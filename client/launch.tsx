import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import { TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { IssueDetail } from "../shared/linear";
import { ACTION_LABELS, composePrompt } from "../shared/prompts";
import {
  AGENT_ACTIONS,
  type AgentAction,
  type LinearSettings,
  linearSettings,
} from "../shared/settings";
import { useKeyScope } from "./key-scope";
import { type LaunchChoices, useLaunchChoices } from "./launch-choices";
import { Chip, Field, Toggle } from "./launch-fields";
import { linearPatch, type TargetWorkspace, useLaunchAgent } from "./launch-plan";
import { PickerModal } from "./pickers";
import { useCatalog, useIssue } from "./queries";
import { Button, EmptyState, errorMessage, IconButton, SectionLabel, type Theme } from "./ui";

// The workspace whose panel shows the browser. Null on the Linear screen.
export interface LaunchTarget {
  workspace: TargetWorkspace | null;
}

export interface LaunchPageProps {
  theme: Theme;
  compact: boolean;
  issueId: string;
  action: AgentAction;
  target: LaunchTarget;
  navigation: PluginSurfaceProps["navigation"];
  onBack(): void;
  onStarted(): void;
}

type PickerKind = "prompt" | "agent" | "model" | "effort" | "mode" | "project" | "placement";

const SCROLL_STYLE = { flex: 1 } as const;
const PROMPT_CHOICES = AGENT_ACTIONS.map((action) => ({
  value: action,
  label: ACTION_LABELS[action].title,
}));

// Full-page composer for a new agent. It replaces the issue browser until the agent starts.
export function LaunchPage(props: LaunchPageProps) {
  const { theme } = props;
  const settings = useSettings(linearSettings);
  const issue = useIssue(props.issueId);
  if (settings.status === "ready" && issue.data) {
    return <LaunchComposer {...props} issue={issue.data} settings={settings.values} />;
  }
  const failed = settings.status !== "ready" && settings.status !== "loading";
  return (
    <EmptyState
      theme={theme}
      icon={failed || issue.isError ? "TriangleAlert" : "RefreshCw"}
      title={failed || issue.isError ? "Could not open the agent setup" : "Loading"}
      detail={failed ? settings.error : issue.isError ? errorMessage(issue.error) : undefined}
    >
      <Button theme={theme} label="Back to issue" icon="ChevronLeft" onPress={props.onBack} />
    </EmptyState>
  );
}

function pickerConfig(kind: PickerKind, choices: LaunchChoices, action: AgentAction) {
  const { agent } = choices;
  switch (kind) {
    case "prompt":
      return { title: "Prompt", icon: "FileText", value: action, options: PROMPT_CHOICES };
    case "agent":
      return {
        title: "Agent",
        icon: "Bot",
        value: agent?.agent.id ?? null,
        options: choices.agents.map((entry) => ({ value: entry.id, label: entry.label })),
      };
    case "model":
      return {
        title: "Model",
        icon: "Cpu",
        value: agent?.model.id ?? null,
        options: (agent?.agent.models ?? []).map((entry) => ({
          value: entry.id,
          label: entry.label,
        })),
      };
    case "effort":
      return {
        title: "Effort",
        icon: "Gauge",
        value: agent?.effort?.id ?? null,
        options: (agent?.model.efforts ?? []).map((entry) => ({
          value: entry.id,
          label: entry.label,
        })),
      };
    case "mode":
      return {
        title: "Mode",
        icon: "Shield",
        value: agent?.mode?.id ?? null,
        options: (agent?.agent.modes ?? []).map((entry) => ({
          value: entry.id,
          label: entry.label,
        })),
      };
    case "project":
      return {
        title: "Project",
        icon: "FolderGit2",
        value: choices.project?.projectId ?? null,
        options: (choices.projects.data ?? []).map((entry) => ({
          value: entry.projectId,
          label: entry.displayName,
          detail: entry.rootPath,
        })),
      };
    case "placement":
      return {
        title: "Run in",
        icon: "GitBranch",
        value: choices.placement?.value ?? null,
        options: choices.placements,
      };
  }
}

function agentLabel(choices: LaunchChoices): string {
  if (choices.agent) return choices.agent.agent.label;
  return choices.providers.isPending ? "Loading…" : "None available";
}

function LaunchComposer(props: LaunchPageProps & { issue: IssueDetail; settings: LinearSettings }) {
  const { theme, compact, issue, settings, navigation, onStarted } = props;
  const { colors } = theme;
  const toast = useToast();
  const queries = useQueryClient();
  const catalog = useCatalog();
  const keyScope = useKeyScope();
  const [action, setAction] = useState<AgentAction>(props.action);
  const choices = useLaunchChoices({
    issue,
    action,
    settings,
    target: props.target.workspace,
  });
  const launch = useLaunchAgent();
  const label = ACTION_LABELS[action];
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
  const [picker, setPicker] = useState<PickerKind | null>(null);
  // Null until the user types. Until then the prompt follows the template and options.
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);
  const { projectConfig } = choices;
  const generated = useMemo(
    () =>
      composePrompt({
        action,
        issue,
        settings,
        project: projectConfig,
        includeComments,
        extraInstructions: "",
      }),
    [action, issue, settings, projectConfig, includeComments],
  );
  const prompt = customPrompt ?? generated;
  const styles = useMemo(() => {
    const padding = compact ? 16 : 24;
    return {
      root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
      bar: {
        height: 48,
        paddingHorizontal: compact ? 8 : 12,
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      heading: { flex: 1, color: colors.foreground, fontSize: 15, fontWeight: "500" as const },
      content: {
        padding,
        gap: 18,
        paddingBottom: 48,
        width: "100%" as const,
        maxWidth: 820,
        alignSelf: "center" as const,
      },
      issue: { color: colors.foregroundMuted, fontSize: 13 },
      box: {
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        overflow: "hidden" as const,
      },
      input: {
        minHeight: compact ? 200 : 280,
        padding: 14,
        color: colors.foreground,
        fontSize: 14,
        lineHeight: 20,
        textAlignVertical: "top" as const,
      },
      chips: {
        flexDirection: "row" as const,
        flexWrap: "wrap" as const,
        gap: 8,
        padding: 10,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      },
      note: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      hint: { flex: 1, color: colors.foregroundMuted, fontSize: 12 },
      group: { gap: 8 },
      error: { color: colors.statusDanger, fontSize: 13 },
      start: { alignSelf: compact ? ("stretch" as const) : ("flex-end" as const) },
    };
  }, [colors, compact]);

  const close = useCallback(() => setPicker(null), []);
  const choosePrompt = useCallback((value: string) => setAction(value as AgentAction), []);
  const select = useCallback(
    (value: string) => {
      setPicker(null);
      const handlers: Record<PickerKind, (value: string) => void> = {
        prompt: choosePrompt,
        agent: choices.chooseAgent,
        model: choices.chooseModel,
        effort: choices.chooseEffort,
        mode: choices.chooseMode,
        project: choices.chooseProject,
        placement: choices.choosePlacement,
      };
      if (picker) handlers[picker](value);
    },
    [picker, choices, choosePrompt],
  );
  const resetPrompt = useCallback(() => setCustomPrompt(null), []);
  const { mutate } = launch;
  const start = useCallback(() => {
    if (!choices.project || !choices.agent || !choices.placement || !prompt.trim()) return;
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
        agent: choices.agent,
        placement: choices.placement.value,
        prNumber: choices.prNumber,
        target: choices.target,
        agentWorkspace: choices.agentWorkspace,
        prompt,
        patch,
        started,
        keyScope,
      },
      {
        onSuccess: ({ agentId, warning }) => {
          void queries.invalidateQueries({ queryKey: ["linear"] });
          if (warning) {
            toast.show(`Agent started. Linear was not updated: ${warning}`, { variant: "warning" });
          } else toast.show("Agent started", { variant: "success" });
          onStarted();
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
    keyScope,
    queries,
    toast,
    onStarted,
    navigation,
  ]);

  const open = (kind: PickerKind) => () => setPicker(kind);
  const config = picker ? pickerConfig(picker, choices, action) : null;
  const { agent } = choices;
  return (
    <View style={styles.root}>
      <View style={styles.bar}>
        <IconButton theme={theme} icon="ChevronLeft" label="Back to issue" onPress={props.onBack} />
        <Text style={styles.heading} numberOfLines={1}>
          {`${label.verb} · ${issue.identifier}`}
        </Text>
      </View>
      <ScrollView style={SCROLL_STYLE} contentContainerStyle={styles.content}>
        <Text style={styles.issue} numberOfLines={2}>
          {issue.title}
        </Text>
        <View style={styles.box}>
          <TextInput
            value={prompt}
            onChangeText={setCustomPrompt}
            multiline
            placeholder="Tell the agent what to do"
            placeholderTextColor={colors.foregroundMuted}
            accessibilityLabel="Prompt"
            style={styles.input}
          />
          <View style={styles.chips}>
            <Chip theme={theme} label="Prompt" value={label.title} onPress={open("prompt")} />
            <Chip theme={theme} label="Agent" value={agentLabel(choices)} onPress={open("agent")} />
            {agent ? (
              <Chip theme={theme} label="Model" value={agent.model.label} onPress={open("model")} />
            ) : null}
            {agent?.effort ? (
              <Chip
                theme={theme}
                label="Effort"
                value={agent.effort.label}
                onPress={open("effort")}
              />
            ) : null}
            {agent?.mode ? (
              <Chip theme={theme} label="Mode" value={agent.mode.label} onPress={open("mode")} />
            ) : null}
          </View>
        </View>
        <View style={styles.note}>
          <Text style={styles.hint}>
            {customPrompt === null
              ? "The prompt follows the options below until you edit it."
              : "You edited the prompt. Option changes no longer update it."}
          </Text>
          {customPrompt === null ? null : (
            <Button
              theme={theme}
              size="xs"
              variant="ghost"
              icon="RotateCcw"
              label="Reset prompt"
              onPress={resetPrompt}
            />
          )}
        </View>
        <View style={styles.group}>
          <SectionLabel theme={theme}>Where</SectionLabel>
          <Field
            theme={theme}
            label="Project"
            icon="FolderGit2"
            value={
              choices.project?.displayName ??
              (choices.projects.isPending ? "Loading…" : "Choose a project")
            }
            onPress={open("project")}
          />
          <Field
            theme={theme}
            label="Run in"
            icon="GitBranch"
            value={choices.placement?.label ?? ""}
            detail={choices.placement?.detail}
            onPress={open("placement")}
          />
        </View>
        <View style={styles.group}>
          <SectionLabel theme={theme}>Options</SectionLabel>
          <Toggle
            theme={theme}
            label="Include comments in the prompt"
            value={includeComments}
            onChange={setIncludeComments}
          />
          {canStart ? (
            <Toggle
              theme={theme}
              label="Move the issue to In Progress"
              value={moveToStarted}
              onChange={setMoveToStarted}
            />
          ) : null}
          {canAssign ? (
            <Toggle
              theme={theme}
              label="Assign the issue to me"
              value={assignToMe}
              onChange={setAssignToMe}
            />
          ) : null}
        </View>
        {launch.error ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {errorMessage(launch.error)}
          </Text>
        ) : null}
        <View style={styles.start}>
          <Button
            theme={theme}
            variant="primary"
            size="md"
            icon={label.icon}
            label={label.verb}
            busy={launch.isPending}
            disabled={!choices.project || !choices.agent || !prompt.trim()}
            onPress={start}
          />
        </View>
      </ScrollView>
      {config ? (
        <PickerModal
          theme={theme}
          title={config.title}
          icon={config.icon}
          open
          options={config.options}
          value={config.value}
          searchable={config.options.length > 8}
          onClose={close}
          onSelect={select}
        />
      ) : null}
    </View>
  );
}
