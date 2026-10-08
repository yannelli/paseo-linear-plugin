import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import {
  type LinearSettings,
  type LiveView,
  linearSettings,
  type MappingMode,
} from "../shared/settings";
import { useProviders } from "./queries";
import { type ReadySettings, SaveBar, SettingsGate, useSettingsDraft } from "./settings-fields";
import type { Theme } from "./ui";

const MAPPING_OPTIONS: readonly { label: string; value: MappingMode }[] = [
  { label: "Ticket text: free, rough", value: "semantic" },
  { label: "Explore agent: reads the repo first", value: "explore" },
];
const VIEW_OPTIONS: readonly { label: string; value: LiveView }[] = [
  { label: "Map: files grouped by folder", value: "map" },
  { label: "Graph: issue, files, and agents as connected nodes", value: "graph" },
];
const SAME_AGENT = "";

export function LiveSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(linearSettings);
  const render = useCallback(
    (ready: ReadySettings) => <LiveEditor theme={theme} settings={ready} />,
    [theme],
  );
  return (
    <SettingsGate theme={theme} title="Live" settings={settings}>
      {render}
    </SettingsGate>
  );
}

type Live = LinearSettings["live"];

function LiveEditor({ theme, settings }: { theme: Theme; settings: ReadySettings }) {
  const { values, dirty, edit, save, discard } = useSettingsDraft(settings);
  const providers = useProviders();
  const live = values.live;
  const change = useCallback(
    (patch: Partial<Live>) => edit((current) => ({ ...current, live: { ...current.live, ...patch } })),
    [edit],
  );
  const agentOptions = useMemo(() => {
    const options = [{ label: "Same agent as the implementer", value: SAME_AGENT }];
    for (const agent of providers.data ?? []) {
      for (const model of agent.models) {
        options.push({ label: `${agent.label} · ${model.label}`, value: `${agent.id}/${model.id}` });
      }
    }
    if (live.exploreProvider && !options.some((option) => option.value === live.exploreProvider)) {
      options.push({ label: `${live.exploreProvider} · not on this host`, value: live.exploreProvider });
    }
    return options;
  }, [providers.data, live.exploreProvider]);

  return (
    <View>
      <SettingsSection title="Linear Live">
        <SettingsCard>
          <SettingsSwitch
            label="Show Linear Live"
            hint="Track agents started from an issue: sub-issues, todos, and the files they touch."
            value={live.enabled}
            onValueChange={(enabled) => change({ enabled })}
          />
          <SettingsSelect
            label="Map files with"
            hint="Ticket text finds paths named in the issue. The explore agent reads the repository first, and the implement agent starts when the map is ready. It costs provider usage."
            value={live.mapping}
            options={MAPPING_OPTIONS}
            onValueChange={(mapping) => change({ mapping })}
            disabled={!live.enabled}
          />
          <SettingsSelect
            label="Show files as"
            hint="The view Linear Live opens with. Switch it in the panel at any time."
            value={live.view}
            options={VIEW_OPTIONS}
            onValueChange={(view) => change({ view })}
            disabled={!live.enabled}
          />
          <SettingsSelect
            label="Explore and setup agent"
            hint="It may only read and search the project folder. A faster, cheaper model is usually enough."
            value={live.exploreProvider}
            options={agentOptions}
            onValueChange={(exploreProvider) => change({ exploreProvider })}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Linear status sync">
        <SettingsCard>
          <SettingsSwitch
            label="Update Linear from agent todos"
            hint="After each turn, a todo that starts with a sub-issue key moves that sub-issue forward: In Progress, then Done. The parent moves to In Review when every sub-issue is Done. Statuses never move back."
            value={live.syncTodos}
            onValueChange={(syncTodos) => change({ syncTodos })}
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
