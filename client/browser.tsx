import {
  type PluginSurfaceProps,
  type PluginWorkspacePanelProps,
  useSettings,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { type AgentAction, linearSettings } from "../shared/settings";
import { ConnectCard } from "./connect";
import { CreateIssueModal } from "./create-issue";
import { IssueDetailView } from "./issue-detail";
import { IssueList } from "./issue-list";
import { effectiveKeyScope, KeyScopeProvider } from "./key-scope";
import { LaunchPage, type LaunchTarget } from "./launch";
import { useAuthStatus, useCatalog, useProjects } from "./queries";
import { panelScope, SCREEN_SCOPE, useBrowserState } from "./store";
import { Button, EmptyState, errorMessage, type Theme } from "./ui";

const SPLIT_WIDTH = 820;
const NARROW_WIDTH = 560;
const SCREEN_TARGET: LaunchTarget = { workspace: null };

interface BrowserProps {
  theme: Theme;
  compact: boolean;
  navigation: PluginSurfaceProps["navigation"];
  scope: string;
  target: LaunchTarget;
  /** The Paseo project to use the Linear key of. Null uses the default key. */
  keyProjectId: string | null;
  /** Shows a picker for the Linear key. The screen has one; panels follow their workspace. */
  canSwitchKey: boolean;
}

type Catalog = NonNullable<ReturnType<typeof useCatalog>["data"]>;

function LoadError(props: { theme: Theme; title: string; error: unknown; retry(): unknown }) {
  const { retry } = props;
  const tryAgain = useCallback(() => void retry(), [retry]);
  return (
    <EmptyState
      theme={props.theme}
      icon="TriangleAlert"
      tone="danger"
      title={props.title}
      detail={errorMessage(props.error)}
    >
      <Button theme={props.theme} label="Try again" icon="RefreshCw" onPress={tryAgain} />
    </EmptyState>
  );
}

export function IssueBrowser(props: BrowserProps) {
  const { theme } = props;
  const auth = useAuthStatus();
  const keyScope = effectiveKeyScope(props.keyProjectId, auth.data?.projectKeys);
  if (auth.isPending) {
    return <EmptyState theme={theme} icon="RefreshCw" title="Connecting to Linear" />;
  }
  if (auth.isError) {
    return (
      <LoadError
        theme={theme}
        title="Linear plugin is not responding"
        error={auth.error}
        retry={auth.refetch}
      />
    );
  }
  if (keyScope === null && !auth.data.configured) {
    return <ConnectCard theme={theme} compact={props.compact} />;
  }
  return (
    <KeyScopeProvider key={keyScope ?? "default"} projectId={keyScope}>
      <ScopedBrowser {...props} projectKeys={auth.data.projectKeys} />
    </KeyScopeProvider>
  );
}

type ProjectKeys = readonly { projectId: string }[];

function ScopedBrowser(props: BrowserProps & { projectKeys: ProjectKeys }) {
  const { theme } = props;
  const catalog = useCatalog();
  if (catalog.isPending) {
    return <EmptyState theme={theme} icon="RefreshCw" title="Loading your Linear workspace" />;
  }
  if (catalog.isError) {
    return (
      <LoadError
        theme={theme}
        title="Could not reach Linear"
        error={catalog.error}
        retry={catalog.refetch}
      />
    );
  }
  return <ConnectedBrowser {...props} catalog={catalog.data} />;
}

function useKeyOptions(enabled: boolean, projectKeys: ProjectKeys) {
  const projects = useProjects();
  return useMemo(() => {
    if (!enabled || projectKeys.length === 0) return [];
    const names = new Map(
      projects.data?.map((project) => [project.projectId, project.displayName]),
    );
    return [
      { value: "", label: "Default key" },
      ...projectKeys.map((entry) => ({
        value: entry.projectId,
        label: names.get(entry.projectId) ?? entry.projectId,
      })),
    ];
  }, [enabled, projectKeys, projects.data]);
}

function ConnectedBrowser(props: BrowserProps & { catalog: Catalog; projectKeys: ProjectKeys }) {
  const { theme, catalog } = props;
  const { colors } = theme;
  const [state, update] = useBrowserState(props.scope);
  const keyOptions = useKeyOptions(props.canSwitchKey, props.projectKeys);
  const [width, setWidth] = useState(0);
  const split = !props.compact && width >= SPLIT_WIDTH;
  const showDetail = state.issueId !== null;
  const showList = split || !showDetail;
  const sideBySide = split && showDetail;
  const narrow = props.compact || width < NARROW_WIDTH;

  const styles = useMemo(
    () => ({
      root: { flex: 1, flexDirection: "row" as const, backgroundColor: colors.surface0 },
      // Not `flex: 0`: on web it sets flex-basis 0, which overrides the width.
      list: sideBySide
        ? {
            flexGrow: 0,
            flexShrink: 0,
            width: Math.min(460, Math.round(width * 0.42)),
            borderRightWidth: 1,
            borderRightColor: colors.border,
            overflow: "hidden" as const,
          }
        : { flex: 1, minWidth: 0, overflow: "hidden" as const },
      detail: { flex: 1, minWidth: 0, overflow: "hidden" as const },
    }),
    [colors, sideBySide, width],
  );
  const measure = useCallback(
    (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width),
    [],
  );
  const back = useCallback(() => update({ issueId: null }), [update]);
  const openIssue = useCallback((issueId: string) => update({ issueId }), [update]);
  const closeCreate = useCallback(() => update({ creating: false }), [update]);
  const created = useCallback((issueId: string) => update({ creating: false, issueId }), [update]);
  const openLaunch = useCallback(
    (action: AgentAction) =>
      state.issueId && update({ launch: { issueId: state.issueId, action } }),
    [update, state.issueId],
  );
  const closeLaunch = useCallback(() => update({ launch: null }), [update]);

  if (state.launch) {
    return (
      <LaunchPage
        key={`${state.launch.issueId}:${state.launch.action}`}
        theme={theme}
        compact={narrow}
        issueId={state.launch.issueId}
        action={state.launch.action}
        target={props.target}
        navigation={props.navigation}
        onBack={closeLaunch}
        onStarted={closeLaunch}
      />
    );
  }

  return (
    <View style={styles.root} onLayout={measure}>
      {showList ? (
        <View style={styles.list}>
          <IssueList
            theme={theme}
            compact={narrow || sideBySide}
            teams={catalog.teams}
            state={state}
            update={update}
            keyOptions={keyOptions}
          />
        </View>
      ) : null}
      {state.issueId ? (
        <View style={styles.detail}>
          <IssueDetailView
            key={state.issueId}
            theme={theme}
            compact={narrow}
            issueId={state.issueId}
            teams={catalog.teams}
            users={catalog.users}
            viewerId={catalog.viewer.id}
            target={props.target}
            navigation={props.navigation}
            onBack={back}
            onOpenIssue={openIssue}
            onLaunch={openLaunch}
          />
        </View>
      ) : null}
      {state.creating ? (
        <CreateIssueModal
          theme={theme}
          teams={catalog.teams}
          users={catalog.users}
          viewerId={catalog.viewer.id}
          defaultTeamId={state.teamId}
          onClose={closeCreate}
          onCreated={created}
        />
      ) : null}
    </View>
  );
}

export function LinearScreen({ theme, layout, navigation }: PluginSurfaceProps) {
  const [state] = useBrowserState(SCREEN_SCOPE);
  return (
    <IssueBrowser
      theme={theme}
      compact={layout.compact}
      navigation={navigation}
      scope={SCREEN_SCOPE}
      target={SCREEN_TARGET}
      keyProjectId={state.keyProjectId}
      canSwitchKey
    />
  );
}

const selectProjectId = (workspace: { projectId: string }) => workspace.projectId;
const selectName = (workspace: { name: string }) => workspace.name;

export function LinearPanel({ theme, layout, navigation, workspaceId }: PluginWorkspacePanelProps) {
  const scope = panelScope(workspaceId);
  const projectId = useWorkspace(workspaceId, selectProjectId);
  const name = useWorkspace(workspaceId, selectName);
  const settings = useSettings(linearSettings);
  const [, update] = useBrowserState(scope);
  const seeded = useRef(false);
  const target = useMemo(
    () => ({ workspace: projectId ? { id: workspaceId, projectId, name: name ?? "" } : null }),
    [workspaceId, projectId, name],
  );
  // Default the panel's team filter to the team mapped to this workspace's project, once.
  useEffect(() => {
    if (seeded.current || settings.status !== "ready" || !projectId) return;
    seeded.current = true;
    const mapped = settings.values.projects.find((entry) => entry.projectId === projectId);
    const teamId = mapped?.teamIds[0];
    if (teamId) update({ teamId, assignee: "anyone" });
  }, [settings, projectId, update]);
  return (
    <IssueBrowser
      theme={theme}
      compact={layout.compact}
      navigation={navigation}
      scope={scope}
      target={target}
      keyProjectId={projectId ?? null}
      canSwitchKey={false}
    />
  );
}
