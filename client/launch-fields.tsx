import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useCallback, useMemo } from "react";
import { Pressable, type PressableStateCallbackType, Switch, Text, View } from "react-native";
import { type Theme, usePressableStyle } from "./ui";

// Matches the controls under Paseo's agent composer: an icon, the value, and a chevron.
export function Chip(props: {
  theme: Theme;
  icon: ReactNode;
  value: string;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress(): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(() => {
    const idle = {
      height: 28,
      paddingHorizontal: 8,
      borderRadius: 16,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      minWidth: 0,
      maxWidth: 260,
      opacity: props.disabled ? 0.5 : 1,
    };
    return {
      idle,
      hovered: { ...idle, backgroundColor: colors.surface2 },
      pressed: { ...idle, backgroundColor: colors.surface0 },
      icon: {
        width: 16,
        height: 16,
        alignItems: "center" as const,
        justifyContent: "center" as const,
      },
      value: { color: colors.foregroundMuted, fontSize: 14, flexShrink: 1, minWidth: 0 },
      chevron: { transform: [{ translateY: 1 }] },
    };
  }, [colors, props.disabled]);
  const style = useCallback(
    (state: PressableStateCallbackType) =>
      state.pressed
        ? styles.pressed
        : (state as { hovered?: boolean }).hovered
          ? styles.hovered
          : styles.idle,
    [styles],
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      disabled={props.disabled}
      onPress={props.onPress}
      style={style}
    >
      <View style={styles.icon}>{props.icon}</View>
      <Text numberOfLines={1} style={styles.value}>
        {props.value}
      </Text>
      <View style={styles.chevron}>
        <Icon name="ChevronDown" size={14} color={colors.foregroundMuted} />
      </View>
    </Pressable>
  );
}

export function Field(props: {
  theme: Theme;
  label: string;
  icon: string;
  value: string;
  detail?: string;
  onPress(): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(() => {
    const idle = {
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 10,
      backgroundColor: colors.surface1,
    };
    return {
      idle,
      active: { ...idle, backgroundColor: colors.surface2 },
      label: { color: colors.foregroundMuted, fontSize: 13, width: 64 },
      body: { flex: 1, minWidth: 0 },
      value: { color: colors.foreground, fontSize: 14 },
      detail: { color: colors.foregroundMuted, fontSize: 12 },
    };
  }, [colors]);
  const style = usePressableStyle(styles.idle, styles.active);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${props.label}: ${props.value}`}
      onPress={props.onPress}
      style={style}
    >
      <Icon name={props.icon} size={16} color={colors.foregroundMuted} />
      <Text style={styles.label}>{props.label}</Text>
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.value}>
          {props.value}
        </Text>
        {props.detail ? (
          <Text numberOfLines={1} style={styles.detail}>
            {props.detail}
          </Text>
        ) : null}
      </View>
      <Icon name="ChevronDown" size={14} color={colors.foregroundMuted} />
    </Pressable>
  );
}

export function Toggle(props: {
  theme: Theme;
  label: string;
  value: boolean;
  onChange(value: boolean): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(
    () => ({
      row: { minHeight: 36, flexDirection: "row" as const, alignItems: "center" as const, gap: 10 },
      label: { flex: 1, color: colors.foreground, fontSize: 14 },
      track: { true: colors.accent, false: colors.surface2 },
    }),
    [colors],
  );
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{props.label}</Text>
      <Switch
        accessibilityLabel={props.label}
        value={props.value}
        onValueChange={props.onChange}
        trackColor={styles.track}
      />
    </View>
  );
}
