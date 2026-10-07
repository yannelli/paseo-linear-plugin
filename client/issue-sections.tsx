import { openExternalUrl, type PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { IssueDetail } from "../shared/linear";
import { Markdown } from "./markdown";
import { type LinkedAgent, useAddComment, useLinkedAgents } from "./queries";
import {
  Avatar,
  Button,
  errorMessage,
  relativeTime,
  SectionLabel,
  StateIcon,
  type Theme,
  usePressableStyle,
} from "./ui";

type Colors = Theme["colors"];
type Navigation = PluginSurfaceProps["navigation"];

function openUrl(url: string) {
  void openExternalUrl(url);
}

function LinkRow(props: {
  theme: Theme;
  label: string;
  detail?: string;
  icon?: string;
  state?: { type: string; color: string };
  target: string;
  onOpen(target: string): void;
}) {
  const { colors } = props.theme;
  const { target, onOpen } = props;
  const styles = useMemo(() => {
    const idle = {
      minHeight: 34,
      paddingHorizontal: 8,
      paddingVertical: 6,
      marginHorizontal: -8,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: "transparent",
    } as const;
    return {
      idle,
      active: { ...idle, backgroundColor: colors.surface2 },
      label: { flex: 1, color: colors.foreground, fontSize: 14 },
      detail: { color: colors.foregroundMuted, fontSize: 12, maxWidth: 160 },
    };
  }, [colors]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const press = useCallback(() => onOpen(target), [onOpen, target]);
  return (
    <Pressable accessibilityRole="link" onPress={press} style={pressStyle}>
      {props.state ? (
        <StateIcon state={props.state} size={14} />
      ) : (
        <Icon name={props.icon ?? "Link"} size={14} color={colors.foregroundMuted} />
      )}
      <Text numberOfLines={1} style={styles.label}>
        {props.label}
      </Text>
      {props.detail ? (
        <Text numberOfLines={1} style={styles.detail}>
          {props.detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

export function IssueRelations(props: {
  theme: Theme;
  issue: IssueDetail;
  onOpenIssue(issueId: string): void;
}) {
  const { theme, issue } = props;
  if (!issue.parent && issue.children.length === 0) return null;
  return (
    <View>
      <SectionLabel theme={theme}>
        {issue.parent ? "Parent and sub-issues" : "Sub-issues"}
      </SectionLabel>
      {issue.parent ? (
        <LinkRow
          theme={theme}
          icon="CornerLeftUp"
          label={`${issue.parent.identifier} ${issue.parent.title}`}
          target={issue.parent.id}
          onOpen={props.onOpenIssue}
        />
      ) : null}
      {issue.children.map((child) => (
        <LinkRow
          key={child.id}
          theme={theme}
          state={child.state}
          label={`${child.identifier} ${child.title}`}
          target={child.id}
          onOpen={props.onOpenIssue}
        />
      ))}
    </View>
  );
}

export function IssueLinks({ theme, issue }: { theme: Theme; issue: IssueDetail }) {
  if (issue.attachments.length === 0) return null;
  return (
    <View>
      <SectionLabel theme={theme}>Links</SectionLabel>
      {issue.attachments.map((attachment) => (
        <LinkRow
          key={attachment.id}
          theme={theme}
          icon={attachment.sourceType === "github" ? "GitPullRequest" : "Link"}
          label={attachment.title}
          detail={attachment.subtitle ?? undefined}
          target={attachment.url}
          onOpen={openUrl}
        />
      ))}
    </View>
  );
}

const AGENT_STATUS_COPY: Record<string, string> = {
  initializing: "Starting",
  idle: "Idle",
  running: "Working",
  error: "Error",
  closed: "Closed",
};

function agentStatusColor(agent: LinkedAgent, colors: Colors): string {
  if (agent.requiresAttention) return colors.statusWarning;
  if (agent.status === "running") return colors.statusSuccess;
  if (agent.status === "error") return colors.statusDanger;
  return colors.foregroundMuted;
}

function AgentRow(props: {
  theme: Theme;
  agent: LinkedAgent;
  first: boolean;
  navigation: Navigation;
}) {
  const { colors } = props.theme;
  const { agent, first, navigation } = props;
  const statusColor = agentStatusColor(agent, colors);
  const styles = useMemo(() => {
    const idle = {
      minHeight: 44,
      paddingHorizontal: 12,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      borderTopWidth: first ? 0 : 1,
      borderTopColor: colors.border,
      backgroundColor: colors.surface1,
    } as const;
    return {
      idle,
      active: { ...idle, backgroundColor: colors.surface2 },
      title: { flex: 1, color: colors.foreground, fontSize: 14 },
      dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor },
      status: { color: colors.foregroundMuted, fontSize: 12 },
    };
  }, [colors, first, statusColor]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const open = useCallback(
    () => navigation?.openAgent({ agentId: agent.id }),
    [navigation, agent.id],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open agent ${agent.title ?? agent.id}`}
      disabled={!navigation}
      onPress={open}
      style={pressStyle}
    >
      <Icon
        name={agent.action === "review" ? "ScanSearch" : "Bot"}
        size={16}
        color={colors.foregroundMuted}
      />
      <Text numberOfLines={1} style={styles.title}>
        {agent.title ?? agent.id}
      </Text>
      <View style={styles.dot} />
      <Text style={styles.status}>
        {agent.requiresAttention ? "Needs you" : (AGENT_STATUS_COPY[agent.status] ?? agent.status)}
      </Text>
    </Pressable>
  );
}

export function LinkedAgents(props: { theme: Theme; identifier: string; navigation: Navigation }) {
  const { colors } = props.theme;
  const agents = useLinkedAgents(props.identifier);
  const style = useMemo(
    () =>
      ({
        borderRadius: 10,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      }) as const,
    [colors],
  );
  if (!agents.data || agents.data.length === 0) return null;
  return (
    <View>
      <SectionLabel theme={props.theme}>Agents on this issue</SectionLabel>
      <View style={style}>
        {agents.data.map((agent, index) => (
          <AgentRow
            key={agent.id}
            theme={props.theme}
            agent={agent}
            first={index === 0}
            navigation={props.navigation}
          />
        ))}
      </View>
    </View>
  );
}

type IssueComment = IssueDetail["comments"][number];

function CommentItem({ theme, comment }: { theme: Theme; comment: IssueComment }) {
  const { colors } = theme;
  const styles = useMemo(
    () =>
      ({
        root: { flexDirection: "row", gap: 10 },
        body: { flex: 1, minWidth: 0, gap: 2 },
        meta: { color: colors.foregroundMuted, fontSize: 12 },
        author: { color: colors.foreground, fontWeight: "500" },
      }) as const,
    [colors],
  );
  return (
    <View style={styles.root}>
      <Avatar theme={theme} name={comment.user?.displayName ?? "Linear"} size={24} />
      <View style={styles.body}>
        <Text style={styles.meta}>
          <Text style={styles.author}>{comment.user?.displayName ?? "Integration"}</Text>
          {`  ${relativeTime(comment.createdAt)}`}
        </Text>
        <Markdown theme={theme} compact source={comment.body} />
      </View>
    </View>
  );
}

export function Comments({ theme, issue }: { theme: Theme; issue: IssueDetail }) {
  const { colors } = theme;
  const toast = useToast();
  const [body, setBody] = useState("");
  const { mutate, isPending } = useAddComment(issue.id);
  const submit = useCallback(() => {
    if (!body.trim()) return;
    mutate(body, {
      onSuccess: () => setBody(""),
      onError: (error) => toast.error(errorMessage(error)),
    });
  }, [body, mutate, toast]);
  const styles = useMemo(
    () =>
      ({
        root: { gap: 12 },
        composer: { gap: 8 },
        input: {
          minHeight: 72,
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
          color: colors.foreground,
          fontSize: 14,
          textAlignVertical: "top",
        },
        actions: { alignItems: "flex-end" },
      }) as const,
    [colors],
  );
  return (
    <View style={styles.root}>
      <SectionLabel theme={theme}>Activity</SectionLabel>
      {issue.comments.map((comment) => (
        <CommentItem key={comment.id} theme={theme} comment={comment} />
      ))}
      <View style={styles.composer}>
        <TextInput
          value={body}
          onChangeText={setBody}
          multiline
          placeholder="Leave a comment…"
          placeholderTextColor={colors.foregroundMuted}
          accessibilityLabel="New comment"
          style={styles.input}
        />
        <View style={styles.actions}>
          <Button
            theme={theme}
            icon="Send"
            label="Comment"
            busy={isPending}
            disabled={!body.trim()}
            onPress={submit}
          />
        </View>
      </View>
    </View>
  );
}
