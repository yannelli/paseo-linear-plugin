import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { usePaseo } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  type Activity,
  type ActivityEvent,
  type AgentFocus,
  type DirTouch,
  deriveActivity,
  type FileTouch,
} from "../shared/activity";
import type { SubagentRun } from "../shared/subagents";
import { MONO } from "./live-issues";
import { useAgentTimelines } from "./live-timeline";
import { ProviderIcon } from "./provider-icon";
import { type Theme, usePressableStyle } from "./ui";

// Agents working on the issue besides the one the panel belongs to: Paseo child agents, which
// have their own timelines, and provider subagents, which only report what they were asked.

const CHILD_LABEL = "paseo.parent-agent-id";
const MAX_CHILDREN = 4;
const CHILD_COLORS = ["#e879f9", "#38bdf8", "#facc15", "#fb7185"];
const POLL_MS = 10_000;

export type AgentStatus = PluginAgentSnapshot["status"];

export interface ChildAgent {
  id: string;
  title: string;
  provider: string;
  status: AgentStatus;
  cwd: string;
  color: string;
}

export interface ChildView {
  agent: ChildAgent;
  activity: Activity | null;
  /** Works in the parent's folder, so its files can go on the same map. */
  sameFolder: boolean;
}

export interface AgentMarker {
  key: string;
  kind: "main" | "child" | "subagent";
  color: string;
  provider: string | null;
  label: string;
}

/** Child agents of an agent, newest running ones first. Polls only while the parent works. */
export function useChildAgents(agentId: string, polling: boolean): ChildAgent[] {
  const paseo = usePaseo();
  const query = useQuery({
    queryKey: ["linear", "live", "children", agentId],
    queryFn: async () => {
      const result = await paseo.agents.list({
        filter: { labels: { [CHILD_LABEL]: agentId }, includeArchived: true },
        page: { limit: 20 },
      });
      return result.entries.map((entry) => entry.agent);
    },
    refetchInterval: polling ? POLL_MS : false,
    staleTime: 5_000,
  });
  return useMemo(() => {
    const agents = [...(query.data ?? [])].sort((a, b) => {
      const running = Number(b.status === "running") - Number(a.status === "running");
      return running || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""));
    });
    return agents.slice(0, MAX_CHILDREN).map((agent, index) => ({
      id: agent.id,
      title: agent.title ?? "Child agent",
      provider: agent.provider,
      status: agent.status as AgentStatus,
      cwd: agent.cwd,
      color: CHILD_COLORS[index % CHILD_COLORS.length] ?? "#38bdf8",
    }));
  }, [query.data]);
}

export function sameFolder(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

function add(markers: Map<string, AgentMarker[]>, paths: readonly string[], marker: AgentMarker) {
  for (const path of paths) {
    if (path.endsWith("/")) continue;
    const list = markers.get(path) ?? [];
    if (!list.some((entry) => entry.key === marker.key)) markers.set(path, [...list, marker]);
  }
}

/** Which agents are on which file: where the main and child agents work, and subagent targets. */
export function agentMarkers(input: {
  theme: Theme;
  provider: string;
  working: boolean;
  current: ActivityEvent | null;
  children: readonly ChildView[];
  subagents: readonly SubagentRun[];
}): ReadonlyMap<string, AgentMarker[]> {
  const { colors } = input.theme;
  const markers = new Map<string, AgentMarker[]>();
  if (input.working && input.current) {
    const main = { key: "main", kind: "main", color: colors.accent, provider: input.provider, label: "Agent" } as const;
    add(markers, input.current.paths, main);
  }
  for (const child of input.children) {
    const current = child.activity?.current;
    if (child.agent.status !== "running" || !child.sameFolder || !current) continue;
    add(markers, current.paths, {
      key: child.agent.id,
      kind: "child",
      color: child.agent.color,
      provider: child.agent.provider,
      label: child.agent.title,
    });
  }
  for (const run of input.subagents) {
    if (run.status !== "running") continue;
    add(markers, run.targets, {
      key: run.key,
      kind: "subagent",
      color: colors.foregroundMuted,
      provider: null,
      label: run.description || run.type,
    });
  }
  return markers;
}

function subagentStatus(run: SubagentRun, parentRunning: boolean): string {
  if (run.status === "completed") return "Done";
  if (run.status === "failed") return "Failed";
  if (run.status === "canceled") return "Canceled";
  return parentRunning ? "Running" : "Started, no report since";
}

function names(paths: readonly string[]): string {
  const shown = paths.slice(0, 2).map((path) => path.replace(/\/$/, "").split("/").pop() ?? path);
  return `${shown.join(", ")}${paths.length > 2 ? ` +${paths.length - 2}` : ""}`;
}

interface RowProps {
  theme: Theme;
  color: string;
  icon: "provider" | "bot";
  provider: string | null;
  title: string;
  status: string;
  detail: string | null;
  live: boolean;
  onPress?: () => void;
}

function AgentRow(props: RowProps) {
  const { theme } = props;
  const { colors } = theme;
  const styles = useMemo(() => {
    const idle = { flexDirection: "row", gap: 10, padding: 8, borderRadius: 8 } as const;
    return {
      idle,
      hover: { ...idle, backgroundColor: colors.surface1 },
      badge: {
        width: 24,
        height: 24,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.surface2,
        borderWidth: 1,
        borderColor: props.icon === "bot" ? colors.border : props.color,
      },
      tint: { ...StyleSheet.absoluteFillObject, borderRadius: 6, backgroundColor: props.color, opacity: 0.18 },
      body: { flex: 1, minWidth: 0, gap: 2 },
      line: { flexDirection: "row", alignItems: "center", gap: 6 },
      title: { flex: 1, color: colors.foreground, fontSize: 13, fontWeight: "500" },
      status: { color: props.live ? colors.statusSuccess : colors.foregroundMuted, fontSize: 11 },
      detail: { color: colors.foregroundMuted, fontSize: 11, fontFamily: MONO },
    } as const;
  }, [colors, props.color, props.icon, props.live]);
  const pressStyle = usePressableStyle(styles.idle, styles.hover);
  const content = (
    <>
      <View style={styles.badge}>
        {props.icon === "bot" ? null : <View style={styles.tint} />}
        {props.icon === "provider" && props.provider ? (
          <ProviderIcon provider={props.provider} size={12} color={colors.foreground} />
        ) : (
          <Icon name="Bot" size={12} color={colors.foregroundMuted} />
        )}
      </View>
      <View style={styles.body}>
        <View style={styles.line}>
          <Text numberOfLines={1} style={styles.title}>
            {props.title}
          </Text>
          <Text style={styles.status}>{props.status}</Text>
        </View>
        {props.detail ? (
          <Text numberOfLines={1} style={styles.detail}>
            {props.detail}
          </Text>
        ) : null}
      </View>
    </>
  );
  if (!props.onPress) return <View style={styles.idle}>{content}</View>;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Open ${props.title}`} onPress={props.onPress} style={pressStyle}>
      {content}
    </Pressable>
  );
}

const STATUS_COPY: Record<AgentStatus, string> = {
  initializing: "Starting",
  idle: "Idle",
  running: "Working",
  error: "Error",
  closed: "Closed",
};

export function AgentsList(props: {
  theme: Theme;
  provider: string;
  status: AgentStatus;
  current: ActivityEvent | null;
  childAgents: readonly ChildView[];
  subagents: readonly SubagentRun[];
  onOpenAgent?: (agentId: string) => void;
}) {
  const { theme, onOpenAgent } = props;
  const parentRunning = props.status === "running";
  const open = useCallback((id: string) => () => onOpenAgent?.(id), [onOpenAgent]);
  return (
    <View>
      <AgentRow
        theme={theme}
        color={theme.colors.accent}
        icon="provider"
        provider={props.provider}
        title={props.provider ? props.provider.charAt(0).toUpperCase() + props.provider.slice(1) : "Agent"}
        status={STATUS_COPY[props.status] ?? props.status}
        detail={props.current?.text ?? null}
        live={parentRunning}
      />
      {props.childAgents.map(({ agent, activity, sameFolder: shared }) => (
        <AgentRow
          key={agent.id}
          theme={theme}
          color={agent.color}
          icon="provider"
          provider={agent.provider}
          title={agent.title}
          status={STATUS_COPY[agent.status] ?? agent.status}
          detail={shared ? (activity?.current?.text ?? null) : `In ${agent.cwd.split("/").pop() ?? agent.cwd}`}
          live={agent.status === "running"}
          onPress={onOpenAgent ? open(agent.id) : undefined}
        />
      ))}
      {props.subagents.map((run) => (
        <AgentRow
          key={run.key}
          theme={theme}
          color={theme.colors.foregroundMuted}
          icon="bot"
          provider={null}
          title={run.description ? `${run.type}: ${run.description}` : run.type}
          status={subagentStatus(run, parentRunning)}
          detail={run.targets.length > 0 ? `Asked about ${names(run.targets)}` : null}
          live={run.status === "running" && parentRunning}
        />
      ))}
    </View>
  );
}

/** Files the main agent and its same-folder child agents touched, counted together. */
function mergeTouches(own: readonly FileTouch[], children: readonly ChildView[]): FileTouch[] {
  const merged = new Map(own.map((file) => [file.path, { ...file }]));
  for (const child of children) {
    if (!child.sameFolder) continue;
    for (const file of child.activity?.files ?? []) {
      const known = merged.get(file.path);
      if (!known) {
        merged.set(file.path, { ...file });
        continue;
      }
      known.reads += file.reads;
      known.edits += file.edits;
      known.added += file.added;
      known.removed += file.removed;
      known.created ||= file.created;
    }
  }
  return [...merged.values()];
}

/** Child agents with their activity, every agent's place on the map, and all touched files. */
export function useLiveAgents(input: {
  theme: Theme;
  agentId: string;
  cwd: string;
  status: AgentStatus;
  provider: string;
  activity: Activity;
}) {
  const { theme, agentId, cwd, status, provider, activity } = input;
  const children = useChildAgents(agentId, status === "running");
  const ids = useMemo(() => children.map((child) => child.id), [children]);
  const timelines = useAgentTimelines(ids);
  const views = useMemo(
    () =>
      children.map((agent): ChildView => {
        const timeline = timelines.get(agent.id);
        return {
          agent,
          activity: timeline ? deriveActivity(timeline.items, agent.cwd) : null,
          sameFolder: sameFolder(agent.cwd, cwd),
        };
      }),
    [children, timelines, cwd],
  );
  const markers = useMemo(
    () =>
      agentMarkers({
        theme,
        provider,
        working: status === "running",
        current: activity.current,
        children: views,
        subagents: activity.subagents,
      }),
    [theme, provider, status, activity.current, activity.subagents, views],
  );
  const files = useMemo(() => mergeTouches(activity.files, views), [activity.files, views]);
  const dirs = useMemo(
    (): DirTouch[] => [
      ...activity.dirs,
      ...views.flatMap((view) => (view.sameFolder ? (view.activity?.dirs ?? []) : [])),
    ],
    [activity.dirs, views],
  );
  return { children: views, markers, files, dirs };
}

/** An agent that moves over the graph to what it works on. */
export interface CursorAgent {
  id: string;
  kind: "main" | "child";
  label: string;
  color: string;
  provider: string | null;
  focus: AgentFocus | null;
  running: boolean;
  /** What it does now, such as "Read page.tsx". */
  caption: string | null;
  /** Subagents running inside it. */
  satellites: number;
}

export function cursorAgents(input: {
  theme: Theme;
  provider: string;
  working: boolean;
  activity: Activity;
  children: readonly ChildView[];
}): CursorAgent[] {
  const { activity } = input;
  const name = input.provider ? input.provider.charAt(0).toUpperCase() + input.provider.slice(1) : "Agent";
  const agents: CursorAgent[] = [
    {
      id: "main",
      kind: "main",
      label: name,
      color: input.theme.colors.accent,
      provider: input.provider,
      focus: activity.focus,
      running: input.working,
      caption: input.working ? (activity.current?.text ?? null) : null,
      satellites: input.working ? activity.subagents.filter((run) => run.status === "running").length : 0,
    },
  ];
  for (const child of input.children) {
    // Paths are relative to each agent's folder, so only agents in this folder fit the graph.
    if (!child.sameFolder || !child.activity) continue;
    const running = child.agent.status === "running";
    agents.push({
      id: child.agent.id,
      kind: "child",
      label: child.agent.title,
      color: child.agent.color,
      provider: null,
      focus: child.activity.focus,
      running,
      caption: running ? (child.activity.current?.text ?? null) : null,
      satellites: 0,
    });
  }
  return agents;
}
