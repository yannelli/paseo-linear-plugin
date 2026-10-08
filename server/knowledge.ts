import { createHash } from "node:crypto";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  knowledgeGetRpc,
  knowledgeInspectRpc,
  type ProjectBrief,
  type ProjectKnowledge,
  ProjectKnowledgeSchema,
  topFolders,
} from "../shared/knowledge";
import type { Paseo } from "./agent-runs";
import { inspectProject } from "./inspect";
import { createJsonFile, type JsonFile } from "./stores";

/** Knowledge older than this is inspected again before use; summaries carry over. */
export const KNOWLEDGE_MAX_AGE_MS = 6 * 60 * 60_000;

export interface KnowledgeProject {
  projectId: string;
  rootPath: string;
}

/** What the setup agent learned: a line on the project and one per area. */
export interface KnowledgeNotes {
  summary: string;
  areas: readonly { path: string; summary: string }[];
}

export interface KnowledgeService {
  get(projectId: string): Promise<ProjectKnowledge | null>;
  /** Saved knowledge, inspected again when missing, stale, or from another folder. */
  ensure(project: KnowledgeProject): Promise<ProjectKnowledge>;
  /** Inspects now. Runs for one project share one inspection. */
  inspect(project: KnowledgeProject): Promise<ProjectKnowledge>;
  annotate(projectId: string, notes: KnowledgeNotes): Promise<void>;
}

type Inspect = (rootPath: string, projectId: string) => Promise<ProjectKnowledge>;

function areaPath(value: string): string {
  const trimmed = value.trim().replace(/^(?:\.\/)+/, "").replace(/^\/+|\/+$/g, "");
  return trimmed === "" || trimmed === "." ? "" : `${trimmed}/`;
}

/** One file per project beside the key file, so each loads only when used. */
export function createKnowledge(
  directory: string,
  inspect: Inspect = inspectProject,
  now = () => Date.now(),
): KnowledgeService {
  const files = new Map<string, JsonFile<ProjectKnowledge | null>>();
  const running = new Map<string, Promise<ProjectKnowledge>>();
  const fileFor = (projectId: string) => {
    let file = files.get(projectId);
    if (!file) {
      const name = createHash("sha256").update(projectId).digest("hex").slice(0, 32);
      file = createJsonFile(path.join(directory, `${name}.json`), ProjectKnowledgeSchema.nullable(), () => null);
      files.set(projectId, file);
    }
    return file;
  };
  const get = async (projectId: string) => {
    const known = await fileFor(projectId).read();
    return known?.projectId === projectId ? known : null;
  };

  function inspectNow(project: KnowledgeProject): Promise<ProjectKnowledge> {
    const existing = running.get(project.projectId);
    if (existing) return existing;
    const work = (async () => {
      const fresh = await inspect(project.rootPath, project.projectId);
      return fileFor(project.projectId).update((previous) => {
        const summaries = new Map((previous?.areas ?? []).map((area) => [area.path, area.summary]));
        const next: ProjectKnowledge = {
          ...fresh,
          areas: fresh.areas.map((area) => ({ ...area, summary: summaries.get(area.path) ?? area.summary })),
          summary: previous?.summary ?? fresh.summary,
          summarizedAt: previous?.summarizedAt ?? fresh.summarizedAt,
        };
        return { next, result: next };
      });
    })().finally(() => running.delete(project.projectId));
    running.set(project.projectId, work);
    return work;
  }

  return {
    get,
    inspect: inspectNow,
    async ensure(project) {
      const known = await get(project.projectId);
      const age = known ? now() - Date.parse(known.inspectedAt) : Number.POSITIVE_INFINITY;
      if (known && known.rootPath === project.rootPath && age < KNOWLEDGE_MAX_AGE_MS) return known;
      // A failed inspection keeps the saved knowledge rather than losing it.
      return inspectNow(project).catch((error: unknown) => {
        if (known) return known;
        throw error;
      });
    },
    async annotate(projectId, notes) {
      await fileFor(projectId).update((current) => {
        if (!current) return { next: current, result: undefined };
        const summaries = new Map(notes.areas.map((area) => [areaPath(area.path), area.summary.trim()]));
        const next: ProjectKnowledge = {
          ...current,
          summary: notes.summary.trim() || current.summary,
          summarizedAt: new Date(now()).toISOString(),
          areas: current.areas.map((area) => ({ ...area, summary: summaries.get(area.path) || area.summary })),
        };
        return { next, result: undefined };
      });
    },
  };
}

export function toBrief(knowledge: ProjectKnowledge): ProjectBrief {
  const { files, ...rest } = knowledge;
  return { ...rest, folders: topFolders(files) };
}

/** A Paseo project on this host; the client names only an id, never a folder. */
export async function findProject(paseo: Paseo, projectId: string): Promise<KnowledgeProject | null> {
  const { projects } = await paseo.projects.list();
  const project = projects.find((entry) => entry.projectId === projectId);
  return project ? { projectId, rootPath: project.projectRootPath } : null;
}

/** Knowledge for prompts and maps; null when the project is unknown or cannot be read. */
export async function knowledgeFor(
  paseo: Paseo,
  knowledge: KnowledgeService,
  projectId: string | null,
): Promise<ProjectKnowledge | null> {
  if (!projectId) return null;
  try {
    const project = await findProject(paseo, projectId);
    return project ? await knowledge.ensure(project) : await knowledge.get(projectId);
  } catch (error) {
    console.error(`Linear could not inspect project ${projectId}`, error);
    return null;
  }
}

export function registerKnowledge(server: PluginServerContext, knowledge: KnowledgeService) {
  async function requireProject(paseo: Paseo, projectId: string) {
    const project = await findProject(paseo, projectId);
    if (!project) throw new Error("That project is not on this host");
    return project;
  }
  server.handle(knowledgeGetRpc, async ({ projectId }, { paseo }) => ({
    knowledge: toBrief(await knowledge.ensure(await requireProject(paseo, projectId))),
  }));
  server.handle(knowledgeInspectRpc, async ({ projectId }, { paseo }) => ({
    knowledge: toBrief(await knowledge.inspect(await requireProject(paseo, projectId))),
  }));
}
