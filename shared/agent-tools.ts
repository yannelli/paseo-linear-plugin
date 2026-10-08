import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { IDENTIFIER } from "./agent-hooks";
import type { IssueDetail } from "./linear";

// The plugin's MCP server for agents started from an issue. It gives them Linear tools for
// their issue tree and a way to start Paseo agents on its sub-issues. The daemon hosts it on
// 127.0.0.1, and each agent gets its own bearer token.

export const TOOLS_SERVER = "linear";
/** Children get only the Linear tools, so agents never start agents of their own. */
export const LINEAR_TOOLS = ["read_issue", "edit_issue"] as const;
export const AGENT_TOOLS = ["start_agent", "wait_agent"] as const;

export const McpHttpServerSchema = z.object({
  type: z.literal("http"),
  url: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
});

export const ToolPolicySchema = z.object({
  preapproved: z.array(z.object({ kind: z.literal("mcp"), server: z.string(), tool: z.string() })),
});

export const ToolScopeSchema = z.object({
  /** The issue the launch started from. The tools reach it and its sub-issues. */
  root: z.string().regex(IDENTIFIER),
  /** The issue this agent works on, the default for read_issue and edit_issue. */
  home: z.string().regex(IDENTIFIER),
  /** The Paseo project whose Linear key loaded the issue. */
  keyScope: z.string().nullable(),
  workspaceId: z.string().min(1),
  /** The agent config that started agents copy. */
  config: z.object({
    provider: z.string().min(1),
    thinkingOptionId: z.string().optional(),
    modeId: z.string().optional(),
  }),
});
export type ToolScope = z.infer<typeof ToolScopeSchema>;

export const agentToolsRpc = defineRpc({
  name: "linear.agent.tools",
  input: ToolScopeSchema,
  output: z.object({
    /** Goes in the agent's labels, so a tool call can find the agent that made it. */
    grantId: z.string(),
    server: McpHttpServerSchema,
    toolPolicy: ToolPolicySchema,
  }),
});

export function toolPolicy(tools: readonly string[]): z.infer<typeof ToolPolicySchema> {
  return { preapproved: tools.map((tool) => ({ kind: "mcp" as const, server: TOOLS_SERVER, tool })) };
}

const IssueKey = z.string().regex(IDENTIFIER);

export const ReadIssueInput = z.object({
  issue: IssueKey.optional().describe("Issue key, such as ENG-12. The default is the issue you work on."),
});

export const EditIssueInput = z.object({
  issue: IssueKey.optional().describe("Issue key, such as ENG-12. The default is the issue you work on."),
  old_text: z
    .string()
    .describe("Exact text of the description to replace. It must occur one time. Use an empty string to add new_text at the end."),
  new_text: z.string().describe("The text that replaces old_text."),
});

export const StartAgentInput = z.object({
  issue: IssueKey.describe("Key of the sub-issue the agent works on."),
  title: z.string().min(1).max(120).describe("Short title. Start it with the issue key."),
  prompt: z.string().min(1).describe("The full task. The agent does not see your conversation."),
  thinking: z
    .string()
    .optional()
    .describe("Thinking option of the agent's model, such as low, medium, or high. The default is yours."),
});

export const WaitAgentInput = z.object({
  agent_id: z.string().min(1),
  timeout_seconds: z.number().int().min(1).max(600).default(50),
});

/** Replaces the one place where old text occurs. Empty old text adds the new text at the end. */
export function editText(body: string, oldText: string, newText: string): { body: string } | { error: string } {
  if (oldText === "") return { body: body.trimEnd() ? `${body.trimEnd()}\n\n${newText}` : newText };
  const first = body.indexOf(oldText);
  if (first < 0) return { error: "old_text is not in the description. Read the issue again, because it can change." };
  if (body.indexOf(oldText, first + 1) >= 0) {
    return { error: "old_text occurs more than one time. Add nearby lines so that it occurs one time." };
  }
  return { body: body.slice(0, first) + newText + body.slice(first + oldText.length) };
}

/** Counts Markdown task list items, so a reply can say how many are done. */
export function taskCount(body: string): { done: number; total: number } {
  const items = [...body.matchAll(/^\s*[-*+] \[([ xX])\]/gm)];
  return { done: items.filter((item) => item[1] !== " ").length, total: items.length };
}

/** The issue as text for read_issue. */
export function issueText(issue: IssueDetail): string {
  const tasks = taskCount(issue.description ?? "");
  const lines = [
    `${issue.identifier}: ${issue.title}`,
    `Status: ${issue.state.name}`,
    `URL: ${issue.url}`,
    tasks.total > 0 ? `Task list: ${tasks.done} of ${tasks.total} checked` : null,
    "",
    "Description:",
    issue.description?.trim() || "(empty)",
  ];
  if (issue.children.length > 0) {
    lines.push("", "Sub-issues:");
    for (const child of issue.children) lines.push(`- ${child.identifier} [${child.state.name}]: ${child.title}`);
  }
  return lines.filter((line) => line !== null).join("\n");
}

/** Opens the prompt of an agent that start_agent makes. */
export function childBrief(key: string, root: string): string {
  const parent = key.toUpperCase() === root.toUpperCase() ? "" : `, a sub-issue of ${root}`;
  return [
    `You work on Linear issue ${key}${parent}. Start your first reply with "${key}:".`,
    `Use the ${TOOLS_SERVER} MCP tools: read_issue shows the issue, and edit_issue changes its description.`,
    "Check off each task list item you finish by replacing `- [ ]` with `- [x]`. Do not post comments.",
  ].join("\n");
}
