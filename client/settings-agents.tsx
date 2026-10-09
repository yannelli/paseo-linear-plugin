import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useCallback } from "react";
import { View } from "react-native";
import { linearSettings, MAX_AGENTS_LIMIT, type ToolSettings } from "../shared/settings";
import { type ReadySettings, SaveBar, SettingsGate, useSettingsDraft } from "./settings-fields";
import type { Theme } from "./ui";

// Settings for all projects. A project can change each of them in Linear settings, under
// Projects.

const LIMITS = [0, 1, 2, 3, 4, 6, 8, 12, MAX_AGENTS_LIMIT];

export const limitLabel = (limit: number) => (limit === 0 ? "No limit" : limit === 1 ? "1 agent" : `${limit} agents`);

export const LIMIT_OPTIONS = LIMITS.map((limit) => ({ label: limitLabel(limit), value: String(limit) }));

export const COPY = {
  enabled: {
    label: "Give agents the Linear tools",
    hint: "Agents started from an issue get the plugin's linear MCP server when Keep Linear updated, Hand off work to Paseo agents, or sub-issue agents need it. When it is off, agents that have the server get no tools from it.",
  },
  allowEdits: {
    label: "Let agents edit issue descriptions",
    hint: "The edit_issue tool, which checks off task list items and updates the plan. When it is off, agents can only read the issue and its sub-issues.",
  },
  assignAgents: {
    label: "Choose agents for sub-issues",
    hint: "The agent setup page lists the sub-issues, and you can choose an agent, model, and thinking for each one. The agent you start hands those sub-issues to them.",
  },
  maxAgents: {
    label: "Agents at the same time",
    hint: "How many agents one launch can run at the same time with start_agent. It refuses to start more until one of them finishes.",
  },
} as const;

export function AgentSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(linearSettings);
  const render = useCallback(
    (ready: ReadySettings) => <AgentEditor theme={theme} settings={ready} />,
    [theme],
  );
  return (
    <SettingsGate theme={theme} title="Agents" settings={settings}>
      {render}
    </SettingsGate>
  );
}

function AgentEditor({ theme, settings }: { theme: Theme; settings: ReadySettings }) {
  const { values, dirty, edit, save, discard } = useSettingsDraft(settings);
  const { tools } = values;
  const change = useCallback(
    (patch: Partial<ToolSettings>) => edit((current) => ({ ...current, tools: { ...current.tools, ...patch } })),
    [edit],
  );
  return (
    <View>
      <SettingsSection title="Linear tools">
        <SettingsCard>
          <SettingsSwitch
            label={COPY.enabled.label}
            hint={COPY.enabled.hint}
            value={tools.enabled}
            onValueChange={(enabled) => change({ enabled })}
          />
          <SettingsSwitch
            label={COPY.allowEdits.label}
            hint={COPY.allowEdits.hint}
            value={tools.allowEdits}
            disabled={!tools.enabled}
            onValueChange={(allowEdits) => change({ allowEdits })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Agents on sub-issues">
        <SettingsCard>
          <SettingsSwitch
            label={COPY.assignAgents.label}
            hint={COPY.assignAgents.hint}
            value={tools.assignAgents}
            disabled={!tools.enabled}
            onValueChange={(assignAgents) => change({ assignAgents })}
          />
          <SettingsSelect
            label={COPY.maxAgents.label}
            hint={COPY.maxAgents.hint}
            value={String(tools.maxAgents)}
            options={LIMIT_OPTIONS}
            disabled={!tools.enabled}
            onValueChange={(value) => change({ maxAgents: Number(value) })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Projects">
        <SettingsCard>
          <SettingsRow
            label="Values for one project"
            hint="A project can use its own values for these settings and for the agent defaults. Set them in Linear settings, under Projects."
          />
        </SettingsCard>
      </SettingsSection>
      <SaveBar
        theme={theme}
        dirty={dirty}
        saving={settings.saving}
        error={settings.saveError}
        onSave={() => void save()}
        onDiscard={discard}
      />
    </View>
  );
}
