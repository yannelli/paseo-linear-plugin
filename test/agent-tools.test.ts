import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { type Assignment, childBrief, editText, type ProjectScope, taskCount, toolPolicy } from "../shared/agent-tools";
import type { IssueDetail } from "../shared/linear";
import type { Paseo } from "../server/agent-runs";
import { type Caller, linearTools, projectToken, TOOLS_OFF, tokenProject } from "../server/agent-tools";
import type { LinearAccess } from "../server/handlers";
import { createMcpServer, listenLocal, tool } from "../server/mcp-http";
import type { LinearService } from "../server/queries";
import { linearSettings, type ToolSettings, toolSettings } from "../shared/settings";

describe("editText", () => {
  const body = "Plan:\n- [ ] Add the form\n- [x] Add the route\n";

  it("replaces text that occurs one time, and counts the checked items", () => {
    const edited = editText(body, "- [ ] Add the form", "- [x] Add the form");
    expect(edited).toEqual({ body: "Plan:\n- [x] Add the form\n- [x] Add the route\n" });
    expect(taskCount("body" in edited ? edited.body : "")).toEqual({ done: 2, total: 2 });
  });

  it("refuses missing or repeated text, and appends for empty old text", () => {
    expect(editText(body, "- [ ] Ship it", "x")).toHaveProperty("error");
    expect(editText("a a", "a", "b")).toHaveProperty("error");
    expect(editText("Plan\n\n", "", "Notes")).toEqual({ body: "Plan\n\nNotes" });
    expect(editText("", "", "Notes")).toEqual({ body: "Notes" });
  });
});

interface Reply {
  result: { tools: { name: string; inputSchema: unknown }[]; isError?: boolean } & Record<string, unknown>;
  error: { code: number };
}
const json = async (response: Response) => (await response.json()) as Reply;

describe("MCP over HTTP", () => {
  let server: Server | null = null;
  afterEach(() => new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve())));

  async function start() {
    const echo = tool({
      name: "echo",
      description: "Echo",
      input: z.object({ text: z.string() }),
      run: async (input: { text: string }, caller: string) => `${caller}: ${input.text}`,
    });
    const hidden = tool({ name: "hidden", description: "Hidden", input: z.object({}), allowed: () => false, run: async () => "" });
    server = createMcpServer<string>({
      name: "test",
      version: "1.0.0",
      instructions: "Use echo.",
      tools: [echo, hidden],
      authorize: async (token) => (token === "good" ? "agent-1" : null),
    });
    const port = await listenLocal(server, null);
    return (body: unknown, headers: Record<string, string> = { authorization: "Bearer good" }, method = "POST") =>
      fetch(`http://127.0.0.1:${port}/mcp`, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: method === "POST" ? JSON.stringify(body) : undefined,
      });
  }

  it("answers initialize, lists the caller's tools, and calls them", async () => {
    const post = await start();
    const init = await json(await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }));
    expect(init.result).toMatchObject({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, instructions: "Use echo." });
    expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    const list = await json(await post({ jsonrpc: "2.0", id: 2, method: "tools/list" }));
    expect(list.result.tools.map((entry: { name: string }) => entry.name)).toEqual(["echo"]);
    expect(list.result.tools[0].inputSchema).toMatchObject({ type: "object", required: ["text"] });
    const call = await json(await post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hi" } } }));
    expect(call.result).toEqual({ content: [{ type: "text", text: "agent-1: hi" }] });
    const bad = await json(await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "echo", arguments: {} } }));
    expect(bad.result.isError).toBe(true);
    const hidden = await json(await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "hidden" } }));
    expect(hidden.error.code).toBe(-32602);
  });

  it("lists no tools and refuses calls when the caller's tools are off", async () => {
    server = createMcpServer<string>({
      name: "test",
      version: "1.0.0",
      tools: [tool({ name: "echo", description: "Echo", input: z.object({}), run: async () => "hi" })],
      authorize: async () => "agent-1",
      closed: () => TOOLS_OFF,
    });
    const port = await listenLocal(server, null);
    const post = async (body: unknown) =>
      json(await fetch(`http://127.0.0.1:${port}/mcp`, { method: "POST", headers: { authorization: "Bearer any" }, body: JSON.stringify(body) }));
    expect((await post({ jsonrpc: "2.0", id: 1, method: "tools/list" })).result.tools).toEqual([]);
    const call = await post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "echo", arguments: {} } });
    expect(call.result).toEqual({ content: [{ type: "text", text: TOOLS_OFF }], isError: true });
  });

  it("refuses unknown tokens, browser requests, and other methods", async () => {
    const post = await start();
    const ping = { jsonrpc: "2.0", id: 1, method: "ping" };
    expect((await post(ping, { authorization: "Bearer bad" })).status).toBe(401);
    expect((await post(ping, {})).status).toBe(401);
    expect((await post(ping, { authorization: "Bearer good", origin: "https://example.test" })).status).toBe(403);
    expect((await post(null, { authorization: "Bearer good" }, "GET")).status).toBe(405);
    expect((await post(ping)).status).toBe(200);
  });
});

describe("Linear tools", () => {
  const state = (name: string) => ({ id: name, name, type: "started", color: "#000000" });
  const ENG = { id: "team-1", key: "ENG", name: "Engineering" };
  const issue = (identifier: string, description: string, children: string[] = []) =>
    ({
      id: `id-${identifier}`,
      identifier,
      title: `Title ${identifier}`,
      url: `https://example.test/${identifier}`,
      state: state("Todo"),
      team: ENG,
      assignee: null,
      priorityLabel: "No priority",
      description,
      children: children.map((key) => ({ id: `id-${key}`, identifier: key, title: `Title ${key}`, state: state("Todo") })),
    }) as unknown as IssueDetail;
  const me = { id: "u-me", name: "Max Mustermann", displayName: "max", avatarUrl: null };
  const catalog = {
    viewer: me,
    organization: { name: "Acme", urlKey: "acme" },
    teams: [
      { ...ENG, states: [state("Todo"), state("In Progress"), state("Done")] },
      { id: "team-2", key: "OPS", name: "Operations", states: [state("Triage")] },
    ],
    users: [me, { id: "u-ann", name: "Ann Lee", displayName: "ann", avatarUrl: null }],
  };

  interface SetupOptions {
    tools?: Partial<ToolSettings>;
    assignments?: Record<string, Assignment>;
    /** Statuses of agents that this grant already started. */
    children?: string[];
    /** Creating an agent with a thinking option fails, as for a model without it. */
    noThinking?: boolean;
    /** The caller is a project agent instead of an agent started from ENG-1. */
    project?: boolean;
  }

  function setup(options: SetupOptions = {}) {
    const issues = new Map([
      ["ENG-1", issue("ENG-1", "- [ ] Plan", ["ENG-2"])],
      ["ENG-2", issue("ENG-2", "- [ ] Form\n- [ ] Tests")],
      ["ENG-9", issue("ENG-9", "")],
    ]);
    const updates: { id: string; description?: string }[] = [];
    const comments: { issueId: string; body: string }[] = [];
    const createdIssues: Record<string, unknown>[] = [];
    const searches: unknown[] = [];
    const linear = {
      catalog: async () => catalog,
      getIssue: async (id: string) => {
        const found = issues.get(id);
        if (!found) throw new Error(`Linear issue ${id} was not found`);
        return found;
      },
      listIssues: async (query: unknown) => {
        searches.push(query);
        return { issues: [issues.get("ENG-1"), issues.get("ENG-2")], endCursor: "c", hasNextPage: true };
      },
      updateIssue: async (id: string, patch: { description?: string }) => {
        updates.push({ id, ...patch });
        const key = id.replace(/^id-/, "");
        const current = issues.get(key);
        if (current && patch.description !== undefined) issues.set(key, { ...current, description: patch.description });
        return issues.get(key);
      },
      createComment: async (issueId: string, body: string) => {
        comments.push({ issueId, body });
        return { id: "c1", body, createdAt: "", user: null };
      },
      createIssue: async (input: Record<string, unknown>) => {
        createdIssues.push(input);
        return issue("ENG-10", "");
      },
    } as unknown as LinearService;
    const access: LinearAccess = { connect: async () => ({ linear, fingerprint: "f" }), mutate: (_scope, run) => run(linear) };
    const created: Record<string, unknown>[] = [];
    const paseo = {
      agents: {
        list: async (input: { filter: { labels: Record<string, string> } }) =>
          input.filter.labels["linear.started-by"]
            ? { entries: (options.children ?? []).map((status, index) => ({ agent: { id: `old-${index}`, status } })) }
            : { entries: [{ agent: { id: "parent-1" } }] },
        ref: (id: string) => ({
          refresh: async () => ({ agent: { id, labels: { "linear.started-by": id === "child-1" ? "g1" : "other" } } }),
          waitForFinish: async () => ({ status: "idle", lastMessage: "ENG-2: done", error: null, final: null }),
        }),
      },
      workspaces: {
        ref: () => ({
          agents: {
            create: async (agent: { config: { thinkingOptionId?: string } }) => {
              if (options.noThinking && agent.config.thinkingOptionId) throw new Error("Unknown thinking option");
              created.push(agent);
              return { id: "child-1" };
            },
          },
        }),
      },
    } as unknown as Paseo;
    const mint = async () => ({
      grantId: "g2",
      server: { type: "http" as const, url: "http://127.0.0.1:1/mcp", headers: { Authorization: "Bearer child" } },
      toolPolicy: toolPolicy(["read_issue", "edit_issue"]),
    });
    const deps = { access, dataDirectory: "/tmp", readSettings: async () => null };
    const tools = new Map(linearTools(deps, () => paseo, mint).map((entry) => [entry.name, entry]));
    const toolsFor = { ...toolSettings(null, null), ...options.tools };
    const projectScope: ProjectScope = { kind: "project", projectId: "p1" };
    const grant: Caller = options.project
      ? { id: "project:p1", canStart: false, scope: projectScope, tools: toolsFor }
      : {
          id: "g1",
          hash: "h",
          canStart: true,
          createdAt: "2026-10-01T00:00:00Z",
          scope: {
            root: "ENG-1",
            home: "ENG-1",
            keyScope: "p1",
            workspaceId: "w1",
            config: { provider: "claude/opus", modeId: "default" },
            assignments: options.assignments,
          },
          tools: toolsFor,
        };
    const call = (name: string, input: unknown) => {
      const entry = tools.get(name);
      if (!entry) throw new Error(name);
      return entry.run(entry.input.parse(input), grant);
    };
    const listed = () => [...tools.values()].filter((entry) => entry.allowed?.(grant) ?? true).map((entry) => entry.name);
    return { call, updates, created, listed, comments, createdIssues, searches };
  }

  it("reads and edits issues of the tree only", async () => {
    const { call, updates } = setup();
    expect(await call("read_issue", {})).toContain("Sub-issues:\n- ENG-2 [Todo]: Title ENG-2");
    expect(await call("edit_issue", { issue: "ENG-2", old_text: "- [ ] Form", new_text: "- [x] Form" })).toBe(
      "Updated the description of ENG-2. 1 of 2 task list items are checked.",
    );
    expect(updates).toEqual([{ id: "id-ENG-2", description: "- [x] Form\n- [ ] Tests" }]);
    await expect(call("read_issue", { issue: "ENG-9" })).rejects.toThrow("not ENG-1 or one of its sub-issues");
  });

  it("runs edits of one issue one at a time, so none is lost", async () => {
    const { call, updates } = setup();
    await Promise.all([
      call("edit_issue", { issue: "ENG-2", old_text: "- [ ] Form", new_text: "- [x] Form" }),
      call("edit_issue", { issue: "ENG-2", old_text: "- [ ] Tests", new_text: "- [x] Tests" }),
    ]);
    expect(updates.at(-1)).toEqual({ id: "id-ENG-2", description: "- [x] Form\n- [x] Tests" });
  });

  it("starts a child with its own tools and labels, and waits only for its own children", async () => {
    const { call, created } = setup();
    expect(await call("start_agent", { issue: "eng-2", title: "ENG-2: form", prompt: "Build the form" })).toContain("child-1");
    expect(created[0]).toMatchObject({
      parent: "parent-1",
      title: "ENG-2: form",
      config: { provider: "claude/opus", modeId: "default", mcpServers: { linear: { url: "http://127.0.0.1:1/mcp" } } },
      labels: { "linear.issue": "ENG-2", "linear.tools": "g2", "linear.started-by": "g1", "linear.project": "p1" },
    });
    expect(String(created[0]?.prompt)).toMatch(/^You work on Linear issue ENG-2, a sub-issue of ENG-1\./);
    expect(await call("wait_agent", { agent_id: "child-1" })).toContain("ENG-2: done");
    await expect(call("wait_agent", { agent_id: "stranger" })).rejects.toThrow("not started by your start_agent calls");
  });

  it("changes the status, assignee, and priority by name, in the tree only", async () => {
    const { call, updates } = setup();
    const reply = await call("update_issue", { issue: "ENG-2", status: "in progress", assignee: "me", priority: 2 });
    expect(reply).toMatch(/^Updated ENG-2: Title ENG-2/);
    expect(updates).toEqual([{ id: "id-ENG-2", stateId: "In Progress", assigneeId: "u-me", priority: 2 }]);
    await call("update_issue", { assignee: "Ann Lee" });
    await call("update_issue", { assignee: null });
    expect(updates.slice(1)).toEqual([
      { id: "id-ENG-1", assigneeId: "u-ann" },
      { id: "id-ENG-1", assigneeId: null },
    ]);
    await expect(call("update_issue", { status: "Shipped" })).rejects.toThrow(
      'ENG has no status "Shipped". Its statuses: Todo, In Progress, Done.',
    );
    await expect(call("update_issue", { assignee: "Nobody" })).rejects.toThrow('No active Linear user is named "Nobody".');
    await expect(call("update_issue", {})).rejects.toThrow("Give a status, assignee, priority, or title.");
    await expect(call("update_issue", { issue: "ENG-9", priority: 1 })).rejects.toThrow("not ENG-1 or one of its sub-issues");
  });

  it("comments, and creates new issues only as sub-issues of the root", async () => {
    const { call, comments, createdIssues } = setup();
    expect(await call("comment_issue", { body: "Opened the pull request." })).toBe("Added a comment to ENG-1.");
    expect(comments).toEqual([{ issueId: "id-ENG-1", body: "Opened the pull request." }]);
    const reply = await call("create_issue", { title: "Follow-up", assignee: "me" });
    expect(reply).toContain("Created ENG-10: Title ENG-10");
    expect(reply).toContain("Parent: ENG-1");
    expect(createdIssues).toEqual([{ teamId: "team-1", title: "Follow-up", parentId: "id-ENG-1", assigneeId: "u-me" }]);
    await expect(call("create_issue", { title: "Elsewhere", parent: "ENG-9" })).rejects.toThrow(
      "New issues must be sub-issues of ENG-1",
    );
  });

  it("gives project agents search and any issue, but no agents of their own", async () => {
    const { call, listed, searches, createdIssues } = setup({ project: true });
    expect(listed()).toEqual(["read_issue", "search_issues", "edit_issue", "update_issue", "comment_issue", "create_issue"]);
    await expect(call("read_issue", {})).rejects.toThrow("Give the issue key");
    expect(await call("read_issue", { issue: "eng-9" })).toContain("ENG-9: Title ENG-9\nStatus: Todo\nAssignee: none");
    const found = await call("search_issues", { query: "form", team: "ops" });
    expect(searches).toEqual([{ query: "form", status: "active", assignee: "anyone", teamId: "team-2", after: null }]);
    expect(found).toContain("- ENG-2 [Todo] Title ENG-2");
    expect(found).toContain("More issues match.");
    await expect(call("create_issue", { title: "New" })).rejects.toThrow("Give the team key: ENG, OPS.");
    await call("create_issue", { title: "New", team: "OPS", status: "Triage" });
    await call("create_issue", { title: "Sub", parent: "ENG-9" });
    expect(createdIssues).toEqual([
      { teamId: "team-2", title: "New", stateId: "Triage" },
      { teamId: "team-1", title: "Sub", parentId: "id-ENG-9" },
    ]);
    expect(setup({ project: true, tools: { allowEdits: false } }).listed()).toEqual(["read_issue", "search_issues"]);
  });

  it("hides edit_issue when edits are off, and tells children to only read", async () => {
    const { listed, call, created } = setup({ tools: { allowEdits: false } });
    expect(listed()).toEqual(["read_issue", "start_agent", "wait_agent"]);
    await call("start_agent", { issue: "ENG-2", title: "ENG-2: form", prompt: "Build the form" });
    expect(String(created[0]?.prompt)).toContain("Do not change the issue");
    expect(childBrief("ENG-2", "ENG-1")).toContain("edit_issue changes its description");
  });

  it("starts the agent the user chose for the sub-issue, and its thinking wins", async () => {
    const codex = { config: { provider: "codex/gpt-5.5", thinkingOptionId: "high" }, label: "Codex · GPT-5.5" };
    const { call, created } = setup({ assignments: { "ENG-2": codex } });
    const reply = await call("start_agent", { issue: "eng-2", title: "ENG-2: form", prompt: "Build", thinking: "low" });
    expect(reply).toContain("It runs on Codex · GPT-5.5, the agent the user chose for ENG-2.");
    expect(reply).toContain("so yours is not used");
    expect(created[0]).toMatchObject({ config: { provider: "codex/gpt-5.5", thinkingOptionId: "high" } });
    expect(created[0]?.config).not.toHaveProperty("modeId");
  });

  it("uses the caller's thinking for an assignment without one, and falls back to its default", async () => {
    const haiku = { config: { provider: "claude/haiku" }, label: "Claude · Haiku" };
    const { call, created } = setup({ assignments: { "ENG-2": haiku }, noThinking: true });
    const reply = await call("start_agent", { issue: "ENG-2", title: "ENG-2: form", prompt: "Build", thinking: "max" });
    expect(reply).toContain('no thinking option "max", so it uses its default');
    expect(created[0]).toMatchObject({ config: { provider: "claude/haiku" } });
  });

  it("refuses to start more agents than the limit while they work", async () => {
    const full = setup({ tools: { maxAgents: 2 }, children: ["running", "initializing", "idle"] });
    await expect(full.call("start_agent", { issue: "ENG-2", title: "ENG-2: a", prompt: "x" })).rejects.toThrow(
      "2 of your agents are working, and the limit is 2",
    );
    const room = setup({ tools: { maxAgents: 2 }, children: ["running", "idle", "error"] });
    expect(await room.call("start_agent", { issue: "ENG-2", title: "ENG-2: a", prompt: "x" })).toContain("child-1");
    expect(await setup({ children: ["running", "running", "running"] }).call("start_agent", { issue: "ENG-2", title: "t", prompt: "x" })).toContain("child-1");
  });
});

describe("toolSettings", () => {
  it("applies a project's own values over the values for all projects", () => {
    const values = linearSettings.schema.parse({
      tools: { maxAgents: 3 },
      projects: [{ projectId: "p1", displayName: "One", rootPath: "/one", overrides: { tools: false, maxAgents: 0 } }],
    });
    expect(toolSettings(values, "p1")).toEqual({ enabled: false, allowEdits: true, allAgents: true, assignAgents: true, maxAgents: 0 });
    expect(toolSettings(values, "p2")).toEqual({ enabled: true, allowEdits: true, allAgents: true, assignAgents: true, maxAgents: 3 });
    expect(toolSettings(null, null)).toEqual({ enabled: true, allowEdits: true, allAgents: true, assignAgents: true, maxAgents: 0 });
  });
});

describe("project tokens", () => {
  it("name their project, and fail with another secret or any change", () => {
    const token = projectToken("secret", "prj_1");
    expect(tokenProject("secret", token)).toBe("prj_1");
    expect(tokenProject("other", token)).toBeNull();
    expect(tokenProject("secret", projectToken("secret", "prj_2").replace(/^p\.[^.]+/, token.split(".").slice(0, 2).join(".")))).toBeNull();
    expect(tokenProject("secret", `${token}x`)).toBeNull();
    expect(tokenProject("secret", "p.only")).toBeNull();
  });
});
