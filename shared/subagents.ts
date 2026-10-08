import { pathsIn } from "./live";

// Subagents that run inside the provider (Claude's Agent tool, Codex sub-agents) report only
// a type, a description, and while the launch streams, the prompt. Their own file reads never
// reach the parent timeline, so the files their prompt names are the best clue to their place.

export type SubagentStatus = "running" | "completed" | "failed" | "canceled";

export interface SubagentRun {
  /** Type and description, the same for the launch call and the subagent item. */
  key: string;
  type: string;
  description: string;
  status: SubagentStatus;
  /** Repo-relative files and folders its prompt or description names. */
  targets: string[];
  order: number;
}

export interface SubagentSignal {
  key: string;
  type: string;
  description: string;
  /** Null for the launch call: it completes as soon as the subagent starts in the background. */
  status: SubagentStatus | null;
  targets: string[];
}

type ToolItem = Readonly<Record<string, unknown>>;

const LAUNCHERS = new Set(["Agent", "Task"]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function statusOf(value: unknown): SubagentStatus {
  return value === "failed" || value === "canceled" || value === "completed" ? value : "running";
}

/** A call that starts, reports on, or waits for a subagent. */
export function isSubagentCall(item: ToolItem): boolean {
  const detail = (item.detail ?? {}) as Record<string, unknown>;
  return detail.type === "sub_agent" || (LAUNCHERS.has(text(item.name)) && detail.type === "unknown");
}

/** The subagent a tool call starts or reports on, or null for any other call or a wait. */
export function subagentOf(
  item: ToolItem,
  resolve: (path: string) => string | null,
): SubagentSignal | null {
  const detail = (item.detail ?? {}) as Record<string, unknown>;
  let type: string;
  let description: string;
  let prompt = "";
  let status: SubagentStatus | null;
  if (detail.type === "sub_agent") {
    type = text(detail.subAgentType);
    description = text(detail.description);
    status = statusOf(item.status);
    const actions = Array.isArray(detail.actions) ? detail.actions : [];
    prompt = actions.map((action) => text((action as { summary?: unknown }).summary)).join("\n");
  } else if (LAUNCHERS.has(text(item.name)) && detail.type === "unknown") {
    const input = (detail.input ?? {}) as Record<string, unknown>;
    type = text(input.subagent_type);
    description = text(input.description);
    prompt = text(input.prompt);
    status = null;
  } else {
    return null;
  }
  if (!description && !type) return null;
  // Waiting for background agents shows as one more Agent call; it starts nothing.
  if (/^wait(ing)? (for|on)\b/i.test(description)) return null;
  const named = pathsIn(`${description}\n${prompt}`)
    .map(resolve)
    .filter((path): path is string => path !== null && path !== "");
  return {
    key: `${type}\u0000${description}`,
    type: type || "Subagent",
    description,
    status,
    targets: [...new Set(named)],
  };
}

/** Folds launch and report calls into one run per subagent, in launch order. */
export function mergeSubagent(
  runs: Map<string, SubagentRun>,
  signal: SubagentSignal,
  order: number,
): SubagentRun {
  const known = runs.get(signal.key);
  const run: SubagentRun = known ?? {
    key: signal.key,
    type: signal.type,
    description: signal.description,
    status: "running",
    targets: [],
    order,
  };
  if (signal.status) run.status = signal.status;
  run.targets = [...new Set([...run.targets, ...signal.targets])];
  runs.set(signal.key, run);
  return run;
}
