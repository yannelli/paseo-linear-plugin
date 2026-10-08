import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import type { IssueDetail } from "../shared/linear";
import { progressByKey, type TodoLike, todoKey, todoLabel, todoStatus } from "../shared/todo-sync";
import { NATIVE_DRIVER, type OwnerColors } from "./live-timeline";
import { IconButton, StateIcon, type Theme, usePressableStyle } from "./ui";

export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, monospace",
});
const TODO_ICONS = { pending: "Circle", in_progress: "CircleDot", completed: "CircleCheck" };

export type FocusKey = string | null;

export function ProgressBar(props: {
  theme: Theme;
  value: number;
  color: string;
  reduce: boolean;
  height?: number;
  /** Tints the empty track with the bar color, so an empty bar still shows whose it is. */
  tinted?: boolean;
}) {
  const { colors } = props.theme;
  const height = props.height ?? 3;
  const target = Math.max(0.001, Math.min(1, props.value));
  const [scale] = useState(() => new Animated.Value(target));
  useEffect(() => {
    if (props.reduce) {
      scale.setValue(target);
      return;
    }
    const animation = Animated.timing(scale, {
      toValue: target,
      duration: 500,
      useNativeDriver: NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [target, props.reduce, scale]);
  const styles = useMemo(
    () =>
      ({
        track: {
          height,
          borderRadius: height / 2,
          backgroundColor: colors.surface2,
          overflow: "hidden",
        },
        tint: { ...StyleSheet.absoluteFillObject, backgroundColor: props.color, opacity: 0.22 },
        fill: {
          height,
          width: "100%",
          backgroundColor: props.color,
          transformOrigin: "left",
          transform: [{ scaleX: scale }],
        },
      }) as const,
    [colors, props.color, scale, height],
  );
  return (
    <View style={styles.track}>
      {props.tinted ? <View style={styles.tint} /> : null}
      <Animated.View style={styles.fill} />
    </View>
  );
}

function TodoRow({ theme, todo, color }: { theme: Theme; todo: TodoLike; color: string }) {
  const { colors } = theme;
  const status = todoStatus(todo);
  const styles = useMemo(() => {
    const done = status === "completed";
    return {
      row: { flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 3 },
      icon: { marginTop: 2 },
      text: {
        flex: 1,
        fontSize: 12,
        lineHeight: 17,
        color: done || status === "pending" ? colors.foregroundMuted : colors.foreground,
        textDecorationLine: done ? "line-through" : "none",
      },
    } as const;
  }, [colors, status]);
  let tone = colors.foregroundMuted;
  if (status === "completed") tone = colors.statusSuccess;
  else if (status === "in_progress") tone = color;
  return (
    <View style={styles.row}>
      <View style={styles.icon}>
        <Icon name={TODO_ICONS[status]} size={12} color={tone} />
      </View>
      <Text numberOfLines={2} style={styles.text}>
        {todoLabel(todo.text)}
      </Text>
    </View>
  );
}

interface RowData {
  identifier: string;
  title: string;
  state: IssueDetail["state"];
}

function IssueRow(props: {
  theme: Theme;
  row: RowData;
  color: string;
  todos: readonly TodoLike[];
  showTodos: boolean;
  active: boolean;
  focused: boolean;
  parent: boolean;
  reduceMotion: boolean;
  onFocus(key: string): void;
}) {
  const { theme, row, color, todos, active, focused, onFocus } = props;
  const { colors } = theme;
  const done = todos.filter((todo) => todoStatus(todo) === "completed").length;
  const finished = row.state.type === "completed";
  const styles = useMemo(() => {
    const idle = {
      flexDirection: "row",
      gap: 10,
      padding: 10,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: focused || active ? colors.border : "transparent",
      backgroundColor: active || focused ? colors.surface1 : "transparent",
    } as const;
    return {
      idle,
      hover: { ...idle, backgroundColor: colors.surface1 },
      bar: { width: 3, borderRadius: 2, backgroundColor: color, opacity: finished ? 0.4 : 1 },
      body: { flex: 1, minWidth: 0, gap: 6 },
      line: { flexDirection: "row", alignItems: "center", gap: 6 },
      key: { color: colors.foregroundMuted, fontFamily: MONO, fontSize: 11 },
      state: { color: colors.foregroundMuted, fontSize: 11 },
      count: { marginLeft: "auto", color: colors.foregroundMuted, fontSize: 11 },
      title: {
        color: finished ? colors.foregroundMuted : colors.foreground,
        fontSize: props.parent ? 14 : 13,
        lineHeight: props.parent ? 19 : 18,
        fontWeight: props.parent || active ? "600" : "400",
      },
      todos: { paddingTop: 2 },
    } as const;
  }, [colors, color, active, focused, finished, props.parent]);
  const pressStyle = usePressableStyle(styles.idle, styles.hover);
  const press = useCallback(() => onFocus(row.identifier.toUpperCase()), [onFocus, row]);
  const a11yState = useMemo(() => ({ selected: focused }), [focused]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${focused ? "Clear map focus on" : "Focus map on"} ${row.identifier}`}
      accessibilityState={a11yState}
      onPress={press}
      style={pressStyle}
    >
      <View style={styles.bar} />
      <View style={styles.body}>
        <View style={styles.line}>
          <StateIcon state={row.state} size={13} />
          <Text style={styles.key}>{row.identifier}</Text>
          <Text numberOfLines={1} style={styles.state}>
            {row.state.name}
          </Text>
          {todos.length > 0 ? <Text style={styles.count}>{`${done}/${todos.length}`}</Text> : null}
        </View>
        <Text numberOfLines={2} style={styles.title}>
          {row.title}
        </Text>
        {todos.length > 0 ? (
          <ProgressBar
            theme={theme}
            value={finished ? 1 : done / todos.length}
            color={color}
            reduce={props.reduceMotion}
          />
        ) : null}
        {props.showTodos && todos.length > 0 ? (
          <View style={styles.todos}>
            {todos.map((todo, index) => (
              <TodoRow key={`${index}:${todo.text}`} theme={theme} todo={todo} color={color} />
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const NO_TODOS: readonly TodoLike[] = [];

export interface IssueProgress {
  /** Todos grouped by the issue key their text starts with; others go to the parent. */
  groups: ReadonlyMap<string, TodoLike[]>;
  /** The sub-issue with a todo in progress. */
  active: string | null;
}

export function issueProgress(issue: IssueDetail, todos: readonly TodoLike[]): IssueProgress {
  const parentKey = issue.identifier.toUpperCase();
  const children = new Set(issue.children.map((child) => child.identifier.toUpperCase()));
  const groups = new Map<string, TodoLike[]>();
  for (const todo of todos) {
    const key = todoKey(todo.text);
    const owner = key && children.has(key) ? key : parentKey;
    groups.set(owner, [...(groups.get(owner) ?? []), todo]);
  }
  const progress = progressByKey(todos);
  const active = issue.children.find(
    (child) => (progress.get(child.identifier.toUpperCase())?.inProgress ?? 0) > 0,
  );
  return { groups, active: active?.identifier.toUpperCase() ?? null };
}

// The map legend. Selecting a row focuses the map on that issue's files.
export function SubIssues(props: {
  theme: Theme;
  issue: IssueDetail;
  progress: IssueProgress;
  owners: OwnerColors;
  focus: FocusKey;
  reduceMotion: boolean;
  onFocus(key: string): void;
}) {
  const { theme, issue, progress, owners, focus } = props;
  const parentKey = issue.identifier.toUpperCase();
  const fallback = theme.colors.accent;
  const styles = useMemo(
    () =>
      ({
        list: { gap: 4 },
        label: {
          color: theme.colors.foregroundMuted,
          fontSize: 11,
          fontWeight: "600",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          paddingHorizontal: 10,
          paddingTop: 14,
          paddingBottom: 4,
        },
      }) as const,
    [theme],
  );
  return (
    <View style={styles.list}>
      <IssueRow
        theme={theme}
        row={issue}
        color={owners.get(parentKey) ?? fallback}
        todos={progress.groups.get(parentKey) ?? NO_TODOS}
        showTodos
        active={false}
        focused={focus === parentKey}
        parent
        reduceMotion={props.reduceMotion}
        onFocus={props.onFocus}
      />
      {issue.children.length > 0 ? <Text style={styles.label}>Sub-issues</Text> : null}
      {issue.children.map((child) => {
        const key = child.identifier.toUpperCase();
        const active = progress.active === key;
        return (
          <IssueRow
            key={child.id}
            theme={theme}
            row={child}
            color={owners.get(key) ?? fallback}
            todos={progress.groups.get(key) ?? NO_TODOS}
            showTodos={active || focus === key}
            active={active}
            focused={focus === key}
            parent={false}
            reduceMotion={props.reduceMotion}
            onFocus={props.onFocus}
          />
        );
      })}
    </View>
  );
}

/** The issues column when collapsed: a button to open it and each issue's state. */
export function IssueRail(props: {
  theme: Theme;
  issue: IssueDetail;
  owners: OwnerColors;
  focus: FocusKey;
  onFocus(key: string): void;
  onExpand(): void;
}) {
  const { theme, issue, owners, focus } = props;
  const { colors } = theme;
  const styles = useMemo(
    () =>
      ({
        rail: {
          width: 48,
          alignItems: "center",
          gap: 8,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          backgroundColor: colors.surface0,
        },
        rule: { width: 24, height: 1, backgroundColor: colors.border },
        dot: { width: 34, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center", gap: 4, borderWidth: 2 },
        bar: { width: 14, height: 3, borderRadius: 2 },
      }) as const,
    [colors],
  );
  const rows = [issue, ...issue.children];
  return (
    <View style={styles.rail}>
      <IconButton theme={theme} icon="PanelLeftOpen" label="Show issues" onPress={props.onExpand} />
      <View style={styles.rule} />
      {rows.map((row) => {
        const key = row.identifier.toUpperCase();
        const focused = focus === key;
        return (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.identifier}: ${row.title}, ${row.state.name}`}
            accessibilityState={{ selected: focused }}
            onPress={() => props.onFocus(key)}
            style={[styles.dot, { borderColor: focused ? (owners.get(key) ?? colors.accent) : "transparent" }]}
          >
            <StateIcon state={row.state} size={row === issue ? 17 : 15} />
            <View style={[styles.bar, { backgroundColor: owners.get(key) ?? colors.accent }]} />
          </Pressable>
        );
      })}
    </View>
  );
}
