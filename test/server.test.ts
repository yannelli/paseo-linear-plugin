import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createResponseCache } from "../server/cache";
import { createCredentialStore } from "../server/credentials";
import { registerHandlers } from "../server/handlers";
import { createLinearService, flattenAncestors, ISSUE_SORT_INPUT } from "../server/queries";
import { authStatusRpc, cachedIssuesRpc, listIssuesRpc, updateIssueRpc } from "../shared/linear";

let directory = "";
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "paseo-linear-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("credential scopes", () => {
  it("reads a version 1 file as the default key", async () => {
    const file = path.join(directory, "credentials.json");
    await writeFile(file, JSON.stringify({ apiKey: "lin_api_old" }));
    const store = createCredentialStore({ file, env: {} });
    expect(await store.resolve("project-a")).toEqual({ apiKey: "lin_api_old", source: "file" });
    expect(await store.projectKeys()).toEqual([]);
  });

  it("uses a project key first, then the default key, then the environment", async () => {
    const file = path.join(directory, "credentials.json");
    const store = createCredentialStore({ file, env: { LINEAR_API_KEY: "lin_api_env" } });
    await store.save("lin_api_project", "project-a");
    expect(await store.resolve("project-a")).toEqual({
      apiKey: "lin_api_project",
      source: "project",
    });
    expect(await store.resolve("project-b")).toEqual({
      apiKey: "lin_api_env",
      source: "environment",
    });
    await store.save("lin_api_default");
    expect(await store.resolve(null)).toEqual({ apiKey: "lin_api_default", source: "file" });

    await store.clear();
    expect(await store.projectKeys()).toEqual([
      { projectId: "project-a", apiKey: "lin_api_project" },
    ]);
    await store.clear("project-a");
    await expect(readFile(file, "utf8")).rejects.toThrow();
  });
});

describe("Linear queries", () => {
  it("flattens the parent chain root first and stops at a cycle", () => {
    const root = { id: "1", identifier: "ENG-1", title: "Root" };
    const middle = { id: "2", identifier: "ENG-2", title: "Middle", parent: root };
    expect(
      flattenAncestors({ id: "3", identifier: "ENG-3", title: "Parent", parent: middle }),
    ).toEqual([
      root,
      { id: "2", identifier: "ENG-2", title: "Middle" },
      {
        id: "3",
        identifier: "ENG-3",
        title: "Parent",
      },
    ]);
    const loop = {
      id: "1",
      identifier: "ENG-1",
      title: "A",
      parent: { id: "1", identifier: "ENG-1", title: "A" },
    };
    expect(flattenAncestors(loop)).toHaveLength(1);
    expect(flattenAncestors(null)).toEqual([]);
  });

  it("sends the selected sort to Linear", async () => {
    const sent: unknown[] = [];
    const service = createLinearService(async (_query, variables) => {
      sent.push(variables?.sort);
      return { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    });
    const base = {
      teamId: null,
      assignee: "anyone",
      status: "all",
      query: "",
      after: null,
    } as const;
    await service.listIssues({ ...base, sort: "priority" });
    await service.listIssues(base);
    expect(sent).toEqual([ISSUE_SORT_INPUT.priority, ISSUE_SORT_INPUT.updated]);
  });
});

type Handler = (input: unknown, context: unknown) => Promise<unknown>;

async function withHandlers(run: (call: Call, keys: string[]) => Promise<void>) {
  const keys: string[] = [];
  const linear = createServer((request, response) => {
    keys.push(request.headers.authorization ?? "");
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { query: string };
      const data = body.query.includes("issueUpdate")
        ? { issueUpdate: { success: true, issue: null } }
        : { issues: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ data }));
    });
  });
  await new Promise<void>((resolve) => linear.listen(0, "127.0.0.1", resolve));
  const handlers = new Map<string, Handler>();
  const server = {
    handle: (contract: { name: string }, handler: Handler) => handlers.set(contract.name, handler),
  } as unknown as PluginServerContext;
  const credentials = createCredentialStore({ file: path.join(directory, "c.json"), env: {} });
  await credentials.save("lin_api_default");
  await credentials.save("lin_api_project", "project-a");
  const { port } = linear.address() as AddressInfo;
  registerHandlers(server, {
    credentials,
    endpoint: `http://127.0.0.1:${port}/graphql`,
    cache: createResponseCache({ maxEntries: 10, maxAgeMs: 60_000 }),
  });
  const call: Call = (contract, input) =>
    handlers.get(contract.name)!(contract.input.parse(input), {});
  try {
    await run(call, keys);
  } finally {
    await new Promise<void>((resolve) => linear.close(() => resolve()));
  }
}

type Call = (
  contract: { name: string; input: { parse(input: unknown): unknown } },
  input: unknown,
) => Promise<unknown>;

describe("handlers", () => {
  const query = { teamId: null, assignee: "anyone", status: "all", query: "", after: null };

  it("uses the project key and reports saved project keys", async () => {
    await withHandlers(async (call, keys) => {
      await call(listIssuesRpc, { ...query, projectId: "project-a" });
      await call(listIssuesRpc, query);
      expect(keys).toEqual(["lin_api_project", "lin_api_default"]);
      expect(await call(authStatusRpc, { projectId: "project-a" })).toEqual({
        configured: true,
        source: "project",
        keyHint: "…ject",
        projectKeys: [{ projectId: "project-a", keyHint: "…ject" }],
      });
    });
  });

  it("serves cached lists per key and drops them after an edit", async () => {
    await withHandlers(async (call) => {
      expect(await call(cachedIssuesRpc, query)).toEqual({ value: null, fetchedAt: null });
      await call(listIssuesRpc, query);
      const cached = (await call(cachedIssuesRpc, query)) as { value: unknown; fetchedAt: string };
      expect(cached.value).toEqual({ issues: [], endCursor: null, hasNextPage: false });
      expect(typeof cached.fetchedAt).toBe("string");
      expect(await call(cachedIssuesRpc, { ...query, projectId: "project-a" })).toEqual({
        value: null,
        fetchedAt: null,
      });
      await expect(call(updateIssueRpc, { id: "ENG-1", patch: { priority: 1 } })).rejects.toThrow();
      expect(await call(cachedIssuesRpc, query)).toEqual({ value: null, fetchedAt: null });
    });
  });
});

describe("response cache", () => {
  it("evicts the least recently used entry and expires old entries", () => {
    let now = 0;
    const cache = createResponseCache({ maxEntries: 2, maxAgeMs: 100, now: () => now });
    cache.set("a", 1);
    cache.set("b", 2);
    cache.get("a");
    cache.set("c", 3);
    expect(cache.get("b")).toBeNull();
    expect(cache.get("a")?.value).toBe(1);
    now = 101;
    expect(cache.get("c")).toBeNull();
  });
});
