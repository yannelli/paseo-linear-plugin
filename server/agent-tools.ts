import { createHash, randomBytes } from "node:crypto";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  AGENT_TOOLS,
  agentToolsRpc,
  childBrief,
  EditIssueInput,
  editText,
  issueText,
  LINEAR_TOOLS,
  ReadIssueInput,
  StartAgentInput,
  TOOLS_SERVER,
  taskCount,
  type ToolScope,
  ToolScopeSchema,
  toolPolicy,
  WaitAgentInput,
} from "../shared/agent-tools";
import { AGENT_LABELS } from "../shared/prompts";
import { lastReply, type Paseo } from "./agent-runs";
import type { LinearAccess } from "./handlers";
import { createMcpServer, listenLocal, type McpTool, tool } from "./mcp-http";
import type { LinearService } from "./queries";
import { createJsonFile } from "./stores";

// Each launch gets a grant: a random token for the agent's MCP config, and the issue tree it
// reaches. The file keeps the port and a hash of each token, never the token, so agents keep
// their tools after a restart.

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

const FileSchema = z.object({ port: z.number().int().nullable(), grants: z.array(GrantSchema) });

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

export interface AgentToolsDependencies {
  access: LinearAccess;
  dataDirectory: string;
}

/** The root issue or one of its sub-issues; any other key is refused. */
async function treeIssue(linear: LinearService, scope: ToolScope, key: string | undefined) {
  const wanted = (key ?? scope.home).toUpperCase();
  const root = await linear.getIssue(scope.root);
  if (wanted === root.identifier.toUpperCase()) return root;
  if (!root.children.some((child) => child.identifier.toUpperCase() === wanted)) {
    throw new Error(`${wanted} is not ${root.identifier} or one of its sub-issues.`);
  }
  return linear.getIssue(wanted);
}

export function linearTools(deps: AgentToolsDependencies, paseo: () => Paseo, mint: Mint): McpTool<Grant>[] {
  const callers = new Map<string, string>();
  async function callerAgent(api: Paseo, grant: Grant): Promise<string | null> {
    const known = callers.get(grant.id);
    if (known) return known;
    const result = await api.agents.list({ filter: { labels: { [AGENT_LABELS.tools]: grant.id } }, page: { limit: 1 } });
    const id = result.entries[0]?.agent.id ?? null;
    if (id) callers.set(grant.id, id);
    return id;
  }
  return [
    tool({
      name: "read_issue",
      description: "Read a Linear issue of your issue tree: status, description with its task list, and sub-issues.",
      input: ReadIssueInput,
      async run(input, grant) {
        const { linear } = await deps.access.connect(grant.scope.keyScope);
        return issueText(await treeIssue(linear, grant.scope, input.issue));
      },
    }),
    tool({
      name: "edit_issue",
      description:
        "Change the description of a Linear issue of your issue tree. Replace exact text, for example `- [ ] Add the form` with `- [x] Add the form` to check off a task list item.",
      input: EditIssueInput,
      run(input, grant) {
        return deps.access.mutate(grant.scope.keyScope, async (linear) => {
          const issue = await treeIssue(linear, grant.scope, input.issue);
          const edited = editText(issue.description ?? "", input.old_text, input.new_text);
          if ("error" in edited) throw new Error(edited.error);
          await linear.updateIssue(issue.id, { description: edited.body });
          const tasks = taskCount(edited.body);
          const count = tasks.total > 0 ? ` ${tasks.done} of ${tasks.total} task list items are checked.` : "";
          return `Updated the description of ${issue.identifier}.${count}`;
        });
      },
    }),
    tool({
      name: "start_agent",
      description:
        "Start a Paseo agent on a sub-issue, in your workspace, on your provider and model. It gets read_issue and edit_issue. Returns its id at once.",
      input: StartAgentInput,
      allowed: (grant) => grant.canStart,
      async run(input, grant) {
        const api = paseo();
        const key = input.issue.toUpperCase();
        const { linear } = await deps.access.connect(grant.scope.keyScope);
        await treeIssue(linear, grant.scope, key);
        const parent = await callerAgent(api, grant);
        const child = await mint({ ...grant.scope, home: key }, false);
        const { keyScope } = grant.scope;
        const create = (config: ToolScope["config"]) =>
          api.workspaces.ref(grant.scope.workspaceId).agents.create({
            config: { ...config, mcpServers: { [TOOLS_SERVER]: child.server }, toolPolicy: child.toolPolicy },
            ...(parent ? { parent } : {}),
            title: input.title,
            prompt: `${childBrief(key, grant.scope.root)}\n\n${input.prompt}`,
            labels: {
              [AGENT_LABELS.issue]: key,
              [AGENT_LABELS.action]: "implement",
              ...(keyScope ? { [AGENT_LABELS.project]: keyScope } : {}),
              [AGENT_LABELS.tools]: child.grantId,
              [AGENT_LABELS.startedBy]: grant.id,
            },
          });
        const base = grant.scope.config;
        let note = "";
        let handle: Awaited<ReturnType<typeof create>>;
        try {
          handle = await create(input.thinking ? { ...base, thinkingOptionId: input.thinking } : base);
        } catch (error) {
          if (!input.thinking) throw error;
          handle = await create(base);
          note = ` The model has no thinking option "${input.thinking}", so it uses yours.`;
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
  const http = createMcpServer<Grant>({
    name: "paseo-linear",
    version: "1.0.0",
    tools: linearTools(deps, paseo, mint),
    async authorize(token) {
      const hash = hashOf(token);
      return (await file.read()).grants.find((grant) => grant.hash === hash) ?? null;
    },
  });

  server.handle(agentToolsRpc, async (scope, context) => {
    api = context.paseo;
    return mint(scope, true);
  });
  // Agents from before a restart call the same port, so listen again when grants exist.
  void file
    .read()
    .then((current) => (current.grants.length > 0 ? ensureListening() : null))
    .catch((error: unknown) => console.error("Linear MCP could not start", error));

  return () =>
    new Promise<void>((resolve) => {
      http.closeAllConnections();
      http.close(() => resolve());
    });
}
