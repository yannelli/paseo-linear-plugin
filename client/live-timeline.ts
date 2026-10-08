import { usePaseo, useRpc } from "@getpaseo/plugin/client";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";
import type { DirTouch, FileTouch, TimelineItemLike } from "../shared/activity";
import type { IssueDetail } from "../shared/linear";
import type { FileLink } from "../shared/links";
import {
  clearMapRpc,
  exploreRpc,
  type IssueMap,
  type Job,
  listFilesRpc,
  linksRpc,
  liveMapRpc,
  type SubagentLog,
  subagentLogsRpc,
  MAX_LINK_FILES,
  MAX_LIST_DIRS,
  type MapFile,
  semanticMap,
} from "../shared/live";
import { buildMapModel, type MapModel, zoneDirs } from "../shared/map-model";
import type { MappingMode } from "../shared/settings";
import { errorMessage } from "./ui";

export interface AgentTimeline {
  items: TimelineItemLike[];
  loading: boolean;
  error: string | null;
}

const TAIL_LIMIT = 400;
const MAX_ITEMS = 600;
const FLUSH_MS = 150;
const TODO_SLOT = "todo";
// Assistant text and reasoning stream per token and carry no file activity.
const SKIPPED = new Set(["assistant_message", "reasoning"]);
const INITIAL: AgentTimeline = { items: [], loading: true, error: null };

function asItem(value: unknown): TimelineItemLike | null {
  if (!value || typeof value !== "object") return null;
  return typeof (value as { type?: unknown }).type === "string"
    ? (value as TimelineItemLike)
    : null;
}

// Ordered slots: a tool call keeps its first position as later copies replace it, the single
// todo slot moves to the end on each update, and the cap drops the oldest other slot.
function createSlots() {
  const slots = new Map<string, TimelineItemLike>();
  let counter = 0;
  return {
    add(item: TimelineItemLike): boolean {
      if (SKIPPED.has(item.type)) return false;
      let key = `item:${counter++}`;
      if (item.type === "todo") {
        key = TODO_SLOT;
        slots.delete(TODO_SLOT);
      } else if (item.type === "tool_call" && typeof item.callId === "string") {
        key = `call:${item.callId}`;
      }
      slots.set(key, item);
      for (const oldest of slots.keys()) {
        if (slots.size <= MAX_ITEMS) break;
        if (oldest !== TODO_SLOT) slots.delete(oldest);
      }
      return true;
    },
    clear() {
      slots.clear();
    },
    values(): TimelineItemLike[] {
      return [...slots.values()];
    },
  };
}

function later(run: () => void, ms: number): () => void {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
}

type Paseo = ReturnType<typeof usePaseo>;
type Update = AgentTimeline | ((current: AgentTimeline) => AgentTimeline);

/** Watches one agent's tool calls and todos, batched about every 150 ms. Returns cleanup. */
function watchTimeline(paseo: Paseo, agentId: string, setState: (update: Update) => void) {
  const handle = paseo.agents.ref(agentId);
  const slots = createSlots();
  let disposed = false;
  let request = 0;
  let replay: TimelineItemLike[] | null = [];
  let cancelFlush: (() => void) | null = null;
  let streamError: string | null = null;
  setState(INITIAL);

  const flush = () => {
    cancelFlush?.();
    cancelFlush = null;
    if (!disposed) setState({ items: slots.values(), loading: false, error: streamError });
  };
  const schedule = () => {
    if (!cancelFlush) cancelFlush = later(flush, FLUSH_MS);
  };
  const fail = (message: string) => {
    if (disposed) return;
    setState((current) => ({ ...current, loading: false, error: message }));
  };
  const streamFailed = (message: string) => {
    streamError = message;
    fail(message);
  };

  // Events that arrive while the tail loads are applied again on top of it.
  const load = async () => {
    const mine = ++request;
    if (!replay) replay = [];
    try {
      const page = await handle.timeline.refetch({
        direction: "tail",
        limit: TAIL_LIMIT,
        projection: "projected",
      });
      if (disposed || mine !== request) return;
      const pending = replay ?? [];
      replay = null;
      slots.clear();
      for (const entry of page.entries) {
        const item = asItem(entry.item);
        if (item) slots.add(item);
      }
      for (const item of pending) slots.add(item);
      flush();
    } catch (error) {
      if (mine !== request) return;
      replay = null;
      fail(errorMessage(error));
    }
  };

  const subscription = handle.timeline.subscribe((event) => {
    if (disposed) return;
    const inner = event.event;
    if (inner.type === "timeline") {
      const item = asItem(inner.item);
      if (!item || !slots.add(item)) return;
      replay?.push(item);
      schedule();
    } else if (inner.type === "replacement" || inner.type === "subscription_restored") {
      streamError = null;
      replay = null;
      void load();
    } else if (inner.type === "error") {
      streamFailed(inner.error);
    }
  });

  void subscription.ready
    .catch((error: unknown) => streamFailed(errorMessage(error)))
    .then(() => {
      if (!disposed && request === 0) void load();
    });

  return () => {
    disposed = true;
    cancelFlush?.();
    subscription();
  };
}

/** Tool calls and todos of one agent, live. */
export function useAgentTimeline(agentId: string): AgentTimeline {
  const paseo = usePaseo();
  const [state, setState] = useState(INITIAL);
  useEffect(() => watchTimeline(paseo, agentId, setState), [paseo, agentId]);
  return state;
}

const NO_TIMELINES: ReadonlyMap<string, AgentTimeline> = new Map();

/** Timelines of several agents, such as a parent's child agents, keyed by agent id. */
export function useAgentTimelines(agentIds: readonly string[]): ReadonlyMap<string, AgentTimeline> {
  const paseo = usePaseo();
  const [state, setState] = useState(NO_TIMELINES);
  const key = agentIds.join(",");
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    // Keep the timelines of agents still in the list until their new watch loads, so they do not blink.
    setState((current) => new Map([...current].filter(([id]) => ids.includes(id))));
    const stops = ids.map((id) =>
      watchTimeline(paseo, id, (update) =>
        setState((current) => {
          const known = current.get(id);
          if (update === INITIAL && known) return current;
          const next = new Map(current);
          next.set(id, typeof update === "function" ? update(known ?? INITIAL) : update);
          return next;
        }),
      ),
    );
    return () => {
      for (const stop of stops) stop();
    };
  }, [paseo, key]);
  return state;
}

// Shared by the map and the panel: motion, sub-issue colors, map data, and the map model.
export const NATIVE_DRIVER = Platform.OS !== "web";
const PALETTE = ["#5e6ad2", "#26b5ce", "#f2994a", "#bb87fc", "#4cb782", "#eb5757", "#e2b93d"];

/** True until the platform answers, so nothing animates for someone who asked for less. */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(true);
  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((value) => active && setReduced(value))
      .catch(() => active && setReduced(false));
    return () => {
      active = false;
    };
  }, []);
  return reduced;
}

export type OwnerColors = ReadonlyMap<string, string>;

/** The parent gets the accent; each sub-issue gets a palette color by its position. */
export function ownerColors(issue: IssueDetail, accent: string): OwnerColors {
  const colors = new Map([[issue.identifier.toUpperCase(), accent]]);
  issue.children.forEach((child, index) => {
    colors.set(child.identifier.toUpperCase(), PALETTE[index % PALETTE.length] ?? accent);
  });
  return colors;
}

// Map data: the stored map, else one from the ticket text. Polls fast while an explore job
// runs, and slowly while there is no map, since a launch can start a job after this mounts.
export interface LiveMap {
  map: IssueMap;
  stored: boolean;
  /** The stored map has been read once, so the map no longer swaps from the fallback. */
  ready: boolean;
  job: Job | null;
  starting: boolean;
  error: string | null;
  explore(force: boolean): void;
  /** Reads the map, folder listings, links, and subagents again. */
  refresh(): void;
  /** Forgets the saved explore map; the map falls back to the ticket text. */
  clear(): void;
  clearing: boolean;
}

export function useLiveMap(
  agentId: string,
  identifier: string,
  issue: IssueDetail,
  mapping: MappingMode,
): LiveMap {
  const read = useRpc(liveMapRpc);
  const start = useRpc(exploreRpc);
  const query = useQuery({
    queryKey: ["linear", "live", "map", identifier],
    queryFn: () => read({ identifier }),
    refetchInterval: (current) => {
      const data = current.state.data;
      if (data?.job?.status === "running") return 4_000;
      return data?.map || mapping !== "explore" ? false : 15_000;
    },
    staleTime: 10_000,
  });
  const { refetch } = query;
  const explore = useMutation({
    mutationFn: (force: boolean) => start({ agentId, force }),
    onSettled: () => void refetch(),
  });
  const { mutate } = explore;
  const queries = useQueryClient();
  const refresh = useCallback(() => void queries.invalidateQueries({ queryKey: ["linear", "live"] }), [queries]);
  const clearMap = useRpc(clearMapRpc);
  const clear = useMutation({ mutationFn: () => clearMap({ agentId }), onSettled: refresh });
  const fallback = useMemo(() => semanticMap(issue), [issue]);
  const stored = query.data?.map ?? null;
  const failure = explore.error ?? clear.error ?? query.error;
  return {
    map: stored ?? fallback,
    stored: stored !== null,
    ready: query.data !== undefined || query.isError,
    job: query.data?.job ?? null,
    starting: explore.isPending,
    error: failure ? errorMessage(failure) : null,
    explore: mutate,
    refresh,
    clear: clear.mutate as () => void,
    clearing: clear.isPending,
  };
}

const NO_LISTING: ReadonlyMap<string, readonly string[]> = new Map();

export function useMapModel(
  agentId: string,
  files: readonly MapFile[],
  touches: readonly FileTouch[],
  explored: readonly DirTouch[],
): MapModel & { ready: boolean } {
  const list = useRpc(listFilesRpc);
  const dirs = useMemo(
    () => zoneDirs(files, touches).slice(0, MAX_LIST_DIRS).sort(),
    [files, touches],
  );
  const listing = useQuery({
    queryKey: ["linear", "live", "files", agentId, dirs],
    queryFn: () => list({ agentId, dirs }),
    enabled: dirs.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  const byDir = useMemo(() => {
    if (!listing.data) return NO_LISTING;
    return new Map(listing.data.dirs.map((entry) => [entry.dir, entry.files]));
  }, [listing.data]);
  const ready = dirs.length === 0 || listing.data !== undefined || listing.isError;
  return useMemo(
    () => ({ ...buildMapModel(files, touches, byDir, explored), ready }),
    [files, touches, byDir, explored, ready],
  );
}

const NO_LINKS: readonly FileLink[] = [];

/** Links between the graph's files. `version` changes when files change, to read them again. */
export function useFileLinks(
  agentId: string,
  files: readonly string[],
  version: number,
  enabled: boolean,
): { links: readonly FileLink[]; ready: boolean } {
  const read = useRpc(linksRpc);
  const sorted = useMemo(() => [...files].sort().slice(0, MAX_LINK_FILES), [files]);
  const query = useQuery({
    queryKey: ["linear", "live", "links", agentId, sorted, version],
    queryFn: () => read({ agentId, files: sorted }),
    enabled: enabled && sorted.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
  return {
    links: query.data?.links ?? NO_LINKS,
    // With no files or a failed read the graph shows without links rather than waiting.
    ready: sorted.length === 0 || query.data !== undefined || query.isError,
  };
}

const NO_RUNS: readonly SubagentLog[] = [];

/** Tool calls of the agent's subagents, read again every few seconds while the agent works. */
export function useSubagentLogs(
  agentId: string,
  enabled: boolean,
  polling: boolean,
): { runs: readonly SubagentLog[]; checkedAt: number } {
  const read = useRpc(subagentLogsRpc);
  const query = useQuery({
    queryKey: ["linear", "live", "subagents", agentId],
    queryFn: () => read({ agentId }),
    enabled,
    refetchInterval: polling ? 3_000 : false,
    placeholderData: keepPreviousData,
    staleTime: 2_000,
  });
  return { runs: query.data?.runs ?? NO_RUNS, checkedAt: query.dataUpdatedAt };
}
