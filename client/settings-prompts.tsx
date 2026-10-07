import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import { DEFAULT_TEMPLATES } from "../shared/prompts";
import {
  AGENT_ACTIONS,
  type AgentAction,
  type Isolation,
  type LinearSettings,
  linearSettings,
} from "../shared/settings";
import { useProviders } from "./queries";
import {
  MultilineField,
  type ReadySettings,
  SaveBar,
  SettingsGate,
  useSettingsDraft,
  VariablesHint,
} from "./settings-fields";
import type { Theme } from "./ui";

const ISOLATION_OPTIONS: readonly { label: string; value: Isolation }[] = [
  { label: "New worktree on the issue branch", value: "worktree" },
  { label: "The project or current workspace", value: "workspace" },
];
const AUTO_MODEL = "__auto__";
const TEMPLATE_TITLES: Record<AgentAction, string> = {
  implement: "Implement prompt",
  review: "Review prompt",
};

type Edit = ReturnType<typeof useSettingsDraft>["edit"];
type Launch = LinearSettings["launch"];

export function PromptSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(linearSettings);
  const render = useCallback(
    (ready: ReadySettings) => <PromptEditor theme={theme} settings={ready} />,
    [theme],
  );
  return (
    <SettingsGate theme={theme} title="Prompts" settings={settings}>
      {render}
    </SettingsGate>
  );
}

function useLaunchSetter<Key extends keyof Launch>(edit: Edit, key: Key) {
  return useCallback(
    (value: Launch[Key]) =>
      edit((current) => ({ ...current, launch: { ...current.launch, [key]: value } })),
    [edit, key],
  );
}

function LaunchDefaults({ launch, edit }: { launch: Launch; edit: Edit }) {
  const providers = useProviders();
  const modelOptions = useMemo(
    () => [
      { label: "Provider default", value: AUTO_MODEL },
      ...(providers.data ?? []).flatMap((provider) =>
        provider.models.map((model) => ({
          label: `${provider.label} · ${model.label}`,
          value: `${provider.id}/${model.id}`,
        })),
      ),
    ],
    [providers.data],
  );
  const setProvider = useLaunchSetter(edit, "provider");
  const chooseModel = useCallback(
    (value: string) => setProvider(value === AUTO_MODEL ? "" : value),
    [setProvider],
  );
  const setIsolation = useLaunchSetter(edit, "isolation");
  const setComments = useLaunchSetter(edit, "includeComments");
  const setStarted = useLaunchSetter(edit, "moveToStarted");
  const setAssign = useLaunchSetter(edit, "assignToMe");
  const model = modelOptions.some((option) => option.value === launch.provider)
    ? launch.provider
    : AUTO_MODEL;
  return (
    <SettingsSection title="Agent defaults">
      <SettingsCard>
        <SettingsSelect
          label="Model"
          hint="Preselected when you start an agent from an issue."
          value={model}
          options={modelOptions}
          onValueChange={chooseModel}
        />
        <SettingsSelect
          label="Run agents in"
          value={launch.isolation}
          options={ISOLATION_OPTIONS}
          onValueChange={setIsolation}
        />
        <SettingsSwitch
          label="Include issue comments"
          value={launch.includeComments}
          onValueChange={setComments}
        />
        <SettingsSwitch
          label="Move the issue to In Progress"
          hint="Applies when an implementation agent starts."
          value={launch.moveToStarted}
          onValueChange={setStarted}
        />
        <SettingsSwitch
          label="Assign the issue to me"
          hint="Applies when an implementation agent starts."
          value={launch.assignToMe}
          onValueChange={setAssign}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function TemplateSection(props: { theme: Theme; action: AgentAction; value: string; edit: Edit }) {
  const { action, edit } = props;
  const setTemplate = useCallback(
    (text: string) =>
      edit((current) => ({ ...current, templates: { ...current.templates, [action]: text } })),
    [edit, action],
  );
  const copyBuiltIn = useCallback(
    () => setTemplate(DEFAULT_TEMPLATES[action]),
    [setTemplate, action],
  );
  return (
    <SettingsSection title={TEMPLATE_TITLES[action]}>
      <SettingsCard>
        <MultilineField
          theme={props.theme}
          label="Template"
          hint="Leave empty to use the built-in prompt shown as the placeholder."
          value={props.value}
          placeholder={DEFAULT_TEMPLATES[action]}
          minHeight={180}
          onChange={setTemplate}
        />
        <SettingsAction
          label="Start from the built-in prompt"
          actionLabel="Copy built-in"
          disabled={props.value === DEFAULT_TEMPLATES[action]}
          onPress={copyBuiltIn}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function PromptEditor({ theme, settings }: { theme: Theme; settings: ReadySettings }) {
  const { values, dirty, edit, save, discard } = useSettingsDraft(settings);
  const saveDraft = useCallback(() => void save(), [save]);
  return (
    <View>
      <LaunchDefaults launch={values.launch} edit={edit} />
      {AGENT_ACTIONS.map((action) => (
        <TemplateSection
          key={action}
          theme={theme}
          action={action}
          value={values.templates[action]}
          edit={edit}
        />
      ))}
      <SettingsSection title="Template variables">
        <SettingsCard>
          <SettingsRow
            label="Available in every template"
            hint="Projects can append to or replace these prompts in Linear projects settings."
          >
            <VariablesHint theme={theme} />
          </SettingsRow>
        </SettingsCard>
      </SettingsSection>
      <SaveBar
        theme={theme}
        dirty={dirty}
        saving={settings.saving}
        error={settings.saveError}
        onSave={saveDraft}
        onDiscard={discard}
      />
    </View>
  );
}
