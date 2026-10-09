import type { PluginServerContext } from "@getpaseo/plugin/server";
import type { WorkflowState } from "../shared/linear";
import { syncNowRpc } from "../shared/live";
import { AGENT_LABELS, isInternalAgent } from "../shared/prompts";
import { type LinearSettings, projectDefaults, projectEnabled } from "../shared/settings";
import { planStatusMoves, progressByKey, type TodoLike } from "../shared/todo-sync";
import type { Paseo } from "./agent-runs";
import type { LinearAccess } from "./handlers";
import { agentInfo } from "./live";

const STATES_MAX_AGE_MS = 10 * 60_000;

export interface SyncDependencies {
  access: LinearAccess;
  readSettings(): Promise<LinearSettings | null>;
}

export interface SyncResult {
  moves: { identifier: string; from: WorkflowState; to: WorkflowState }[];
  skipped: string | null;
}

function latestTodos(items: readonly { type: string; items?: unknown }[]): TodoLike[] | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "todo" && Array.isArray(item.items)) return item.items as TodoLike[];
  }
  return null;
}

export function registerSync(server: PluginServerContext, dependencies: SyncDependencies) {
  const { access, readSettings } = dependencies;
  const teamStates = new Map<string, { at: number; states: Map<string, WorkflowState[]> }>();
  const queues = new Map<string, Promise<unknown>>();

  async function statesFor(projectId: string | null, teamId: string) {
    const { linear, fingerprint } = await access.connect(projectId);
    const cached = teamStates.get(fingerprint);
    if (cached && Date.now() - cached.at < STATES_MAX_AGE_MS && cached.states.has(teamId)) {
      return cached.states.get(teamId) ?? [];
    }
    const catalog = await linear.catalog();
    const states = new Map(catalog.teams.map((team) => [team.id, team.states]));
    teamStates.set(fingerprint, { at: Date.now(), states });
    return states.get(teamId) ?? [];
  }

  // Reads Linear fresh, not the response cache, so a manual move since the last turn counts.
  async function syncIssue(
    identifier: string,
    projectId: string | null,
    todos: readonly TodoLike[],
  ): Promise<SyncResult> {
    const progress = progressByKey(todos);
    if (progress.size === 0) return { moves: [], skipped: "No todo starts with an issue key." };
    const { linear } = await access.connect(projectId);
    const issue = await linear.getIssue(identifier);
    const states = await statesFor(projectId, issue.team.id);
    const moves = planStatusMoves({ parent: issue, progress, states });
    const applied: SyncResult["moves"] = [];
    for (const move of moves) {
      await access.mutate(projectId, (service) =>
        service.updateIssue(move.issueId, { stateId: move.to.id }),
      );
      applied.push({ identifier: move.identifier, from: move.from, to: move.to });
    }
    if (applied.length > 0) {
      console.log(`Linear sync moved ${applied.map((m) => `${m.identifier} to ${m.to.name}`).join(", ")}`);
    }
    return { moves: applied, skipped: null };
  }

  // One sync per issue at a time, so two turns ending together cannot move an issue twice.
  function queued(identifier: string, run: () => Promise<SyncResult>): Promise<SyncResult> {
    const previous = queues.get(identifier) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(run);
    queues.set(identifier, next);
    void next.finally(() => {
      if (queues.get(identifier) === next) queues.delete(identifier);
    });
    return next;
  }

  async function syncAgent(
    paseo: Paseo,
    agentId: string,
    todos: readonly TodoLike[] | null,
    automatic = false,
  ): Promise<SyncResult> {
    const agent = await agentInfo(paseo, agentId);
    const settings = await readSettings();
    if (settings && !projectEnabled(settings.access, agent.projectId)) {
      return { moves: [], skipped: "Linear is off for this project." };
    }
    if (automatic && !(settings && projectDefaults(settings, agent.projectId).syncTodos)) {
      return { moves: [], skipped: "Todo sync is off for this project." };
    }
    const identifier = agent.labels[AGENT_LABELS.issue];
    if (!identifier || isInternalAgent(agent.labels)) {
      return { moves: [], skipped: "This agent is not linked to a Linear issue." };
    }
    if (agent.labels[AGENT_LABELS.action] !== "implement") {
      return { moves: [], skipped: "Only implementing agents update Linear statuses." };
    }
    let items = todos;
    if (!items) {
      const page = await paseo.agents
        .ref(agentId)
        .timeline.refetch({ direction: "tail", limit: 400, projection: "projected" });
      items = latestTodos(page.entries.map((entry) => entry.item));
    }
    if (!items) return { moves: [], skipped: "The agent has no todos yet." };
    const projectId = agent.labels[AGENT_LABELS.project] ?? null;
    const todoItems = items;
    return queued(identifier, () => syncIssue(identifier, projectId, todoItems));
  }

  // A project can turn sync on or off for itself, so the check needs the agent's project.
  server.on("agent.turn_ended", async (event, { paseo }) => {
    const settings = await readSettings();
    const anyOn = settings?.live.syncTodos || settings?.projects.some((entry) => entry.overrides.syncTodos);
    if (!anyOn) return;
    const todos = latestTodos(event.timeline);
    if (!todos) return;
    try {
      await syncAgent(paseo, event.agent.id, todos, true);
    } catch (error) {
      console.error("Linear sync failed", error);
    }
  });

  server.handle(syncNowRpc, async ({ agentId }, { paseo }) => syncAgent(paseo, agentId, null));
}
