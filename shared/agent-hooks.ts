import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { GuidanceSchema } from "./settings";

// Claude Code hooks for an agent started from an issue. The daemon writes them as a Claude Code
// plugin and the launch passes its folder with --plugin-dir, so they never replace the settings
// Paseo itself passes with --settings. Each hook only prints text; none of them runs project code.

export const IDENTIFIER = /^[A-Za-z][A-Za-z0-9]*-\d+$/;

const HookIssueSchema = z.object({
  identifier: z.string().regex(IDENTIFIER),
  title: z.string(),
  children: z.array(z.object({ identifier: z.string().regex(IDENTIFIER), title: z.string() })).max(10_000),
});
export type HookIssue = z.infer<typeof HookIssueSchema>;

export const agentHooksRpc = defineRpc({
  name: "linear.agent.hooks",
  input: z.object({ issue: HookIssueSchema, guidance: GuidanceSchema }),
  /** Null when no hook applies or the daemon host cannot run them. */
  output: z.object({ pluginDir: z.string().nullable() }),
});

/** Single-quotes text for a POSIX shell. */
export function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`;
}

function printHook(event: string, context: string) {
  const output = { hookSpecificOutput: { hookEventName: event, additionalContext: context } };
  return { type: "command", command: `printf '%s' ${shellQuote(JSON.stringify(output))}` };
}

/** Sub-issues the hook text lists, so the hook command stays under the shell's size limit. */
const HOOK_CHILDREN = 150;

function issueLines(issue: HookIssue): string[] {
  const lines = [`Linear issue ${issue.identifier}: ${issue.title}`];
  for (const child of issue.children.slice(0, HOOK_CHILDREN)) lines.push(`- ${child.identifier}: ${child.title}`);
  const more = issue.children.length - HOOK_CHILDREN;
  if (more > 0) lines.push(`- ${more} more sub-issues. Read ${issue.identifier} for the full list.`);
  return lines;
}

/** The plugin's hooks.json, or null when no guidance option needs a hook. */
export function claudeHooks(issue: HookIssue, guidance: z.infer<typeof GuidanceSchema>) {
  const hooks: Record<string, unknown[]> = {};
  if (guidance.subagentKeys) {
    const context = [
      `You are a subagent for ${issue.identifier}.`,
      ...issueLines(issue),
      "Put the key of the issue you work on in the first line of your reply, such as",
      `"${issue.children[0]?.identifier ?? issue.identifier}: checked the form".`,
      "If your work moves to another issue, state the new key.",
    ].join("\n");
    hooks.SubagentStart = [{ hooks: [printHook("SubagentStart", context)] }];
  }
  if (guidance.updateLinear || guidance.subagentKeys || guidance.paseoSubagents) {
    // After compaction the summary can drop the issue, so restate it.
    const context = [
      `You work on ${issue.identifier}. The Linear rules in your first prompt still apply.`,
      ...issueLines(issue),
    ].join("\n");
    hooks.SessionStart = [{ matcher: "compact", hooks: [printHook("SessionStart", context)] }];
  }
  return Object.keys(hooks).length > 0 ? { hooks } : null;
}

/** Claude Code plugin names are lowercase words joined by hyphens. */
export function hookPluginName(identifier: string): string {
  return `paseo-linear-${identifier.toLowerCase()}`;
}
