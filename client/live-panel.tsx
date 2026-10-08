import type { PluginAgentSnapshot } from "@getpaseo/plugin";
import { type PluginAgentPanelProps, useAgent, useSettings } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, Text, View } from "react-native";
import { deriveActivity } from "../shared/activity";
import type { IssueDetail } from "../shared/linear";
import { AGENT_LABELS } from "../shared/prompts";
import { type GraphCamera, type LinearSettings, type LiveView, linearSettings, type MappingMode } from "../shared/settings";
import { KeyScopeProvider } from "./key-scope";
import { buildGraph, graphFiles } from "../shared/graph-model";
import { AgentsList, cursorAgents, useLiveAgents } from "./live-agents";
import { ActivityFeed } from "./live-feed";
import { LiveGraph } from "./live-graph";
import { LiveHeader, MapActions, MapSource, ViewToggle } from "./live-header";
import { type FocusKey, IssueRail, issueProgress, SubIssues } from "./live-issues";
import { MapLegend, RepoMap } from "./live-map";
import {
  ownerColors,
  useAgentTimeline,
  useFileLinks,
  useLiveMap,
  useMapModel,
  useReduceMotion,
} from "./live-timeline";
import { hitRateLine, offMapLine, offMapWhere } from "../shared/map-model";
import { useIssue } from "./queries";
import { Button, EmptyState, errorMessage, IconButton, type Theme } from "./ui";

type AgentStatus = PluginAgentSnapshot["status"];

interface AgentInfo {
  identifier: string | null;
  project: string | null;
  cwd: string;
  workspaceId: string | null;
  status: AgentStatus;
  provider: string;
}

const selectAgent = (agent: PluginAgentSnapshot): AgentInfo => ({
  identifier: agent.labels[AGENT_LABELS.issue] ?? null,
  project: agent.labels[AGENT_LABELS.project] ?? null,
  cwd: agent.cwd,
  workspaceId: agent.workspaceId ?? null,
  status: agent.status,
  provider: agent.provider,
});

export type LivePatch = Partial<
  Pick<LinearSettings["live"], "view" | "issuesCollapsed" | "graphCamera" | "graphLocked">
>;

const STACK_WIDTH = 760;
const COLUMN_WIDTH = 330;

export function LivePanel(props: PluginAgentPanelProps) {
  const { theme, agentId } = props;
  const settings = useSettings(linearSettings);
  const agent = useAgent(agentId, selectAgent);
  const live = settings.status === "ready" ? settings.values.live : null;
  // The panel switches at once and each save carries every choice made here, so two
  // choices made in a row do not undo each other. A failed save keeps them for this session.
  const latest = useRef(settings);
  latest.current = settings;
  const choices = useRef<LivePatch>({});
  const saveLive = useCallback((patch: LivePatch) => {
    const current = latest.current;
    if (current.status !== "ready") return;
    choices.current = { ...choices.current, ...patch };
    const values = { ...current.values, live: { ...current.values.live, ...choices.current } };
    void current.save(values, current.revision);
  }, []);
  if (settings.status === "loading") {
    return <EmptyState theme={theme} icon="Radar" title="Loading Linear Live" />;
  }
  if (live && !live.enabled) {
    return (
      <EmptyState
        theme={theme}
        icon="Radar"
        title="Linear Live is off"
        detail="Turn it on in Linear settings, under Live."
      />
    );
  }
  if (!agent) return <EmptyState theme={theme} icon="Radar" title="Loading agent" />;
  if (!agent.identifier) {
    return (
      <EmptyState
        theme={theme}
        icon="Radar"
        title="This agent is not linked to a Linear issue"
        detail="Agents started from a Linear issue show here."
      />
    );
  }
  return (
    <KeyScopeProvider projectId={agent.project}>
      <LiveBody
        key={agentId}
        theme={theme}
        compact={props.layout.compact}
        agentId={agentId}
        agent={agent}
        identifier={agent.identifier}
        mapping={live?.mapping ?? "semantic"}
        view={live?.view ?? "map"}
        issuesCollapsed={live?.issuesCollapsed ?? false}
        graphCamera={live?.graphCamera ?? "auto"}
        graphLocked={live?.graphLocked ?? false}
        saveLive={saveLive}
        openAgent={props.navigation ? (id) => props.navigation?.openAgent({ agentId: id }) : undefined}
      />
    </KeyScopeProvider>
  );
}

interface BodyProps {
  theme: Theme;
  compact: boolean;
  agentId: string;
  agent: AgentInfo;
  identifier: string;
  mapping: MappingMode;
  view: LiveView;
  issuesCollapsed: boolean;
  graphCamera: GraphCamera;
  graphLocked: boolean;
  saveLive(patch: LivePatch): void;
  openAgent?: (agentId: string) => void;
}

function LiveBody(props: BodyProps) {
  const { theme } = props;
  const issue = useIssue(props.identifier);
  const { refetch } = issue;
  const retry = useCallback(() => void refetch(), [refetch]);
  if (issue.isPending) return <EmptyState theme={theme} icon="Loader" title="Loading issue" />;
  if (issue.isError) {
    return (
      <EmptyState
        theme={theme}
        icon="TriangleAlert"
        tone="danger"
        title="Could not load the issue"
        detail={errorMessage(issue.error)}
      >
        <Button theme={theme} label="Try again" icon="RefreshCw" onPress={retry} />
      </EmptyState>
    );
  }
  return <LiveView {...props} issue={issue.data} />;
}

function Card(props: {
  theme: Theme;
  title: string;
  meta?: ReactNode;
  right?: ReactNode;
  fill?: boolean;
  children?: ReactNode;
}) {
  const { colors } = props.theme;
  const styles = useMemo(
    () =>
      ({
        card: {
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 12,
          backgroundColor: colors.surface0,
          overflow: "hidden",
          ...(props.fill ? { flex: 1, minHeight: 0 } : {}),
        },
        head: {
          flexDirection: "row",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderBottomWidth: props.children ? 1 : 0,
          borderBottomColor: colors.border,
        },
        title: { color: colors.foreground, fontSize: 13, fontWeight: "600" },
        right: { marginLeft: "auto" },
        body: { padding: 12, ...(props.fill ? { flex: 1, minHeight: 0 } : {}) },
      }) as const,
    [colors, props.fill, props.children],
  );
  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Text style={styles.title}>{props.title}</Text>
        {props.meta}
        {props.right ? <View style={styles.right}>{props.right}</View> : null}
      </View>
      {props.children ? <View style={styles.body}>{props.children}</View> : null}
    </View>
  );
}

function LiveView(props: BodyProps & { issue: IssueDetail }) {
  const { theme, issue, agent, agentId } = props;
  const { colors } = theme;
  const timeline = useAgentTimeline(agentId);
  const activity = useMemo(
    () => deriveActivity(timeline.items, agent.cwd),
    [timeline.items, agent.cwd],
  );
  const liveMap = useLiveMap(agentId, props.identifier, issue, props.mapping);
  const agents = useLiveAgents({
    theme,
    agentId,
    cwd: agent.cwd,
    workspaceId: agent.workspaceId,
    status: agent.status,
    provider: agent.provider,
    activity,
  });
  const model = useMapModel(agentId, liveMap.map.files, agents.files, agents.dirs, liveMap.areas);
  const offMap = offMapLine(model);
  const currentPath = activity.current?.path ?? null;
  const where = useMemo(() => offMapWhere(model, currentPath, liveMap.areas), [model, currentPath, liveMap.areas]);
  // Hold the map until its first full data, so it does not draw once and then swap.
  const mapShown = useRef(false);
  if (liveMap.ready && model.ready) mapShown.current = true;
  const [view, setView] = useState<LiveView>(props.view);
  const [collapsed, setCollapsed] = useState(props.issuesCollapsed);
  const { saveLive } = props;
  const chooseView = useCallback(
    (next: LiveView) => {
      setView(next);
      saveLive({ view: next });
    },
    [saveLive],
  );
  const toggleIssues = useCallback(() => {
    setCollapsed(!collapsed);
    saveLive({ issuesCollapsed: !collapsed });
  }, [collapsed, saveLive]);
  const working = agent.status === "running";
  const graphInput = useMemo(
    () => ({
      issue: issue.identifier,
      children: issue.children.map((child) => child.identifier),
      tiles: model.zones.flatMap((zone) => zone.tiles),
    }),
    [issue, model.zones],
  );
  const graphPaths = useMemo(
    () => (view === "graph" ? graphFiles(graphInput).tiles.map((tile) => tile.path) : []),
    [view, graphInput],
  );
  // Each edit can add or drop an import, so the links are read again.
  const edits = graphInput.tiles.reduce((sum, tile) => sum + tile.added + tile.removed, 0);
  const links = useFileLinks(agentId, graphPaths, edits, view === "graph");
  const graph = useMemo(
    () => (view === "graph" ? buildGraph({ ...graphInput, links: links.links }) : null),
    [view, graphInput, links.links],
  );
  const cursors = useMemo(
    () =>
      cursorAgents({
        theme,
        provider: agent.provider,
        working,
        activity,
        children: agents.children,
        subagents: agents.subagents,
      }),
    [theme, agent.provider, working, activity, agents.children, agents.subagents],
  );
  const owners = useMemo(() => ownerColors(issue, colors.accent), [issue, colors.accent]);
  const progress = useMemo(() => issueProgress(issue, activity.todos), [issue, activity.todos]);
  const reduceMotion = useReduceMotion();
  const [focus, setFocus] = useState<FocusKey>(null);
  const toggleFocus = useCallback(
    (key: string) => setFocus((current) => (current === key ? null : key)),
    [],
  );
  const [width, setWidth] = useState(0);
  const measure = useCallback((event: LayoutChangeEvent) => {
    setWidth(event.nativeEvent.layout.width);
  }, []);
  const stacked = props.compact || (width > 0 && width < STACK_WIDTH);
  const styles = useMemo(
    () =>
      ({
        root: { flex: 1, minHeight: 0, backgroundColor: colors.surface0 },
        scroll: { flex: 1 },
        stack: { padding: 12, gap: 12, paddingBottom: 48 },
        header: {
          paddingHorizontal: 20,
          paddingVertical: 16,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        },
        split: { flex: 1, minHeight: 0, flexDirection: "row", gap: 16, padding: 16 },
        // Not `flex: 0`: on web it sets flex-basis 0, which overrides the width.
        column: { flexGrow: 0, flexShrink: 0, width: COLUMN_WIDTH, minHeight: 0, gap: 16 },
        main: { flex: 1, minWidth: 0 },
        mainContent: { gap: 16, paddingBottom: 32 },
        hit: { color: colors.foregroundMuted, fontSize: 12 },
        off: { color: colors.statusWarning, fontSize: 12 },
        tools: { flexDirection: "row", alignItems: "center", gap: 12 },
        mapHead: { gap: 8 },
        mapWait: { minHeight: 240, alignItems: "center", justifyContent: "center" },
      }) as const,
    [colors],
  );

  const header = (
    <LiveHeader
      theme={theme}
      issue={issue}
      progress={progress}
      owners={owners}
      status={agent.status}
      provider={agent.provider}
      current={activity.current}
      offMap={where}
      reduceMotion={reduceMotion}
    />
  );
  const issues = (
    <SubIssues
      theme={theme}
      issue={issue}
      progress={progress}
      owners={owners}
      focus={focus}
      onFocus={toggleFocus}
      reduceMotion={reduceMotion}
    />
  );
  const toggle = <ViewToggle theme={theme} value={view} onChange={chooseView} />;
  const map = (
    <Card
      theme={theme}
      title={view === "graph" ? "Graph" : "Repository map"}
      meta={mapShown.current ? <MapSource theme={theme} live={liveMap} mapping={props.mapping} /> : null}
      right={
        <View style={styles.tools}>
          {stacked || view === "graph" ? null : <MapLegend theme={theme} />}
          <MapActions theme={theme} live={liveMap} />
          {toggle}
        </View>
      }
    >
      {!mapShown.current ? (
        <View style={styles.mapWait}>
          <Text style={styles.hit}>Loading map…</Text>
        </View>
      ) : (
      <View style={styles.mapHead}>
        <Text style={styles.hit}>{hitRateLine(model)}</Text>
        {offMap ? <Text style={styles.off}>{offMap}</Text> : null}
        {graph ? (
          <LiveGraph
            theme={theme}
            compact={stacked}
            full={collapsed && !stacked}
            graph={graph}
            ready={links.ready}
            issue={issue}
            progress={progress}
            owners={owners}
            agents={cursors}
            areas={liveMap.areas}
            focus={focus}
            onFocus={toggleFocus}
            camera={props.graphCamera}
            locked={props.graphLocked}
            saveLive={saveLive}
            reduceMotion={reduceMotion}
          />
        ) : (
          <RepoMap
            theme={theme}
            compact={stacked}
            model={model}
            colors={owners}
            focus={focus}
            markers={agents.markers}
            reduceMotion={reduceMotion}
          />
        )}
      </View>
      )}
    </Card>
  );
  const feed = (
    <Card theme={theme} title="Activity">
      <ActivityFeed
        theme={theme}
        events={agents.events}
        loading={timeline.loading}
        error={timeline.error}
        reduceMotion={reduceMotion}
      />
    </Card>
  );
  const helpers = agents.children.length + agents.subagents.length;
  const agentsCard =
    helpers > 0 ? (
      <Card theme={theme} title="Agents" meta={<Text style={styles.hit}>{`${helpers + 1}`}</Text>}>
        <AgentsList
          theme={theme}
          provider={agent.provider}
          status={agent.status}
          current={activity.current}
          childAgents={agents.children}
          subagents={agents.subagents}
          onOpenAgent={props.openAgent}
        />
      </Card>
    ) : null;
  const collapse = (
    <IconButton
      theme={theme}
      icon={stacked ? (collapsed ? "ChevronDown" : "ChevronUp") : "PanelLeftClose"}
      label={collapsed ? "Show issues" : "Hide issues"}
      onPress={toggleIssues}
    />
  );
  if (stacked) {
    return (
      <View style={styles.root} onLayout={measure}>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.stack}>
          {header}
          <Card theme={theme} title="Issue" right={collapse}>
            {collapsed ? null : issues}
          </Card>
          {agentsCard}
          {map}
          {feed}
        </ScrollView>
      </View>
    );
  }
  return (
    <View style={styles.root} onLayout={measure}>
      <View style={styles.header}>{header}</View>
      <View style={styles.split}>
        {collapsed ? (
          <IssueRail
            theme={theme}
            issue={issue}
            owners={owners}
            focus={focus}
            onFocus={toggleFocus}
            onExpand={toggleIssues}
          />
        ) : (
          <View style={styles.column}>
            <Card theme={theme} title="Issue" right={collapse} fill>
              <ScrollView style={styles.scroll}>{issues}</ScrollView>
            </Card>
            {agentsCard}
          </View>
        )}
        <ScrollView style={styles.main} contentContainerStyle={styles.mainContent}>
          {map}
          {collapsed ? agentsCard : null}
          {feed}
        </ScrollView>
      </View>
    </View>
  );
}
