import { displayCommand, shellActivity } from "./shell-activity";
import { isSubagentCall, mergeSubagent, type SubagentRun, subagentOf } from "./subagents";
import { type TodoLike, todoKey, todoStatus } from "./todo-sync";

// Structural view of Paseo timeline items, so shared code needs no protocol import.
export interface TimelineItemLike {
  type: string;
  [key: string]: unknown;
}

export type TouchKind = "read" | "edit" | "write" | "search";
export type EventKind = TouchKind | "list" | "shell" | "agent" | "tool";
export type ToolStatus = "running" | "completed" | "failed" | "canceled";

export interface FileTouch {
  path: string;
  reads: number;
  edits: number;
  added: number;
  removed: number;
  created: boolean;
  /** Position of the last touch in the timeline. Higher is more recent. */
  order: number;
  last: TouchKind;
}

export interface ActivityEvent {
  id: string;
  kind: EventKind;
  text: string;
  /** The command as run, for shell events. */
  detail: string | null;
  path: string | null;
  /** Every file the event read or changed; `path` is the first. */
  paths: string[];
  status: ToolStatus;
  added: number;
  removed: number;
  exitCode: number | null;
}

export interface DirTouch {
  /** Folder with a trailing slash; "" is the repository root. */
  path: string;
  /** Searched recursively, not only listed. */
  deep: boolean;
  order: number;
}

/** What the agent works on now: a file, or an issue whose todo it just started. */
export type AgentFocus = { kind: "file"; path: string } | { kind: "issue"; key: string };

export interface Activity {
  focus: AgentFocus | null;
  files: FileTouch[];
  dirs: DirTouch[];
  /** Subagents started inside the provider, in launch order. */
  subagents: SubagentRun[];
  /** Newest first. */
  events: ActivityEvent[];
  current: ActivityEvent | null;
  todos: TodoLike[];
}

const MAX_EVENTS = 40;
// Bookkeeping tools: the todos already show what they do.
const HIDDEN_TOOLS = /^(Task(Create|Update|List|Get|Stop|Output)|TodoWrite|ToolSearch|advisor|task_notification)$/;

/** A repo-relative path, or null when the path is outside the agent's folder. */
export function relativePath(path: string, cwd: string): string | null {
  let value = path.trim().replace(/\\/g, "/");
  const root = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && value.startsWith(`${root}/`)) value = value.slice(root.length + 1);
  else if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return null;
  value = value.replace(/^(\.\/)+/, "");
  if (!value || value.split("/").includes("..")) return null;
  return value;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function lineCount(value: string | null): number {
  if (!value) return 0;
  return value.replace(/\n$/, "").split("\n").length;
}

function diffCounts(detail: Record<string, unknown>): { added: number; removed: number } {
  // Subagent transcripts send counts, not the text.
  if (typeof detail.added === "number") {
    return { added: detail.added, removed: typeof detail.removed === "number" ? detail.removed : 0 };
  }
  const diff = text(detail.unifiedDiff);
  if (diff) {
    let added = 0;
    let removed = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) added += 1;
      else if (line.startsWith("-") && !line.startsWith("---")) removed += 1;
    }
    return { added, removed };
  }
  return { added: lineCount(text(detail.newString)), removed: lineCount(text(detail.oldString)) };
}

function toolStatus(value: unknown): ToolStatus {
  return value === "running" || value === "failed" || value === "canceled" ? value : "completed";
}

function baseName(path: string): string {
  return path.split("/").pop() ?? path;
}

// Tool calls stream as repeated items with one callId. The last copy wins, in first position.
function latestToolCalls(items: readonly TimelineItemLike[]) {
  const order: string[] = [];
  const byId = new Map<string, TimelineItemLike>();
  const started = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.type !== "tool_call") return;
    const id = text(item.callId) ?? `index-${index}`;
    if (!byId.has(id)) {
      order.push(id);
      started.set(id, index);
    }
    byId.set(id, item);
  });
  return order.map((id) => ({ id, item: byId.get(id) as TimelineItemLike, start: started.get(id) ?? 0 }));
}

interface FocusMark {
  path: string;
  /** Index of the item where the call started. */
  at: number;
}

// The newest point at which the in-progress todo moved to another issue key.
function todoFocus(items: readonly TimelineItemLike[]): { key: string; at: number } | null {
  let focus: { key: string; at: number } | null = null;
  let active: string | null = null;
  items.forEach((item, index) => {
    if (item.type !== "todo" || !Array.isArray(item.items)) return;
    const doing = (item.items as TodoLike[]).find((todo) => todoStatus(todo) === "in_progress");
    const key = doing ? todoKey(doing.text) : null;
    if (key && key !== active) focus = { key, at: index };
    active = key;
  });
  return focus;
}

export function deriveActivity(items: readonly TimelineItemLike[], cwd: string): Activity {
  const files = new Map<string, FileTouch>();
  const dirs = new Map<string, DirTouch>();
  const events: ActivityEvent[] = [];
  const subagents = new Map<string, SubagentRun>();
  const subagentEvents = new Map<string, ActivityEvent>();
  const resolve = (path: string) => relativePath(path, cwd);
  let todos: TodoLike[] = [];
  for (const item of items) {
    if (item.type === "todo" && Array.isArray(item.items)) todos = item.items as TodoLike[];
  }
  const touch = (path: string, kind: TouchKind, order: number) => {
    const entry = files.get(path) ?? {
      path,
      reads: 0,
      edits: 0,
      added: 0,
      removed: 0,
      created: false,
      order,
      last: kind,
    };
    entry.order = order;
    entry.last = kind;
    files.set(path, entry);
    return entry;
  };

  let fileFocus: FocusMark | null = null;
  let runningFocus: FocusMark | null = null;
  latestToolCalls(items).forEach(({ id, item, start }, order) => {
    if (HIDDEN_TOOLS.test(text(item.name) ?? "")) return;
    const signal = subagentOf(item, resolve);
    if (!signal && isSubagentCall(item)) return;
    if (signal) {
      // The launch call and the subagent item are one run, so they make one feed row.
      const run = mergeSubagent(subagents, signal, order);
      const known = subagentEvents.get(run.key);
      const row: ActivityEvent = known ?? {
        id,
        kind: "agent",
        text: run.description ? `${run.type}: ${run.description}` : run.type,
        detail: null,
        path: null,
        paths: [],
        status: run.status,
        added: 0,
        removed: 0,
        exitCode: null,
      };
      row.status = run.status;
      row.paths = run.targets;
      row.path = run.targets[0] ?? null;
      if (!known) {
        subagentEvents.set(run.key, row);
        events.push(row);
      }
      return;
    }
    const detail = (item.detail ?? {}) as Record<string, unknown>;
    const status = toolStatus(item.status);
    const event: ActivityEvent = {
      id,
      kind: "tool",
      text: text(item.name) ?? "Tool call",
      detail: null,
      path: null,
      paths: [],
      status,
      added: 0,
      removed: 0,
      exitCode: null,
    };
    const raw = text(detail.filePath);
    const path = raw ? relativePath(raw, cwd) : null;
    if (path) event.paths = [path];
    if (detail.type === "read" && raw) {
      event.kind = "read";
      event.path = path;
      event.text = `Read ${path ?? baseName(raw)}`;
      if (path) touch(path, "read", order).reads += 1;
    } else if ((detail.type === "edit" || detail.type === "write") && raw) {
      const write = detail.type === "write";
      const counts = write && typeof detail.added !== "number"
        ? { added: lineCount(text(detail.content)), removed: 0 }
        : diffCounts(detail);
      event.kind = write ? "write" : "edit";
      event.path = path;
      event.added = counts.added;
      event.removed = counts.removed;
      event.text = `${write ? "Wrote" : "Edited"} ${path ?? baseName(raw)}`;
      if (path && status !== "failed") {
        const entry = touch(path, event.kind, order);
        entry.edits += 1;
        entry.added += counts.added;
        entry.removed += counts.removed;
        if (write && entry.reads === 0 && entry.edits === 1) entry.created = true;
      }
    } else if (detail.type === "search") {
      event.kind = "search";
      event.text = `Searched ${JSON.stringify(text(detail.query) ?? "")}`;
      const hits = Array.isArray(detail.filePaths) ? detail.filePaths : [];
      for (const hit of hits) {
        const hitPath = typeof hit === "string" ? relativePath(hit, cwd) : null;
        if (hitPath && !files.has(hitPath)) touch(hitPath, "search", order);
      }
    } else if (detail.type === "shell") {
      const command = text(detail.command) ?? "";
      const start = relativePath(text(detail.cwd) ?? "", cwd) ?? "";
      const shell = shellActivity(command, cwd, start);
      event.exitCode = typeof detail.exitCode === "number" ? detail.exitCode : null;
      event.detail = displayCommand(command, cwd);
      event.text = shell.summary;
      event.paths = [...shell.writes.map((write) => write.path), ...shell.reads];
      event.path = event.paths[0] ?? null;
      event.kind = "shell";
      if (shell.writes.length > 0) event.kind = "write";
      else if (shell.reads.length > 0) event.kind = "read";
      else if (shell.pattern !== null) event.kind = "search";
      else if (shell.dirs.length > 0) event.kind = "list";
      for (const read of shell.reads) touch(read, "read", order).reads += 1;
      // A failed write may not have happened; reads count either way, as grep exits 1 on no match.
      const succeeded = status === "completed" && (event.exitCode ?? 0) === 0;
      for (const write of succeeded ? shell.writes : []) {
        const entry = touch(write.path, write.mode, order);
        entry.edits += 1;
        if (write.mode === "write" && entry.reads === 0 && entry.edits === 1) entry.created = true;
      }
      for (const dir of shell.dirs) {
        const known = dirs.get(dir.path);
        dirs.set(dir.path, { path: dir.path, deep: dir.deep || (known?.deep ?? false), order });
      }
    }
    const lead = event.path ?? event.paths[0];
    if (lead && (event.kind === "read" || event.kind === "edit" || event.kind === "write")) {
      if (!fileFocus || start >= fileFocus.at) fileFocus = { path: lead, at: start };
      if (status === "running" && (!runningFocus || start >= runningFocus.at)) runningFocus = { path: lead, at: start };
    }
    events.push(event);
  });

  const recent = events.slice(-MAX_EVENTS).reverse();
  const current = recent.find((event) => event.status === "running") ?? recent[0] ?? null;
  // A running call wins; otherwise the newer of the last file and the last todo change.
  const issueFocus = todoFocus(items);
  const lastFile = fileFocus as FocusMark | null;
  const running = runningFocus as FocusMark | null;
  let focus: AgentFocus | null = null;
  if (running) focus = { kind: "file", path: running.path };
  else if (issueFocus && (!lastFile || issueFocus.at > lastFile.at)) focus = { kind: "issue", key: issueFocus.key };
  else if (lastFile) focus = { kind: "file", path: lastFile.path };
  return {
    focus,
    files: [...files.values()].sort((a, b) => b.order - a.order),
    dirs: [...dirs.values()],
    subagents: [...subagents.values()],
    events: recent,
    current,
    todos,
  };
}
