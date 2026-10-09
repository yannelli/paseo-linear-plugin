import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../client/ui", () => ({ errorMessage: (error: unknown) => String(error) }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => null }));
import { withHookPlugin } from "../client/launch-plan";
import { registerAgentHooks } from "../server/agent-hooks";
import { claudeHooks, shellQuote } from "../shared/agent-hooks";
import type { IssueDetail } from "../shared/linear";
import { ALL_TOOLS, guidanceSections } from "../shared/prompts";
import { GuidanceSchema, linearSettings, projectDefaults, withProjectGuidance } from "../shared/settings";

const ALL = { updateLinear: true, subagentKeys: true, paseoSubagents: true };
const NONE = GuidanceSchema.parse({});
const issue = {
  identifier: "ENG-1",
  title: "Checkout",
  children: [{ identifier: "ENG-2", title: "It's the form" }],
} as unknown as IssueDetail;

describe("guidance in the prompt", () => {
  it("adds one section per option, with the plugin's MCP tools and no comments", () => {
    expect(guidanceSections(issue, NONE)).toEqual([]);
    const sections = guidanceSections(issue, ALL);
    expect(sections).toHaveLength(3);
    expect(sections[0]).toContain('"ENG-2: add the form"');
    expect(sections[0]).toContain("edit_issue");
    expect(sections[0]).toContain("Do not post comments.");
    expect(sections[2]).toContain("start_agent");
  });

  it("leaves out tools that are off, and edits when only reading is allowed", () => {
    const off = guidanceSections(issue, ALL, { ...ALL_TOOLS, enabled: false });
    expect(off).toHaveLength(2);
    expect(off[0]).toContain('"ENG-2: add the form"');
    expect(off[0]).toContain("Do not change the issue or post comments.");
    expect(off.join("\n")).not.toMatch(/edit_issue|read_issue|start_agent/);
    const read = guidanceSections(issue, ALL, { ...ALL_TOOLS, allowEdits: false })[0];
    expect(read).toContain("read_issue");
    expect(read).not.toContain("edit_issue");
  });

  it("lists the agents chosen for sub-issues, with the limit", () => {
    const tools = { ...ALL_TOOLS, maxAgents: 2, assignments: [{ identifier: "ENG-2", label: "Codex · GPT-5.5" }] };
    const alone = guidanceSections(issue, NONE, tools);
    expect(alone).toHaveLength(1);
    expect(alone[0]).toContain("- ENG-2: Codex · GPT-5.5");
    expect(alone[0]).toContain("wait_agent");
    expect(alone[0]).toContain("Run at most 2 of these agents");
    const both = guidanceSections(issue, { ...NONE, paseoSubagents: true }, tools);
    expect(both).toHaveLength(2);
    expect(both[0]).toContain("or on the agent the user chose for the sub-issue");
    expect(both[1]).not.toContain("wait_agent");
    expect(guidanceSections(issue, NONE, { ...tools, enabled: false })).toEqual([]);
  });

  it("applies a project's own values over the values for all projects", () => {
    const values = linearSettings.schema.parse({
      launch: { provider: "claude/opus", includeComments: false },
      live: { syncTodos: true },
      projects: [
        {
          projectId: "p1",
          displayName: "Shop",
          rootPath: "/shop",
          overrides: { provider: "", isolation: "workspace", syncTodos: false, assignAgents: false },
        },
      ],
    });
    const own = projectDefaults(values, "p1");
    expect(own.launch).toEqual({ provider: "", isolation: "workspace", includeComments: false, moveToStarted: true, assignToMe: true });
    expect(own.syncTodos).toBe(false);
    expect(own.tools).toEqual({ enabled: true, allowEdits: true, assignAgents: false, maxAgents: 0 });
    const shared = projectDefaults(values, "p2");
    expect(shared.launch.provider).toBe("claude/opus");
    expect(shared.syncTodos).toBe(true);
    expect(projectDefaults(values, null)).toEqual(shared);
  });

  it("saves guidance to a project, adding the project when it is new", () => {
    const values = linearSettings.schema.parse({});
    const project = { projectId: "p1", displayName: "Shop", rootPath: "/shop" };
    const added = withProjectGuidance(values, project, ALL);
    expect(added.projects).toHaveLength(1);
    expect(added.projects[0]).toMatchObject({ projectId: "p1", teamIds: [], guidance: ALL });
    const changed = withProjectGuidance(added, project, NONE);
    expect(changed.projects).toHaveLength(1);
    expect(changed.projects[0]?.guidance).toEqual(NONE);
  });
});

describe("Claude hooks", () => {
  const hookIssue = { identifier: "ENG-1", title: "Checkout", children: [{ identifier: "ENG-2", title: "It's the form" }] };

  it("adds no hooks without guidance", () => {
    expect(claudeHooks(hookIssue, NONE)).toBeNull();
    expect(Object.keys(claudeHooks(hookIssue, { ...NONE, updateLinear: true })?.hooks ?? {})).toEqual(["SessionStart"]);
  });

  it("prints valid hook output through a real shell, quotes included", () => {
    const hooks = claudeHooks(hookIssue, ALL)?.hooks as Record<string, { hooks: { command: string }[] }[]>;
    for (const event of ["SubagentStart", "SessionStart"]) {
      const command = hooks[event]?.[0]?.hooks[0]?.command ?? "";
      const output = JSON.parse(execFileSync("sh", ["-c", command], { encoding: "utf8" }));
      expect(output.hookSpecificOutput.hookEventName).toBe(event);
      expect(output.hookSpecificOutput.additionalContext).toContain("ENG-2: It's the form");
    }
    expect(execFileSync("sh", ["-c", `printf '%s' ${shellQuote("a'b $HOME `x`")}`], { encoding: "utf8" })).toBe("a'b $HOME `x`");
  });

  it("writes a plugin folder the launch passes with --plugin-dir", async () => {
    const data = await mkdtemp(path.join(tmpdir(), "linear-hooks-"));
    const handlers = new Map<string, (input: unknown) => Promise<{ pluginDir: string | null }>>();
    const server = { handle: (rpc: { name: string }, handler: never) => handlers.set(rpc.name, handler) };
    registerAgentHooks(server as unknown as PluginServerContext, data);
    const write = handlers.get("linear.agent.hooks");
    const { pluginDir } = (await write?.({ issue: hookIssue, guidance: ALL })) ?? { pluginDir: null };
    expect(pluginDir).toMatch(/claude-hooks\/ENG-1-[0-9a-f]{12}$/);
    const manifest = JSON.parse(await readFile(path.join(pluginDir as string, ".claude-plugin", "plugin.json"), "utf8"));
    expect(manifest.name).toBe("paseo-linear-eng-1");
    expect(await write?.({ issue: hookIssue, guidance: NONE })).toEqual({ pluginDir: null });
    expect(withHookPlugin({ provider: "claude/x" }, pluginDir)).toEqual({
      provider: "claude/x",
      providerOptions: { extraArgs: { "plugin-dir": pluginDir } },
    });
    expect(withHookPlugin({ provider: "claude/x" }, null)).toEqual({ provider: "claude/x" });
    await rm(data, { recursive: true, force: true });
  });
});
