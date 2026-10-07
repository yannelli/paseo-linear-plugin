import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, type ListRenderItemInfo, ScrollView, Text, View } from "react-native";
import type { AssigneeFilter, IssueSort, LinearTeam, StatusFilter } from "../shared/linear";
import { IssueRow, StateHeader } from "./issue-row";
import { buildIssueRows, type IssueListRow, toggleCollapsed } from "./issue-tree";
import { PickerModal } from "./pickers";
import { useIssues } from "./queries";
import type { BrowserState } from "./store";
import {
  Button,
  EmptyState,
  errorMessage,
  Segmented,
  type Theme,
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
export const SORT_OPTIONS: readonly { value: IssueSort; label: string }[] = [
  { value: "updated", label: "Last updated" },
  { value: "created", label: "Newest" },
  { value: "priority", label: "Priority" },
  { value: "due", label: "Due date" },
  { value: "title", label: "Title" },
];
const ALL_TEAMS = "__all__";
const ROOT_STYLE = { flex: 1, minHeight: 0 } as const;
const FILTER_SCROLL_STYLE = { flexGrow: 0 } as const;
const ROW_STYLE = { flexDirection: "row", gap: 8, alignItems: "center" } as const;

type Update = (patch: Partial<BrowserState>) => void;
type Picker = "team" | "sort" | "key";
const KEY_DEFAULT = "";

function rowKey(row: IssueListRow): string {
  return row.key;
}

export interface KeyOption {
  value: string;
  label: string;
}

export function IssueList(props: {
  theme: Theme;
  compact: boolean;
  teams: readonly LinearTeam[];
  state: BrowserState;
  update: Update;
  /** Linear keys to switch between. Empty hides the key picker. */
  keyOptions: readonly KeyOption[];
}) {
  const { theme, state, update, keyOptions } = props;
  const [picker, setPicker] = useState<Picker | null>(null);
  const team = props.teams.find((entry) => entry.id === state.teamId) ?? null;
  const keyValue = state.keyProjectId ?? KEY_DEFAULT;
  const keyLabel = keyOptions.find((option) => option.value === keyValue)?.label ?? "Default key";
  const sortLabel = SORT_OPTIONS.find((option) => option.value === state.sort)?.label ?? "Sort";
  const picked = useMemo(() => {
    if (picker === "sort") {
      return { title: "Sort by", icon: "ArrowUpDown", options: SORT_OPTIONS, value: state.sort };
    }
    if (picker === "key") {
      return { title: "Linear key", icon: "KeyRound", options: keyOptions, value: keyValue };
    }
    const options = [
      { value: ALL_TEAMS, label: "All teams" },
      ...props.teams.map((entry) => ({ value: entry.id, label: entry.name, detail: entry.key })),
    ];
    return { title: "Team", icon: "Users", options, value: state.teamId ?? ALL_TEAMS };
  }, [picker, props.teams, keyOptions, keyValue, state.sort, state.teamId]);
  const open = useCallback((kind: Picker) => setPicker(kind), []);
  const close = useCallback(() => setPicker(null), []);
  const select = useCallback(
    (value: string) => {
      setPicker(null);
      if (picker === "sort") update({ sort: value as IssueSort });
      else if (picker === "key") {
        update({
          keyProjectId: value === KEY_DEFAULT ? null : value,
          issueId: null,
          teamId: null,
          launch: null,
        });
      } else update({ teamId: value === ALL_TEAMS ? null : value });
    },
    [picker, update],
  );
  return (
    <View style={ROOT_STYLE}>
      <IssueFilters
        theme={theme}
        compact={props.compact}
        state={state}
        teamName={team ? team.name : "All teams"}
        sortLabel={sortLabel}
        keyLabel={keyOptions.length > 0 ? keyLabel : null}
        update={update}
        onOpen={open}
      />
      <IssueResults theme={theme} compact={props.compact} state={state} update={update} />
      <PickerModal
        theme={theme}
        title={picked.title}
        icon={picked.icon}
        open={picker !== null}
        options={picked.options}
        value={picked.value}
        searchable={picker === "team" && props.teams.length > 8}
        onClose={close}
        onSelect={select}
      />
    </View>
  );
}

function IssueFilters(props: {
  theme: Theme;
  compact: boolean;
  state: BrowserState;
  teamName: string;
  sortLabel: string;
  keyLabel: string | null;
  update: Update;
  onOpen(picker: Picker): void;
}) {
  const { theme, compact, state, update, onOpen } = props;
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
  const toggleNested = useCallback(() => update({ nested: !state.nested }), [update, state.nested]);
  const openTeams = useCallback(() => onOpen("team"), [onOpen]);
  const openSort = useCallback(() => onOpen("sort"), [onOpen]);
  const openKey = useCallback(() => onOpen("key"), [onOpen]);
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
            onPress={openTeams}
          />
          <Button
            theme={theme}
            size="xs"
            variant="ghost"
            icon="ArrowUpDown"
            label={props.sortLabel}
            accessibilityLabel={`Sort by ${props.sortLabel}`}
            onPress={openSort}
          />
          <Button
            theme={theme}
            size="xs"
            variant={state.nested ? "secondary" : "ghost"}
            icon="ListTree"
            label="Sub-issues"
            accessibilityLabel={state.nested ? "Show sub-issues flat" : "Nest sub-issues"}
            onPress={toggleNested}
          />
          {props.keyLabel ? (
            <Button
              theme={theme}
              size="xs"
              variant="ghost"
              icon="KeyRound"
              label={props.keyLabel}
              accessibilityLabel={`Linear key: ${props.keyLabel}`}
              onPress={openKey}
            />
          ) : null}
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
    sort: state.sort,
  });
  const { refetch, hasNextPage, isFetchingNextPage, fetchNextPage } = issues;
  const collapsed = useMemo(() => new Set(state.collapsed), [state.collapsed]);
  const rows = useMemo(
    () =>
      buildIssueRows(issues.data?.pages.flatMap((page) => page.issues) ?? [], {
        nested: state.nested,
        collapsed,
      }),
    [issues.data, state.nested, collapsed],
  );
  const styles = useMemo(
    () =>
      ({
        list: { flex: 1, minHeight: 0 },
        content: { paddingHorizontal: compact ? 4 : 8, paddingVertical: 8 },
        footer: { color: colors.foregroundMuted, textAlign: "center", padding: 12 },
        updating: {
          color: colors.foregroundMuted,
          fontSize: 12,
          paddingHorizontal: compact ? 12 : 16,
          paddingTop: 8,
        },
      }) as const,
    [colors, compact],
  );
  const retry = useCallback(() => void refetch(), [refetch]);
  const loadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const select = useCallback((issueId: string) => update({ issueId, creating: false }), [update]);
  const toggle = useCallback(
    (issueId: string) => update({ collapsed: toggleCollapsed(state.collapsed, issueId) }),
    [update, state.collapsed],
  );
  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<IssueListRow>) =>
      item.kind === "header" ? (
        <StateHeader theme={theme} state={item.state} count={item.count} />
      ) : (
        <IssueRow
          theme={theme}
          compact={compact}
          issue={item.issue}
          depth={item.depth}
          childCount={item.childCount}
          collapsed={item.collapsed}
          nested={state.nested}
          selected={item.issue.id === state.issueId}
          onSelect={select}
          onToggle={toggle}
        />
      ),
    [theme, compact, state.issueId, state.nested, select, toggle],
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
    <>
      {issues.isPlaceholderData ? (
        <Text style={styles.updating} accessibilityLiveRegion="polite">
          Showing saved results. Updating…
        </Text>
      ) : null}
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
    </>
  );
}
