import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paseo } from "../server/agent-runs";
import { ALL_AGENTS_OFF, LINEAR_OFF, registerAgentTools } from "../server/agent-tools";
import type { LinearAccess } from "../server/handlers";
import { type CreateRequest, projectToolsHook } from "../server/project-tools";
import type { LinearService } from "../server/queries";
import { TOOLS_INSTRUCTIONS } from "../shared/agent-tools";
import { type LinearSettings, linearSettings } from "../shared/settings";

const minted = {
  server: { type: "http" as const, url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer p.x.y" } },
  toolPolicy: { preapproved: [{ kind: "mcp" as const, server: "linear", tool: "read_issue" }] },
};

function fakePaseo() {
  const workspaces = vi.fn(async () => ({
    entries: [
      { projectId: "p1", projectRootPath: "/repo", workspaceDirectory: "/worktrees/one" },
      { projectId: "p2", projectRootPath: "/other", workspaceDirectory: "/other" },
    ],
    pageInfo: { hasMore: false, nextCursor: null },
  }));
  const agents = vi.fn(async () => ({
    entries: [
      { agent: { provider: "cursor", capabilities: { supportsMcpServers: true } } },
      { agent: { provider: "mock", capabilities: { supportsMcpServers: false } } },
    ],
  }));
  return { paseo: { workspaces: { list: workspaces }, agents: { list: agents } } as unknown as Paseo, workspaces };
}

const request = (config: Partial<CreateRequest["config"]> = {}): CreateRequest => ({
  config: { provider: "claude", cwd: "/worktrees/one/src", ...config } as CreateRequest["config"],
});

describe("Linear tools for every agent of a project", () => {
  function setup(values: unknown = {}, keyed = true) {
    const access = {
      connect: async () => {
        if (!keyed) throw new Error("Connect Linear: add an API key in Linear settings");
        return { linear: {} as LinearService, fingerprint: "f" };
      },
    } as unknown as LinearAccess;
    const mint = vi.fn(async () => minted);
    const add = projectToolsHook({ access, readSettings: async () => linearSettings.schema.parse(values), mint });
    return { add, mint, ...fakePaseo() };
  }

  it("adds the server to an agent in a project folder, and keeps its other servers", async () => {
    const { add, paseo, workspaces, mint } = setup();
    const browser = { type: "stdio" as const, command: "browser" };
    const own = { kind: "mcp" as const, server: "browser", tool: "open" };
    const next = await add(request({ mcpServers: { browser }, toolPolicy: { preapproved: [own] } }), paseo);
    expect(mint).toHaveBeenCalledWith("p1");
    expect(next?.config.mcpServers).toEqual({ browser, linear: minted.server });
    expect(next?.config.toolPolicy?.preapproved).toEqual([own, ...minted.toolPolicy.preapproved]);
    expect(await add(request(), paseo)).toBeDefined();
    expect(workspaces).toHaveBeenCalledTimes(1);
  });

  it("leaves agents that have the tools, or are outside a project, alone", async () => {
    const { add, paseo } = setup();
    expect(await add(request({ mcpServers: { linear: minted.server } }), paseo)).toBeUndefined();
    expect(await add(request({ cwd: "/tmp/elsewhere" }), paseo)).toBeUndefined();
    expect(await add(request({ cwd: "/repository" }), paseo)).toBeUndefined();
  });

  it("follows the project's settings and needs a Linear key", async () => {
    const off = { access: { allProjects: true, projects: { p1: false } } };
    expect(await setup(off).add(request(), fakePaseo().paseo)).toBeUndefined();
    const own = { projects: [{ projectId: "p1", displayName: "One", rootPath: "/repo", overrides: { allAgents: false } }] };
    expect(await setup(own).add(request(), fakePaseo().paseo)).toBeUndefined();
    expect(await setup(own).add(request({ cwd: "/other" }), fakePaseo().paseo)).toBeDefined();
    expect(await setup({ tools: { enabled: false } }).add(request(), fakePaseo().paseo)).toBeUndefined();
    expect(await setup({}, false).add(request(), fakePaseo().paseo)).toBeUndefined();
  });

  it("adds the server only for providers that can use MCP servers", async () => {
    const { add, paseo } = setup();
    expect(await add(request({ provider: "mock" }), paseo)).toBeUndefined();
    expect(await add(request({ provider: "unknown" }), paseo)).toBeUndefined();
    expect(await add(request({ provider: "cursor" }), paseo)).toBeDefined();
  });
});

describe("project tokens over HTTP", () => {
  let directory: string | null = null;
  let close: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await close?.();
    if (directory) await rm(directory, { recursive: true, force: true });
    close = null;
    directory = null;
  });

  it("serve the project's tools until the settings turn them off", async () => {
    directory = await mkdtemp(path.join(tmpdir(), "linear-tools-"));
    let values: LinearSettings = linearSettings.schema.parse({});
    const linear = {
      getIssue: async (key: string) => ({ identifier: key, title: "Checkout", state: { name: "Todo" }, priorityLabel: "High", url: "u", children: [] }),
    } as unknown as LinearService;
    const access = { connect: async () => ({ linear, fingerprint: "f" }), mutate: async () => null } as unknown as LinearAccess;
    let hook: ((input: { request: CreateRequest }, context: { paseo: Paseo }) => Promise<CreateRequest | undefined>) | null = null;
    const server = {
      on: () => () => undefined,
      handle: () => undefined,
      before: (_name: string, handler: typeof hook) => {
        hook = handler;
        return () => undefined;
      },
    } as unknown as PluginServerContext;
    close = registerAgentTools(server, { access, dataDirectory: directory, readSettings: async () => values });
    const next = await hook!({ request: request() }, { paseo: fakePaseo().paseo });
    const config = next?.config.mcpServers?.linear as unknown as { url: string; headers: { Authorization: string } };
    const post = async (body: unknown, authorization = config.headers.Authorization) => {
      const response = await fetch(config.url, { method: "POST", headers: { authorization }, body: JSON.stringify(body) });
      return { status: response.status, body: response.status === 200 ? ((await response.json()) as { result: Record<string, unknown> }) : null };
    };
    const init = await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(init.body?.result.instructions).toBe(TOOLS_INSTRUCTIONS);
    const list = await post({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = (list.body?.result.tools as { name: string }[]).map((entry) => entry.name);
    expect(names).toContain("search_issues");
    expect(names).not.toContain("start_agent");
    const read = await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "read_issue", arguments: { issue: "ENG-1" } } });
    expect(JSON.stringify(read.body?.result)).toContain("ENG-1: Checkout");
    expect((await post({ jsonrpc: "2.0", id: 4, method: "ping" }, `${config.headers.Authorization}x`)).status).toBe(401);
    const file = JSON.parse(await readFile(path.join(directory, "agent-tools.json"), "utf8")) as { grants: unknown[]; secret?: string };
    expect(file.grants).toEqual([]);
    expect(file.secret).toBeTruthy();

    values = linearSettings.schema.parse({ tools: { allAgents: false } });
    expect((await post({ jsonrpc: "2.0", id: 5, method: "tools/list" })).body?.result.tools).toEqual([]);
    const refused = await post({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "read_issue", arguments: {} } });
    expect(refused.body?.result).toEqual({ content: [{ type: "text", text: ALL_AGENTS_OFF }], isError: true });
    values = linearSettings.schema.parse({ access: { allProjects: false } });
    const linearOff = await post({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "read_issue", arguments: {} } });
    expect(linearOff.body?.result).toEqual({ content: [{ type: "text", text: LINEAR_OFF }], isError: true });
  });
});
