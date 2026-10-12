import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  AGENT_TOOLS,
  type AgentConfig,
  agentToolsRpc,
  assignmentFor,
  childBrief,
  isProjectScope,
  LINEAR_TOOLS,
  PROJECT_READ_TOOLS,
  type ProjectScope,
  StartAgentInput,
  TOOLS_INSTRUCTIONS,
  TOOLS_SERVER,
  type ToolScope,
  ToolScopeSchema,
  toolPolicy,
  WaitAgentInput,
} from "../shared/agent-tools";
import { AGENT_LABELS } from "../shared/prompts";
import { type LinearSettings, projectEnabled, type ToolSettings, toolSettings } from "../shared/settings";
import { lastReply, type Paseo } from "./agent-runs";
import type { LinearAccess } from "./handlers";
import { issueTools } from "./issue-tools";
import { createMcpServer, listenLocal, type McpTool, tool } from "./mcp-http";
import { createJsonFile } from "./json-file";
import { registerProjectTools } from "./project-tools";

// Each launch gets a grant: a random token and the issue tree it reaches. The file keeps the
// port and a hash of each token, never the token, so agents keep their tools after a restart.
// Project tokens are signed with the file's secret instead, so they need no grant.

const MAX_GRANTS = 500;

const GrantSchema = z.object({
  id: z.string(),
  hash: z.string(),
  scope: ToolScopeSchema,
  /** Only agents started from an issue may start agents, so the tree is one level deep. */
  canStart: z.boolean(),
  createdAt: z.string(),
});
export type Grant = z.infer<typeof GrantSchema>;

const FileSchema = z.object({
  port: z.number().int().nullable(),
  grants: z.array(GrantSchema),
  /** Signs project tokens. */
  secret: z.string().optional(),
});

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** The token of a project's agents: the project id and its signature. */
export function projectToken(secret: string, projectId: string): string {
  const signature = createHmac("sha256", secret).update(`project:${projectId}`).digest("base64url");
  return `p.${Buffer.from(projectId).toString("base64url")}.${signature}`;
}

/** The project of a valid project token, or null. */
export function tokenProject(secret: string, token: string): string | null {
  const [prefix, id, signature, ...rest] = token.split(".");
  if (prefix !== "p" || !id || !signature || rest.length > 0) return null;
  const projectId = Buffer.from(id, "base64url").toString("utf8");
  const expected = Buffer.from(projectToken(secret, projectId));
  const given = Buffer.from(token);
  return expected.length === given.length && timingSafeEqual(expected, given) ? projectId : null;
}

type ProjectGrant = { id: string; scope: ProjectScope; canStart: false };

/** A grant with the tool settings of its project, read when the request comes in. */
export type Caller = (Grant | ProjectGrant) & {
  tools: ToolSettings;
  /** Why the caller gets no tools, when the settings turn them off. */
  off?: string | null;
};

export const TOOLS_OFF = "The Linear tools are off for this project in the Linear plugin settings in Paseo.";
export const LINEAR_OFF = "Linear is off for this project in the Linear plugin settings in Paseo.";
export const ALL_AGENTS_OFF =
  "The Linear tools for agents not started from an issue are off for this project in the Linear plugin settings in Paseo.";
const RUNNING = new Set(["initializing", "running"]);

export interface AgentToolsDependencies {
  access: LinearAccess;
  dataDirectory: string;
  readSettings(): Promise<LinearSettings | null>;
}

/** The issue tree of a caller that may start agents. */
function treeScope(caller: Caller): ToolScope {
  if (isProjectScope(caller.scope)) throw new Error("Only agents started from an issue can start agents.");
  return caller.scope;
}

export function linearTools(deps: AgentToolsDependencies, paseo: () => Paseo, mint: Mint): McpTool<Caller>[] {
  const callers = new Map<string, string>();
  async function callerAgent(api: Paseo, grant: Pick<Grant, "id">): Promise<string | null> {
    const known = callers.get(grant.id);
    if (known) return known;
    const result = await api.agents.list({ filter: { labels: { [AGENT_LABELS.tools]: grant.id } }, page: { limit: 1 } });
    const id = result.entries[0]?.agent.id ?? null;
    if (id) callers.set(grant.id, id);
    return id;
  }
  // Agents of one launch that still work count against the limit of the caller's project.
  async function checkLimit(api: Paseo, caller: Caller) {
    const limit = caller.tools.maxAgents;
    if (limit <= 0) return;
    const { entries } = await api.agents.list({ filter: { labels: { [AGENT_LABELS.startedBy]: caller.id } }, page: { limit: 100 } });
    const running = entries.filter((entry) => !entry.agent.archivedAt && RUNNING.has(entry.agent.status)).length;
    if (running >= limit) {
      throw new Error(`${running} of your agents are working, and the limit is ${limit}. Call wait_agent for one of them, then start the next one.`);
    }
  }
  return [
    ...issueTools(deps.access),
    tool({
      name: "start_agent",
      description:
        "Start a Paseo agent on a sub-issue, in your workspace. It runs on the agent the user chose for the sub-issue, or on your provider and model. It gets the Linear tools. Returns its id at once.",
      input: StartAgentInput,
      allowed: (grant) => grant.canStart,
      async run(input, grant) {
        const api = paseo();
        const scope = treeScope(grant);
        const key = input.issue.toUpperCase();
        const { linear } = await deps.access.connect(scope.keyScope);
        const root = await linear.getIssue(scope.root);
        const inTree = key === root.identifier.toUpperCase() || root.children.some((child) => child.identifier.toUpperCase() === key);
        if (!inTree) throw new Error(`${key} is not ${root.identifier} or one of its sub-issues.`);
        await checkLimit(api, grant);
        const parent = await callerAgent(api, grant);
        const child = await mint({ ...scope, home: key }, false);
        const { keyScope } = scope;
        const create = (config: AgentConfig) =>
          api.workspaces.ref(scope.workspaceId).agents.create({
            config: { ...config, mcpServers: { [TOOLS_SERVER]: child.server }, toolPolicy: child.toolPolicy },
            ...(parent ? { parent } : {}),
            title: input.title,
            prompt: `${childBrief(key, scope.root, grant.tools.allowEdits)}\n\n${input.prompt}`,
            labels: {
              [AGENT_LABELS.issue]: key,
              [AGENT_LABELS.action]: "implement",
              ...(keyScope ? { [AGENT_LABELS.project]: keyScope } : {}),
              [AGENT_LABELS.tools]: child.grantId,
              [AGENT_LABELS.startedBy]: grant.id,
            },
          });
        // The user's choice for the sub-issue wins over the caller's thinking.
        const assigned = assignmentFor(scope.assignments, key);
        const base = assigned?.config ?? scope.config;
        const thinking = assigned?.config.thinkingOptionId ? undefined : input.thinking;
        let note = assigned ? ` It runs on ${assigned.label}, the agent the user chose for ${key}.` : "";
        if (assigned?.config.thinkingOptionId && input.thinking) note += " Its thinking is set too, so yours is not used.";
        let handle: Awaited<ReturnType<typeof create>>;
        try {
          handle = await create(thinking ? { ...base, thinkingOptionId: thinking } : base);
        } catch (error) {
          if (!thinking) throw error;
          handle = await create(base);
          note += ` The model has no thinking option "${thinking}", so it uses ${assigned ? "its default" : "yours"}.`;
        }
        return `Started agent ${handle.id} on ${key}.${note} Call wait_agent with agent_id "${handle.id}" to get its result.`;
      },
    }),
    tool({
      name: "wait_agent",
      description: "Wait for an agent that start_agent started, and get its last reply. Call it again while the agent works.",
      input: WaitAgentInput,
      allowed: (grant) => grant.canStart,
      async run(input, grant) {
        const id = input.agent_id;
        const handle = paseo().agents.ref(id);
        const snapshot = (await handle.refresh().catch(() => null))?.agent;
        if (snapshot?.labels?.[AGENT_LABELS.startedBy] !== grant.id) {
          throw new Error(`Agent ${id} was not started by your start_agent calls.`);
        }
        const result = await handle.waitForFinish(input.timeout_seconds * 1000);
        if (result.status === "timeout") return `Agent ${id} is still working. Call wait_agent again.`;
        if (result.status === "permission") return `Agent ${id} waits for the user to answer a permission request in Paseo.`;
        if (result.status === "error") return `Agent ${id} stopped with an error: ${result.error ?? "unknown error"}`;
        const reply = result.lastMessage ?? (await lastReply(handle));
        return `Agent ${id} finished.\n\nIts last reply:\n${reply || "(no reply)"}`;
      },
    }),
  ];
}

type Minted = z.infer<typeof agentToolsRpc.output>;
type Mint = (scope: ToolScope, canStart: boolean) => Promise<Minted>;

export function registerAgentTools(server: PluginServerContext, deps: AgentToolsDependencies) {
  const file = createJsonFile(path.join(deps.dataDirectory, "agent-tools.json"), FileSchema, () => ({
    port: null,
    grants: [],
  }));
  // The SDK hands Paseo to handlers and hooks only. The subprocess has one, so keep the latest.
  let api: Paseo | null = null;
  const remember = (_event: unknown, context: { paseo: Paseo }) => {
    api = context.paseo;
  };
  server.on("agent.turn_started", remember);
  server.on("agent.turn_ended", remember);
  server.on("agent.created", remember);
  const paseo = () => {
    if (!api) throw new Error("Paseo is not ready yet. Try again in a few seconds.");
    return api;
  };

  let listening: Promise<number> | null = null;
  const ensureListening = () => {
    listening ??= file
      .read()
      .then((current) => listenLocal(http, current.port))
      .then(async (port) => {
        await file.update((current) => ({ next: { ...current, port }, result: null }));
        return port;
      });
    return listening;
  };
  const mint: Mint = async (scope, canStart) => {
    if (canStart && !toolSettings(await deps.readSettings(), scope.projectId).enabled) throw new Error(TOOLS_OFF);
    const port = await ensureListening();
    const token = randomBytes(32).toString("base64url");
    const grant: Grant = {
      id: randomBytes(8).toString("hex"),
      hash: hashOf(token),
      scope,
      canStart,
      createdAt: new Date().toISOString(),
    };
    await file.update((current) => ({ next: { ...current, grants: [...current.grants, grant].slice(-MAX_GRANTS) }, result: null }));
    return {
      grantId: grant.id,
      server: { type: "http", url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } },
      toolPolicy: toolPolicy(canStart ? [...LINEAR_TOOLS, ...AGENT_TOOLS] : [...LINEAR_TOOLS]),
    };
  };
  const secret = async () =>
    (await file.read()).secret ??
    file.update((current) => {
      const value = current.secret ?? randomBytes(32).toString("base64url");
      return { next: { ...current, secret: value }, result: value };
    });
  // Project agents may only read without a prompt; changes follow the agent's permission mode.
  const mintProject = async (projectId: string) => {
    const port = await ensureListening();
    const token = projectToken(await secret(), projectId);
    return {
      server: { type: "http" as const, url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: `Bearer ${token}` } },
      toolPolicy: toolPolicy(PROJECT_READ_TOOLS),
    };
  };
  async function projectCaller(token: string): Promise<Caller | null> {
    const current = await file.read();
    const projectId = current.secret ? tokenProject(current.secret, token) : null;
    if (!projectId) return null;
    const values = await deps.readSettings();
    const tools = toolSettings(values, projectId);
    const off = values && !projectEnabled(values.access, projectId) ? LINEAR_OFF : tools.allAgents ? null : ALL_AGENTS_OFF;
    return { id: `project:${projectId}`, scope: { kind: "project", projectId }, canStart: false, tools, off };
  }
  // Settings are read on each request, so a change applies to agents that already run.
  const http = createMcpServer<Caller>({
    name: "paseo-linear",
    version: "1.0.0",
    instructions: TOOLS_INSTRUCTIONS,
    tools: linearTools(deps, paseo, mint),
    async authorize(token) {
      if (token.startsWith("p.")) return projectCaller(token);
      const hash = hashOf(token);
      const grant = (await file.read()).grants.find((entry) => entry.hash === hash);
      if (!grant) return null;
      return { ...grant, tools: toolSettings(await deps.readSettings(), grant.scope.projectId) };
    },
    closed: (caller) => (caller.tools.enabled ? (caller.off ?? null) : TOOLS_OFF),
  });

  server.handle(agentToolsRpc, async (scope, context) => {
    api = context.paseo;
    return mint(scope, true);
  });
  registerProjectTools(server, { access: deps.access, readSettings: deps.readSettings, mint: mintProject, remember });
  // Agents from before a restart call the same port, so listen again when they have tokens.
  void file
    .read()
    .then((current) => (current.grants.length > 0 || current.secret ? ensureListening() : null))
    .catch((error: unknown) => console.error("Linear MCP could not start", error));

  return () =>
    new Promise<void>((resolve) => {
      http.closeAllConnections();
      http.close(() => resolve());
    });
}
