import {
  type PluginSurfaceProps,
  type PluginWorkspacePanelProps,
  useSettings,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type LayoutChangeEvent, View } from "react-native";
import { linearSettings } from "../shared/settings";
import { ConnectCard } from "./connect";
import { CreateIssueModal } from "./create-issue";
import { IssueDetailView } from "./issue-detail";
import { IssueList } from "./issue-list";
import type { LaunchTarget } from "./launch";
import { useAuthStatus, useCatalog } from "./queries";
import { panelScope, SCREEN_SCOPE, useBrowserState } from "./store";
import { Button, EmptyState, errorMessage, type Theme } from "./ui";

const SPLIT_WIDTH = 820;
const NARROW_WIDTH = 560;
const SCREEN_TARGET: LaunchTarget = { workspaceId: null };

interface BrowserProps {
  theme: Theme;
  compact: boolean;
  navigation: PluginSurfaceProps["navigation"];
  scope: string;
  target: LaunchTarget;
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
  const configured = auth.data?.configured === true;
  const catalog = useCatalog(configured);
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
  if (!configured) return <ConnectCard theme={theme} compact={props.compact} />;
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

function ConnectedBrowser(props: BrowserProps & { catalog: Catalog }) {
  const { theme, catalog } = props;
  const { colors } = theme;
  const [state, update] = useBrowserState(props.scope);
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
  return (
    <IssueBrowser
      theme={theme}
      compact={layout.compact}
      navigation={navigation}
      scope={SCREEN_SCOPE}
      target={SCREEN_TARGET}
    />
  );
}

const selectProjectId = (workspace: { projectId: string }) => workspace.projectId;

export function LinearPanel({ theme, layout, navigation, workspaceId }: PluginWorkspacePanelProps) {
  const scope = panelScope(workspaceId);
  const projectId = useWorkspace(workspaceId, selectProjectId);
  const settings = useSettings(linearSettings);
  const [, update] = useBrowserState(scope);
  const seeded = useRef(false);
  const target = useMemo(() => ({ workspaceId }), [workspaceId]);
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
    />
  );
}
