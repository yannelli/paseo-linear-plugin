import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it } from "vitest";
import {
  type PermissionRequest,
  readOnlyAnswer,
  readOnlyCommand,
  waitUntilIdle,
  withEffort,
} from "../server/agent-runs";
import type { LinearAccess } from "../server/handlers";
import { registerLive } from "../server/live";
import { createKnowledge } from "../server/knowledge";
import { createLaunchQueue, createMapStore, PENDING_LAUNCH_MAX_AGE_MS } from "../server/stores";
import type { IssueDetail } from "../shared/linear";
import type { LaunchInput } from "../shared/live";

const temporary: string[] = [];
async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), "linear-recovery-"));
  temporary.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const CWD = "/repo";

describe("read-only commands", () => {
  it.each([
    'rg -n "AppShell" app components',
    'grep -rn "<main" app',
    "find app -name '*.tsx' 2>/dev/null | head -50",
    "ls -la /repo/components/ui",
    "ls /repo",
    "git ls-files | grep layout",
    'rg "a|b" src',
  ])("allows %s", (command) => {
    expect(readOnlyCommand(command, CWD)).toBe(true);
  });

  it.each([
    "rm -rf src",
    "cat src/a.ts > copy.ts",
    "ls; rm a",
    "ls && touch a",
    "ls\nrm a",
    "cat $HOME/.ssh/id_rsa",
    'cat "$(whoami)"',
    "cat /etc/passwd",
    'cat "/etc/passwd"',
    "ls ..",
    "find . -name x -delete",
    "find . -exec rm {} +",
    "rg --pre sh x",
    "git grep -O x",
    "git commit -m x",
    "FOO=1 rg x",
    "cat ~/secret",
  ])("denies %s", (command) => {
    expect(readOnlyCommand(command, CWD)).toBe(false);
  });

  it("answers reads and safe commands with allow and everything else with deny", () => {
    const request = (fields: Partial<PermissionRequest>) =>
      ({ id: "p", provider: "claude", name: "Tool", kind: "tool", ...fields }) as PermissionRequest;
    const allow = { behavior: "allow" };
    expect(readOnlyAnswer(request({ detail: { type: "read", filePath: "/repo/a.ts" } }), CWD)).toEqual(allow);
    expect(readOnlyAnswer(request({ detail: { type: "shell", command: "rg x" } }), CWD)).toEqual(allow);
    expect(readOnlyAnswer(request({ input: { command: "ls src" } }), CWD)).toEqual(allow);
    for (const denied of [
      request({ detail: { type: "read", filePath: "/etc/hosts" } }),
      request({ detail: { type: "edit", filePath: "/repo/a.ts" } }),
      request({ detail: { type: "fetch", url: "https://example.com" } }),
      request({ detail: { type: "search", query: "x", toolName: "web_search" } }),
      request({ kind: "question" }),
      request({ kind: "plan" }),
    ]) {
      expect(readOnlyAnswer(denied, CWD).behavior).toBe("deny");
    }
  });
});

type Finish = { status: string; final?: { pendingPermissions: PermissionRequest[] } | null };

function fakeAgent(id: string, reply: string, finishes: Finish[] = []) {
  const calls = { archived: 0, answers: [] as unknown[] };
  const queue = [...finishes];
  const handle = {
    id,
    waitForFinish: async () => queue.shift() ?? { status: "idle", final: null },
    respondToPermission: async (answer: unknown) => {
      calls.answers.push(answer);
    },
    timeline: {
      refetch: async () => ({ entries: [{ item: { type: "assistant_message", text: reply } }] }),
      append: async () => ({ seq: 1, epoch: "e" }),
    },
    archive: async () => {
      calls.archived += 1;
      return { archivedAt: "now" };
    },
  };
  return { handle, calls };
}

describe("waiting for an internal agent", () => {
  it("answers permission prompts and keeps waiting", async () => {
    const shell = { id: "p1", kind: "tool", detail: { type: "shell", command: "rg x" } };
    const write = { id: "p2", kind: "tool", detail: { type: "write", filePath: "/repo/x" } };
    const { handle, calls } = fakeAgent("a", "", [
      { status: "permission", final: { pendingPermissions: [shell, write] as PermissionRequest[] } },
      { status: "idle" },
    ]);
    await waitUntilIdle(handle as never, CWD, 1000);
    expect(calls.answers).toEqual([
      { requestId: "p1", response: { behavior: "allow" } },
      { requestId: "p2", response: expect.objectContaining({ behavior: "deny" }) },
    ]);
  });
});

describe("launch queue", () => {
  const launch = (identifier: string): LaunchInput => ({
    workspaceId: "w",
    identifier,
    keyScope: null,
    agent: { config: { provider: "claude" }, title: "t", prompt: "p", labels: {} },
    card: { identifier, title: "t", url: "https://linear.app/x" } as LaunchInput["card"],
  });

  it("gives each waiting launch to one claim only", async () => {
    const queue = createLaunchQueue(path.join(await scratch(), "launches.json"));
    await queue.add(launch("ENG-1"));
    await queue.add(launch("ENG-2"));
    const [first, second] = await Promise.all([queue.claim("ENG-1"), queue.claim("ENG-1")]);
    expect(first.length + second.length).toBe(1);
    expect(await queue.claim("ENG-2")).toHaveLength(1);
  });

  it("drops launches that waited too long", async () => {
    let time = 0;
    const queue = createLaunchQueue(path.join(await scratch(), "launches.json"), () => time);
    await queue.add(launch("ENG-1"));
    time = PENDING_LAUNCH_MAX_AGE_MS + 1;
    expect(await queue.claim("ENG-1")).toEqual([]);
  });
});

const issue = {
  identifier: "ENG-1",
  title: "Drafts",
  description: null,
  children: [{ identifier: "ENG-2", title: "Queue" }],
} as unknown as IssueDetail;

async function harness(agents: { id: string; cwd: string; archivedAt: string | null }[]) {
  const handlers = new Map<string, (input: unknown, context: unknown) => Promise<unknown>>();
  const hooks = new Map<string, (event: unknown, context: unknown) => Promise<void>>();
  const server = {
    handle: (contract: { name: string }, handler: (input: unknown, context: unknown) => Promise<unknown>) =>
      handlers.set(contract.name, handler),
    on: (name: string, handler: (event: unknown, context: unknown) => Promise<void>) => {
      hooks.set(name, handler);
      return () => {};
    },
  } as unknown as PluginServerContext;
  const directory = await scratch();
  const maps = createMapStore(path.join(directory, "maps.json"));
  const launches = createLaunchQueue(path.join(directory, "launches.json"));
  const access = { connect: async () => ({ linear: { getIssue: async () => issue } }) };
  registerLive(server, {
    access: access as unknown as LinearAccess,
    maps,
    launches,
    knowledge: createKnowledge(path.join(directory, "knowledge")),
    readSettings: async () => null,
  });
  const orphan = fakeAgent("explore-1", '```json\n{"files":[{"path":"src/q.ts","issue":"ENG-2"}]}\n```');
  const created: unknown[] = [];
  const paseo = {
    agents: {
      list: async () => ({ entries: agents.map((agent) => ({ agent: { ...agent, labels: {} } })) }),
      ref: () => orphan.handle,
    },
    workspaces: {
      ref: () => ({
        agents: {
          create: async (input: unknown) => {
            created.push(input);
            return { id: `agent-${created.length}`, timeline: orphan.handle.timeline };
          },
        },
      }),
    },
  };
  return { handlers, hooks, maps, launches, orphan, created, paseo };
}

describe("explore recovery", () => {
  it("adopts an unarchived explore agent, saves its map, and archives it", async () => {
    const { handlers, maps, orphan, paseo } = await harness([
      { id: "explore-1", cwd: "/repo", archivedAt: null },
    ]);
    await handlers.get("linear.live.map")?.({ identifier: "ENG-1" }, { paseo });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect((await maps.get("ENG-1"))?.files).toEqual([{ path: "src/q.ts", issue: "ENG-2" }]);
    expect(orphan.calls.archived).toBe(1);
  });

  it("starts a waiting launch once when the hook and the panel both recover the run", async () => {
    const { handlers, hooks, launches, created, paseo } = await harness([
      { id: "explore-1", cwd: "/repo", archivedAt: null },
    ]);
    await launches.add({
      workspaceId: "w",
      identifier: "ENG-1",
      keyScope: null,
      agent: { config: { provider: "claude" }, title: "t", prompt: "p", labels: {} },
      card: { identifier: "ENG-1" } as LaunchInput["card"],
    });
    await Promise.all([
      hooks.get("agent.turn_ended")?.({ agent: { title: "Explore ENG-1" } }, { paseo }),
      handlers.get("linear.live.map")?.({ identifier: "ENG-1" }, { paseo }),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(created).toHaveLength(1);
  });

  it("starts waiting launches when no explore agent is left", async () => {
    const { handlers, launches, created, paseo } = await harness([
      { id: "explore-1", cwd: "/repo", archivedAt: "earlier" },
    ]);
    await launches.add({
      workspaceId: "w",
      identifier: "ENG-1",
      keyScope: null,
      agent: { config: { provider: "claude" }, title: "t", prompt: "p", labels: {} },
      card: { identifier: "ENG-1" } as LaunchInput["card"],
    });
    await handlers.get("linear.live.map")?.({ identifier: "ENG-1" }, { paseo });
    expect(created).toHaveLength(1);
  });
});

describe("waiting when the finish result has no snapshot", () => {
  it("reads pending prompts from a refresh and answers each one once", async () => {
    const request = { id: "p1", kind: "tool", detail: { type: "shell", command: "ls" } };
    const { handle, calls } = fakeAgent("a", "", [
      { status: "permission", final: null },
      { status: "permission", final: { pendingPermissions: [request] as PermissionRequest[] } },
      { status: "idle" },
    ]);
    const refreshed = Object.assign(handle, {
      pendingPermissions: [request],
      refresh: async () => null,
    });
    await waitUntilIdle(refreshed as never, CWD, 5000);
    expect(calls.answers).toEqual([{ requestId: "p1", response: { behavior: "allow" } }]);
  });

  it("denies a path passed after an equals sign", () => {
    expect(readOnlyCommand("rg --file=/etc/passwd x", CWD)).toBe(false);
  });
});

describe("explore effort", () => {
  it("applies the effort only to the chosen model", () => {
    expect(withEffort({ provider: "claude/claude-haiku-5-5" }, "claude/claude-haiku-5-5", "low")).toEqual({
      provider: "claude/claude-haiku-5-5",
      thinkingOptionId: "low",
    });
    expect(withEffort({ provider: "codex" }, "claude/claude-haiku-5-5", "low")).toEqual({ provider: "codex" });
    expect(withEffort({ provider: "claude" }, "claude", "low")).toEqual({ provider: "claude" });
    expect(withEffort({ provider: "claude/x" }, "claude/x", "")).toEqual({ provider: "claude/x" });
  });
});
