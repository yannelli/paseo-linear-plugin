import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { SubagentLog } from "../shared/live";

// Claude writes each subagent's transcript beside the session, also for subagents that run in
// the background and send nothing to the parent timeline. This reads their tool calls and turns
// them into timeline items the panel already understands. Nothing here writes or runs anything.

const SESSION_ID = /^[A-Za-z0-9-]{8,80}$/;
const MAX_RUNS = 8;
const MAX_TAIL_BYTES = 512 * 1024;
const MAX_ITEMS = 120;

/** Folders that can hold Claude's `projects` folder: the env setting, the default, Paseo homes. */
async function claudeHomes(): Promise<string[]> {
  const homes = [process.env.CLAUDE_CONFIG_DIR, path.join(homedir(), ".claude")];
  const paseoHome = process.env.PASEO_HOME || path.join(homedir(), ".paseo");
  const accounts = await readdir(path.join(paseoHome, "zerosub", "homes")).catch(() => []);
  for (const name of accounts) homes.push(path.join(paseoHome, "zerosub", "homes", name));
  return [...new Set(homes.filter((home): home is string => Boolean(home)))];
}

const found = new Map<string, string>();

async function isDirectory(target: string): Promise<boolean> {
  return (await stat(target).catch(() => null))?.isDirectory() ?? false;
}

/** The session's `subagents` folder. Claude names the project folder after the cwd. */
export async function subagentFolder(sessionId: string, cwd: string): Promise<string | null> {
  if (!SESSION_ID.test(sessionId)) return null;
  const known = found.get(sessionId);
  if (known) return known;
  const slug = cwd.replace(/[^A-Za-z0-9]/g, "-");
  for (const home of await claudeHomes()) {
    const projects = path.join(home, "projects");
    const guess = path.join(projects, slug, sessionId, "subagents");
    const names = (await isDirectory(guess)) ? [slug] : await readdir(projects).catch(() => []);
    for (const name of names) {
      const folder = path.join(projects, name, sessionId, "subagents");
      if (await isDirectory(folder)) {
        found.set(sessionId, folder);
        return folder;
      }
    }
  }
  return null;
}

async function tail(file: string): Promise<string> {
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - MAX_TAIL_BYTES);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString("utf8");
    // A cut first line is not valid JSON; drop it.
    return start > 0 ? text.slice(text.indexOf("\n") + 1) : text;
  } finally {
    await handle.close();
  }
}

type Block = Record<string, unknown>;
type Item = SubagentLog["items"][number];

const str = (value: unknown) => (typeof value === "string" ? value : "");
const lines = (value: unknown) => (str(value) ? str(value).replace(/\n$/, "").split("\n").length : 0);

/** A Claude tool call as a Paseo-style tool call item, with paths moved from the worktree. */
export function toolItem(block: Block, move: (value: string) => string, cwd: string): Item {
  const input = (block.input ?? {}) as Block;
  const name = str(block.name);
  const file = move(str(input.file_path) || str(input.notebook_path));
  let detail: Record<string, unknown> = { type: "unknown" };
  if (name === "Read" && file) detail = { type: "read", filePath: file };
  else if ((name === "Edit" || name === "MultiEdit" || name === "NotebookEdit") && file) {
    const edits = Array.isArray(input.edits) ? (input.edits as Block[]) : [input];
    const added = edits.reduce((sum, edit) => sum + lines(edit.new_string ?? edit.new_source), 0);
    const removed = edits.reduce((sum, edit) => sum + lines(edit.old_string), 0);
    detail = { type: "edit", filePath: file, added, removed };
  } else if (name === "Write" && file) detail = { type: "write", filePath: file, added: lines(input.content) };
  else if (name === "Grep" || name === "Glob") detail = { type: "search", query: str(input.pattern) };
  else if (name === "Bash") detail = { type: "shell", command: move(str(input.command)), cwd };
  return { type: "tool_call", callId: str(block.id), name, status: "running", detail };
}

/** Tool calls in a transcript, newest last, with each finished call marked done or failed. */
export function transcriptItems(text: string, move: (value: string) => string, cwd: string) {
  const items = new Map<string, Item>();
  let finished = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let entry: Block;
    try {
      entry = JSON.parse(line) as Block;
    } catch {
      continue;
    }
    const message = (entry.message ?? {}) as Block;
    const content = Array.isArray(message.content) ? (message.content as Block[]) : [];
    if (entry.type === "assistant") {
      finished = message.stop_reason === "end_turn" && !content.some((block) => block.type === "tool_use");
    }
    for (const block of content) {
      if (block.type === "tool_use" && str(block.id)) items.set(str(block.id), toolItem(block, move, cwd));
      const done = block.type === "tool_result" ? items.get(str(block.tool_use_id)) : undefined;
      if (done) done.status = block.is_error ? "failed" : "completed";
    }
  }
  return { items: [...items.values()].slice(-MAX_ITEMS), finished };
}

/** The newest subagents of a Claude session, with their tool calls. */
export async function subagentLogs(sessionId: string, cwd: string): Promise<SubagentLog[]> {
  const folder = await subagentFolder(sessionId, cwd);
  if (!folder) return [];
  const names = (await readdir(folder).catch(() => [])).filter((name) => /^agent-[A-Za-z0-9]+\.jsonl$/.test(name));
  const dated = await Promise.all(
    names.map(async (name) => ({ name, at: (await stat(path.join(folder, name)).catch(() => null))?.mtimeMs ?? 0 })),
  );
  const newest = dated.sort((a, b) => b.at - a.at).slice(0, MAX_RUNS);
  const runs: SubagentLog[] = [];
  for (const { name, at } of newest) {
    const id = name.slice("agent-".length, -".jsonl".length);
    const meta = JSON.parse(
      (await readFile(path.join(folder, `agent-${id}.meta.json`), "utf8").catch(() => "{}")) || "{}",
    ) as Block;
    const worktree = str(meta.worktreePath).replace(/\/+$/, "");
    // A subagent in its own worktree sees the same repository, so its paths map onto the agent's.
    const move = (value: string) => (worktree ? value.split(worktree).join(cwd) : value);
    const { items, finished } = transcriptItems(await tail(path.join(folder, name)).catch(() => ""), move, cwd);
    runs.push({
      id,
      type: str(meta.agentType) || "Subagent",
      description: str(meta.description),
      toolUseId: str(meta.toolUseId) || null,
      updatedAt: Math.round(at),
      finished,
      items,
    });
  }
  return runs;
}
