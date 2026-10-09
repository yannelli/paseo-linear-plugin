import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useMemo } from "react";
import { ActivityIndicator, Pressable, View } from "react-native";
import { type Theme, usePressableStyle } from "./ui";

// Small icon buttons for card toolbars, such as the map actions. A group draws them in one
// bordered track.

export function ToolGroup({ theme, children }: { theme: Theme; children: ReactNode }) {
  const { colors } = theme;
  const style = useMemo(
    () =>
      ({
        flexDirection: "row",
        alignItems: "center",
        padding: 2,
        gap: 2,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      }) as const,
    [colors],
  );
  return <View style={style}>{children}</View>;
}

export function ToolButton(props: {
  theme: Theme;
  icon: string;
  /** Read by screen readers and shown as the tooltip on web. */
  label: string;
  onPress(): void;
  /** A toggle that is on. */
  active?: boolean;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { colors } = props.theme;
  const styles = useMemo(() => {
    const idle = {
      width: 26,
      height: 24,
      borderRadius: 6,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: props.active ? colors.surface2 : "transparent",
      opacity: props.disabled ? 0.4 : 1,
    } as const;
    return { idle, hover: { ...idle, backgroundColor: colors.surface2 } };
  }, [colors, props.active, props.disabled]);
  const pressStyle = usePressableStyle(styles.idle, styles.hover);
  const color = props.active ? colors.foreground : colors.foregroundMuted;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: props.active === true, disabled: props.disabled === true }}
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      hitSlop={4}
      style={pressStyle}
      {...({ title: props.label } as object)}
    >
      {props.busy ? <ActivityIndicator size="small" color={color} /> : <Icon name={props.icon} size={14} color={color} />}
    </Pressable>
  );
}
