import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { LinearTeam } from "../shared/linear";
import { ACTION_LABELS } from "../shared/prompts";
import {
  AGENT_ACTIONS,
  type AgentAction,
  emptyProjectConfig,
  linearSettings,
  type ProjectConfig,
  type PromptMode,
  upsertProject,
} from "../shared/settings";
import { effectiveKeyScope, KeyScopeProvider } from "./key-scope";
import { ProjectSetup } from "./project-init";
import { AccessSection } from "./settings-access";
import { type PaseoProjectOption, useAuthStatus, useCatalog, useProjects } from "./queries";
import {
  MultilineField,
  type ReadySettings,
  SaveBar,
  SettingsGate,
  useSettingsDraft,
} from "./settings-fields";
import type { Theme } from "./ui";

const MODE_OPTIONS: readonly { label: string; value: PromptMode }[] = [
  { label: "Use the default prompt", value: "default" },
  { label: "Append to the default prompt", value: "append" },
  { label: "Replace the default prompt", value: "replace" },
];
const STEPS_PLACEHOLDER = "Run the type checker\nUpdate the changelog\nOpen a draft pull request";

type Change = (patch: Partial<ProjectConfig>) => void;

export function ProjectSettings({ theme }: PluginSurfaceProps) {
  const settings = useSettings(linearSettings);
  const render = useCallback(
    (ready: ReadySettings) => <ProjectEditor theme={theme} settings={ready} />,
    [theme],
  );
  return (
    <SettingsGate theme={theme} title="Projects" settings={settings}>
      {render}
    </SettingsGate>
  );
}

function projectOptions(
  projects: readonly PaseoProjectOption[] | undefined,
  stored: readonly ProjectConfig[],
) {
  const known = (projects ?? []).map((project) => {
    const customized = stored.some((entry) => entry.projectId === project.projectId);
    return {
      value: project.projectId,
      label: customized ? `${project.displayName} · customized` : project.displayName,
    };
  });
  const missing = stored
    .filter((entry) => !projects?.some((project) => project.projectId === entry.projectId))
    .map((entry) => ({ value: entry.projectId, label: `${entry.displayName} · not on this host` }));
  return [...known, ...missing];
}

function ProjectEditor({ theme, settings }: { theme: Theme; settings: ReadySettings }) {
  const { values, dirty, edit, save, discard } = useSettingsDraft(settings);
  const projects = useProjects();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const options = useMemo(
    () => projectOptions(projects.data, values.projects),
    [projects.data, values.projects],
  );
  const projectId = selectedId ?? options[0]?.value ?? null;
  const paseoProject = projects.data?.find((project) => project.projectId === projectId) ?? null;
  const stored = values.projects.find((entry) => entry.projectId === projectId) ?? null;
  const config = useMemo(
    () =>
      stored ??
      emptyProjectConfig({
        projectId: projectId ?? "",
        displayName: paseoProject?.displayName ?? projectId ?? "",
        rootPath: paseoProject?.rootPath ?? "",
      }),
    [stored, projectId, paseoProject],
  );
  const change = useCallback<Change>(
    (patch) =>
      edit((current) => ({
        ...current,
        projects: upsertProject(current, { ...config, ...patch }),
      })),
    [edit, config],
  );
  const remove = useCallback(
    () =>
      edit((current) => ({
        ...current,
        projects: current.projects.filter((entry) => entry.projectId !== config.projectId),
      })),
    [edit, config.projectId],
  );
  const saveDraft = useCallback(() => void save(), [save]);
  const mutedStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);

  if (projects.isPending) return <Text style={mutedStyle}>Loading projects…</Text>;
  if (!projectId) {
    return (
      <SettingsSection title="Projects">
        <Text style={mutedStyle}>Add a project to Paseo to customize its Linear prompts.</Text>
      </SettingsSection>
    );
  }
  return (
    <View>
      <AccessSection
        access={values.access}
        saved={settings.values.access}
        projects={projects.data}
        edit={edit}
      />
      <SettingsSection title="Project">
        <SettingsCard>
          <SettingsSelect
            label="Customize"
            value={projectId}
            options={options}
            onValueChange={setSelectedId}
          />
          <SettingsRow label="Folder" hint={config.rootPath || "Unknown"} />
        </SettingsCard>
      </SettingsSection>
      <TeamsSection config={config} change={change} />
      <ProjectSetup theme={theme} config={config} change={change} />
      <InstructionsSection theme={theme} config={config} change={change} />
      {AGENT_ACTIONS.map((action) => (
        <ActionSection key={action} theme={theme} action={action} config={config} change={change} />
      ))}
      {stored ? (
        <SettingsSection title="Reset">
          <SettingsCard>
            <SettingsAction
              label="Remove this project's customization"
              actionLabel="Remove"
              onPress={remove}
            />
          </SettingsCard>
        </SettingsSection>
      ) : null}
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

function TeamsSection({ config, change }: { config: ProjectConfig; change: Change }) {
  const auth = useAuthStatus();
  const scope = effectiveKeyScope(config.projectId, auth.data?.projectKeys);
  return (
    <KeyScopeProvider key={scope ?? "default"} projectId={scope}>
      <TeamSwitches
        config={config}
        change={change}
        enabled={scope !== null || auth.data?.configured === true}
      />
    </KeyScopeProvider>
  );
}

function TeamSwitches(props: { config: ProjectConfig; change: Change; enabled: boolean }) {
  const { config, change } = props;
  const catalog = useCatalog(props.enabled);
  return (
    <SettingsSection title="Linear teams">
      <SettingsCard>
        {catalog.data ? (
          catalog.data.teams.map((team) => (
            <TeamSwitch key={team.id} team={team} config={config} change={change} />
          ))
        ) : (
          <SettingsRow label="Teams" hint="Connect Linear to map its teams to this project." />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}

function TeamSwitch(props: { team: LinearTeam; config: ProjectConfig; change: Change }) {
  const { team, config, change } = props;
  const toggle = useCallback(
    (enabled: boolean) =>
      change({
        teamIds: enabled
          ? [...config.teamIds, team.id]
          : config.teamIds.filter((id) => id !== team.id),
      }),
    [change, config.teamIds, team.id],
  );
  return (
    <SettingsSwitch
      label={`${team.name} (${team.key})`}
      hint="Issues from this team default to this project when you start an agent."
      value={config.teamIds.includes(team.id)}
      onValueChange={toggle}
    />
  );
}

function InstructionsSection(props: { theme: Theme; config: ProjectConfig; change: Change }) {
  const { change } = props;
  const setInstructions = useCallback((instructions: string) => change({ instructions }), [change]);
  const setSteps = useCallback((text: string) => change({ steps: text.split("\n") }), [change]);
  return (
    <SettingsSection title="Instructions and steps">
      <SettingsCard>
        <MultilineField
          theme={props.theme}
          label="Project instructions"
          hint="Added to every implement and review prompt for this project."
          value={props.config.instructions}
          placeholder="Example: This is a pnpm monorepo. Run pnpm test --filter <package> before finishing."
          onChange={setInstructions}
        />
        <MultilineField
          theme={props.theme}
          label="Steps"
          hint="One step per line. Agents receive them as a numbered checklist."
          value={props.config.steps.join("\n")}
          placeholder={STEPS_PLACEHOLDER}
          onChange={setSteps}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

function ActionSection(props: {
  theme: Theme;
  action: AgentAction;
  config: ProjectConfig;
  change: Change;
}) {
  const { action, change } = props;
  const override = props.config[action];
  const setMode = useCallback(
    (mode: PromptMode) => change({ [action]: { ...override, mode } }),
    [change, action, override],
  );
  const setText = useCallback(
    (text: string) => change({ [action]: { ...override, text } }),
    [change, action, override],
  );
  return (
    <SettingsSection title={`${ACTION_LABELS[action].title} prompt`}>
      <SettingsCard>
        <SettingsSelect
          label="Prompt"
          value={override.mode}
          options={MODE_OPTIONS}
          onValueChange={setMode}
        />
        {override.mode === "default" ? null : (
          <MultilineField
            theme={props.theme}
            label={override.mode === "append" ? "Text to append" : "Replacement prompt"}
            hint="Supports {{identifier}}, {{title}}, {{url}}, {{branch}}, and {{issue}}."
            value={override.text}
            minHeight={140}
            onChange={setText}
          />
        )}
      </SettingsCard>
    </SettingsSection>
  );
}
