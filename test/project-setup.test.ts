import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createJobStore,
  lastJsonObject,
  type PermissionRequest,
  safeModeId,
  strictJsonSchema,
  waitUntilIdle,
} from "../server/agent-runs";
import { initPrompt } from "../server/init";
import { readOnlyAnswer, readOnlyCommand } from "../server/read-only";
import { applyProposal, InitProposalSchema, proposalDiffs } from "../shared/project-setup";
import { isInternalAgent } from "../shared/prompts";
import { emptyProjectConfig } from "../shared/settings";

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
    'rg -n "foo\\.bar" src',
    "find src -name '*.ts' -type f",
    "git grep -n 'Once' -- src",
    "rg -n -e Lazy src",
    "grep -rn 'a b' .",
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
    "find . '-exec' sh -c 'id' ';'",
    "find . -e\\xec id +",
    'find . "-delete"',
    "find . -fprintf out x",
    'rg "--pre" ./evil.sh x',
    "rg --pre=./evil.sh x",
    "rg --hostname-bin=./evil.sh --hyperlink-format=default x",
    "rg -nL x",
    'git grep "-O" sh x',
    "git grep -Osh -l x",
    "git grep --open-files sh x",
    "grep --deref -n x .",
    "ls --deref link",
    "tail -f log.txt",
    "find * -name x",
    "ls src/*",
    "cat a?.ts",
    "rg x | | head",
    "rg -f/etc/passwd .",
    "grep -nf/etc/passwd -r .",
    "git grep -f/etc/passwd",
    "rg -f../secret .",
    "find -files0-from src/list -printf '%p'",
    "wc --files0-from=src/list",
    "git grep x -- ':/'",
    "git ls-files :/",
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
      request({ input: { command: "ls", workdir: "/etc" }, detail: { type: "shell", command: "ls" } }),
      request({ input: { command: "ls" }, detail: { type: "mcp", server: "paseo", tool: "create_terminal" } } as never),
    ]) {
      expect(readOnlyAnswer(denied, CWD).behavior).toBe("deny");
    }
  });
});

describe("links out of the folder", () => {
  it("denies reads and commands that reach outside through a link", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "linear-read-only-"));
    try {
      const root = path.join(base, "repo");
      const outside = path.join(base, "home");
      await mkdir(path.join(root, "src"), { recursive: true });
      await mkdir(outside);
      await writeFile(path.join(root, "src", "a.ts"), "");
      await writeFile(path.join(outside, "id_rsa"), "");
      await symlink(outside, path.join(root, "escape"));
      await symlink(path.join(outside, "id_rsa"), path.join(root, "key"));
      expect(readOnlyCommand("cat src/a.ts", root)).toBe(true);
      expect(readOnlyCommand("ls src", root)).toBe(true);
      for (const command of ["cat key", "cat escape/id_rsa", "ls escape/", "rg x escape", "rg -fkey .", "head --lines=1 key"]) {
        expect(readOnlyCommand(command, root)).toBe(false);
      }
      const read = (filePath: string) =>
        readOnlyAnswer({ id: "p", provider: "claude", name: "Read", kind: "tool", detail: { type: "read", filePath } } as PermissionRequest, root);
      expect(read(path.join(root, "src", "a.ts")).behavior).toBe("allow");
      expect(read(path.join(root, "key")).behavior).toBe("deny");
      const grep = (input: Record<string, unknown>) =>
        readOnlyAnswer({ id: "p", provider: "claude", name: "Grep", kind: "tool", input, detail: { type: "search", query: "x", toolName: "grep" } } as PermissionRequest, root);
      expect(grep({ pattern: "x", path: "src" }).behavior).toBe("allow");
      expect(grep({ pattern: "x", path: "/etc" }).behavior).toBe("deny");
      expect(grep({ pattern: "x", path: "escape" }).behavior).toBe("deny");
    } finally {
      await rm(base, { recursive: true, force: true });
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

describe("the setup agent", () => {
  it("picks a mode that asks before edits and never a bypass default", () => {
    const claude = ["plan", "default", "acceptEdits", "auto", "bypassPermissions"];
    const codex = ["auto", "auto-review", "full-access"];
    const ids = (list: string[]) => list.map((id) => ({ id }));
    expect(safeModeId(ids(claude))).toBe("default");
    expect(safeModeId(ids(codex))).toBe("auto");
    expect(safeModeId(ids(["read-only", "default"]))).toBe("read-only");
    expect(safeModeId(ids(["bypass", "full-access"]))).toBeUndefined();
    expect(safeModeId(undefined)).toBeUndefined();
  });

  it("builds a strict schema: all properties required, no extras, no defaults", () => {
    const schema = strictJsonSchema(InitProposalSchema);
    expect(schema.required).toEqual(["instructions", "steps", "implement", "review"]);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).not.toMatch(/"default"|"\$schema"/);
  });

  it("finds the last JSON object in a fenced block, plain text, or prose", () => {
    expect(lastJsonObject('Done.\n```json\n{"a":1}\n```\n```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(lastJsonObject('{"steps":[]}')).toEqual({ steps: [] });
    expect(lastJsonObject('Here it is: {"steps":["x"]} hope that helps')).toEqual({ steps: ["x"] });
    expect(lastJsonObject("no json here")).toBeNull();
  });

  it("reads the guideline files itself and only reads", () => {
    const prompt = initPrompt("/shop");
    expect(prompt).toContain("/shop");
    expect(prompt).toContain("AGENTS.md");
    expect(prompt).toContain("Do not create, edit, or delete files.");
    expect(prompt).toContain('{"instructions":"...","steps":["..."],"implement":"...","review":"..."}');
  });

  it("is an internal agent, so it gets no pill and no sync", () => {
    expect(isInternalAgent({ "linear.init": "p1" })).toBe(true);
    expect(isInternalAgent({ "linear.issue": "ENG-1" })).toBe(false);
    expect(isInternalAgent(undefined)).toBe(false);
  });

  it("keeps the job and the proposal when the agent finishes", async () => {
    const jobs = createJobStore<string>();
    let finish = (_value: string) => {};
    const result = new Promise<string>((resolve) => {
      finish = resolve;
    });
    const job = await jobs.start(async () => ({ agentId: "a1", result }));
    expect(jobs.get(job.id)).toMatchObject({ job: { status: "running", agentId: "a1" }, value: null });
    finish("proposal");
    await result;
    await Promise.resolve();
    expect(jobs.get(job.id)).toMatchObject({ job: { status: "done" }, value: "proposal" });
    const failed = await jobs.start(async () => {
      throw new Error("No agent provider is ready on this host");
    });
    expect(jobs.get(failed.id)?.job).toMatchObject({ status: "failed", error: "No agent provider is ready on this host" });
  });
});

describe("project setup proposals", () => {
  const config = emptyProjectConfig({ projectId: "p", displayName: "Shop", rootPath: "/shop" });
  const proposal = {
    instructions: "Use pnpm.",
    steps: [" Run pnpm test ", ""],
    implement: "",
    review: "Check migrations.",
  };

  it("lists only fields that change and appends accepted prompt text", () => {
    const diffs = proposalDiffs({ ...config, instructions: "Use pnpm." }, proposal);
    expect(diffs.map((diff) => diff.field)).toEqual(["steps", "review"]);
    expect(applyProposal(proposal, new Set(["steps", "review"]))).toEqual({
      steps: ["Run pnpm test"],
      review: { mode: "append", text: "Check migrations." },
    });
  });
});
