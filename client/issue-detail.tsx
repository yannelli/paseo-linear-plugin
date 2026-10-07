import { openExternalUrl, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { copyText, Icon, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { IssueDetail, IssuePatch, LinearTeam, LinearUser } from "../shared/linear";
import { ACTION_LABELS } from "../shared/prompts";
import type { AgentAction } from "../shared/settings";
import { IssueBreadcrumbs } from "./breadcrumbs";
import { Markdown } from "./markdown";
import { Comments, IssueLinks, IssueRelations, LinkedAgents } from "./issue-sections";
import type { LaunchTarget } from "./launch";
import {
  assigneeOptions,
  PickerModal,
  priorityOptions,
  PropertyChip,
  stateOptions,
  UNASSIGNED,
} from "./pickers";
import { useIssue, useUpdateIssue } from "./queries";
import {
  Avatar,
  Button,
  EmptyState,
  errorMessage,
  IconButton,
  LabelPill,
  priorityMeta,
  PriorityIcon,
  SectionLabel,
  StateIcon,
  type Theme,
} from "./ui";

type PickerKind = "state" | "priority" | "assignee";
type Picker = PickerKind | null;

const PICKER_META: Record<PickerKind, { title: string; icon: string }> = {
  state: { title: "Status", icon: "CircleDot" },
  priority: { title: "Priority", icon: "SignalHigh" },
  assignee: { title: "Assignee", icon: "UserRound" },
};
const ROW_WRAP_STYLE = { flexDirection: "row", flexWrap: "wrap", gap: 8 } as const;
const LABELS_STYLE = { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: -8 } as const;
const ROOT_STYLE = { flex: 1, minHeight: 0 } as const;
const SCROLL_STYLE = { flex: 1 } as const;

function pickerValue(picker: Picker, issue: IssueDetail): string {
  if (picker === "state") return issue.state.id;
  if (picker === "priority") return String(issue.priority);
  return issue.assignee?.id ?? UNASSIGNED;
}

function pickerPatch(picker: Picker, value: string): IssuePatch {
  if (picker === "state") return { stateId: value };
  if (picker === "priority") return { priority: Number(value) };
  return { assigneeId: value === UNASSIGNED ? null : value };
}

export interface IssueDetailProps {
  theme: Theme;
  compact: boolean;
  issueId: string;
  teams: readonly LinearTeam[];
  users: readonly LinearUser[];
  viewerId: string | null;
  target: LaunchTarget;
  navigation: PluginSurfaceProps["navigation"];
  onBack(): void;
  onOpenIssue(issueId: string): void;
  onLaunch(action: AgentAction): void;
}

export function IssueDetailView(props: IssueDetailProps) {
  const { theme } = props;
  const issue = useIssue(props.issueId);
  const { refetch } = issue;
  const reload = useCallback(() => void refetch(), [refetch]);
  if (issue.isPending) return <EmptyState theme={theme} icon="RefreshCw" title="Loading issue" />;
  if (issue.isError) {
    return (
      <EmptyState
        theme={theme}
        icon="TriangleAlert"
        tone="danger"
        title="Could not load the issue"
        detail={errorMessage(issue.error)}
      >
        <Button theme={theme} label="Back to issues" icon="ChevronLeft" onPress={props.onBack} />
      </EmptyState>
    );
  }
  return <LoadedIssue {...props} issue={issue.data} refetch={reload} />;
}

function LoadedIssue(props: IssueDetailProps & { issue: IssueDetail; refetch(): void }) {
  const { theme, issue, compact } = props;
  const { colors } = theme;
  const [picker, setPicker] = useState<Picker>(null);
  const update = useUpdateIssue(issue.id);
  const styles = useMemo(() => {
    const padding = compact ? 16 : 24;
    return {
      content: { padding, gap: 20, paddingBottom: 48 },
      title: {
        color: colors.foreground,
        fontSize: compact ? 18 : 20,
        fontWeight: "500",
        lineHeight: compact ? 24 : 28,
      },
      description: { color: colors.foregroundMuted, fontSize: 14, lineHeight: 21 },
    } as const;
  }, [colors, compact]);
  return (
    <View style={ROOT_STYLE}>
      <IssueHeader
        theme={theme}
        compact={compact}
        issue={issue}
        onBack={props.onBack}
        onRefresh={props.refetch}
        onOpenIssue={props.onOpenIssue}
      />
      <ScrollView style={SCROLL_STYLE} contentContainerStyle={styles.content}>
        <Text selectable style={styles.title}>
          {issue.title}
        </Text>
        <IssueProperties
          theme={theme}
          issue={issue}
          disabled={update.isPending}
          onPick={setPicker}
        />
        {issue.labels.length > 0 ? (
          <View style={LABELS_STYLE}>
            {issue.labels.map((label) => (
              <LabelPill key={label.id} theme={theme} name={label.name} color={label.color} />
            ))}
          </View>
        ) : null}
        <LaunchButtons theme={theme} onLaunch={props.onLaunch} />
        <LinkedAgents theme={theme} identifier={issue.identifier} navigation={props.navigation} />
        <View>
          <SectionLabel theme={theme}>Description</SectionLabel>
          {issue.description?.trim() ? (
            <Markdown theme={theme} compact={compact} source={issue.description} />
          ) : (
            <Text style={styles.description}>No description.</Text>
          )}
        </View>
        <IssueRelations theme={theme} issue={issue} onOpenIssue={props.onOpenIssue} />
        <IssueLinks theme={theme} issue={issue} />
        <Comments theme={theme} issue={issue} />
      </ScrollView>
      <IssuePicker
        theme={theme}
        issue={issue}
        picker={picker}
        teams={props.teams}
        users={props.users}
        viewerId={props.viewerId}
        onUpdate={update.mutate}
        onClose={setPicker}
      />
    </View>
  );
}

function IssueHeader(props: {
  theme: Theme;
  compact: boolean;
  issue: IssueDetail;
  onBack(): void;
  onRefresh(): void;
  onOpenIssue(issueId: string): void;
}) {
  const { theme, compact, issue } = props;
  const { colors } = theme;
  const toast = useToast();
  const { branchName, url } = issue;
  const styles = useMemo(
    () =>
      ({
        bar: {
          height: 48,
          paddingHorizontal: compact ? 8 : 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 4,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
      }) as const,
    [colors, compact],
  );
  const copyBranch = useCallback(async () => {
    try {
      await copyText(branchName);
      toast.show(`Copied ${branchName}`, { variant: "success" });
    } catch {
      toast.error("Could not copy the branch name");
    }
  }, [branchName, toast]);
  const pressCopy = useCallback(() => void copyBranch(), [copyBranch]);
  const openInLinear = useCallback(() => void openExternalUrl(url), [url]);
  return (
    <View style={styles.bar}>
      <IconButton
        theme={theme}
        icon={compact ? "ChevronLeft" : "X"}
        label="Close issue"
        onPress={props.onBack}
      />
      <IssueBreadcrumbs
        theme={theme}
        compact={compact}
        issue={issue}
        onOpenIssue={props.onOpenIssue}
      />
      <IconButton theme={theme} icon="RefreshCw" label="Refresh issue" onPress={props.onRefresh} />
      <IconButton theme={theme} icon="GitBranch" label="Copy branch name" onPress={pressCopy} />
      <IconButton theme={theme} icon="ExternalLink" label="Open in Linear" onPress={openInLinear} />
    </View>
  );
}

function IssueProperties(props: {
  theme: Theme;
  issue: IssueDetail;
  disabled: boolean;
  onPick(picker: PickerKind): void;
}) {
  const { theme, issue, onPick } = props;
  const { colors } = theme;
  const assigneeName = issue.assignee?.displayName ?? null;
  const stateIcon = useMemo(() => <StateIcon state={issue.state} size={14} />, [issue.state]);
  const priorityIcon = useMemo(
    () => <PriorityIcon theme={theme} priority={issue.priority} size={14} />,
    [theme, issue.priority],
  );
  const avatar = useMemo(
    () => <Avatar theme={theme} name={assigneeName} size={16} />,
    [theme, assigneeName],
  );
  const projectStyles = useMemo(
    () =>
      ({
        row: {
          height: 30,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 4,
        },
        name: { color: colors.foregroundMuted, fontSize: 13 },
      }) as const,
    [colors],
  );
  const pickState = useCallback(() => onPick("state"), [onPick]);
  const pickPriority = useCallback(() => onPick("priority"), [onPick]);
  const pickAssignee = useCallback(() => onPick("assignee"), [onPick]);
  return (
    <View style={ROW_WRAP_STYLE}>
      <PropertyChip
        theme={theme}
        label={issue.state.name}
        leading={stateIcon}
        accessibilityLabel={`Status: ${issue.state.name}. Change status`}
        disabled={props.disabled}
        onPress={pickState}
      />
      <PropertyChip
        theme={theme}
        label={priorityMeta(issue.priority).label}
        leading={priorityIcon}
        accessibilityLabel={`Priority: ${issue.priorityLabel}. Change priority`}
        disabled={props.disabled}
        onPress={pickPriority}
      />
      <PropertyChip
        theme={theme}
        label={assigneeName ?? "Unassigned"}
        leading={avatar}
        accessibilityLabel={`Assignee: ${assigneeName ?? "nobody"}. Change assignee`}
        disabled={props.disabled}
        onPress={pickAssignee}
      />
      {issue.project ? (
        <View style={projectStyles.row}>
          <Icon name="FolderGit2" size={14} color={colors.foregroundMuted} />
          <Text style={projectStyles.name}>{issue.project.name}</Text>
        </View>
      ) : null}
    </View>
  );
}

function LaunchButtons({ theme, onLaunch }: { theme: Theme; onLaunch(action: AgentAction): void }) {
  const implement = useCallback(() => onLaunch("implement"), [onLaunch]);
  const review = useCallback(() => onLaunch("review"), [onLaunch]);
  return (
    <View style={ROW_WRAP_STYLE}>
      <Button
        theme={theme}
        variant="primary"
        size="md"
        icon={ACTION_LABELS.implement.icon}
        label={ACTION_LABELS.implement.verb}
        onPress={implement}
      />
      <Button
        theme={theme}
        variant="secondary"
        size="md"
        icon={ACTION_LABELS.review.icon}
        label={ACTION_LABELS.review.verb}
        onPress={review}
      />
    </View>
  );
}

function IssuePicker(props: {
  theme: Theme;
  issue: IssueDetail;
  picker: Picker;
  teams: readonly LinearTeam[];
  users: readonly LinearUser[];
  viewerId: string | null;
  onUpdate: ReturnType<typeof useUpdateIssue>["mutate"];
  onClose(picker: null): void;
}) {
  const { theme, issue, picker, users, viewerId, onUpdate, onClose } = props;
  const toast = useToast();
  const team = props.teams.find((entry) => entry.id === issue.team.id) ?? null;
  const options = useMemo(() => {
    if (picker === "state") return stateOptions(team?.states ?? []);
    if (picker === "priority") return priorityOptions(theme);
    if (picker === "assignee") return assigneeOptions(theme, users, viewerId);
    return [];
  }, [picker, team, theme, users, viewerId]);
  const close = useCallback(() => onClose(null), [onClose]);
  const choose = useCallback(
    (value: string) => {
      onClose(null);
      onUpdate(pickerPatch(picker, value), {
        onError: (error) => toast.error(errorMessage(error)),
      });
    },
    [picker, onClose, onUpdate, toast],
  );
  const meta = PICKER_META[picker ?? "assignee"];
  return (
    <PickerModal
      theme={theme}
      title={meta.title}
      icon={meta.icon}
      open={picker !== null}
      options={options}
      value={pickerValue(picker, issue)}
      searchable={picker === "assignee"}
      onClose={close}
      onSelect={choose}
    />
  );
}
