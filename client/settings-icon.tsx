import { type PluginSurfaceProps, useSettings } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { useCallback, useMemo, useState } from "react";
import { Platform, Text, View } from "react-native";
import {
  HEX_COLOR,
  type IconPaint,
  type IconSettings,
  MAX_SVG_LENGTH,
  parseIconSvg,
} from "../shared/custom-icon";
import { linearSettings } from "../shared/settings";
import { IconGlyph } from "./plugin-icon";
import { MultilineField, type ReadySettings, SaveBar, SettingsGate, useSettingsDraft } from "./settings-fields";
import type { Theme } from "./ui";
import { canPickFiles, pickTextFile } from "./web";

const PAINT_OPTIONS: readonly { label: string; value: IconPaint }[] = [
  { label: "Original colors", value: "original" },
  { label: "Theme color, like Paseo's icons", value: "theme" },
  { label: "Theme accent", value: "accent" },
  { label: "Linear indigo, the plugin color", value: "linear" },
  { label: "Custom color", value: "custom" },
];
const PREVIEW_SIZES = [14, 16, 22, 28] as const;
const SVG_FILES = ".svg,image/svg+xml";
/** Exports often carry comments and metadata, so the file may be larger than the saved SVG. */
const MAX_FILE_BYTES = MAX_SVG_LENGTH * 4;

export function IconSettingsScreen({ theme }: PluginSurfaceProps) {
  const settings = useSettings(linearSettings);
  const render = useCallback(
    (ready: ReadySettings) => <IconEditor theme={theme} settings={ready} />,
    [theme],
  );
  return (
    <SettingsGate theme={theme} title="Icon" settings={settings}>
      {render}
    </SettingsGate>
  );
}

function IconPreview({ theme, icon }: { theme: Theme; icon: IconSettings }) {
  const { colors } = theme;
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, gap: 14, paddingTop: 8 },
      pill: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        height: 26,
        paddingHorizontal: 10,
        borderRadius: 13,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
      },
      label: { color: colors.foreground, fontSize: 12 },
    }),
    [colors],
  );
  return (
    <View style={styles.row}>
      {PREVIEW_SIZES.map((size) => (
        <IconGlyph key={size} icon={icon} size={size} color={colors.foregroundMuted} theme={theme} />
      ))}
      <View style={styles.pill}>
        <IconGlyph icon={icon} size={14} color={colors.foregroundMuted} theme={theme} />
        <Text style={styles.label}>ENG-123</Text>
      </View>
      <View style={styles.pill}>
        <IconGlyph icon={icon} size={14} color={colors.foreground} theme={theme} />
        <Text style={styles.label}>Linear</Text>
      </View>
    </View>
  );
}

function IconEditor({ theme, settings }: { theme: Theme; settings: ReadySettings }) {
  const { values, dirty, edit, save, discard } = useSettingsDraft(settings);
  const icon = values.icon;
  const [markup, setMarkup] = useState(icon.svg);
  const [markupError, setMarkupError] = useState<string | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const change = useCallback(
    (patch: Partial<IconSettings>) => edit((current) => ({ ...current, icon: { ...current.icon, ...patch } })),
    [edit],
  );
  // The draft keeps the last SVG that passed the checks, so the preview never breaks.
  const applyMarkup = useCallback(
    (text: string) => {
      setMarkup(text);
      if (!text.trim()) {
        setMarkupError(null);
        change({ svg: "" });
        return;
      }
      const parsed = parseIconSvg(text);
      setMarkupError("error" in parsed ? parsed.error : null);
      if ("svg" in parsed) change({ svg: parsed.svg });
    },
    [change],
  );
  const choose = useCallback(
    () =>
      pickTextFile(SVG_FILES, MAX_FILE_BYTES, (file) => {
        if ("error" in file) {
          setMarkupError(file.error);
          return;
        }
        setFileName(file.name);
        applyMarkup(file.text);
      }),
    [applyMarkup],
  );
  const useBuiltIn = useCallback(() => {
    setFileName(null);
    applyMarkup("");
  }, [applyMarkup]);
  const changeColor = useCallback(
    (text: string) => {
      const color = text.trim();
      const valid = HEX_COLOR.test(color);
      setColorError(valid ? null : "Use a hex color, such as #5E6AD2.");
      if (valid) change({ color });
    },
    [change],
  );
  const reset = useCallback(() => {
    discard();
    setMarkup(settings.values.icon.svg);
    setMarkupError(null);
    setColorError(null);
    setFileName(null);
  }, [discard, settings.values.icon.svg]);
  const native = Platform.OS !== "web";
  const custom = icon.svg !== "";

  return (
    <View>
      <SettingsSection title="Plugin icon">
        <SettingsCard>
          <SettingsRow
            label="Preview"
            hint={
              native
                ? "The iOS and Android apps cannot draw plugin SVG images, so they show the built-in icon in the color you choose."
                : "Composer pills, the Linear sidebar row, and Linear screens use this icon. Paseo menus and panel tabs keep the built-in icon."
            }
          >
            <IconPreview theme={theme} icon={icon} />
          </SettingsRow>
          {canPickFiles ? (
            <SettingsAction
              label="SVG file"
              hint={fileName ? `Loaded ${fileName}. Save to use it.` : "Choose an .svg file. The plugin saves a copy in its settings."}
              actionLabel="Choose file"
              onPress={choose}
            />
          ) : null}
          <MultilineField
            theme={theme}
            label="SVG markup"
            hint="Paste SVG markup, or edit it here. Scripts, links to other files, and bitmap images are not allowed. Clear it to use the built-in icon."
            value={markup}
            placeholder={'<svg viewBox="0 0 24 24">…</svg>'}
            error={markupError}
            code
            onChange={applyMarkup}
          />
          <SettingsAction
            label="Built-in icon"
            hint="Remove your SVG and use the Linear board icon."
            actionLabel="Use built-in"
            disabled={!custom && markup === ""}
            onPress={useBuiltIn}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Color and fill">
        <SettingsCard>
          <SettingsSelect
            label="Color"
            hint="Original colors keep the SVG as drawn, and currentColor follows Paseo. The other choices paint the whole icon one color."
            value={icon.paint}
            options={PAINT_OPTIONS}
            onValueChange={(paint) => change({ paint })}
          />
          {icon.paint === "custom" ? (
            <SettingsInput
              label="Custom color"
              hint="A hex color, such as #5E6AD2 or #5E6AD2CC with transparency."
              initialValue={icon.color}
              placeholder="#5E6AD2"
              error={colorError}
              onChangeText={changeColor}
            />
          ) : null}
          <SettingsSwitch
            label="Solid"
            hint={custom ? "Fill shapes that only have an outline, so line icons show as solid shapes." : "Add your SVG to use this. The built-in icon stays as drawn."}
            value={icon.solid}
            disabled={!custom}
            onValueChange={(solid) => change({ solid })}
          />
        </SettingsCard>
      </SettingsSection>
      <SaveBar
        theme={theme}
        dirty={dirty}
        saving={settings.saving}
        error={settings.saveError}
        onSave={() => void save()}
        onDiscard={reset}
      />
    </View>
  );
}
