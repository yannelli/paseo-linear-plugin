// Turns the daemon's provider snapshot into Agent, Model, Effort, and Mode choices.

export interface Choice {
  id: string;
  label: string;
}

export interface ModelChoice extends Choice {
  isDefault: boolean;
  efforts: Choice[];
  defaultEffortId: string | null;
}

export interface AgentChoice extends Choice {
  models: ModelChoice[];
  modes: Choice[];
  defaultModeId: string | null;
}

interface ThinkingOption {
  id: string;
  label: string;
  isDefault?: boolean;
}

interface SnapshotModel {
  id: string;
  label: string;
  isDefault?: boolean;
  isSelectable?: boolean;
  thinkingOptions?: readonly ThinkingOption[];
  defaultThinkingOptionId?: string;
  thinkingSet?: number;
}

interface SnapshotEntry {
  provider: string;
  label?: string;
  status: string;
  enabled?: boolean;
  models?: readonly SnapshotModel[];
  modes?: readonly Choice[];
  defaultModeId?: string | null;
}

export interface ProviderSnapshot {
  entries: readonly SnapshotEntry[];
  compactSnapshot?: {
    entries: readonly SnapshotEntry[];
    thinkingSets: readonly { options: readonly ThinkingOption[]; defaultOptionId?: string }[];
  } | null;
}

// App connections get the compact catalog, where a model points into a shared list of efforts.
export function agentChoices(snapshot: ProviderSnapshot): AgentChoice[] {
  const compact = snapshot.entries.length === 0 ? snapshot.compactSnapshot : null;
  const entries = compact ? compact.entries : snapshot.entries;
  return entries
    .filter((entry) => entry.status === "ready" && entry.enabled !== false)
    .map((entry) => ({
      id: entry.provider,
      label: entry.label ?? entry.provider,
      models: (entry.models ?? [])
        .filter((model) => model.isSelectable !== false)
        .map((model) => {
          const set = model.thinkingSet === undefined ? null : compact?.thinkingSets[model.thinkingSet];
          const options = set?.options ?? model.thinkingOptions ?? [];
          const fallback = options.find((option) => option.isDefault)?.id ?? null;
          return {
            id: model.id,
            label: model.label,
            isDefault: model.isDefault === true,
            efforts: options.map(({ id, label }) => ({ id, label })),
            defaultEffortId: model.defaultThinkingOptionId ?? set?.defaultOptionId ?? fallback,
          };
        }),
      modes: (entry.modes ?? []).map(({ id, label }) => ({ id, label })),
      defaultModeId: entry.defaultModeId ?? null,
    }))
    .filter((entry) => entry.models.length > 0);
}

export interface AgentSelection {
  agent: AgentChoice;
  model: ModelChoice;
  effort: Choice | null;
  mode: Choice | null;
}

export interface AgentPicks {
  agent: string | null;
  model: string | null;
  effort: string | null;
  mode: string | null;
}

/** `configured` is the settings default in `provider/model` form. Empty uses the first agent. */
export function resolveAgent(
  agents: readonly AgentChoice[],
  picks: AgentPicks,
  configured: string,
): AgentSelection | null {
  const [configuredAgent, ...rest] = configured.split("/");
  const configuredModel = rest.join("/");
  const agent =
    agents.find((entry) => entry.id === picks.agent) ??
    agents.find((entry) => entry.id === configuredAgent) ??
    agents[0];
  if (!agent) return null;
  const preferredModel = agent.id === configuredAgent ? configuredModel : null;
  const model =
    agent.models.find((entry) => entry.id === picks.model) ??
    agent.models.find((entry) => entry.id === preferredModel) ??
    agent.models.find((entry) => entry.isDefault) ??
    agent.models[0];
  if (!model) return null;
  const effort =
    model.efforts.find((entry) => entry.id === picks.effort) ??
    model.efforts.find((entry) => entry.id === model.defaultEffortId) ??
    null;
  const mode =
    agent.modes.find((entry) => entry.id === picks.mode) ??
    agent.modes.find((entry) => entry.id === agent.defaultModeId) ??
    null;
  return { agent, model, effort, mode };
}

/** Config for `agents.create`. Ids come from the selection, so they always fit the model. */
export function agentConfig(selection: AgentSelection) {
  return {
    provider: `${selection.agent.id}/${selection.model.id}`,
    ...(selection.effort ? { thinkingOptionId: selection.effort.id } : {}),
    ...(selection.mode ? { modeId: selection.mode.id } : {}),
  };
}
