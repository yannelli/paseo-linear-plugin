import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { subagentLogs, transcriptItems } from "../server/subagent-logs";
import { deriveActivity } from "../shared/activity";

const CWD = "/repo";
const WORKTREE = "/repo/.claude/worktrees/agent-a1";
const line = (entry: unknown) => JSON.stringify(entry);
const use = (id: string, name: string, input: unknown) =>
  line({ type: "assistant", message: { stop_reason: "tool_use", content: [{ type: "tool_use", id, name, input }] } });
const result = (id: string, error = false) =>
  line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: error }] } });
const TRANSCRIPT = [
  line({ type: "user", message: { content: "Review src/a.ts" } }),
  use("t1", "Read", { file_path: `${WORKTREE}/src/a.ts` }),
  result("t1"),
  use("t2", "Bash", { command: `cat ${WORKTREE}/src/b.ts && rg -n foo src` }),
  result("t2"),
  use("t3", "Edit", { file_path: `${WORKTREE}/src/a.ts`, old_string: "a", new_string: "b\nc" }),
  result("t3", true),
  use("t4", "Grep", { pattern: "TODO" }),
].join("\n");

describe("subagent transcripts", () => {
  const move = (value: string) => value.split(WORKTREE).join(CWD);

  it("turns tool calls into timeline items on the agent's paths", () => {
    const { items, finished } = transcriptItems(TRANSCRIPT, move, CWD);
    expect(finished).toBe(false);
    expect(items.map((item) => [item.name, item.status, item.detail])).toEqual([
      ["Read", "completed", { type: "read", filePath: "/repo/src/a.ts" }],
      ["Bash", "completed", { type: "shell", command: "cat /repo/src/b.ts && rg -n foo src", cwd: CWD }],
      ["Edit", "failed", { type: "edit", filePath: "/repo/src/a.ts", added: 2, removed: 1 }],
      ["Grep", "running", { type: "search", query: "TODO" }],
    ]);
    const activity = deriveActivity(items, CWD);
    expect(activity.files.map((file) => file.path).sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(activity.current?.text).toBe('Searched "TODO"');
  });

  it("sees the end of a run and skips broken lines", () => {
    const done = line({ type: "assistant", message: { stop_reason: "end_turn", content: [{ type: "text", text: "ok" }] } });
    expect(transcriptItems(`{"cut\n${TRANSCRIPT}\n${done}`, move, CWD).finished).toBe(true);
  });
});

describe("finding transcripts", () => {
  let home = "";
  const saved = process.env.CLAUDE_CONFIG_DIR;
  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "claude-home-"));
    const folder = path.join(home, "projects", "-repo", "session-1234", "subagents");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "agent-a1.jsonl"), TRANSCRIPT);
    await writeFile(
      path.join(folder, "agent-a1.meta.json"),
      JSON.stringify({ agentType: "code-reviewer", description: "Review auth", toolUseId: "toolu_1", worktreePath: WORKTREE }),
    );
    process.env.CLAUDE_CONFIG_DIR = home;
  });
  afterAll(async () => {
    process.env.CLAUDE_CONFIG_DIR = saved;
    await rm(home, { recursive: true, force: true });
  });

  it("reads the session's subagents and rejects unsafe session ids", async () => {
    const [run] = await subagentLogs("session-1234", CWD);
    expect(run).toMatchObject({ id: "a1", type: "code-reviewer", description: "Review auth", toolUseId: "toolu_1" });
    expect(run?.items[0]?.detail).toEqual({ type: "read", filePath: "/repo/src/a.ts" });
    expect(await subagentLogs("../../etc", CWD)).toEqual([]);
    expect(await subagentLogs("session-9999", CWD)).toEqual([]);
  });
});
