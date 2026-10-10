import { randomUUID } from "node:crypto";
import type { PluginHandlerContext, PluginLifecycleEvents } from "@getpaseo/plugin/server";
import { type ZodType, z } from "zod";
import type { Job } from "../shared/project-setup";

// Project setup runs a read-only agent, waits for it in the background, and reads a JSON
// answer from its last message. Claude ignores outputSchema, so the prompt asks for JSON.

export type Paseo = PluginHandlerContext["paseo"];
type WorkspaceHandle = Awaited<ReturnType<Paseo["workspaces"]["open"]>>;
type AgentHandle = ReturnType<Paseo["agents"]["ref"]>;
export type PermissionRequest = PluginLifecycleEvents["agent.permission_requested"]["request"];
export type PermissionAnswer = Parameters<AgentHandle["respondToPermission"]>[0]["response"];

export interface InternalRun<T> {
  paseo: Paseo;
  workspace: WorkspaceHandle;
  /** Folder the agent works in; its reads must stay inside. */
  cwd: string;
  provider: string;
  title: string;
  prompt: string;
  labels: Record<string, string>;
  schema: ZodType<T>;
  timeoutMs: number;
}

interface SnapshotEntry {
  provider: string;
  status: string;
  enabled?: boolean;
  modes?: readonly { id: string; label?: string }[];
}

const SAFE_MODES = [/read.?only/i, /^default$/i, /ask/i];
const UNSAFE_MODE = /bypass|full|yolo|danger/i;

// Never inherit a provider default that skips approvals. Claude's "default" asks before
// edits, so an edit attempt stops the run. Codex has no read-only mode; "auto" asks on request.
export function safeModeId(modes: SnapshotEntry["modes"]): string | undefined {
  for (const pattern of SAFE_MODES) {
    const match = modes?.find((mode) => pattern.test(mode.id));
    if (match) return match.id;
  }
  return modes?.find((mode) => !UNSAFE_MODE.test(`${mode.id} ${mode.label ?? ""}`))?.id;
}

const UNSUPPORTED_KEYWORDS = new Set([
  "$schema",
  "default",
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
]);

/** JSON schema for strict structured output: every property required, no extras. */
export function strictJsonSchema(schema: ZodType): Record<string, unknown> {
  const strip = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strip);
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(
      Object.entries(node)
        .filter(([key]) => !UNSUPPORTED_KEYWORDS.has(key))
        .map(([key, value]) => [key, strip(value)]),
    );
  };
  return strip(z.toJSONSchema(schema, { io: "output" })) as Record<string, unknown>;
}

// Some Claude builds search only through the shell, so internal agents may run a short list of
// commands that read. Anything that writes, runs other programs, or leaves the folder is denied.
const READ_COMMAND = /^(?:ls|find|rg|grep|cat|head|tail|wc|pwd|git (?:ls-files|grep))(?:\s|$)/;
const UNSAFE_SHELL =
  /[`;&<>~$\n\r]|\.\.|\s-(?:exec|execdir|ok|okdir|delete|fprint\w*|fls|O)\b|\s--(?:pre|open-files-in-pager)\b/;
/** Quoted text the shell does not expand: single quotes, or double quotes without $ or `. */
const LITERAL = /'[^']*'|"[^"$`\\]*"/g;

/** The path relative to the folder, or null when it leaves the folder. */
function relativePath(filePath: string, cwd: string): string | null {
  let value = filePath.trim().replace(/\\/g, "/");
  const root = cwd.trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (root && value.startsWith(`${root}/`)) value = value.slice(root.length + 1);
  else if (value.startsWith("/") || /^[A-Za-z]:\//.test(value)) return null;
  value = value.replace(/^(\.\/)+/, "");
  if (!value || value.split("/").includes("..")) return null;
  return value;
}

function insideFolder(filePath: string, cwd: string): boolean {
  return filePath.replace(/\/+$/, "") === cwd.replace(/\/+$/, "") || relativePath(filePath, cwd) !== null;
}

export function readOnlyCommand(command: string, cwd: string): boolean {
  const text = command.replace(/\s2>\s*\/dev\/null/g, " ").trim();
  const bare = text.replace(LITERAL, "Q");
  if (!bare || UNSAFE_SHELL.test(bare)) return false;
  const outside = text.split(/\s+|=/).some((word) => {
    const filePath = word.replace(/['"]/g, "");
    return filePath.startsWith("/") && !insideFolder(filePath, cwd);
  });
  return !outside && bare.split("|").every((part) => READ_COMMAND.test(part.trim()));
}

/** Prompt lines that match what readOnlyAnswer allows. */
export const READ_ONLY_RULES = [
  "Read and search only. Do not create, edit, or delete files.",
  "To find files, use your read and search tools, or these shell commands, one at a time and",
  "without redirection: ls, find, rg, grep, cat, head, tail, wc, git ls-files, git grep.",
  "Keep paths inside this folder. Other commands are denied.",
  "Work alone: do not start subagents or background tasks.",
];

const DENIED =
  "Not allowed in this read-only run. Read and search files in this repository only, one " +
  "command at a time, without redirection.";

/** No one watches internal agents, so the plugin answers their prompts: reads yes, else no. */
export function readOnlyAnswer(request: PermissionRequest, cwd: string): PermissionAnswer {
  if (request.kind === "question") {
    return { behavior: "deny", message: "No one can answer here. Decide yourself and continue." };
  }
  const detail = request.detail;
  const command =
    detail?.type === "shell" ? detail.command : (request.input as { command?: unknown })?.command;
  const allowed =
    request.kind === "tool" &&
    ((detail?.type === "read" && insideFolder(detail.filePath, cwd)) ||
      (detail?.type === "search" && detail.toolName !== "web_search") ||
      (typeof command === "string" && readOnlyCommand(command, cwd)));
  return allowed ? { behavior: "allow" } : { behavior: "deny", message: DENIED };
}

function entriesOf(snapshot: unknown): readonly SnapshotEntry[] {
  const value = snapshot as {
    entries?: readonly SnapshotEntry[];
    compactSnapshot?: { entries?: readonly SnapshotEntry[] } | null;
  };
  const entries = value.entries ?? [];
  return entries.length > 0 ? entries : (value.compactSnapshot?.entries ?? []);
}

/** Uses `preferred` (`provider` or `provider/model`) when ready, else the first ready provider. */
export async function agentConfigFor(paseo: Paseo, preferred: string) {
  const entries = entriesOf(await paseo.providers.snapshot()).filter(
    (entry) => entry.status === "ready" && entry.enabled !== false,
  );
  const wanted = preferred.split("/")[0] ?? "";
  const entry = entries.find((candidate) => candidate.provider === wanted) ?? entries[0];
  if (!entry) throw new Error("No agent provider is ready on this host");
  const provider = entry.provider === wanted && preferred.includes("/") ? preferred : entry.provider;
  const modeId = safeModeId(entry.modes);
  return { provider, ...(modeId ? { modeId } : {}) };
}

/** Parses the last JSON object in an agent reply: a fenced block, the whole text, or braces. */
export function lastJsonObject(reply: string): unknown {
  const fences = [...reply.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].reverse();
  const candidates = [...fences.map((match) => match[1] ?? ""), reply.trim()];
  const start = reply.indexOf("{");
  const end = reply.lastIndexOf("}");
  if (start >= 0 && end > start) candidates.push(reply.slice(start, end + 1));
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // Not JSON; try the next candidate.
    }
  }
  return null;
}

export async function lastReply(handle: AgentHandle) {
  const page = await handle.timeline.refetch({
    direction: "tail",
    limit: 60,
    projection: "projected",
  });
  for (const entry of [...page.entries].reverse()) {
    const item = entry.item as { type: string; text?: unknown };
    if (item.type === "assistant_message" && typeof item.text === "string") return item.text;
  }
  return "";
}

const MAX_STALLS = 20;
const STALL_DELAY_MS = 500;

// waitForFinish also returns when the agent asks for permission, so answer and keep waiting.
// A prompt is answered once; while the daemon applies an answer, the loop waits briefly.
export async function waitUntilIdle(handle: AgentHandle, cwd: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  const answered = new Set<string>();
  let stalls = 0;
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("The agent did not finish in time");
    const finish = await handle.waitForFinish(remaining);
    if (finish.status === "idle") return;
    if (finish.status !== "permission") {
      throw new Error(finish.error ?? `The agent stopped with status ${finish.status}`);
    }
    const unanswered = (requests: readonly PermissionRequest[] | null | undefined) =>
      (requests ?? []).filter((request) => !answered.has(request.id));
    let pending = unanswered(finish.final?.pendingPermissions);
    if (pending.length === 0) {
      await handle.refresh();
      pending = unanswered(handle.pendingPermissions);
    }
    if (pending.length === 0) {
      stalls += 1;
      if (answered.size === 0 || stalls > MAX_STALLS) {
        throw new Error("The agent is waiting for input");
      }
      await new Promise((resolve) => setTimeout(resolve, STALL_DELAY_MS));
      continue;
    }
    stalls = 0;
    for (const request of pending) {
      answered.add(request.id);
      await handle
        .respondToPermission({ requestId: request.id, response: readOnlyAnswer(request, cwd) })
        .catch((error: unknown) => console.error("Linear could not answer a permission", error));
    }
  }
}

/** Waits for an internal agent, reads its JSON answer, and archives it either way. */
async function finishInternalRun<T>(
  handle: AgentHandle,
  cwd: string,
  schema: ZodType<T>,
  timeoutMs: number,
): Promise<T> {
  try {
    await waitUntilIdle(handle, cwd, timeoutMs);
    const parsed = schema.safeParse(lastJsonObject(await lastReply(handle)));
    if (!parsed.success) throw new Error("The agent did not return the expected JSON");
    return parsed.data;
  } finally {
    await handle.archive().catch(() => undefined);
  }
}

export interface StartedRun<T> {
  agentId: string;
  result: Promise<T>;
}

export async function startInternalRun<T>(run: InternalRun<T>): Promise<StartedRun<T>> {
  const config = await agentConfigFor(run.paseo, run.provider);
  const handle = await run.workspace.agents.create({
    config,
    title: run.title,
    prompt: run.prompt,
    labels: run.labels,
    outputSchema: strictJsonSchema(run.schema),
  });
  const result = finishInternalRun(handle, run.cwd, run.schema, run.timeoutMs);
  return { agentId: handle.id, result };
}

export interface JobStore<T> {
  get(id: string): { job: Job; value: T | null } | null;
  start(begin: () => Promise<StartedRun<T>>): Promise<Job>;
}

export function createJobStore<T>(): JobStore<T> {
  const jobs = new Map<string, { job: Job; value: T | null }>();
  return {
    get: (id) => jobs.get(id) ?? null,
    async start(begin) {
      const record: { job: Job; value: T | null } = {
        job: { id: randomUUID(), status: "running", agentId: null, error: null, startedAt: new Date().toISOString() },
        value: null,
      };
      jobs.set(record.job.id, record);
      const fail = (error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        record.job = { ...record.job, status: "failed", error: message };
      };
      try {
        const started = await begin();
        record.job = { ...record.job, agentId: started.agentId };
        started.result.then((value) => {
          record.value = value;
          record.job = { ...record.job, status: "done" };
        }, fail);
      } catch (error) {
        fail(error);
      }
      return record.job;
    },
  };
}
