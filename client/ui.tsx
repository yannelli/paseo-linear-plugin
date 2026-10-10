import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { type ComponentType, type ReactNode, useCallback, useMemo } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  type PressableStateCallbackType,
  type StyleProp,
  Text,
  View,
  type ViewStyle,
} from "react-native";

export { Avatar, LabelPill, PriorityIcon, priorityMeta, StateIcon } from "./glyphs";

export type Theme = PluginSurfaceProps["theme"];

export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, monospace",
});

/** A Lucide icon name, or a component such as the plugin icon. */
export type Glyph = string | ComponentType<{ size: number; color: string; theme: Theme }>;

export function GlyphIcon(props: { glyph: Glyph; size: number; color: string; theme: Theme }) {
  const { glyph: Custom, size, color, theme } = props;
  if (typeof Custom === "string") return <Icon name={Custom} size={size} color={color} />;
  return <Custom size={size} color={color} theme={theme} />;
}

type InteractionState = PressableStateCallbackType & { hovered?: boolean };

export function interactive(state: PressableStateCallbackType): boolean {
  return state.pressed || (state as InteractionState).hovered === true;
}

// Stable Pressable style callback: `idle` normally, `active` while hovered or pressed.
// Callers pass memoized styles so the callback only changes when the styles do.
export function usePressableStyle(idle: StyleProp<ViewStyle>, active: StyleProp<ViewStyle>) {
  return useCallback(
    (pressable: PressableStateCallbackType) => (interactive(pressable) ? active : idle),
    [idle, active],
  );
}

const HEIGHT = { xs: 28, sm: 32, md: 40 } as const;

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost";

function buttonFill(variant: ButtonVariant, colors: Theme["colors"]): string {
  if (variant === "primary") return colors.accent;
  if (variant === "secondary") return colors.surface2;
  return "transparent";
}

export interface ButtonProps {
  theme: Theme;
  label: string;
  icon?: Glyph;
  variant?: ButtonVariant;
  size?: keyof typeof HEIGHT;
  disabled?: boolean;
  busy?: boolean;
  accessibilityLabel?: string;
  onPress(): void;
}

function ButtonGlyph(props: { busy: boolean; icon?: Glyph; size: number; color: string; theme: Theme }) {
  if (props.busy) return <ActivityIndicator size="small" color={props.color} />;
  if (!props.icon) return null;
  return <GlyphIcon glyph={props.icon} size={props.size} color={props.color} theme={props.theme} />;
}

export function Button({
  theme,
  label,
  icon,
  variant = "secondary",
  size = "sm",
  disabled,
  busy,
  accessibilityLabel,
  onPress,
}: ButtonProps) {
  const colors = theme.colors;
  const ink = variant === "primary" ? colors.accentForeground : colors.foreground;
  const inactive = disabled === true || busy === true;
  const styles = useMemo(() => {
    const idle = {
      height: HEIGHT[size],
      paddingHorizontal: size === "xs" ? 8 : 12,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      backgroundColor: buttonFill(variant, colors),
      borderWidth: variant === "outline" ? 1 : 0,
      borderColor: colors.border,
      opacity: inactive ? 0.5 : 1,
    } as const;
    return {
      idle,
      active: { ...idle, opacity: inactive ? 0.5 : 0.85 },
      label: { color: ink, fontSize: size === "xs" ? 12 : 14 },
    };
  }, [colors, variant, size, inactive, ink]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const a11yState = useMemo(() => ({ disabled: inactive, busy: busy === true }), [inactive, busy]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={a11yState}
      disabled={inactive}
      onPress={onPress}
      style={pressStyle}
    >
      <ButtonGlyph busy={busy === true} icon={icon} size={size === "xs" ? 14 : 16} color={ink} theme={theme} />
      <Text numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton(props: {
  theme: Theme;
  icon: string;
  label: string;
  onPress(): void;
  disabled?: boolean;
}) {
  const { colors } = props.theme;
  const styles = useMemo(() => {
    const idle = {
      width: 32,
      height: 32,
      borderRadius: 8,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "transparent",
      opacity: props.disabled ? 0.5 : 1,
    } as const;
    return { idle, active: { ...idle, backgroundColor: colors.surface2 } };
  }, [colors, props.disabled]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={6}
      style={pressStyle}
    >
      <Icon name={props.icon} size={16} color={colors.foregroundMuted} />
    </Pressable>
  );
}

function SegmentTab<Value extends string>(props: {
  theme: Theme;
  value: Value;
  label: string;
  selected: boolean;
  onChange(value: Value): void;
}) {
  const { colors } = props.theme;
  const { selected, value, onChange } = props;
  const styles = useMemo(() => {
    const tab = {
      height: 26,
      paddingHorizontal: 10,
      borderRadius: 6,
      justifyContent: "center",
      backgroundColor: "transparent",
    } as const;
    const active = { ...tab, backgroundColor: colors.surface2 };
    return {
      idle: selected ? active : tab,
      active,
      label: { fontSize: 12, color: selected ? colors.foreground : colors.foregroundMuted },
    };
  }, [colors, selected]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const a11yState = useMemo(() => ({ selected }), [selected]);
  const press = useCallback(() => onChange(value), [onChange, value]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={a11yState}
      onPress={press}
      style={pressStyle}
    >
      <Text style={styles.label}>{props.label}</Text>
    </Pressable>
  );
}

export function Segmented<Value extends string>(props: {
  theme: Theme;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange(value: Value): void;
  accessibilityLabel: string;
}) {
  const { colors } = props.theme;
  const style = useMemo(
    () =>
      ({
        flexDirection: "row",
        gap: 2,
        padding: 2,
        borderRadius: 8,
        backgroundColor: colors.surface1,
      }) as const,
    [colors],
  );
  return (
    <View accessibilityRole="tablist" accessibilityLabel={props.accessibilityLabel} style={style}>
      {props.options.map((option) => (
        <SegmentTab
          key={option.value}
          theme={props.theme}
          value={option.value}
          label={option.label}
          selected={option.value === props.value}
          onChange={props.onChange}
        />
      ))}
    </View>
  );
}

export function OptionRow(props: {
  theme: Theme;
  label: string;
  detail?: string;
  leading?: ReactNode;
  selected?: boolean;
  onPress(): void;
}) {
  const { colors } = props.theme;
  const selected = props.selected === true;
  const styles = useMemo(() => {
    const idle = {
      minHeight: 40,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 8,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      backgroundColor: "transparent",
    } as const;
    return {
      idle,
      active: { ...idle, backgroundColor: colors.surface2 },
      body: { flex: 1, minWidth: 0 },
      label: { color: colors.foreground, fontSize: 14 },
      detail: { color: colors.foregroundMuted, fontSize: 12 },
    };
  }, [colors]);
  const pressStyle = usePressableStyle(styles.idle, styles.active);
  const a11yState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={a11yState}
      onPress={props.onPress}
      style={pressStyle}
    >
      {props.leading}
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.label}>
          {props.label}
        </Text>
        {props.detail ? (
          <Text numberOfLines={1} style={styles.detail}>
            {props.detail}
          </Text>
        ) : null}
      </View>
      {selected ? <Icon name="Check" size={16} color={colors.foreground} /> : null}
    </Pressable>
  );
}

export function EmptyState(props: {
  theme: Theme;
  icon: Glyph;
  title: string;
  detail?: string;
  tone?: "default" | "danger";
  children?: ReactNode;
}) {
  const { colors } = props.theme;
  const styles = useMemo(
    () => ({
      root: {
        flex: 1,
        alignItems: "center" as const,
        justifyContent: "center" as const,
        gap: 10,
        padding: 32,
      },
      title: {
        color: props.tone === "danger" ? colors.statusDanger : colors.foreground,
        fontSize: 15,
        fontWeight: "500" as const,
        textAlign: "center" as const,
      },
      detail: {
        color: colors.foregroundMuted,
        fontSize: 13,
        textAlign: "center" as const,
        maxWidth: 420,
      },
    }),
    [colors, props.tone],
  );
  return (
    <View style={styles.root}>
      <GlyphIcon glyph={props.icon} size={28} color={colors.foregroundMuted} theme={props.theme} />
      <Text style={styles.title}>{props.title}</Text>
      {props.detail ? <Text style={styles.detail}>{props.detail}</Text> : null}
      {props.children}
    </View>
  );
}

export function SectionLabel({ theme, children }: { theme: Theme; children: ReactNode }) {
  const { colors } = theme;
  const style = useMemo(
    () =>
      ({
        color: colors.foregroundMuted,
        fontSize: 12,
        fontWeight: "500",
        marginBottom: 6,
      }) as const,
    [colors],
  );
  return <Text style={style}>{children}</Text>;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function relativeTime(iso: string, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const date = new Date(iso);
  const month = date.toLocaleString("en-US", { month: "short" });
  if (date.getFullYear() === new Date(now).getFullYear()) return `${month} ${date.getDate()}`;
  return `${month} ${date.getFullYear()}`;
}
