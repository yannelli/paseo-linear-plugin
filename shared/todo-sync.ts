import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { type WorkflowState, WorkflowStateSchema } from "./linear";

// Claude and Codex todos share one timeline shape. Codex ids are list positions, so todos
// map to issues by a key prefix in their text, such as "ENG-124: add the queue".

export type TodoStatus = "pending" | "in_progress" | "completed";

export interface TodoLike {
  text: string;
  completed: boolean;
  status?: TodoStatus;
}

export interface KeyProgress {
  key: string;
  total: number;
  completed: number;
  inProgress: number;
}

const KEY_PREFIX =
  /^\s*(?:[-*]\s+)?(?:\[([A-Za-z][A-Za-z0-9]*-\d+)\]\s*:?|([A-Za-z][A-Za-z0-9]*-\d+)\s*(?::|-\s))/;

/** The agent's latest todo list in its timeline, or null when it has none. */
export function latestTodos(items: readonly { type: string; items?: unknown }[]): TodoLike[] | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item?.type === "todo" && Array.isArray(item.items)) return item.items as TodoLike[];
  }
  return null;
}

function todoStatus(item: TodoLike): TodoStatus {
  return item.status ?? (item.completed ? "completed" : "pending");
}

export function todoKey(text: string): string | null {
  const match = KEY_PREFIX.exec(text);
  const key = match?.[1] ?? match?.[2];
  return key ? key.toUpperCase() : null;
}

export function progressByKey(items: readonly TodoLike[]): Map<string, KeyProgress> {
  const progress = new Map<string, KeyProgress>();
  for (const item of items) {
    const key = todoKey(item.text);
    if (!key) continue;
    const entry = progress.get(key) ?? { key, total: 0, completed: 0, inProgress: 0 };
    const status = todoStatus(item);
    entry.total += 1;
    if (status === "completed") entry.completed += 1;
    if (status === "in_progress") entry.inProgress += 1;
    progress.set(key, entry);
  }
  return progress;
}

export interface SyncIssue {
  id: string;
  identifier: string;
  state: WorkflowState;
}

export interface SyncInput {
  parent: SyncIssue & { children: readonly SyncIssue[] };
  progress: ReadonlyMap<string, KeyProgress>;
  /** Workflow states of the parent's team. */
  states: readonly WorkflowState[];
}

export interface StatusMove {
  issueId: string;
  identifier: string;
  from: WorkflowState;
  to: WorkflowState;
}

const RANK: Record<string, number> = {
  triage: 0,
  backlog: 0,
  unstarted: 1,
  started: 2,
  completed: 3,
};

function rank(state: WorkflowState): number | null {
  return RANK[state.type] ?? null;
}

const byPosition = (a: WorkflowState, b: WorkflowState) => a.position - b.position;

function firstOfType(states: readonly WorkflowState[], type: string, exclude?: RegExp) {
  return (
    states
      .filter((state) => state.type === type && !(exclude && exclude.test(state.name)))
      .sort(byPosition)[0] ?? null
  );
}

const REVIEW = /review/i;

export function reviewState(states: readonly WorkflowState[]): WorkflowState | null {
  return states.filter((s) => s.type === "started" && REVIEW.test(s.name)).sort(byPosition)[0] ?? null;
}

function targetFor(progress: KeyProgress | undefined): "started" | "completed" | null {
  if (!progress || progress.total === 0) return null;
  if (progress.completed === progress.total) return "completed";
  return progress.completed > 0 || progress.inProgress > 0 ? "started" : null;
}

// Forward-only moves for the parent and its direct children; a todo naming any other key is
// ignored. Canceled issues never move, and the parent stops at a review state, never Done.
export function planStatusMoves(input: SyncInput): StatusMove[] {
  const { parent, progress, states } = input;
  const known = new Set(states.map((state) => state.id));
  const started = firstOfType(states, "started", REVIEW) ?? firstOfType(states, "started");
  const completed = firstOfType(states, "completed");
  const moves: StatusMove[] = [];
  const effective = new Map<string, WorkflowState>();

  for (const child of parent.children) {
    effective.set(child.id, child.state);
    const target = targetFor(progress.get(child.identifier.toUpperCase()));
    const to = target === "completed" ? completed : target === "started" ? started : null;
    const current = rank(child.state);
    if (!to || current === null || !known.has(child.state.id)) continue;
    if ((rank(to) ?? 0) <= current) continue;
    moves.push({ issueId: child.id, identifier: child.identifier, from: child.state, to });
    effective.set(child.id, to);
  }

  const parentRank = rank(parent.state);
  if (parentRank === null || !known.has(parent.state.id)) return moves;
  const anyWork =
    moves.length > 0 ||
    targetFor(progress.get(parent.identifier.toUpperCase())) !== null ||
    parent.children.some((child) => targetFor(progress.get(child.identifier.toUpperCase())));
  const allDone =
    parent.children.length > 0 &&
    parent.children.every((child) => effective.get(child.id)?.type === "completed");
  const review = reviewState(states);
  if (allDone && review && parentRank <= RANK.started && parent.state.id !== review.id) {
    if (!(parent.state.type === "started" && REVIEW.test(parent.state.name))) {
      moves.push({ issueId: parent.id, identifier: parent.identifier, from: parent.state, to: review });
    }
  } else if (anyWork && started && parentRank < RANK.started) {
    moves.push({ issueId: parent.id, identifier: parent.identifier, from: parent.state, to: started });
  }
  return moves;
}

/** The prompt line that makes todos map to sub-issues. */
export function todoConventionLine(children: readonly { identifier: string }[]): string | null {
  const first = children[0];
  if (!first) return null;
  return [
    "Track your work with one or more todos per sub-issue.",
    `Start each todo with its sub-issue key, for example "${first.identifier}: <task>".`,
  ].join(" ");
}

export const SyncMoveSchema = z.object({
  identifier: z.string(),
  from: WorkflowStateSchema,
  to: WorkflowStateSchema,
});

export const syncNowRpc = defineRpc({
  name: "linear.sync.now",
  input: z.object({ agentId: z.string().min(1) }),
  output: z.object({ moves: z.array(SyncMoveSchema), skipped: z.string().nullable() }),
});
