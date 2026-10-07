// Turns the daemon's provider snapshot into Agent, Model, Effort, and Mode choices.

export interface Choice {
  id: string;
  label: string;
}

export interface ModelChoice extends Choice {
  description: string | null;
  isDefault: boolean;
  efforts: Choice[];
  defaultEffortId: string | null;
}

export interface ModeChoice extends Choice {
  icon: string | null;
  colorTier: string | null;
}

export interface AgentChoice extends Choice {
  /** SVG markup for custom providers. Built-in providers have none. */
  iconSvg: string | null;
  models: ModelChoice[];
  modes: ModeChoice[];
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
  description?: string;
  isDefault?: boolean;
  isSelectable?: boolean;
  thinkingOptions?: readonly ThinkingOption[];
  defaultThinkingOptionId?: string;
  thinkingSet?: number;
}

interface SnapshotEntry {
  provider: string;
  label?: string;
  iconSvg?: string;
  status: string;
  enabled?: boolean;
  models?: readonly SnapshotModel[];
  modes?: readonly (Choice & { icon?: string; colorTier?: string })[];
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
      iconSvg: entry.iconSvg ?? null,
      models: (entry.models ?? [])
        .filter((model) => model.isSelectable !== false)
        .map((model) => {
          const set =
            model.thinkingSet === undefined ? null : compact?.thinkingSets[model.thinkingSet];
          const options = set?.options ?? model.thinkingOptions ?? [];
          const fallback = options.find((option) => option.isDefault)?.id ?? null;
          return {
            id: model.id,
            label: model.label,
            description: model.description ?? null,
            isDefault: model.isDefault === true,
            efforts: options.map(({ id, label }) => ({ id, label })),
            defaultEffortId: model.defaultThinkingOptionId ?? set?.defaultOptionId ?? fallback,
          };
        }),
      modes: (entry.modes ?? []).map(({ id, label, icon, colorTier }) => ({
        id,
        label,
        icon: icon ?? null,
        colorTier: colorTier ?? null,
      })),
      defaultModeId: entry.defaultModeId ?? null,
    }))
    .filter((entry) => entry.models.length > 0);
}

export interface AgentSelection {
  agent: AgentChoice;
  model: ModelChoice;
  effort: Choice | null;
  mode: ModeChoice | null;
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

export interface ModelMatch {
  agent: AgentChoice;
  model: ModelChoice;
}

/** Models whose name, id, description, or agent name contain every word of the query. */
export function searchModels(agents: readonly AgentChoice[], query: string): ModelMatch[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return agents.flatMap((agent) =>
    agent.models
      .filter((model) => {
        const text = [model.label, model.id, model.description ?? "", agent.label]
          .join(" ")
          .toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .map((model) => ({ agent, model })),
  );
}

const MODE_ICONS = new Set([
  "Bot",
  "Shield",
  "ShieldAlert",
  "ShieldCheck",
  "ShieldEllipsis",
  "ShieldOff",
  "ShieldPlus",
  "ShieldQuestionMark",
]);

/** The Lucide icon Paseo shows for a mode. */
export function modeIcon(mode: ModeChoice): string {
  const icon = mode.icon ?? "ShieldCheck";
  return MODE_ICONS.has(icon) ? icon : "Bot";
}

function sentenceCase(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

/** Effort and mode names as Paseo writes them, for example "Extra high". */
export function optionLabel(option: Choice): string {
  return option.id === "xhigh" ? "Extra high" : sentenceCase(option.label);
}
