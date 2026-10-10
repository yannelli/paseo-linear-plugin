import type { SettingsState } from "@getpaseo/plugin/client";
import { TextInput } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { type ReactNode, useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { TEMPLATE_VARIABLES } from "../shared/prompts";
import type { LinearSettings, linearSettings } from "../shared/settings";
import { MONO, type Theme } from "./ui";

export type ReadySettings = Extract<
  SettingsState<typeof linearSettings.schema>,
  { status: "ready" }
>;

export function MultilineField(props: {
  theme: Theme;
  label: string;
  hint?: string;
  value: string;
  placeholder?: string;
  minHeight?: number;
  error?: string | null;
  /** Markup, not prose: a monospace font and no autocorrect. */
  code?: boolean;
  onChange(value: string): void;
}) {
  const { colors } = props.theme;
  const minHeight = props.minHeight ?? 96;
  const { code } = props;
  const style = useMemo(
    () => ({
      marginTop: 8,
      minHeight,
      padding: 10,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface2,
      color: colors.foreground,
      fontSize: 13,
      lineHeight: 19,
      textAlignVertical: "top" as const,
      ...(code ? { fontFamily: MONO, fontSize: 12 } : {}),
    }),
    [colors, minHeight, code],
  );
  return (
    <SettingsRow label={props.label} hint={props.hint} error={props.error}>
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        multiline
        placeholder={props.placeholder}
        placeholderTextColor={colors.foregroundMuted}
        accessibilityLabel={props.label}
        autoCapitalize={code ? "none" : "sentences"}
        autoCorrect={!code}
        spellCheck={!code}
        style={style}
      />
    </SettingsRow>
  );
}

const VARIABLES_STYLE = { gap: 2 } as const;

export function VariablesHint({ theme }: { theme: Theme }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      line: { color: colors.foregroundMuted, fontSize: 12 },
      name: { color: colors.foreground },
    }),
    [colors],
  );
  return (
    <View style={VARIABLES_STYLE}>
      {TEMPLATE_VARIABLES.map((variable) => (
        <Text key={variable.name} style={styles.line}>
          <Text style={styles.name}>{`{{${variable.name}}}`}</Text>
          {`  ${variable.description}`}
        </Text>
      ))}
    </View>
  );
}

type AnySettings = SettingsState<typeof linearSettings.schema>;

function SettingsProblem(props: { theme: Theme; title: string; settings: AnySettings }) {
  const { settings } = props;
  const { reload, reset } = settings;
  const style = useMemo(() => ({ color: props.theme.colors.statusDanger }), [props.theme]);
  const retry = useCallback(() => void reload(), [reload]);
  const restore = useCallback(() => void reset(), [reset]);
  return (
    <SettingsSection title={props.title}>
      <Text style={style}>{"error" in settings ? settings.error : ""}</Text>
      <SettingsAction label="Try again" actionLabel="Reload" onPress={retry} />
      {settings.status === "invalid" ? (
        <SettingsAction label="Restore default settings" actionLabel="Reset" onPress={restore} />
      ) : null}
    </SettingsSection>
  );
}

export function SettingsGate(props: {
  theme: Theme;
  title: string;
  settings: AnySettings;
  children(settings: ReadySettings): ReactNode;
}) {
  const { settings, theme } = props;
  const loadingStyle = useMemo(() => ({ color: theme.colors.foregroundMuted }), [theme]);
  if (settings.status === "ready") return props.children(settings);
  if (settings.status === "loading") return <Text style={loadingStyle}>Loading settings…</Text>;
  return <SettingsProblem theme={theme} title={props.title} settings={settings} />;
}

const SAVE_BAR_STYLE = { gap: 8 } as const;

export function SaveBar(props: {
  theme: Theme;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  onSave(): void;
  onDiscard(): void;
}) {
  const errorStyle = useMemo(() => ({ color: props.theme.colors.statusDanger }), [props.theme]);
  if (!props.dirty && !props.error) return null;
  return (
    <View style={SAVE_BAR_STYLE}>
      {props.error ? (
        <Text accessibilityRole="alert" style={errorStyle}>
          {props.error}
        </Text>
      ) : null}
      {props.dirty ? (
        <SettingsAction
          label="Unsaved changes"
          actionLabel="Save"
          disabled={props.saving}
          onPress={props.onSave}
        />
      ) : null}
      {props.dirty ? (
        <SettingsAction
          label="Discard changes"
          actionLabel="Discard"
          disabled={props.saving}
          onPress={props.onDiscard}
        />
      ) : null}
    </View>
  );
}

// A draft keeps the revision it started from, so a save over someone else's change conflicts
// instead of silently overwriting it. With no draft, the editor shows the saved values.
export function useSettingsDraft(settings: ReadySettings) {
  const [draft, setDraft] = useState<{ values: LinearSettings; revision: string } | null>(null);
  const values = draft?.values ?? settings.values;
  const edit = useCallback(
    (change: (current: LinearSettings) => LinearSettings) =>
      setDraft((current) => ({
        values: change(current?.values ?? settings.values),
        revision: current?.revision ?? settings.revision,
      })),
    [settings.values, settings.revision],
  );
  const save = useCallback(async () => {
    if (draft && (await settings.save(draft.values, draft.revision))) setDraft(null);
  }, [draft, settings]);
  const discard = useCallback(() => {
    setDraft(null);
    void settings.reload();
  }, [settings]);
  return { values, dirty: draft !== null, edit, save, discard };
}
