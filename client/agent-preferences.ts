import { z } from "zod";

// Agent choices remembered between launches, in the shape Paseo's new-agent form stores them.

const ProviderPreferenceSchema = z.object({
  model: z.string().optional(),
  mode: z.string().optional(),
  thinkingByModel: z.record(z.string(), z.string()).optional(),
});

const AgentPreferencesSchema = z.object({
  provider: z.string().optional(),
  providerPreferences: z.record(z.string(), ProviderPreferenceSchema).optional(),
});

export type ProviderPreference = z.infer<typeof ProviderPreferenceSchema>;
export type AgentPreferences = z.infer<typeof AgentPreferencesSchema>;

/** What the user last picked for one launch. */
export interface RememberedLaunch {
  agent: string;
  model: string;
  effort: string | null;
  mode: string | null;
}

interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Paseo's own new-agent preferences. Read only: the app owns this key. */
export const PASEO_PREFERENCES_KEY = "@paseo:create-agent-preferences";
export const PLUGIN_PREFERENCES_KEY = "@yannelli/paseo-linear-plugin:agent-preferences";

let sessionPreferences: AgentPreferences = {};

// Paseo keeps preferences in AsyncStorage, which is localStorage on web and desktop.
// Native apps have no localStorage, so only this session's launches are remembered there.
function storage(): KeyValueStorage | null {
  try {
    const candidate = (globalThis as { localStorage?: KeyValueStorage }).localStorage;
    return candidate && typeof candidate.getItem === "function" ? candidate : null;
  } catch {
    return null;
  }
}

export function parsePreferences(raw: string | null): AgentPreferences {
  if (!raw) return {};
  try {
    const parsed = AgentPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

function readStored(key: string): AgentPreferences {
  try {
    return parsePreferences(storage()?.getItem(key) ?? null);
  } catch {
    return {};
  }
}

/** Layers `top` over `base`, per provider and per model. */
export function mergePreferences(base: AgentPreferences, top: AgentPreferences): AgentPreferences {
  const providers: Record<string, ProviderPreference> = { ...base.providerPreferences };
  for (const [id, preference] of Object.entries(top.providerPreferences ?? {})) {
    const below = providers[id] ?? {};
    providers[id] = {
      ...below,
      ...preference,
      thinkingByModel: { ...below.thinkingByModel, ...preference.thinkingByModel },
    };
  }
  return { provider: top.provider ?? base.provider, providerPreferences: providers };
}

export function withLaunch(
  preferences: AgentPreferences,
  launch: RememberedLaunch,
): AgentPreferences {
  return mergePreferences(preferences, {
    provider: launch.agent,
    providerPreferences: {
      [launch.agent]: {
        model: launch.model,
        ...(launch.mode ? { mode: launch.mode } : {}),
        ...(launch.effort ? { thinkingByModel: { [launch.model]: launch.effort } } : {}),
      },
    },
  });
}

/** Paseo's remembered choices, overridden by launches made from this plugin. */
export function loadAgentPreferences(): AgentPreferences {
  const paseo = readStored(PASEO_PREFERENCES_KEY);
  const plugin = mergePreferences(readStored(PLUGIN_PREFERENCES_KEY), sessionPreferences);
  return mergePreferences(paseo, plugin);
}

export function rememberLaunch(launch: RememberedLaunch): void {
  sessionPreferences = withLaunch(sessionPreferences, launch);
  try {
    const stored = withLaunch(readStored(PLUGIN_PREFERENCES_KEY), launch);
    storage()?.setItem(PLUGIN_PREFERENCES_KEY, JSON.stringify(stored));
  } catch {
    // Storage full or blocked: this session still remembers the launch.
  }
}
