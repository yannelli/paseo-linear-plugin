import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import { PRIORITIES } from "../shared/linear";

type Theme = PluginSurfaceProps["theme"];

const STATE_ICONS: Record<string, string> = {
  triage: "CircleDot",
  backlog: "CircleDashed",
  unstarted: "Circle",
  started: "CircleDot",
  completed: "CircleCheck",
  canceled: "CircleX",
  duplicate: "CircleX",
};

export function StateIcon({
  state,
  size = 16,
}: {
  state: { type: string; color: string };
  size?: number;
}) {
  return <Icon name={STATE_ICONS[state.type] ?? "Circle"} size={size} color={state.color} />;
}

export function priorityMeta(priority: number) {
  return PRIORITIES.find((entry) => entry.value === priority) ?? PRIORITIES[0];
}

export function PriorityIcon({
  theme,
  priority,
  size = 16,
}: {
  theme: Theme;
  priority: number;
  size?: number;
}) {
  const meta = priorityMeta(priority);
  const color = priority === 1 ? theme.colors.statusDanger : theme.colors.foregroundMuted;
  return <Icon name={meta.icon} size={size} color={color} />;
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters =
    parts.length > 1 ? `${parts[0]?.[0] ?? ""}${parts[1]?.[0] ?? ""}` : name.slice(0, 2);
  return letters.toUpperCase() || "?";
}

export function Avatar({
  theme,
  name,
  size = 20,
}: {
  theme: Theme;
  name: string | null;
  size?: number;
}) {
  const { colors } = theme;
  const styles = useMemo(
    () =>
      ({
        circle: {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.surface2,
          borderWidth: 1,
          borderColor: colors.border,
        },
        letters: { fontSize: Math.max(8, size * 0.42), color: colors.foreground },
      }) as const,
    [colors, size],
  );
  if (!name) return <Icon name="CircleUser" size={size} color={colors.foregroundMuted} />;
  return (
    <View accessibilityLabel={name} style={styles.circle}>
      <Text style={styles.letters}>{initials(name)}</Text>
    </View>
  );
}

export function LabelPill({ theme, name, color }: { theme: Theme; name: string; color: string }) {
  const { colors } = theme;
  const styles = useMemo(
    () =>
      ({
        pill: {
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          height: 22,
          paddingHorizontal: 8,
          borderRadius: 11,
          borderWidth: 1,
          borderColor: colors.border,
        },
        dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: color },
        name: { fontSize: 12, color: colors.foregroundMuted },
      }) as const,
    [colors, color],
  );
  return (
    <View style={styles.pill}>
      <View style={styles.dot} />
      <Text numberOfLines={1} style={styles.name}>
        {name}
      </Text>
    </View>
  );
}
