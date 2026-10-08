import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { IssueDetail } from "../shared/linear";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createJobStore, safeModeId, strictJsonSchema } from "../server/agent-runs";
import type { LinearAccess } from "../server/handlers";
import {
  explorePrompt,
  listDirectories,
  registerLive,
  toIssueMap,
} from "../server/live";
import { createLaunchQueue, createMapStore } from "../server/stores";
import { ExploreResultSchema, InitProposalSchema } from "../shared/live";

const temporary: string[] = [];
async function scratch() {
  const dir = await mkdtemp(path.join(tmpdir(), "linear-live-"));
  temporary.push(dir);
  return dir;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const state = { id: "s", name: "Todo", type: "unstarted", color: "#ccc", position: 1 };
const issue = {
  id: "i1",
  identifier: "ENG-1",
  title: "Offline drafts",
  description: "Store drafts locally.",
  url: "https://linear.app/acme/issue/ENG-1",
  team: { id: "t", key: "ENG", name: "Engineering" },
  state,
  priorityLabel: "High",
  labels: [],
  parent: null,
  attachments: [],
  comments: [],
  children: [{ id: "c2", identifier: "ENG-2", title: "Queue", state }],
} as unknown as IssueDetail;

describe("directory listing", () => {
  it("lists files inside the agent folder and skips anything that escapes it", async () => {
    const root = await scratch();
    const outside = await scratch();
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "b.ts"), "");
    await writeFile(path.join(root, "src", "a.ts"), "");
    await mkdir(path.join(root, "src", "nested"));
    await writeFile(path.join(outside, "secret.txt"), "");
    await symlink(outside, path.join(root, "escape"));
    const result = await listDirectories(root, ["src/", "../", "/etc/", "escape/", ""]);
    expect(result).toEqual([
      { dir: "src/", files: ["a.ts", "b.ts"], truncated: false },
      { dir: "", files: [], truncated: false },
    ]);
  });
});

describe("explore results", () => {
  it("keeps repo-relative paths and known keys only", () => {
    const map = toIssueMap(
      issue,
      "/work/tree",
      {
        files: [
          { path: "/work/tree/src/queue.ts", issue: "eng-2" },
          { path: "src/queue.ts", issue: "ENG-2" },
          { path: "../outside.ts", issue: "ENG-2" },
          { path: "docs/offline.md", issue: "OPS-9" },
        ],
      },
      new Date("2026-10-07T00:00:00Z"),
    );
    expect(map.files).toEqual([
      { path: "src/queue.ts", issue: "ENG-2" },
      { path: "docs/offline.md", issue: "ENG-1" },
    ]);
    expect(explorePrompt(issue)).toContain("Valid keys: ENG-1, ENG-2.");
  });

  it("stores maps on disk and reads them back", async () => {
    const file = path.join(await scratch(), "data", "live-maps.json");
    const map = { identifier: "ENG-1", source: "explore" as const, files: [], createdAt: "2026-10-07T00:00:00Z" };
    await createMapStore(file).set(map);
    expect(await createMapStore(file).get("ENG-1")).toEqual(map);
    expect(await createMapStore(file).get("ENG-9")).toBeNull();
    await createMapStore(file).delete("ENG-1");
    expect(await createMapStore(file).get("ENG-1")).toBeNull();
  });

  it("forgets a finished job so the next start runs again, but keeps a running one", async () => {
    const jobs = createJobStore<string>();
    let finish = (_value: string) => {};
    const result = new Promise<string>((resolve) => {
      finish = resolve;
    });
    await jobs.start("ENG-1", async () => ({ agentId: "a1", result }));
    jobs.forget("ENG-1");
    expect(jobs.get("ENG-1")?.job.status).toBe("running");
    finish("map");
    await jobs.wait("ENG-1");
    jobs.forget("ENG-1");
    expect(jobs.get("ENG-1")).toBeNull();
  });
});

describe("internal agent runs", () => {
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

  it("builds strict schemas: all properties required, no extras, no defaults", () => {
    const init = strictJsonSchema(InitProposalSchema);
    expect(init.required).toEqual(["instructions", "steps", "implement", "review"]);
    expect(init.additionalProperties).toBe(false);
    expect(JSON.stringify(init)).not.toMatch(/"default"|"\$schema"/);
    const explore = JSON.stringify(strictJsonSchema(ExploreResultSchema));
    expect(explore).not.toMatch(/minLength|maxItems/);
  });

  it("reuses a stored map instead of starting another explore agent", async () => {
    const handlers = new Map<string, (input: unknown, context: unknown) => Promise<unknown>>();
    const server = {
      handle: (contract: { name: string }, handler: (input: unknown, context: unknown) => Promise<unknown>) =>
        handlers.set(contract.name, handler),
      on: () => () => {},
    } as unknown as PluginServerContext;
    const directory = await scratch();
    const maps = createMapStore(path.join(directory, "maps.json"));
    const launches = createLaunchQueue(path.join(directory, "launches.json"));
    await maps.set({ identifier: "ENG-1", source: "explore", files: [], createdAt: "2026-10-07T00:00:00Z" });
    let created = 0;
    const agent = { id: "a1", cwd: "/w", provider: "claude", labels: { "linear.issue": "ENG-1" } };
    const paseo = {
      agents: { ref: () => ({ refresh: async () => null, current: () => agent }) },
      workspaces: { ref: () => ({ agents: { create: async () => (created += 1) } }) },
    };
    const access = { connect: async () => { throw new Error("no Linear call expected"); } };
    registerLive(server, {
      access: access as unknown as LinearAccess,
      maps,
      launches,
      readSettings: async () => null,
    });
    const result = (await handlers.get("linear.live.explore")?.({ agentId: "a1", force: false }, { paseo })) as {
      job: { status: string };
    };
    expect(result.job.status).toBe("done");
    expect(created).toBe(0);
  });
});
