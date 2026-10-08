import type {
  PluginButtonContentProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { useAgent, usePaseo, useRpc, useSettings } from "@getpaseo/plugin/client";
import { ScrollView, TextInput, useToast } from "@getpaseo/plugin/client/react-native";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { type ComponentType, useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { deriveActivity, type TimelineItemLike } from "../shared/activity";
import { searchIssuesRpc } from "../shared/issues";
import { syncNowRpc } from "../shared/live";
import { AGENT_LABELS, isInternalAgent } from "../shared/prompts";
import { accessRpc, linearSettings, projectEnabled } from "../shared/settings";
import { progressByKey } from "../shared/todo-sync";
import { currentAccess, onAccessChange, publishAccess } from "./access";
import { KeyScopeProvider } from "./key-scope";
import { MONO } from "./live-issues";
import { useIssue } from "./queries";
import { focusIssue, panelScope } from "./store";
import { Button, errorMessage, StateIcon, type Theme } from "./ui";

type Agent = Awaited<
  ReturnType<PluginClientContext["paseo"]["agents"]["list"]>
>["entries"][number]["agent"];

const ACCESS_POLL_MS = 60_000;

// Paseo marks delegated sub-agents with this label; they share the parent's composer.
const PARENT_LABEL = "paseo.parent-agent-id";

type ContentProps = PluginButtonContentProps & { context: "agent"; agentId: string };
type Open = (panel: string, workspaceId: string, agentId?: string) => void;

function asAgentContent(Component: ComponentType<ContentProps>) {
  return function AgentContent(props: PluginButtonContentProps) {
    return props.context === "agent" ? <Component {...props} /> : null;
  };
}

function useTodos(agentId: string, cwd: string) {
  const paseo = usePaseo();
  return useQuery({
    queryKey: ["linear", "pill-todos", agentId],
    queryFn: async () => {
      const page = await paseo.agents
        .ref(agentId)
        .timeline.refetch({ direction: "tail", limit: 200, projection: "projected" });
      const items = page.entries.map((entry) => entry.item as unknown as TimelineItemLike);
      return deriveActivity(items, cwd).todos;
    },
    refetchInterval: 5_000,
  });
}

function textStyles(theme: Theme, compact: boolean) {
  const { colors } = theme;
  return {
    body: { width: compact ? ("100%" as const) : 320, gap: 6 },
    title: { color: colors.foreground, fontSize: 13, fontWeight: "600" as const, flexShrink: 1 },
    plain: { color: colors.foreground, fontSize: 13, flex: 1, minWidth: 0 },
    child: { color: colors.foreground, fontSize: 12, flex: 1 },
    // Keys never wrap, and a fixed column lines the titles up.
    key: { color: colors.foregroundMuted, fontSize: 12, fontFamily: MONO, flexShrink: 0, minWidth: 64 },
    muted: { color: colors.foregroundMuted, fontSize: 12 },
    danger: { color: colors.statusDanger, fontSize: 12 },
    row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8, paddingVertical: 5 },
    track: { width: 40, height: 3, borderRadius: 2, backgroundColor: colors.border },
    fill: { height: 3, borderRadius: 2, backgroundColor: colors.accent },
    actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6, paddingTop: 4 },
    list: { maxHeight: 240 },
    option: { borderRadius: 6, paddingHorizontal: 6 },
  };
}

function LinkedIssue(props: ContentProps & { open: Open }) {
  const { theme, layout, agentId, workspaceId, close, open } = props;
  const identifier = useAgent(agentId, (agent) => agent.labels[AGENT_LABELS.issue] ?? null);
  const cwd = useAgent(agentId, (agent) => agent.cwd);
  const settings = useSettings(linearSettings);
  const issue = useIssue(identifier);
  const todos = useTodos(agentId, cwd ?? "");
  const sync = useRpc(syncNowRpc);
  const toast = useToast();
  const syncNow = useMutation({
    mutationFn: () => sync({ agentId }),
    onSuccess: ({ moves, skipped }) => {
      const message = moves.length
        ? `Moved ${moves.map((move) => `${move.identifier} to ${move.to.name}`).join(", ")}`
        : (skipped ?? "Linear is already up to date");
      toast.show(message, { variant: moves.length ? "success" : "default" });
      void issue.refetch();
    },
  });
  const styles = useMemo(() => textStyles(theme, layout.compact), [theme, layout.compact]);
  const progress = useMemo(() => progressByKey(todos.data ?? []), [todos.data]);
  const live = settings.status === "ready" && settings.values.live;
  if (!identifier) return null;
  const data = issue.data;
  return (
    <View style={styles.body}>
      <View style={styles.row}>
        {data ? <StateIcon state={data.state} size={16} /> : null}
        <Text style={styles.key}>{identifier}</Text>
        <Text numberOfLines={1} style={styles.title}>
          {data?.title ?? (issue.isError ? "Issue unavailable" : "Loading…")}
        </Text>
      </View>
      {issue.isError ? <Text style={styles.danger}>{errorMessage(issue.error)}</Text> : null}
      <ScrollView style={styles.list}>
        {(data?.children ?? []).map((child) => {
          const entry = progress.get(child.identifier.toUpperCase());
          const ratio = entry ? entry.completed / entry.total : 0;
          return (
            <View key={child.id} style={styles.row}>
              <StateIcon state={child.state} size={14} />
              <Text numberOfLines={1} style={styles.key}>
                {child.identifier}
              </Text>
              <Text numberOfLines={1} style={styles.child}>
                {child.title}
              </Text>
              <View style={styles.track}>
                <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
              </View>
            </View>
          );
        })}
      </ScrollView>
      <View style={styles.actions}>
        {live && live.enabled ? (
          <Button
            theme={theme}
            size="xs"
            icon="Radar"
            label="Open Linear Live"
            onPress={() => {
              close();
              open("live", workspaceId, agentId);
            }}
          />
        ) : null}
        <Button
          theme={theme}
          size="xs"
          icon="SquareKanban"
          label="Open issue"
          onPress={() => {
            focusIssue(panelScope(workspaceId), identifier);
            close();
            open("issues", workspaceId);
          }}
        />
        {live && live.syncTodos ? (
          <Button
            theme={theme}
            size="xs"
            icon="RefreshCw"
            label="Sync now"
            busy={syncNow.isPending}
            onPress={() => syncNow.mutate()}
          />
        ) : null}
      </View>
      {syncNow.error ? <Text style={styles.danger}>{errorMessage(syncNow.error)}</Text> : null}
    </View>
  );
}

function LinkedIssueScoped(props: ContentProps & { open: Open }) {
  const project = useAgent(props.agentId, (agent) => agent.labels[AGENT_LABELS.project] ?? null);
  return (
    <KeyScopeProvider projectId={project}>
      <LinkedIssue {...props} />
    </KeyScopeProvider>
  );
}

function useDebounced(value: string, delay: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// Agents not started from an issue: find one and send its snapshot as the next message.
function SendIssue({ theme, layout, agentId, close }: ContentProps) {
  const paseo = usePaseo();
  const search = useRpc(searchIssuesRpc);
  const toast = useToast();
  const [query, setQuery] = useState("");
  const term = useDebounced(query.trim(), 250);
  const results = useQuery({
    queryKey: ["linear", "pill-search", term],
    queryFn: () => search({ query: term }),
    placeholderData: keepPreviousData,
  });
  const send = useMutation({
    mutationFn: async (item: { identifier: string; text: string }) => {
      await paseo.agents.ref(agentId).send(item.text);
      return item.identifier;
    },
    onSuccess: (identifier) => {
      toast.show(`Sent ${identifier} to the agent`, { variant: "success" });
      close();
    },
  });
  const styles = useMemo(() => textStyles(theme, layout.compact), [theme, layout.compact]);
  const input = useMemo(
    () => ({
      color: theme.colors.foreground,
      backgroundColor: theme.colors.surface2,
      borderColor: theme.colors.border,
      borderWidth: 1,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 7,
      fontSize: 13,
    }),
    [theme],
  );
  return (
    <View style={styles.body}>
      <TextInput
        accessibilityLabel="Search Linear issues"
        value={query}
        onChangeText={setQuery}
        autoFocus={!layout.compact}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Search by key or title"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={input}
      />
      {results.error ? <Text style={styles.danger}>{errorMessage(results.error)}</Text> : null}
      {send.error ? <Text style={styles.danger}>{errorMessage(send.error)}</Text> : null}
      <ScrollView keyboardShouldPersistTaps="handled" style={styles.list}>
        {(results.data?.items ?? []).slice(0, 20).map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityLabel={`Send ${item.identifier} to the agent`}
            disabled={send.isPending}
            onPress={() => send.mutate(item)}
            style={({ pressed }) => [
              styles.row,
              styles.option,
              pressed ? { backgroundColor: theme.colors.surface2 } : null,
            ]}
          >
            <Text numberOfLines={1} style={styles.key}>
              {item.identifier}
            </Text>
            <Text numberOfLines={1} style={styles.plain}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
      {results.data?.items.length === 0 ? (
        <Text style={styles.muted}>No matching issues.</Text>
      ) : null}
    </View>
  );
}

export function contributeComposerPills(client: PluginClientContext) {
  const pills = new Map<
    string,
    { registration: PluginButtonRegistration; identifier: string | null }
  >();
  const lifetime = new AbortController();
  const open: Open = (panel, workspaceId, agentId) =>
    client.openPanel(panel, agentId ? { workspaceId, agentId } : { workspaceId });
  const Linked = asAgentContent((props) => <LinkedIssueScoped {...props} open={open} />);
  const Search = asAgentContent(SendIssue);

  const agents = new Map<string, Agent>();
  const projects = new Map<string, string | null>();
  const loading = new Set<string>();
  const remove = (agentId: string) => {
    pills.get(agentId)?.registration.remove();
    pills.delete(agentId);
  };
  const applyAll = () => {
    for (const agent of agents.values()) apply(agent);
  };
  // A workspace never changes project, so each one is looked up once.
  const projectOf = (workspaceId: string): string | null | undefined => {
    if (projects.has(workspaceId)) return projects.get(workspaceId);
    if (!loading.has(workspaceId)) {
      loading.add(workspaceId);
      void client.paseo.workspaces
        .ref(workspaceId)
        .refresh()
        .then((workspace) => projects.set(workspaceId, workspace?.projectId ?? null))
        .catch(() => projects.set(workspaceId, null))
        .finally(() => {
          loading.delete(workspaceId);
          applyAll();
        });
    }
    return undefined;
  };
  const register = (agent: Agent) => {
    agents.set(agent.id, agent);
    apply(agent);
  };
  const forget = (agentId: string) => {
    agents.delete(agentId);
    remove(agentId);
  };
  const apply = (agent: Agent) => {
    if (lifetime.signal.aborted) return;
    const labels = agent.labels ?? {};
    if (!agent.workspaceId || labels[PARENT_LABEL] || isInternalAgent(labels) || agent.archivedAt) {
      remove(agent.id);
      return;
    }
    const projectId = projectOf(agent.workspaceId);
    const access = currentAccess();
    if (projectId === undefined || !access) return;
    if (!projectEnabled(access, projectId)) {
      remove(agent.id);
      return;
    }
    const identifier = labels[AGENT_LABELS.issue] ?? null;
    if (pills.get(agent.id)?.identifier === identifier) return;
    remove(agent.id);
    const registration = client.addComposerPill({
      id: "linear",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
      button: identifier
        ? {
            title: `Linear issue ${identifier}`,
            icon: "SquareKanban",
            label: identifier,
            behavior: { kind: "popover", Content: Linked },
          }
        : {
            title: "Send a Linear issue to this agent",
            icon: "SquareKanban",
            label: "Linear",
            behavior: { kind: "popover", Content: Search },
          },
    });
    pills.set(agent.id, { registration, identifier });
  };
  const removeAll = () => {
    for (const agentId of [...pills.keys()]) remove(agentId);
  };
  // Settings screens publish switch changes at once; the poll covers other devices.
  const readAccess = () =>
    client
      .rpc(accessRpc, {})
      .then(publishAccess)
      .catch(() => undefined);
  const stopListening = onAccessChange(applyAll);
  const poll = setInterval(() => void readAccess(), ACCESS_POLL_MS);
  void readAccess();
  void client.paseo.agents
    .list({ subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      subscription.subscribe({
        snapshot: ({ entries }) => {
          removeAll();
          agents.clear();
          for (const { agent } of entries) register(agent);
          void readAccess();
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert") register(update.agent);
          else forget(update.agentId);
        },
      });
      return undefined;
    })
    .catch((error: unknown) => {
      if (!lifetime.signal.aborted) console.error("Linear pills could not watch agents", error);
    });
  return () => {
    lifetime.abort();
    clearInterval(poll);
    stopListening();
    removeAll();
  };
}
