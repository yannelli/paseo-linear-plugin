import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import type { IssueSummary } from "../shared/linear";
import {
  Avatar,
  LabelPill,
  PriorityIcon,
  relativeTime,
  StateIcon,
  type Theme,
  usePressableStyle,
} from "./ui";

export function StateHeader(props: { theme: Theme; state: IssueSummary["state"]; count: number }) {
  const { colors } = props.theme;
  const styles = useMemo(
    () =>
      ({
        root: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 10,
          paddingTop: 14,
          paddingBottom: 6,
        },
        name: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
        count: { color: colors.foregroundMuted, fontSize: 12 },
      }) as const,
    [colors],
  );
  return (
    <View style={styles.root}>
      <StateIcon state={props.state} size={14} />
      <Text style={styles.name}>{props.state.name}</Text>
      <Text style={styles.count}>{props.count}</Text>
    </View>
  );
}

const INDENT = 18;

export function IssueRow(props: {
  theme: Theme;
  compact: boolean;
  issue: IssueSummary;
  depth: number;
  childCount: number;
  collapsed: boolean;
  nested: boolean;
  selected: boolean;
  onSelect(issueId: string): void;
  onToggle(issueId: string): void;
}) {
  const { theme, issue, compact, selected, onSelect, onToggle, depth } = props;
  const { colors } = theme;
  const styles = useMemo(() => {
    const row = {
      minHeight: 40,
      paddingLeft: 10 + depth * INDENT,
      paddingRight: 10,
      paddingVertical: 8,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: "transparent",
    } as const;
    const active = { ...row, backgroundColor: colors.surface2 };
    return {
      idle: selected ? active : row,
      active,
      identifier: { color: colors.foregroundMuted, fontSize: 12, width: 68 },
      body: { flex: 1, minWidth: 0 },
      title: { color: colors.foreground, fontSize: 14 },
      meta: { color: colors.foregroundMuted, fontSize: 12 },
      updated: { color: colors.foregroundMuted, fontSize: 12, minWidth: 56, textAlign: "right" },
      chevron: { width: 18, height: 24, alignItems: "center", justifyContent: "center" },
      count: { color: colors.foregroundMuted, fontSize: 12 },
    } as const;
  }, [colors, selected, depth]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const a11yState = useMemo(() => ({ selected }), [selected]);
  const press = useCallback(() => onSelect(issue.id), [onSelect, issue.id]);
  const toggle = useCallback(() => onToggle(issue.id), [onToggle, issue.id]);
  const subIssues = `${props.childCount} sub-issue${props.childCount === 1 ? "" : "s"}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${issue.identifier} ${issue.title}, ${issue.state.name}`}
      accessibilityState={a11yState}
      onPress={press}
      style={pressStyle}
    >
      {props.nested ? (
        props.childCount > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${props.collapsed ? "Show" : "Hide"} ${subIssues}`}
            hitSlop={6}
            onPress={toggle}
            style={styles.chevron}
          >
            <Icon
              name={props.collapsed ? "ChevronRight" : "ChevronDown"}
              size={14}
              color={colors.foregroundMuted}
            />
          </Pressable>
        ) : (
          <View style={styles.chevron} />
        )
      ) : null}
      <PriorityIcon theme={theme} priority={issue.priority} size={15} />
      {compact ? null : (
        <Text numberOfLines={1} style={styles.identifier}>
          {issue.identifier}
        </Text>
      )}
      <StateIcon state={issue.state} size={15} />
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.title}>
          {issue.title}
        </Text>
        {compact ? (
          <Text numberOfLines={1} style={styles.meta}>
            {issue.identifier} · {relativeTime(issue.updatedAt)}
          </Text>
        ) : null}
        {props.collapsed ? (
          <Text numberOfLines={1} style={styles.count}>
            {subIssues} hidden
          </Text>
        ) : null}
      </View>
      {compact
        ? null
        : issue.labels
            .slice(0, 2)
            .map((label) => (
              <LabelPill key={label.id} theme={theme} name={label.name} color={label.color} />
            ))}
      {compact ? null : (
        <Text numberOfLines={1} style={styles.updated}>
          {relativeTime(issue.updatedAt)}
        </Text>
      )}
      <Avatar theme={theme} name={issue.assignee?.displayName ?? null} />
    </Pressable>
  );
}
