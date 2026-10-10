import { useSettings } from "@getpaseo/plugin/client";
import { useCallback, useMemo, useState } from "react";
import { Switch, Text, View } from "react-native";
import {
  GUIDANCE_KEYS,
  type Guidance,
  GuidanceSchema,
  linearSettings,
  type ProjectConfig,
  type ToolSettings,
  withProjectGuidance,
} from "../shared/settings";
import type { PaseoProjectOption } from "./queries";
import type { Theme } from "./ui";

// Launch options that add instructions to the prompt. Each project keeps its own choices, so
// the next launch in the project starts with them.

const DEFAULT_GUIDANCE = GuidanceSchema.parse({});

const COPY: Record<(typeof GUIDANCE_KEYS)[number], { label: string; hint: string }> = {
  updateLinear: {
    label: "Keep Linear updated",
    hint: "The agent edits the issue description and checks off task list items as it works, with the plugin's Linear tools. It posts no comments. Todos start with issue keys, so status sync can move each sub-issue.",
  },
  subagentKeys: {
    label: "Subagents state their issue key",
    hint: "Subagents open with the key of the issue they work on and state the new key when it changes. Claude agents also get a hook that tells each subagent.",
  },
  paseoSubagents: {
    label: "Hand off work to Paseo agents",
    hint: "The agent starts one Paseo agent for each sub-issue with the plugin's tools, on its own provider and model. Each one checks off its own items.",
  },
};

/** The project's guidance, changed locally at once and saved to the project in the background. */
export function useProjectGuidance(project: PaseoProjectOption | null, config: ProjectConfig | null) {
  const settings = useSettings(linearSettings);
  const [edits, setEdits] = useState<Record<string, Guidance>>({});
  const guidance = (project ? edits[project.projectId] : undefined) ?? config?.guidance ?? DEFAULT_GUIDANCE;
  const change = useCallback(
    (key: (typeof GUIDANCE_KEYS)[number], value: boolean) => {
      if (!project) return;
      const next = { ...guidance, [key]: value };
      setEdits((current) => ({ ...current, [project.projectId]: next }));
      if (settings.status === "ready") void settings.save(withProjectGuidance(settings.values, project, next), settings.revision);
    },
    [project, guidance, settings],
  );
  return { guidance, change };
}

/** The hint of an option whose Linear tools are off or limited, or null for the usual hint. */
function toolsHint(key: (typeof GUIDANCE_KEYS)[number], tools: ToolSettings): string | null {
  if (key === "paseoSubagents" && !tools.enabled) {
    return "This needs the plugin's Linear tools, which are off for this project. Turn them on in Linear settings, under Agents.";
  }
  if (key === "updateLinear" && !(tools.enabled && tools.allowEdits)) {
    return "Todos start with issue keys, so status sync can move each sub-issue. The agent cannot edit the issue, because the Linear tools or description edits are off for this project.";
  }
  return null;
}

export function GuidanceToggles(props: {
  theme: Theme;
  guidance: Guidance;
  tools: ToolSettings;
  onChange(key: (typeof GUIDANCE_KEYS)[number], value: boolean): void;
}) {
  const { colors } = props.theme;
  const styles = useMemo(
    () => ({
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 10, paddingVertical: 4 },
      body: { flex: 1, gap: 2 },
      label: { color: colors.foreground, fontSize: 14 },
      hint: { color: colors.foregroundMuted, fontSize: 12 },
      track: { true: colors.accent, false: colors.surface2 },
    }),
    [colors],
  );
  return (
    <View>
      {GUIDANCE_KEYS.map((key) => {
        const blocked = key === "paseoSubagents" && !props.tools.enabled;
        return (
          <View key={key} style={styles.row}>
            <View style={styles.body}>
              <Text style={styles.label}>{COPY[key].label}</Text>
              <Text style={styles.hint}>{toolsHint(key, props.tools) ?? COPY[key].hint}</Text>
            </View>
            <Switch
              accessibilityLabel={COPY[key].label}
              value={props.guidance[key] && !blocked}
              disabled={blocked}
              onValueChange={(value) => props.onChange(key, value)}
              trackColor={styles.track}
            />
          </View>
        );
      })}
    </View>
  );
}
