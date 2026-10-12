import path from "node:path";
import type { PluginBeforeRequests, PluginServerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { type McpHttpServerSchema, TOOLS_SERVER, type ToolPolicySchema } from "../shared/agent-tools";
import { type LinearSettings, projectEnabled, toolSettings } from "../shared/settings";
import type { Paseo } from "./agent-runs";
import type { LinearAccess } from "./handlers";

// Agents that did not start from an issue get the Linear tools of their project when Paseo
// creates them, so any agent in a project with Linear on can read and change issues.

/** Built-in providers that use MCP servers. Others count once one of their agents reports it. */
const MCP_PROVIDERS = ["claude", "codex", "opencode"];
const WORKSPACE_PAGES = 20;

export type CreateRequest = PluginBeforeRequests["agent.create"];

export interface ProjectToolsDependencies {
  access: LinearAccess;
  readSettings(): Promise<LinearSettings | null>;
  /** The server config and tool policy for an agent of the project. */
  mint(projectId: string): Promise<{
    server: z.infer<typeof McpHttpServerSchema>;
    toolPolicy: z.infer<typeof ToolPolicySchema>;
  }>;
}

const within = (folder: string, root: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(folder));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
};

/** Returns the create request with the project's Linear tools, or undefined to leave it. */
export function projectToolsHook(deps: ProjectToolsDependencies) {
  const projects = new Map<string, string>();
  const mcpProviders = new Set(MCP_PROVIDERS);

  // The deepest workspace or project folder that holds the agent's folder names its project.
  async function projectOf(paseo: Paseo, cwd: string): Promise<string | null> {
    const known = projects.get(cwd);
    if (known) return known;
    let best: { projectId: string; length: number } | null = null;
    let cursor: string | null = null;
    for (let page = 0; page < WORKSPACE_PAGES; page += 1) {
      const result: Awaited<ReturnType<Paseo["workspaces"]["list"]>> = await paseo.workspaces.list({
        page: { limit: 200, ...(cursor ? { cursor } : {}) },
      });
      for (const workspace of result.entries) {
        for (const root of [workspace.workspaceDirectory, workspace.projectRootPath]) {
          if (root && within(cwd, root) && root.length > (best?.length ?? -1)) {
            best = { projectId: workspace.projectId, length: root.length };
          }
        }
      }
      cursor = result.pageInfo.hasMore ? result.pageInfo.nextCursor : null;
      if (!cursor) break;
    }
    if (best) projects.set(cwd, best.projectId);
    return best?.projectId ?? null;
  }

  // Paseo refuses to start an agent whose provider cannot use MCP servers.
  async function supportsMcp(paseo: Paseo, provider: string): Promise<boolean> {
    const id = provider.split("/")[0] ?? provider;
    if (mcpProviders.has(id)) return true;
    const { entries } = await paseo.agents.list({ page: { limit: 200 } });
    const known = entries.some((entry) => entry.agent.provider === id && entry.agent.capabilities?.supportsMcpServers === true);
    if (known) mcpProviders.add(id);
    return known;
  }

  return async (request: CreateRequest, paseo: Paseo): Promise<CreateRequest | undefined> => {
    const { config } = request;
    if (config.mcpServers?.[TOOLS_SERVER]) return undefined;
    const values = await deps.readSettings();
    const projectId = await projectOf(paseo, config.cwd);
    if (!projectId || (values && !projectEnabled(values.access, projectId))) return undefined;
    const tools = toolSettings(values, projectId);
    if (!tools.enabled || !tools.allAgents) return undefined;
    if (!(await supportsMcp(paseo, config.provider))) return undefined;
    // Without a Linear key every tool call would fail.
    const keyed = await deps.access.connect(projectId).then(
      () => true,
      () => false,
    );
    if (!keyed) return undefined;
    const minted = await deps.mint(projectId);
    const preapproved = [...(config.toolPolicy?.preapproved ?? []), ...minted.toolPolicy.preapproved];
    return {
      ...request,
      config: {
        ...config,
        mcpServers: { ...config.mcpServers, [TOOLS_SERVER]: minted.server },
        toolPolicy: { ...config.toolPolicy, preapproved },
      },
    };
  };
}

export function registerProjectTools(
  server: PluginServerContext,
  deps: ProjectToolsDependencies & { remember(event: unknown, context: { paseo: Paseo }): void },
) {
  const addTools = projectToolsHook(deps);
  server.before("agent.create", async ({ request }, context) => {
    deps.remember(null, context);
    try {
      return await addTools(request, context.paseo);
    } catch (error) {
      console.error("Linear tools were not added to the agent", error);
      return undefined;
    }
  });
}
