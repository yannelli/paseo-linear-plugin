import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Project knowledge: what the daemon learns about a project's files without an agent. It is
// kept on disk, so explore and setup prompts, ticket-text maps, and Linear Live can use it.

export const AREA_KINDS = ["service", "package", "folder"] as const;
export type AreaKind = (typeof AREA_KINDS)[number];

export const AreaSchema = z.object({
  /** Folder with a trailing slash; "" is the repository root. */
  path: z.string(),
  name: z.string(),
  kind: z.enum(AREA_KINDS),
  /** What the folder holds, from its name, such as "backend" or "tests"; "" when unknown. */
  role: z.string(),
  /** Files that define it, such as package.json or Dockerfile. */
  manifests: z.array(z.string()),
  /** Files under the folder, at any depth. */
  files: z.number(),
  languages: z.array(z.string()),
  /** One line from the setup agent; "" until it writes one. */
  summary: z.string(),
});
export type Area = z.infer<typeof AreaSchema>;

/** The part of an area the app needs to label files. */
export const AreaRefSchema = AreaSchema.pick({
  path: true,
  name: true,
  kind: true,
  role: true,
  summary: true,
});
export type AreaRef = z.infer<typeof AreaRefSchema>;

const CountSchema = z.object({ name: z.string(), files: z.number() });

export const ProjectKnowledgeSchema = z.object({
  projectId: z.string(),
  rootPath: z.string(),
  inspectedAt: z.string(),
  source: z.enum(["git", "walk"]),
  /** Repo-relative file paths, sorted, at most MAX_KNOWLEDGE_FILES. */
  files: z.array(z.string()),
  fileCount: z.number(),
  truncated: z.boolean(),
  areas: z.array(AreaSchema),
  languages: z.array(CountSchema),
  /** Files that guide agents and contributors, such as AGENTS.md and CI workflows. */
  guides: z.array(z.string()),
  /** Commands the repository defines, such as "npm run check". */
  commands: z.array(z.string()),
  /** One line from the setup agent about the project; "" until it writes one. */
  summary: z.string(),
  summarizedAt: z.string().nullable(),
});
export type ProjectKnowledge = z.infer<typeof ProjectKnowledgeSchema>;

/** What the app gets: everything but the file list, plus file counts per top folder. */
export const ProjectBriefSchema = ProjectKnowledgeSchema.omit({ files: true }).extend({
  folders: z.array(CountSchema),
});
export type ProjectBrief = z.infer<typeof ProjectBriefSchema>;

export const MAX_KNOWLEDGE_FILES = 20_000;
export const MAX_RESOLVE_PATHS = 200;

/** Saved knowledge of a project; the daemon inspects the project first when it has none. */
export const knowledgeGetRpc = defineRpc({
  name: "linear.knowledge.get",
  input: z.object({ projectId: z.string().min(1) }),
  output: z.object({ knowledge: ProjectBriefSchema }),
});

export const knowledgeInspectRpc = defineRpc({
  name: "linear.knowledge.inspect",
  input: z.object({ projectId: z.string().min(1) }),
  output: z.object({ knowledge: ProjectBriefSchema }),
});

/** The areas of an agent's project, and ticket paths matched to the project's real files. */
export const liveProjectRpc = defineRpc({
  name: "linear.live.project",
  input: z.object({
    agentId: z.string().min(1),
    paths: z.array(z.string()).max(MAX_RESOLVE_PATHS),
  }),
  output: z.object({
    areas: z.array(AreaRefSchema),
    resolved: z.array(z.object({ from: z.string(), to: z.string() })),
  }),
});

export function toAreaRef(area: Area): AreaRef {
  return { path: area.path, name: area.name, kind: area.kind, role: area.role, summary: area.summary };
}

/** The deepest area whose folder holds the path. */
export function areaOf<A extends { path: string }>(path: string, areas: readonly A[]): A | null {
  let best: A | null = null;
  for (const area of areas) {
    if (path.startsWith(area.path) && (!best || area.path.length > best.path.length)) best = area;
  }
  return best;
}

/** Such as "billing-api · service", "server · backend", or "docs". */
export function areaLabel(area: AreaRef): string {
  const what = area.role || (area.kind === "folder" ? "" : area.kind);
  return what && what.toLowerCase() !== area.name.toLowerCase() ? `${area.name} · ${what}` : area.name;
}

function topFolder(path: string): string {
  const index = path.indexOf("/");
  return index < 0 ? "./" : path.slice(0, index + 1);
}

/** File counts per top folder; "./" counts files at the root. */
export function topFolders(files: readonly string[]): { name: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) counts.set(topFolder(file), (counts.get(topFolder(file)) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => ({ name, files: count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Where an off-map file is: its area, or its top folder when the project has no knowledge. */
export function whereLabel(path: string, areas: readonly AreaRef[]): string {
  const area = areaOf(path, areas);
  return area && area.path !== "" ? areaLabel(area) : topFolder(path);
}

/** Folders to the given depth with their file counts, indented, for prompts. */
export function folderLines(files: readonly string[], depth = 2, limit = 60): string[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const parts = file.split("/").slice(0, -1);
    for (let level = 1; level <= Math.min(depth, parts.length); level += 1) {
      const dir = `${parts.slice(0, level).join("/")}/`;
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
  }
  const dirs = [...counts.keys()].sort();
  if (dirs.length > limit && depth > 1) return folderLines(files, depth - 1, limit);
  const lines = dirs.slice(0, limit).map((dir) => {
    const indent = "  ".repeat(dir.split("/").length - 2);
    return `${indent}${dir} (${counts.get(dir)})`;
  });
  if (dirs.length > limit) lines.push(`... ${dirs.length - limit} more folders`);
  return lines;
}

function countLine(entries: readonly { name: string; files: number }[]): string {
  return entries.map((entry) => `${entry.name} ${entry.files}`).join(", ");
}

/** The project map an agent prompt starts from. Empty without knowledge. */
export function knowledgeLines(knowledge: ProjectKnowledge | null): string[] {
  if (!knowledge) return [];
  const source = knowledge.source === "git" ? "git ls-files" : "a folder walk";
  const lines = [
    `Project map from the plugin's inspection (${knowledge.inspectedAt}, by ${source}). Start from`,
    "it instead of listing the whole repository; files may have changed since.",
  ];
  if (knowledge.summary) lines.push(`- Project: ${knowledge.summary}`);
  const truncated = knowledge.truncated ? ", list truncated" : "";
  lines.push(`- ${knowledge.fileCount} files${truncated}. Languages: ${countLine(knowledge.languages) || "unknown"}.`);
  if (knowledge.guides.length > 0) lines.push(`- Guides: ${knowledge.guides.join(", ")}`);
  if (knowledge.commands.length > 0) lines.push(`- Commands: ${knowledge.commands.join(", ")}`);
  if (knowledge.areas.length > 0) {
    lines.push("Areas (services, packages, and main folders):");
    for (const area of knowledge.areas) {
      const manifests = area.manifests.length > 0 ? ` [${area.manifests.join(", ")}]` : "";
      const languages = area.languages.length > 0 ? `, ${area.languages.join("/")}` : "";
      const summary = area.summary ? `: ${area.summary}` : "";
      const files = `${area.files} ${area.files === 1 ? "file" : "files"}`;
      lines.push(`- ${area.path || "./"} ${areaLabel(area)}${manifests}, ${files}${languages}${summary}`);
    }
  }
  lines.push("Folders (file count):", ...folderLines(knowledge.files));
  return lines;
}

function byName(files: readonly string[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const file of files) {
    const name = file.slice(file.lastIndexOf("/") + 1);
    const known = index.get(name);
    if (known) known.push(file);
    else index.set(name, [file]);
  }
  return index;
}

function dirsOf(files: readonly string[]): Set<string> {
  const dirs = new Set<string>();
  for (const file of files) {
    let index = file.indexOf("/");
    while (index >= 0) {
      dirs.add(file.slice(0, index + 1));
      index = file.indexOf("/", index + 1);
    }
  }
  return dirs;
}

/** Ticket paths matched to real files: "linear.ts" to "server/linear.ts" when only one fits. */
export function resolvePaths(paths: readonly string[], files: readonly string[]): Map<string, string> {
  const known = new Set(files);
  const names = byName(files);
  let dirs: Set<string> | null = null;
  const resolved = new Map<string, string>();
  for (const path of paths) {
    let matches: string[];
    if (path.endsWith("/")) {
      dirs ??= dirsOf(files);
      if (dirs.has(path)) continue;
      matches = [...dirs].filter((dir) => dir.endsWith(`/${path}`));
    } else {
      if (known.has(path)) continue;
      const name = path.slice(path.lastIndexOf("/") + 1);
      matches = (names.get(name) ?? []).filter((file) => file === name || file.endsWith(`/${path}`));
    }
    if (matches.length === 1 && matches[0]) resolved.set(path, matches[0]);
  }
  return resolved;
}

const KINDS_SAID = "(?:service|package|app|module|library|lib|worker|folder|directory|dir)";

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliases(area: AreaRef): string[] {
  const folder = area.path.replace(/\/$/, "").split("/").pop() ?? "";
  return [...new Set([area.name, folder])].filter((alias) => alias.length >= 3);
}

// A service or package counts when its name appears; a plain folder only when the text says
// "the docs folder" or similar, since folder names like "server" are common words.
function mentions(text: string, alias: string, plain: boolean): boolean {
  const word = `(?:^|[^\\w@/.-])${escapeRegex(alias)}(?![\\w@/-])`;
  if (plain && alias.length >= 4 && new RegExp(word, "i").test(text)) return true;
  return new RegExp(`${word}\\s+${KINDS_SAID}\\b`, "i").test(text);
}

/** Areas the text names, other than the whole repository. */
export function areasIn(text: string, areas: readonly AreaRef[]): AreaRef[] {
  return areas.filter(
    (area) =>
      area.path !== "" && aliases(area).some((alias) => mentions(text, alias, area.kind !== "folder")),
  );
}
