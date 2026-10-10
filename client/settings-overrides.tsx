import { SettingsCard, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo } from "react";
import { View } from "react-native";
import {
  type LinearSettings,
  type ProjectConfig,
  type ProjectOverrides,
  projectDefaults,
} from "../shared/settings";
import { useProviders } from "./queries";
import { COPY, LIMIT_OPTIONS, limitLabel } from "./settings-agents";
import { ISOLATION_OPTIONS } from "./settings-prompts";

// A project's own values for settings that all projects share. "Same as all projects" removes
// the project's value, so the project follows the setting for all projects again.

const INHERIT = "__all__";
const AUTO_MODEL = "__auto__";
const ON_OFF = [
  { label: "On", value: "on" },
  { label: "Off", value: "off" },
];

type BooleanKey = {
  [Key in keyof ProjectOverrides]-?: NonNullable<ProjectOverrides[Key]> extends boolean ? Key : never;
}[keyof ProjectOverrides];

interface Option {
  label: string;
  value: string;
}

const onOff = (value: boolean) => (value ? "On" : "Off");
const labelOf = (options: readonly Option[], value: string) =>
  options.find((option) => option.value === value)?.label ?? value;

function OverrideSelect(props: {
  label: string;
  hint?: string;
  /** The project's own value, or undefined when it follows all projects. */
  value: string | undefined;
  /** How the setting for all projects reads, such as "On". */
  inherited: string;
  options: readonly Option[];
  disabled?: boolean;
  onChange(value: string | undefined): void;
}) {
  const { onChange } = props;
  const options = useMemo(
    () => [{ label: `Same as all projects: ${props.inherited}`, value: INHERIT }, ...props.options],
    [props.inherited, props.options],
  );
  const select = useCallback((value: string) => onChange(value === INHERIT ? undefined : value), [onChange]);
  return (
    <SettingsSelect
      label={props.label}
      hint={props.hint}
      value={props.value ?? INHERIT}
      options={options}
      disabled={props.disabled}
      onValueChange={select}
    />
  );
}

export function ProjectOverridesSection(props: {
  values: LinearSettings;
  config: ProjectConfig;
  change(patch: Partial<ProjectConfig>): void;
}) {
  const { values, config, change } = props;
  const own = config.overrides;
  const providers = useProviders();
  const set = useCallback(
    <Key extends keyof ProjectOverrides>(key: Key, value: ProjectOverrides[Key] | undefined) => {
      const { [key]: _previous, ...others } = config.overrides;
      change({ overrides: value === undefined ? others : { ...others, [key]: value } });
    },
    [change, config.overrides],
  );
  const modelOptions = useMemo(() => {
    const options: Option[] = [{ label: "Provider default", value: AUTO_MODEL }];
    for (const agent of providers.data ?? []) {
      for (const model of agent.models) options.push({ label: `${agent.label} · ${model.label}`, value: `${agent.id}/${model.id}` });
    }
    if (own.provider && !options.some((option) => option.value === own.provider)) {
      options.push({ label: `${own.provider} · not on this host`, value: own.provider });
    }
    return options;
  }, [providers.data, own.provider]);
  const tools = projectDefaults(values, config.projectId).tools;
  const toggle = (key: BooleanKey, label: string, global: boolean, extra: { hint?: string; disabled?: boolean } = {}) => (
    <OverrideSelect
      label={label}
      hint={extra.hint}
      value={own[key] === undefined ? undefined : own[key] ? "on" : "off"}
      inherited={onOff(global)}
      options={ON_OFF}
      disabled={extra.disabled}
      onChange={(value) => set(key, value === undefined ? undefined : value === "on")}
    />
  );
  const globalModel = values.launch.provider || AUTO_MODEL;
  return (
    <View>
      <SettingsSection title="Agent defaults for this project">
        <SettingsCard>
          <OverrideSelect
            label="Model"
            hint="Preselected when you start an agent from an issue in this project."
            value={own.provider === undefined ? undefined : own.provider || AUTO_MODEL}
            inherited={labelOf(modelOptions, globalModel)}
            options={modelOptions}
            onChange={(value) => set("provider", value === undefined ? undefined : value === AUTO_MODEL ? "" : value)}
          />
          <OverrideSelect
            label="Run agents in"
            value={own.isolation}
            inherited={labelOf(ISOLATION_OPTIONS, values.launch.isolation)}
            options={ISOLATION_OPTIONS}
            onChange={(value) => set("isolation", value as ProjectOverrides["isolation"])}
          />
          {toggle("includeComments", "Include issue comments", values.launch.includeComments)}
          {toggle("moveToStarted", "Move the issue to In Progress", values.launch.moveToStarted)}
          {toggle("assignToMe", "Assign the issue to me", values.launch.assignToMe)}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Linear tools and sync for this project">
        <SettingsCard>
          {toggle("syncTodos", COPY.syncTodos.label, values.sync.todos, {
            hint: "After each turn, todos that start with a sub-issue key move that sub-issue forward.",
          })}
          {toggle("tools", COPY.enabled.label, values.tools.enabled, { hint: COPY.enabled.hint })}
          {toggle("allowEdits", COPY.allowEdits.label, values.tools.allowEdits, { disabled: !tools.enabled })}
          {toggle("assignAgents", COPY.assignAgents.label, values.tools.assignAgents, { disabled: !tools.enabled })}
          <OverrideSelect
            label={COPY.maxAgents.label}
            value={own.maxAgents === undefined ? undefined : String(own.maxAgents)}
            inherited={limitLabel(values.tools.maxAgents)}
            options={LIMIT_OPTIONS}
            disabled={!tools.enabled}
            onChange={(value) => set("maxAgents", value === undefined ? undefined : Number(value))}
          />
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
