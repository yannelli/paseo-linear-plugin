import { type PluginSurfaceProps, useSettings, useWorkspace } from "@getpaseo/plugin/client";
import { Icon, Modal, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { IssueDetail } from "../shared/linear";
import { ACTION_LABELS, composePrompt } from "../shared/prompts";
import {
  type AgentAction,
  type LinearSettings,
  linearSettings,
  type ProjectConfig,
} from "../shared/settings";
import {
  defaultProjectId,
  linearPatch,
  modelOptions,
  type Placement,
  placementOptions,
  pullRequestNumber,
  resolveModel,
  resolvePlacement,
  type TargetWorkspace,
  useLaunchAgent,
} from "./launch-plan";
import { Field, PromptPreview, Toggle } from "./launch-fields";
import { PickerPage } from "./pickers";
import { useCatalog, useLinkedAgents, useProjects, useProviders } from "./queries";
import { Button, errorMessage, SectionLabel, type Theme } from "./ui";

export interface LaunchTarget {
  workspaceId: string | null;
}

interface LaunchProps {
  theme: Theme;
  action: AgentAction;
  issue: IssueDetail;
  target: LaunchTarget;
  navigation: PluginSurfaceProps["navigation"];
  onClose(): void;
}

type PickerKind = "project" | "placement" | "model";

const selectTarget = (workspace: { id: string; projectId: string; name: string }) => ({
  id: workspace.id,
  projectId: workspace.projectId,
  name: workspace.name,
});

export function LaunchModal(props: LaunchProps) {
  const settings = useSettings(linearSettings);
  const { colors } = props.theme;
  const { onClose } = props;
  const label = ACTION_LABELS[props.action];
  const icon = useMemo(
    () => <Icon name={label.icon} size={18} color={colors.foreground} />,
    [label.icon, colors.foreground],
  );
  const statusStyle = useMemo(
    () => ({ color: settings.status === "loading" ? colors.foregroundMuted : colors.statusDanger }),
    [settings.status, colors],
  );
  const openChange = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  let body = <Text style={statusStyle}>Loading settings…</Text>;
  if (settings.status === "ready") body = <LaunchForm {...props} settings={settings.values} />;
  else if (settings.status !== "loading") body = <Text style={statusStyle}>{settings.error}</Text>;
  return (
    <Modal
      title={`${label.title} ${props.issue.identifier}`}
      icon={icon}
      open
      onOpenChange={openChange}
    >
      <Modal.Content>{body}</Modal.Content>
    </Modal>
  );
}

function useLaunchChoices(props: LaunchProps & { settings: LinearSettings }) {
  const { issue, settings, action } = props;
  const projects = useProjects();
  const providers = useProviders();
  const target = useWorkspace(
    props.target.workspaceId ?? "",
    selectTarget,
  ) as TargetWorkspace | null;
  const prNumber = action === "review" ? pullRequestNumber(issue) : null;
  const linked = useLinkedAgents(issue.identifier);
  const agentWorkspaceId =
    linked.data?.find((agent) => agent.action === "implement" && agent.workspaceId)?.workspaceId ??
    null;
  const agentWorkspace = useWorkspace(
    agentWorkspaceId ?? "",
    selectTarget,
  ) as TargetWorkspace | null;
  const [projectChoice, setProjectChoice] = useState<string | null>(null);
  const [placementChoice, setPlacementChoice] = useState<Placement | null>(null);
  const [modelChoice, setModelChoice] = useState<string | null>(null);
  const projectId =
    projectChoice ??
    defaultProjectId({ target, teamId: issue.team.id, settings, projects: projects.data });
  const project = projects.data?.find((entry) => entry.projectId === projectId) ?? null;
  const placements = useMemo(
    () =>
      placementOptions({
        action,
        prNumber,
        project,
        branchName: issue.branchName,
        target,
        agentWorkspace,
      }),
    [action, prNumber, project, issue.branchName, target, agentWorkspace],
  );
  const placement = resolvePlacement(
    placements,
    placementChoice,
    action,
    settings.launch.isolation,
  );
  const models = useMemo(() => modelOptions(providers.data), [providers.data]);
  const model = resolveModel(models, modelChoice, settings.launch.provider);
  const chooseProject = useCallback((value: string) => {
    setProjectChoice(value);
    setPlacementChoice(null);
  }, []);
  const choosePlacement = useCallback(
    (value: string) => setPlacementChoice(value as Placement),
    [],
  );
  return {
    projects,
    providers,
    target,
    agentWorkspace,
    prNumber,
    project,
    projectConfig: settings.projects.find((entry) => entry.projectId === projectId) ?? null,
    placements,
    placement,
    models,
    model,
    chooseProject,
    choosePlacement,
    chooseModel: setModelChoice,
  };
}

type Choices = ReturnType<typeof useLaunchChoices>;

function pickerFor(kind: PickerKind, choices: Choices) {
  if (kind === "project") {
    return {
      title: "Project",
      value: choices.project?.projectId ?? null,
      options: (choices.projects.data ?? []).map((entry) => ({
        value: entry.projectId,
        label: entry.displayName,
        detail: entry.rootPath,
      })),
      select: choices.chooseProject,
    };
  }
  if (kind === "placement") {
    return {
      title: "Where to run",
      value: choices.placement?.value ?? null,
      options: choices.placements,
      select: choices.choosePlacement,
    };
  }
  return {
    title: "Model",
    value: choices.model?.value ?? null,
    options: choices.models,
    select: choices.chooseModel,
  };
}

function LaunchPicker(props: { theme: Theme; kind: PickerKind; choices: Choices; onDone(): void }) {
  const config = pickerFor(props.kind, props.choices);
  const { onDone } = props;
  const { select } = config;
  const choose = useCallback(
    (value: string) => {
      onDone();
      select(value);
    },
    [onDone, select],
  );
  return (
    <PickerPage
      theme={props.theme}
      title={config.title}
      options={config.options}
      value={config.value}
      searchable={config.options.length > 8}
      onBack={onDone}
      onSelect={choose}
    />
  );
}

function projectLabel(choices: Choices): string {
  if (choices.project) return choices.project.displayName;
  return choices.projects.isPending ? "Loading…" : "Choose a project";
}

function modelLabel(choices: Choices): string {
  if (choices.model) return `${choices.model.detail} · ${choices.model.label}`;
  return choices.providers.isPending ? "Loading…" : "No models available";
}

function customizationHint(config: ProjectConfig | null, action: AgentAction): string {
  const custom =
    config !== null &&
    (config[action].mode !== "default" ||
      config.instructions.trim() !== "" ||
      config.steps.some((step) => step.trim() !== ""));
  if (custom && config) {
    return `Uses the custom ${ACTION_LABELS[action].title.toLowerCase()} prompt for ${config.displayName}.`;
  }
  return "Customize prompts per project in Settings, Plugins, Linear.";
}

function LaunchForm(props: LaunchProps & { settings: LinearSettings }) {
  const { theme, issue, action, settings, onClose, navigation } = props;
  const { colors } = theme;
  const label = ACTION_LABELS[action];
  const toast = useToast();
  const queries = useQueryClient();
  const catalog = useCatalog();
  const choices = useLaunchChoices(props);
  const launch = useLaunchAgent();
  const viewerId = catalog.data?.viewer.id ?? null;
  const started =
    catalog.data?.teams
      .find((team) => team.id === issue.team.id)
      ?.states.find((state) => state.type === "started") ?? null;
  const canStart = action === "implement" && !["started", "completed"].includes(issue.state.type);
  const canAssign = action === "implement" && viewerId !== null && issue.assignee?.id !== viewerId;
  const [includeComments, setIncludeComments] = useState(settings.launch.includeComments);
  const [moveToStarted, setMoveToStarted] = useState(settings.launch.moveToStarted);
  const [assignToMe, setAssignToMe] = useState(settings.launch.assignToMe);
  const [extra, setExtra] = useState("");
  const [picker, setPicker] = useState<PickerKind | null>(null);
  const { projectConfig } = choices;
  const prompt = useMemo(
    () =>
      composePrompt({
        action,
        issue,
        settings,
        project: projectConfig,
        includeComments,
        extraInstructions: extra,
      }),
    [action, issue, settings, projectConfig, includeComments, extra],
  );
  const styles = useMemo(
    () => ({
      root: { gap: 16 },
      title: { color: colors.foreground, fontSize: 14 },
      group: { gap: 8 },
      toggles: { gap: 4 },
      input: {
        minHeight: 64,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        color: colors.foreground,
        fontSize: 14,
        textAlignVertical: "top" as const,
      },
      hint: { color: colors.foregroundMuted, fontSize: 12, marginTop: 6 },
      error: { color: colors.statusDanger, fontSize: 13 },
    }),
    [colors],
  );

  const closePicker = useCallback(() => setPicker(null), []);
  const openProject = useCallback(() => setPicker("project"), []);
  const openPlacement = useCallback(() => setPicker("placement"), []);
  const openModel = useCallback(() => setPicker("model"), []);
  const { mutate } = launch;
  const start = useCallback(() => {
    if (!choices.project || !choices.model || !choices.placement) return;
    const patch = linearPatch({
      started,
      moveToStarted: canStart && moveToStarted,
      viewerId,
      assignToMe: canAssign && assignToMe,
    });
    mutate(
      {
        action,
        issue,
        project: choices.project,
        model: choices.model.value,
        placement: choices.placement.value,
        prNumber: choices.prNumber,
        target: choices.target,
        agentWorkspace: choices.agentWorkspace,
        prompt,
        patch,
        started,
      },
      {
        onSuccess: ({ agentId, warning }) => {
          void queries.invalidateQueries({ queryKey: ["linear"] });
          if (warning)
            toast.show(`Agent started. Linear was not updated: ${warning}`, { variant: "warning" });
          else toast.show("Agent started", { variant: "success" });
          onClose();
          navigation?.openAgent({ agentId });
        },
      },
    );
  }, [
    choices,
    started,
    canStart,
    moveToStarted,
    viewerId,
    canAssign,
    assignToMe,
    mutate,
    action,
    issue,
    prompt,
    queries,
    toast,
    onClose,
    navigation,
  ]);

  if (picker) {
    return <LaunchPicker theme={theme} kind={picker} choices={choices} onDone={closePicker} />;
  }
  return (
    <View style={styles.root}>
      <Text style={styles.title} numberOfLines={2}>
        {issue.title}
      </Text>
      <View style={styles.group}>
        <Field
          theme={theme}
          label="Project"
          icon="FolderGit2"
          value={projectLabel(choices)}
          onPress={openProject}
        />
        <Field
          theme={theme}
          label="Run in"
          icon="GitBranch"
          value={choices.placement?.label ?? ""}
          detail={choices.placement?.detail}
          onPress={openPlacement}
        />
        <Field
          theme={theme}
          label="Model"
          icon="Bot"
          value={modelLabel(choices)}
          onPress={openModel}
        />
      </View>
      <View style={styles.toggles}>
        <Toggle
          theme={theme}
          label="Include comments"
          value={includeComments}
          onChange={setIncludeComments}
        />
        {canStart ? (
          <Toggle
            theme={theme}
            label="Move issue to In Progress"
            value={moveToStarted}
            onChange={setMoveToStarted}
          />
        ) : null}
        {canAssign ? (
          <Toggle
            theme={theme}
            label="Assign issue to me"
            value={assignToMe}
            onChange={setAssignToMe}
          />
        ) : null}
      </View>
      <View>
        <SectionLabel theme={theme}>Additional instructions</SectionLabel>
        <TextInput
          value={extra}
          onChangeText={setExtra}
          multiline
          placeholder="Optional. Appended to the prompt for this run only."
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel="Additional instructions"
          style={styles.input}
        />
        <Text style={styles.hint}>{customizationHint(projectConfig, action)}</Text>
      </View>
      <PromptPreview theme={theme} prompt={prompt} />
      {launch.error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errorMessage(launch.error)}
        </Text>
      ) : null}
      <Button
        theme={theme}
        variant="primary"
        size="md"
        icon={label.icon}
        label={label.verb}
        busy={launch.isPending}
        disabled={!choices.project || !choices.model}
        onPress={start}
      />
    </View>
  );
}
