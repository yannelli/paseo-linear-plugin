import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, Pressable, StyleSheet, Text, View } from "react-native";
import type { ActivityEvent } from "../shared/activity";
import type { IssueDetail } from "../shared/linear";
import type { LiveView, MappingMode } from "../shared/settings";
import { todoStatus } from "../shared/todo-sync";
import { eventTone, KIND_ICONS } from "./live-feed";
import { type IssueProgress, MONO, ProgressBar } from "./live-issues";
import { type LiveMap, NATIVE_DRIVER, type OwnerColors } from "./live-timeline";
import { ProviderIcon } from "./provider-icon";
import { ToolButton, ToolGroup } from "./tool-buttons";
import { Button, StateIcon, type Theme } from "./ui";

type AgentStatus = PluginAgentSnapshot["status"];

const STATUS_COPY: Record<AgentStatus, string> = {
  initializing: "Starting",
  idle: "Idle",
  running: "Working",
  error: "Error",
  closed: "Closed",
};

function providerName(provider: string): string {
  return provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Agent";
}

function StatusChip(props: { theme: Theme; status: AgentStatus; provider: string; reduce: boolean }) {
  const { theme, status } = props;
  const { colors } = theme;
  const running = status === "running" || status === "initializing";
  const [glow] = useState(() => new Animated.Value(1));
  useEffect(() => {
    if (!running || props.reduce) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.35, duration: 700, useNativeDriver: NATIVE_DRIVER }),
        Animated.timing(glow, { toValue: 1, duration: 700, useNativeDriver: NATIVE_DRIVER }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
      glow.setValue(1);
    };
  }, [running, props.reduce, glow]);
  let tone = colors.foregroundMuted;
  if (running) tone = colors.statusSuccess;
  else if (status === "error") tone = colors.statusDanger;
  const styles = useMemo(
    () =>
      ({
        chip: {
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          height: 26,
          paddingHorizontal: 10,
          borderRadius: 13,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface1,
        },
        dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: tone, opacity: glow },
        text: { color: colors.foreground, fontSize: 12, fontWeight: "500" },
        muted: { color: colors.foregroundMuted, fontSize: 12 },
      }) as const,
    [colors, tone, glow],
  );
  return (
    <View style={styles.chip}>
      <Animated.View style={styles.dot} />
      <Text style={styles.text}>{STATUS_COPY[status] ?? status}</Text>
      <ProviderIcon provider={props.provider} size={12} color={colors.foregroundMuted} />
      <Text style={styles.muted}>{providerName(props.provider)}</Text>
    </View>
  );
}

function NowLine(props: { theme: Theme; event: ActivityEvent; live: boolean; offMap: string | null }) {
  const { theme, event } = props;
  const { colors } = theme;
  const tone = eventTone(theme, event);
  const styles = useMemo(
    () =>
      ({
        row: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
        label: {
          color: props.live ? colors.foreground : colors.foregroundMuted,
          fontSize: 10,
          fontWeight: "700",
          letterSpacing: 0.6,
          textTransform: "uppercase",
          width: 34,
        },
        icon: {
          width: 22,
          height: 22,
          borderRadius: 6,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface2,
        },
        tint: { ...StyleSheet.absoluteFillObject, borderRadius: 6, backgroundColor: tone, opacity: 0.14 },
        text: { color: props.live ? colors.foreground : colors.foregroundMuted, fontSize: 13 },
        detail: { flex: 1, color: colors.foregroundMuted, fontFamily: MONO, fontSize: 11 },
        off: {
          flexShrink: 0,
          maxWidth: 220,
          paddingHorizontal: 7,
          paddingVertical: 2,
          borderRadius: 6,
          borderWidth: 1,
          borderStyle: "dashed",
          borderColor: colors.statusWarning,
          color: colors.statusWarning,
          fontSize: 11,
        },
      }) as const,
    [colors, tone, props.live],
  );
  return (
    <View style={styles.row} accessible accessibilityLabel={`${props.live ? "Now" : "Last"}: ${event.text}`}>
      <Text style={styles.label}>{props.live ? "Now" : "Last"}</Text>
      <View style={styles.icon}>
        <View style={styles.tint} />
        <Icon name={KIND_ICONS[event.kind]} size={12} color={tone} />
      </View>
      <Text numberOfLines={1} style={styles.text}>
        {event.text}
      </Text>
      {event.detail ? (
        <Text numberOfLines={1} style={styles.detail}>
          {event.detail}
        </Text>
      ) : null}
      {props.offMap ? (
        <Text numberOfLines={1} style={styles.off} accessibilityLabel={`Off the map, in ${props.offMap}`}>
          {`Off the map · ${props.offMap}`}
        </Text>
      ) : null}
    </View>
  );
}

export function LiveHeader(props: {
  theme: Theme;
  issue: IssueDetail;
  progress: IssueProgress;
  owners: OwnerColors;
  status: AgentStatus;
  provider: string;
  current: ActivityEvent | null;
  /** Where the current file is when the agent works off the map. */
  offMap: string | null;
  reduceMotion: boolean;
}) {
  const { theme, issue, progress, owners } = props;
  const { colors } = theme;
  const rows = issue.children.length > 0 ? issue.children : [issue];
  const segments = rows.map((row) => {
    const key = row.identifier.toUpperCase();
    const todos = progress.groups.get(key) ?? [];
    const done = todos.filter((todo) => todoStatus(todo) === "completed").length;
    const finished = row.state.type === "completed";
    return {
      key,
      color: owners.get(key) ?? colors.accent,
      value: finished ? 1 : todos.length > 0 ? done / todos.length : 0,
      finished,
    };
  });
  const allTodos = [...progress.groups.values()].flat();
  const todosDone = allTodos.filter((todo) => todoStatus(todo) === "completed").length;
  const issuesDone = segments.filter((segment) => segment.finished).length;
  const counts = [
    issue.children.length > 0 ? `${issuesDone} of ${issue.children.length} sub-issues done` : null,
    allTodos.length > 0 ? `${todosDone} of ${allTodos.length} todos` : null,
  ].filter(Boolean);
  const styles = useMemo(
    () =>
      ({
        root: { gap: 12 },
        top: { flexDirection: "row", alignItems: "center", gap: 10, minWidth: 0 },
        key: { color: colors.foregroundMuted, fontFamily: MONO, fontSize: 12 },
        title: { flex: 1, color: colors.foreground, fontSize: 16, fontWeight: "600" },
        strip: { flexDirection: "row", gap: 4 },
        segment: { flex: 1 },
        counts: { color: colors.foregroundMuted, fontSize: 12 },
      }) as const,
    [colors],
  );
  return (
    <View style={styles.root}>
      <View style={styles.top}>
        <StateIcon state={issue.state} size={16} />
        <Text style={styles.key}>{issue.identifier}</Text>
        <Text numberOfLines={1} style={styles.title}>
          {issue.title}
        </Text>
        <StatusChip
          theme={theme}
          status={props.status}
          provider={props.provider}
          reduce={props.reduceMotion}
        />
      </View>
      <View style={styles.strip}>
        {segments.map((segment) => (
          <View key={segment.key} style={styles.segment}>
            <ProgressBar
              theme={theme}
              value={segment.value}
              color={segment.color}
              reduce={props.reduceMotion}
              height={5}
              tinted
            />
          </View>
        ))}
      </View>
      {counts.length > 0 ? <Text style={styles.counts}>{counts.join(" · ")}</Text> : null}
      {props.current ? (
        <NowLine
          theme={theme}
          event={props.current}
          live={props.status === "running"}
          offMap={props.offMap}
        />
      ) : null}
    </View>
  );
}

/** Where the map came from, and the explore job's state, for the map card header. */
export function MapSource(props: { theme: Theme; live: LiveMap; mapping: MappingMode }) {
  const { theme, live } = props;
  const { colors } = theme;
  const { explore } = live;
  const styles = useMemo(
    () =>
      ({
        row: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
        note: { color: colors.foregroundMuted, fontSize: 12 },
        error: { color: colors.statusDanger, fontSize: 12, flexShrink: 1 },
      }) as const,
    [colors],
  );
  const start = useCallback(() => explore(false), [explore]);
  const retry = useCallback(() => explore(true), [explore]);
  const job = live.job;
  const running = job?.status === "running";
  const semantic = live.map.source === "semantic";
  const canExplore =
    props.mapping === "explore" && !live.stored && !running && job?.status !== "failed";
  return (
    <View style={styles.row}>
      <Text style={styles.note}>{semantic ? "From ticket text" : "From explore agent"}</Text>
      {running ? <ActivityIndicator size="small" color={colors.foregroundMuted} /> : null}
      {running ? <Text style={styles.note}>Exploring…</Text> : null}
      {job?.status === "failed" ? (
        <>
          <Text style={styles.error}>{job.error ?? "Explore failed"}</Text>
          <Button theme={theme} size="xs" icon="RefreshCw" label="Retry" busy={live.starting} onPress={retry} />
        </>
      ) : null}
      {canExplore ? (
        <Button
          theme={theme}
          size="xs"
          icon="Sparkles"
          label="Map with explore agent"
          busy={live.starting}
          onPress={start}
        />
      ) : null}
      {live.error ? <Text style={styles.error}>{live.error}</Text> : null}
    </View>
  );
}

/** Read the file data again, rebuild the map with the explore agent, or clear the saved map. */
export function MapActions(props: { theme: Theme; live: LiveMap }) {
  const { theme, live } = props;
  const { explore, refresh, clear } = live;
  const running = live.job?.status === "running";
  const rebuild = useCallback(() => explore(true), [explore]);
  return (
    <ToolGroup theme={theme}>
      <ToolButton theme={theme} icon="RefreshCw" label="Read files and links again" onPress={refresh} />
      <ToolButton
        theme={theme}
        icon="Sparkles"
        label={live.stored ? "Rebuild the map with the explore agent" : "Build the map with the explore agent"}
        busy={live.starting || running}
        onPress={rebuild}
      />
      <ToolButton
        theme={theme}
        icon="Eraser"
        label="Clear the saved map and use the ticket text"
        disabled={!live.stored || running}
        busy={live.clearing}
        onPress={clear}
      />
    </ToolGroup>
  );
}

export function ViewToggle(props: {
  theme: Theme;
  value: LiveView;
  onChange(value: LiveView): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(() => {
    const option = {
      flexDirection: "row",
      alignItems: "center",
      gap: 5,
      height: 24,
      paddingHorizontal: 9,
      borderRadius: 6,
    } as const;
    return {
      track: {
        flexDirection: "row",
        padding: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      option,
      on: { ...option, backgroundColor: colors.surface2 },
      text: { color: colors.foregroundMuted, fontSize: 12 },
      textOn: { color: colors.foreground, fontSize: 12, fontWeight: "500" },
    } as const;
  }, [colors]);
  const options = [
    { value: "map", label: "Map", icon: "LayoutGrid" },
    { value: "graph", label: "Graph", icon: "Waypoints" },
  ] as const;
  return (
    <View style={styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const on = props.value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => props.onChange(option.value)}
            style={on ? styles.on : styles.option}
          >
            <Icon name={option.icon} size={12} color={on ? colors.foreground : colors.foregroundMuted} />
            <Text style={on ? styles.textOn : styles.text}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
