import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, type ListRenderItemInfo, Pressable, ScrollView, Text, View } from "react-native";
import type { AssigneeFilter, IssueSummary, LinearTeam, StatusFilter } from "../shared/linear";
import { PickerModal } from "./pickers";
import { useIssues } from "./queries";
import type { BrowserState } from "./store";
import {
  Avatar,
  Button,
  EmptyState,
  errorMessage,
  LabelPill,
  PriorityIcon,
  relativeTime,
  Segmented,
  StateIcon,
  type Theme,
  usePressableStyle,
} from "./ui";

const ASSIGNEE_OPTIONS: readonly { value: AssigneeFilter; label: string }[] = [
  { value: "me", label: "Mine" },
  { value: "anyone", label: "Everyone" },
  { value: "unassigned", label: "Unassigned" },
];
const STATUS_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "backlog", label: "Backlog" },
  { value: "done", label: "Done" },
  { value: "all", label: "All" },
];
const STATE_ORDER = [
  "started",
  "unstarted",
  "triage",
  "backlog",
  "completed",
  "canceled",
  "duplicate",
];
const ALL_TEAMS = "__all__";
const ROOT_STYLE = { flex: 1, minHeight: 0 } as const;
const FILTER_SCROLL_STYLE = { flexGrow: 0 } as const;
const ROW_STYLE = { flexDirection: "row", gap: 8, alignItems: "center" } as const;

type Update = (patch: Partial<BrowserState>) => void;

type Row =
  | { kind: "header"; key: string; state: IssueSummary["state"]; count: number }
  | { kind: "issue"; key: string; issue: IssueSummary };

function groupRows(issues: readonly IssueSummary[]): Row[] {
  const groups = new Map<string, IssueSummary[]>();
  for (const issue of issues) {
    const key = issue.state.name;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  const ordered = [...groups.values()].sort((a, b) => {
    const left = a[0]?.state;
    const right = b[0]?.state;
    if (!left || !right) return 0;
    const byType = STATE_ORDER.indexOf(left.type) - STATE_ORDER.indexOf(right.type);
    return byType !== 0 ? byType : left.position - right.position;
  });
  const rows: Row[] = [];
  for (const group of ordered) {
    const state = group[0]?.state;
    if (!state) continue;
    rows.push({ kind: "header", key: `header-${state.name}`, state, count: group.length });
    for (const issue of group) rows.push({ kind: "issue", key: issue.id, issue });
  }
  return rows;
}

function rowKey(row: Row): string {
  return row.key;
}

export function IssueList(props: {
  theme: Theme;
  compact: boolean;
  teams: readonly LinearTeam[];
  state: BrowserState;
  update: Update;
}) {
  const { theme, state, update } = props;
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const team = props.teams.find((entry) => entry.id === state.teamId) ?? null;
  const teamOptions = useMemo(
    () => [
      { value: ALL_TEAMS, label: "All teams" },
      ...props.teams.map((entry) => ({ value: entry.id, label: entry.name, detail: entry.key })),
    ],
    [props.teams],
  );
  const openTeams = useCallback(() => setTeamPickerOpen(true), []);
  const closeTeams = useCallback(() => setTeamPickerOpen(false), []);
  const selectTeam = useCallback(
    (value: string) => {
      setTeamPickerOpen(false);
      update({ teamId: value === ALL_TEAMS ? null : value });
    },
    [update],
  );
  return (
    <View style={ROOT_STYLE}>
      <IssueFilters
        theme={theme}
        compact={props.compact}
        state={state}
        teamName={team ? team.name : "All teams"}
        update={update}
        onOpenTeams={openTeams}
      />
      <IssueResults theme={theme} compact={props.compact} state={state} update={update} />
      <PickerModal
        theme={theme}
        title="Team"
        icon="Users"
        open={teamPickerOpen}
        options={teamOptions}
        value={state.teamId ?? ALL_TEAMS}
        searchable={props.teams.length > 8}
        onClose={closeTeams}
        onSelect={selectTeam}
      />
    </View>
  );
}

function IssueFilters(props: {
  theme: Theme;
  compact: boolean;
  state: BrowserState;
  teamName: string;
  update: Update;
  onOpenTeams(): void;
}) {
  const { theme, compact, state, update } = props;
  const { colors } = theme;
  const [draft, setDraft] = useState(state.query);
  useEffect(() => setDraft(state.query), [state.query]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== state.query) update({ query: draft });
    }, 300);
    return () => clearTimeout(timer);
  }, [draft, state.query, update]);
  const styles = useMemo(() => {
    const padding = compact ? 12 : 16;
    return {
      root: { paddingHorizontal: padding, paddingTop: padding, gap: 10 },
      search: {
        flex: 1,
        height: 36,
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      input: { flex: 1, height: 34, color: colors.foreground, fontSize: 14 },
    } as const;
  }, [colors, compact]);
  const create = useCallback(() => update({ creating: true, issueId: null }), [update]);
  const changeAssignee = useCallback((assignee: AssigneeFilter) => update({ assignee }), [update]);
  const changeStatus = useCallback((status: StatusFilter) => update({ status }), [update]);
  return (
    <View style={styles.root}>
      <View style={ROW_STYLE}>
        <View style={styles.search}>
          <Icon name="Search" size={15} color={colors.foregroundMuted} />
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Search issues or jump to ENG-123"
            placeholderTextColor={colors.foregroundMuted}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Search Linear issues"
            style={styles.input}
          />
        </View>
        <Button
          theme={theme}
          variant="primary"
          icon="Plus"
          label={compact ? "New" : "New issue"}
          onPress={create}
        />
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={FILTER_SCROLL_STYLE}>
        <View style={ROW_STYLE}>
          <Segmented
            theme={theme}
            accessibilityLabel="Assignee"
            value={state.assignee}
            options={ASSIGNEE_OPTIONS}
            onChange={changeAssignee}
          />
          <Segmented
            theme={theme}
            accessibilityLabel="Status"
            value={state.status}
            options={STATUS_OPTIONS}
            onChange={changeStatus}
          />
          <Button
            theme={theme}
            size="xs"
            variant="ghost"
            icon="Users"
            label={props.teamName}
            onPress={props.onOpenTeams}
          />
        </View>
      </ScrollView>
    </View>
  );
}

function IssueResults(props: {
  theme: Theme;
  compact: boolean;
  state: BrowserState;
  update: Update;
}) {
  const { theme, compact, state, update } = props;
  const { colors } = theme;
  const issues = useIssues({
    teamId: state.teamId,
    assignee: state.assignee,
    status: state.status,
    query: state.query,
  });
  const { refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = issues;
  const rows = useMemo(
    () => groupRows(issues.data?.pages.flatMap((page) => page.issues) ?? []),
    [issues.data],
  );
  const styles = useMemo(
    () =>
      ({
        list: { flex: 1, minHeight: 0 },
        content: { paddingHorizontal: compact ? 4 : 8, paddingVertical: 8 },
        footer: { color: colors.foregroundMuted, textAlign: "center", padding: 12 },
      }) as const,
    [colors, compact],
  );
  const retry = useCallback(() => void refetch(), [refetch]);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const select = useCallback((issueId: string) => update({ issueId, creating: false }), [update]);
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Row>) =>
      item.kind === "header" ? (
        <StateHeader theme={theme} state={item.state} count={item.count} />
      ) : (
        <IssueRow
          theme={theme}
          compact={compact}
          issue={item.issue}
          selected={item.issue.id === state.issueId}
          onSelect={select}
        />
      ),
    [theme, compact, state.issueId, select],
  );
  const footer = useMemo(
    () => (isFetchingNextPage ? <Text style={styles.footer}>Loading more…</Text> : null),
    [isFetchingNextPage, styles.footer],
  );

  if (issues.isPending) return <EmptyState theme={theme} icon="RefreshCw" title="Loading issues" />;
  if (issues.isError) {
    return (
      <EmptyState
        theme={theme}
        icon="TriangleAlert"
        tone="danger"
        title="Could not load issues"
        detail={errorMessage(issues.error)}
      >
        <Button theme={theme} label="Try again" icon="RefreshCw" onPress={retry} />
      </EmptyState>
    );
  }
  if (rows.length === 0) {
    return (
      <EmptyState
        theme={theme}
        icon="Inbox"
        title="No issues here"
        detail={
          state.query
            ? "Try another search or widen the filters."
            : "Change the filters, or create an issue."
        }
      />
    );
  }
  return (
    <FlatList
      style={styles.list}
      contentContainerStyle={styles.content}
      data={rows}
      keyExtractor={rowKey}
      refreshing={issues.isRefetching && !isFetchingNextPage}
      onRefresh={retry}
      onEndReachedThreshold={0.4}
      onEndReached={loadMore}
      renderItem={renderItem}
      ListFooterComponent={footer}
    />
  );
}

function StateHeader(props: { theme: Theme; state: IssueSummary["state"]; count: number }) {
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

function IssueRow(props: {
  theme: Theme;
  compact: boolean;
  issue: IssueSummary;
  selected: boolean;
  onSelect(issueId: string): void;
}) {
  const { theme, issue, compact, selected, onSelect } = props;
  const { colors } = theme;
  const styles = useMemo(() => {
    const row = {
      minHeight: 40,
      paddingHorizontal: 10,
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
    } as const;
  }, [colors, selected]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const a11yState = useMemo(() => ({ selected }), [selected]);
  const press = useCallback(() => onSelect(issue.id), [onSelect, issue.id]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${issue.identifier} ${issue.title}, ${issue.state.name}`}
      accessibilityState={a11yState}
      onPress={press}
      style={pressStyle}
    >
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
