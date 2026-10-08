import { Icon } from "@getpaseo/plugin/client/react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Animated, StyleSheet, Text, View } from "react-native";
import type { ActivityEvent, EventKind } from "../shared/activity";
import { MONO } from "./live-issues";
import { NATIVE_DRIVER } from "./live-timeline";
import type { Theme } from "./ui";

export const KIND_ICONS: Record<EventKind, string> = {
  read: "Eye",
  edit: "Pencil",
  write: "FilePlus",
  search: "Search",
  list: "FolderOpen",
  shell: "SquareTerminal",
  agent: "Bot",
  tool: "Wrench",
};
const FEED_SIZE = 14;

export function eventFailed(event: ActivityEvent): boolean {
  return event.status === "failed" || (event.exitCode !== null && event.exitCode !== 0);
}

/** The color of an event's icon: changes in green, failures in red, the rest muted. */
export function eventTone(theme: Theme, event: ActivityEvent): string {
  const { colors } = theme;
  if (eventFailed(event) && event.kind !== "search") return colors.statusDanger;
  if (event.kind === "edit" || event.kind === "write") return colors.statusSuccess;
  if (event.kind === "read" || event.kind === "search") return colors.foreground;
  return colors.foregroundMuted;
}

function FeedRow(props: { theme: Theme; event: ActivityEvent; animate: boolean }) {
  const { theme, event } = props;
  const { colors } = theme;
  const [entering] = useState(props.animate);
  const [progress] = useState(() => new Animated.Value(entering ? 0 : 1));
  useEffect(() => {
    if (!entering) return;
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: 280,
      useNativeDriver: NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [entering, progress]);
  const failed = eventFailed(event);
  const tone = eventTone(theme, event);
  const styles = useMemo(() => {
    const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] });
    return {
      row: {
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingVertical: 6,
        paddingHorizontal: 8,
        borderRadius: 8,
        opacity: progress,
        transform: [{ translateY: slide }],
      },
      icon: {
        width: 24,
        height: 24,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface2,
      },
      tint: { ...StyleSheet.absoluteFillObject, borderRadius: 7, backgroundColor: tone, opacity: 0.12 },
      body: { flex: 1, minWidth: 0, gap: 2 },
      text: { color: colors.foreground, fontSize: 13 },
      detail: { color: colors.foregroundMuted, fontFamily: MONO, fontSize: 11 },
      added: { color: colors.statusSuccess, fontSize: 11 },
      removed: { color: colors.statusDanger, fontSize: 11 },
      exit: { color: failed ? colors.statusDanger : colors.foregroundMuted, fontSize: 11 },
    } as const;
  }, [colors, progress, failed, tone]);
  const showExit = event.exitCode !== null && event.exitCode !== 0 && event.kind !== "search";
  return (
    <Animated.View style={styles.row} accessible accessibilityLabel={event.text}>
      <View style={styles.icon}>
        <View style={styles.tint} />
        <Icon name={KIND_ICONS[event.kind]} size={13} color={tone} />
      </View>
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.text}>
          {event.text}
        </Text>
        {event.detail ? (
          <Text numberOfLines={1} style={styles.detail}>
            {event.detail}
          </Text>
        ) : null}
      </View>
      {event.added > 0 ? <Text style={styles.added}>{`+${event.added}`}</Text> : null}
      {event.removed > 0 ? <Text style={styles.removed}>{`-${event.removed}`}</Text> : null}
      {showExit ? <Text style={styles.exit}>{`exit ${event.exitCode}`}</Text> : null}
      {event.status === "running" ? (
        <ActivityIndicator size="small" color={colors.foregroundMuted} />
      ) : null}
      {event.status === "failed" && event.exitCode === null ? (
        <Icon name="TriangleAlert" size={14} color={colors.statusDanger} />
      ) : null}
    </Animated.View>
  );
}

export function ActivityFeed(props: {
  theme: Theme;
  events: readonly ActivityEvent[];
  loading: boolean;
  error: string | null;
  reduceMotion: boolean;
}) {
  const { theme } = props;
  const { colors } = theme;
  const rows = props.events.slice(0, FEED_SIZE);
  // The loaded tail renders in place; only rows that arrive after it slide in.
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (!props.loading) setSettled(true);
  }, [props.loading]);
  const styles = useMemo(
    () =>
      ({
        list: { gap: 2 },
        note: { color: colors.foregroundMuted, fontSize: 13, padding: 8 },
        error: { color: colors.statusDanger, fontSize: 13, padding: 8 },
      }) as const,
    [colors],
  );
  let empty: string | null = null;
  if (rows.length === 0) empty = props.loading ? "Loading activity" : "No tool calls yet";
  return (
    <View style={styles.list}>
      {props.error ? <Text style={styles.error}>{props.error}</Text> : null}
      {empty ? <Text style={styles.note}>{empty}</Text> : null}
      {rows.map((event) => (
        <FeedRow
          key={event.id}
          theme={theme}
          event={event}
          animate={settled && !props.reduceMotion}
        />
      ))}
    </View>
  );
}
