import { readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { relativePath } from "../shared/activity";
import { type IssueDetail, ISSUE_CARD_KIND } from "../shared/linear";
import {
  ExploreResultSchema,
  exploreRpc,
  type IssueMap,
  type Job,
  type LaunchInput,
  launchAfterExploreRpc,
  listFilesRpc,
  liveMapRpc,
  MAX_DIR_ENTRIES,
} from "../shared/live";
import { AGENT_LABELS, issueSnapshot } from "../shared/prompts";
import { type LinearSettings, projectEnabled } from "../shared/settings";
import {
  createJobStore,
  finishInternalRun,
  type Paseo,
  READ_ONLY_RULES,
  startInternalRun,
} from "./agent-runs";
import type { LinearAccess } from "./handlers";
import type { LaunchQueue, MapStore } from "./stores";

const EXPLORE_TIMEOUT_MS = 20 * 60_000;
const RECOVER_INTERVAL_MS = 30_000;
const EXPLORE_TITLE = /^Explore ([A-Za-z][A-Za-z0-9]*-\d+)$/;
const SKIPPED_ENTRIES = new Set([".git", "node_modules", ".DS_Store"]);

export interface AgentInfo {
  id: string;
  cwd: string;
  workspaceId: string | null;
  /** Paseo project of the agent's workspace, when the workspace is known. */
  projectId: string | null;
  provider: string;
  labels: Record<string, string>;
}

export async function agentInfo(paseo: Paseo, agentId: string): Promise<AgentInfo> {
  const handle = paseo.agents.ref(agentId);
  await handle.refresh();
  const agent = handle.current();
  if (!agent) throw new Error("The agent was not found");
  const workspaceId = agent.workspaceId ?? null;
  const workspace = workspaceId
    ? await paseo.workspaces
        .ref(workspaceId)
        .refresh()
        .catch(() => null)
    : null;
  return {
    id: agent.id,
    cwd: agent.cwd,
    workspaceId,
    projectId: workspace?.projectId ?? null,
    provider: agent.provider,
    labels: agent.labels ?? {},
  };
}

// The client names directories, never a root: the root is the agent's own folder, and a
// directory that resolves outside it, through ".." or a symlink, is skipped.
export async function listDirectories(cwd: string, dirs: readonly string[]) {
  const root = await realpath(cwd);
  const results: { dir: string; files: string[]; truncated: boolean }[] = [];
  for (const dir of new Set(dirs)) {
    const relative = dir === "" ? "" : relativePath(dir, root);
    if (relative === null) continue;
    const resolved = await realpath(path.resolve(root, relative)).catch(() => null);
    if (!resolved || (resolved !== root && !resolved.startsWith(`${root}${path.sep}`))) continue;
    const entries = await readdir(resolved, { withFileTypes: true }).catch(() => []);
    const files = entries
      .filter((entry) => entry.isFile() && !SKIPPED_ENTRIES.has(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
    results.push({
      dir,
      files: files.slice(0, MAX_DIR_ENTRIES),
      truncated: files.length > MAX_DIR_ENTRIES,
    });
  }
  return results;
}

export function explorePrompt(issue: IssueDetail): string {
  const keys = [issue.identifier, ...issue.children.map((child) => child.identifier)];
  return [
    `Map this repository for Linear issue ${issue.identifier}: ${issue.title}`,
    "",
    ...READ_ONLY_RULES,
    "",
    issueSnapshot(issue, { includeComments: false }),
    "",
    "List the files an engineer will most likely read or change for this issue and each sub-issue.",
    "Include files that will probably be created, at their expected path. List at most 40 files.",
    `Set "issue" to the sub-issue key the file belongs to, or ${issue.identifier} for the whole issue.`,
    `Valid keys: ${keys.join(", ")}.`,
    "Reply with only a JSON object in a ```json block, with repo-relative paths:",
    `{"files":[{"path":"src/example.ts","issue":"${keys[1] ?? keys[0]}"}]}`,
  ].join("\n");
}

export function toIssueMap(
  issue: IssueDetail,
  cwd: string,
  result: z.infer<typeof ExploreResultSchema>,
  now = new Date(),
): IssueMap {
  const keys = new Set([issue.identifier, ...issue.children.map((child) => child.identifier)]);
  const seen = new Set<string>();
  const files: IssueMap["files"] = [];
  for (const entry of result.files) {
    const filePath = relativePath(entry.path, cwd);
    if (!filePath || seen.has(filePath)) continue;
    seen.add(filePath);
    const key = entry.issue.trim().toUpperCase();
    files.push({ path: filePath, issue: keys.has(key) ? key : issue.identifier });
  }
  return { identifier: issue.identifier, source: "explore", files, createdAt: now.toISOString() };
}

export interface LiveDependencies {
  access: LinearAccess;
  maps: MapStore;
  launches: LaunchQueue;
  readSettings(): Promise<LinearSettings | null>;
}

type WorkspaceHandle = Awaited<ReturnType<Paseo["workspaces"]["open"]>>;

/** Starts the implementing agent and attaches the issue card to its timeline. */
export async function startLaunch(workspace: WorkspaceHandle, launch: LaunchInput) {
  const agent = await workspace.agents.create(launch.agent);
  await agent.timeline
    .append({
      type: "plugin",
      id: `linear-issue-${launch.card.identifier}`,
      kind: ISSUE_CARD_KIND,
      version: 1,
      data: launch.card,
    })
    .catch((error: unknown) => console.error("Linear issue card was not attached", error));
  return agent.id;
}

export function registerLive(server: PluginServerContext, dependencies: LiveDependencies) {
  const { access, maps, launches, readSettings } = dependencies;
  const jobs = createJobStore<IssueMap>();
  const recovering = new Map<string, Promise<Job | null>>();
  const recoveredAt = new Map<string, number>();

  // Called whenever an explore run ends, by any path. Claiming first means a launch that two
  // paths see still starts one agent.
  async function startWaiting(paseo: Paseo, identifier: string) {
    for (const launch of await launches.claim(identifier)) {
      await startLaunch(paseo.workspaces.ref(launch.workspaceId), launch).catch((error: unknown) =>
        console.error(`Linear agent for ${identifier} did not start after exploring`, error),
      );
    }
  }

  function track(paseo: Paseo, job: Job) {
    void jobs.wait(job.id).then(() => startWaiting(paseo, job.id));
    return job;
  }

  function saveMap(issue: IssueDetail, cwd: string) {
    return async (value: z.infer<typeof ExploreResultSchema>) => {
      const map = toIssueMap(issue, cwd, value);
      await maps.set(map);
      return map;
    };
  }

  // A plugin reload or daemon restart drops the job but not the explore agent. Finds that
  // agent by its label and finishes the run, or starts waiting launches when there is none.
  async function adopt(paseo: Paseo, identifier: string): Promise<Job | null> {
    const { entries } = await paseo.agents.list({
      filter: { labels: { [AGENT_LABELS.explore]: identifier } },
      page: { limit: 10 },
    });
    const orphan = entries.map((entry) => entry.agent).find((agent) => !agent.archivedAt);
    if (!orphan) {
      await startWaiting(paseo, identifier);
      return null;
    }
    const job = await jobs.start(identifier, async () => {
      const { linear } = await access.connect(orphan.labels?.[AGENT_LABELS.project] ?? null);
      const issue = await linear.getIssue(identifier);
      const handle = paseo.agents.ref(orphan.id);
      const result = finishInternalRun(handle, orphan.cwd, ExploreResultSchema, EXPLORE_TIMEOUT_MS);
      return { agentId: orphan.id, result: result.then(saveMap(issue, orphan.cwd)) };
    });
    return track(paseo, job);
  }

  function recover(paseo: Paseo, identifier: string): Promise<Job | null> {
    const existing = jobs.get(identifier)?.job;
    if (existing?.status === "running") return Promise.resolve(existing);
    const inFlight = recovering.get(identifier);
    if (inFlight) return inFlight;
    recoveredAt.set(identifier, Date.now());
    const run = adopt(paseo, identifier).finally(() => recovering.delete(identifier));
    recovering.set(identifier, run);
    return run;
  }

  server.handle(listFilesRpc, async ({ agentId, dirs }, { paseo }) => {
    const agent = await agentInfo(paseo, agentId);
    return { dirs: await listDirectories(agent.cwd, dirs) };
  });

  server.handle(liveMapRpc, async ({ identifier }, { paseo }) => {
    const map = await maps.get(identifier);
    let job = jobs.get(identifier)?.job ?? null;
    const checked = recoveredAt.get(identifier) ?? 0;
    if (!map && !job && Date.now() - checked > RECOVER_INTERVAL_MS) {
      job = await recover(paseo, identifier).catch(() => null);
    }
    return { map: map ?? (await maps.get(identifier)), job };
  });

  // Finishes runs whose job a reload dropped, as soon as the agent's turn ends.
  server.on("agent.turn_ended", async (event, { paseo }) => {
    const identifier = EXPLORE_TITLE.exec(event.agent.title ?? "")?.[1];
    if (!identifier || jobs.get(identifier)?.job.status === "running") return;
    await recover(paseo, identifier).catch((error: unknown) =>
      console.error(`Linear explore run for ${identifier} was not recovered`, error),
    );
  });

  interface ExploreTarget {
    identifier: string;
    keyScope: string | null;
    cwd: string;
    /** Opened only when a new run starts. */
    workspace: () => Promise<WorkspaceHandle>;
    provider: string;
    force: boolean;
  }

  // One explore run per issue: a running job is shared, and a saved map is reused.
  async function ensureExplore(paseo: Paseo, target: ExploreTarget): Promise<Job> {
    const { identifier } = target;
    const existing = jobs.get(identifier)?.job;
    if (existing?.status === "running" || (existing?.status === "done" && !target.force)) {
      return existing;
    }
    const stored = target.force ? null : await maps.get(identifier);
    if (stored) {
      return { id: identifier, status: "done", agentId: null, error: null, startedAt: stored.createdAt };
    }
    const adopted = target.force ? null : await recover(paseo, identifier).catch(() => null);
    if (adopted?.status === "running") return adopted;
    const job = await jobs.start(identifier, async () => {
      const { linear } = await access.connect(target.keyScope);
      const issue = await linear.getIssue(identifier);
      const labels: Record<string, string> = { [AGENT_LABELS.explore]: identifier };
      if (target.keyScope) labels[AGENT_LABELS.project] = target.keyScope;
      const run = await startInternalRun({
        paseo,
        workspace: await target.workspace(),
        cwd: target.cwd,
        provider: target.provider,
        title: `Explore ${identifier}`,
        prompt: explorePrompt(issue),
        labels,
        schema: ExploreResultSchema,
        timeoutMs: EXPLORE_TIMEOUT_MS,
      });
      return { agentId: run.agentId, result: run.result.then(saveMap(issue, target.cwd)) };
    });
    return track(paseo, job);
  }
  async function requireEnabled(projectId: string | null) {
    const settings = await readSettings();
    if (settings && !projectEnabled(settings.access, projectId)) {
      throw new Error("Linear is off for this project");
    }
    return settings;
  }

  server.handle(exploreRpc, async ({ agentId, force }, { paseo }) => {
    const agent = await agentInfo(paseo, agentId);
    const identifier = agent.labels[AGENT_LABELS.issue];
    if (!identifier) throw new Error("This agent is not linked to a Linear issue");
    const settings = await requireEnabled(agent.projectId);
    const { workspaceId, cwd } = agent;
    const job = await ensureExplore(paseo, {
      identifier,
      keyScope: agent.labels[AGENT_LABELS.project] ?? null,
      cwd,
      workspace: async () =>
        workspaceId ? paseo.workspaces.ref(workspaceId) : paseo.workspaces.open(cwd),
      provider: settings?.live.exploreProvider || agent.provider,
      force,
    });
    return { job };
  });

  server.handle(launchAfterExploreRpc, async (input, { paseo }) => {
    const workspace = paseo.workspaces.ref(input.workspaceId);
    const info = await workspace.refresh();
    if (!info) throw new Error("The workspace was not found");
    const settings = await requireEnabled(info.projectId);
    const job = await ensureExplore(paseo, {
      identifier: input.identifier,
      keyScope: input.keyScope,
      cwd: info.workspaceDirectory ?? info.projectRootPath,
      workspace: async () => workspace,
      provider: settings?.live.exploreProvider || input.agent.config.provider,
      force: false,
    });
    // A failed or timed-out explore run still starts the agent; the map falls back to ticket text.
    if (job.status !== "running") return { agentId: await startLaunch(workspace, input), job };
    await launches.add(input);
    // The run may have ended while the launch was saved; claiming makes a second start a no-op.
    if (jobs.get(job.id)?.job.status !== "running") await startWaiting(paseo, input.identifier);
    return { agentId: null, job };
  });
}
