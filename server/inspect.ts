import { execFile } from "node:child_process";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type Area, MAX_KNOWLEDGE_FILES, type ProjectKnowledge } from "../shared/knowledge";

// Project inspection without an agent: list the files, read the manifests, and find the
// services, packages, and main folders. It reads only small manifest files inside the root.

const run = promisify(execFile);
const GIT_TIMEOUT_MS = 20_000;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_MANIFESTS = 300;
const MAX_AREAS = 60;
const MAX_GUIDES = 30;
/** A top folder with this share of the files also gets its subfolders as areas. */
const BIG_FOLDER_SHARE = 0.4;

const SKIPPED_DIRS = new Set([
  ".git", "node_modules", "dist", "build", "out", "target", "vendor", ".next", ".nuxt",
  ".turbo", ".cache", "coverage", "__pycache__", ".venv", "venv", ".gradle", "Pods",
]);
// Manifests in these folders describe test data or samples, not parts of the project.
const NOT_AREAS = /^(?:fixtures?|__fixtures__|testdata|test-data|examples?|samples?|templates?|node_modules|vendor|third_party)$/i;
const SERVICE_PARENTS = /^(?:apps|services|cmd|functions|lambdas|workers)$/i;
const SERVICE_MARKER =
  /^(?:(?:Dockerfile|Containerfile)(?:\..+)?|Procfile|fly\.toml|serverless\.ya?ml|wrangler\.toml|vercel\.json|netlify\.toml|render\.ya?ml)$/;
const COMPOSE_FILE = /^(?:docker-)?compose(?:\.[\w-]+)?\.ya?ml$/;
const PROJECT_FILE = /\.(?:csproj|fsproj)$/;

export interface FileList {
  files: string[];
  total: number;
  truncated: boolean;
  source: "git" | "walk";
}

/** Shallow files first, so a cut keeps the outline of the project. */
function keepShallow(files: readonly string[], limit: number): string[] {
  if (files.length <= limit) return [...files].sort();
  const depth = (file: string) => file.split("/").length;
  return [...files]
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, limit)
    .sort();
}

async function gitFiles(root: string): Promise<string[] | null> {
  try {
    const { stdout } = await run(
      "git",
      ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
      { maxBuffer: 256 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, encoding: "utf8" },
    );
    return [...new Set(stdout.split("\0").filter(Boolean))];
  } catch {
    return null;
  }
}

async function walkFiles(root: string, limit: number): Promise<{ files: string[]; complete: boolean }> {
  const files: string[] = [];
  const queue = [""];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    const entries = await readdir(path.join(root, next), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isDirectory() && !SKIPPED_DIRS.has(entry.name)) queue.push(`${next}${entry.name}/`);
      if (!entry.isFile()) continue;
      files.push(`${next}${entry.name}`);
      if (files.length >= limit) return { files, complete: false };
    }
  }
  return { files, complete: true };
}

/** Files git knows and does not ignore; a folder walk when the root is not in a repository. */
export async function listProjectFiles(root: string, limit = MAX_KNOWLEDGE_FILES): Promise<FileList> {
  const tracked = await gitFiles(root);
  if (tracked) {
    return { files: keepShallow(tracked, limit), total: tracked.length, truncated: tracked.length > limit, source: "git" };
  }
  const walked = await walkFiles(root, limit);
  return { files: walked.files.sort(), total: walked.files.length, truncated: !walked.complete, source: "walk" };
}

const baseName = (file: string) => file.slice(file.lastIndexOf("/") + 1);
const dirOf = (file: string) => file.slice(0, file.lastIndexOf("/") + 1);

function jsonName(text: string): string | null {
  try {
    const value = JSON.parse(text) as { name?: unknown };
    return typeof value.name === "string" && value.name ? value.name : null;
  } catch {
    return null;
  }
}

function tomlName(text: string, section: RegExp): string | null {
  const start = text.search(section);
  if (start < 0) return null;
  const body = text.slice(start).split(/\n(?=\[)/)[0] ?? "";
  return /^name\s*=\s*["']([^"']+)["']/m.exec(body)?.[1] ?? null;
}

const NAME_PARSERS: Partial<Record<string, (text: string) => string | null>> = {
  "package.json": jsonName,
  "composer.json": jsonName,
  "deno.json": jsonName,
  "go.mod": (text) => /^module\s+(\S+)/m.exec(text)?.[1]?.split("/").pop() ?? null,
  "Cargo.toml": (text) => tomlName(text, /^\[package\]/m),
  "pyproject.toml": (text) => tomlName(text, /^\[(?:project|tool\.poetry)\]/m),
  "pubspec.yaml": (text) => /^name:\s*["']?([\w.-]+)/m.exec(text)?.[1] ?? null,
  "pom.xml": (text) =>
    /<artifactId>([^<]+)<\/artifactId>/.exec(text.replace(/<parent>[\s\S]*?<\/parent>/, ""))?.[1]?.trim() ?? null,
};
const NAMELESS = new Set(["setup.py", "setup.cfg", "Gemfile", "build.gradle", "build.gradle.kts", "mix.exs", "Package.swift"]);

export interface Manifest {
  kind: "manifest" | "marker" | "compose";
  name: string | null;
  /** Services a compose file builds from folders, with those folders. */
  services: { name: string; path: string }[];
}

function insideRoot(dir: string, relative: string): string | null {
  if (/^[\w+.-]+:\/\/|^git@/.test(relative)) return null;
  const joined = path.posix.normalize(path.posix.join(dir || ".", relative));
  if (joined.startsWith("..") || joined.startsWith("/")) return null;
  return joined === "." ? "" : `${joined.replace(/\/$/, "")}/`;
}

/** Services in a compose file that build from a folder, by indentation, without a YAML parser. */
export function composeServices(text: string, dir: string): { name: string; path: string }[] {
  const found: { name: string; build: string | null }[] = [];
  let inServices = false;
  let indent = -1;
  let current: { name: string; build: string | null } | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\s+#.*$/, "").replace(/\s+$/, "");
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const depth = line.length - line.trimStart().length;
    if (depth === 0) {
      inServices = /^services:$/.test(line);
      indent = -1;
      current = null;
      continue;
    }
    if (!inServices) continue;
    if (indent < 0) indent = depth;
    if (depth === indent) {
      const key = /^\s*["']?([\w.-]+)["']?:/.exec(line)?.[1];
      current = key ? { name: key, build: null } : null;
      if (current) found.push(current);
    } else if (current && !current.build) {
      current.build = /^\s*(?:build|context):\s*["']?([^"'\s]+)/.exec(line)?.[1] ?? null;
    }
  }
  return found.flatMap((service) => {
    const folder = service.build ? insideRoot(dir, service.build) : null;
    return folder === null ? [] : [{ name: service.name, path: folder }];
  });
}

function manifestKind(file: string): "manifest" | "marker" | "compose" | null {
  const name = baseName(file);
  if (name in NAME_PARSERS || NAMELESS.has(name) || PROJECT_FILE.test(name)) return "manifest";
  if (SERVICE_MARKER.test(name)) return "marker";
  return COMPOSE_FILE.test(name) ? "compose" : null;
}

function describesProject(file: string): boolean {
  return !file.split("/").slice(0, -1).some((segment) => NOT_AREAS.test(segment) || SKIPPED_DIRS.has(segment));
}

/** Reads a file under the real root, or null when it leaves the root or is too large. */
async function readText(root: string, file: string): Promise<string | null> {
  const resolved = await realpath(path.join(root, file)).catch(() => null);
  if (!resolved || !resolved.startsWith(`${root}${path.sep}`)) return null;
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile() || info.size > MAX_MANIFEST_BYTES) return null;
  return readFile(resolved, "utf8").catch(() => null);
}

export async function readManifests(root: string, files: readonly string[]): Promise<Map<string, Manifest>> {
  const chosen = files
    .filter((file) => manifestKind(file) !== null && describesProject(file))
    .slice(0, MAX_MANIFESTS);
  const entries = await Promise.all(
    chosen.map(async (file): Promise<[string, Manifest]> => {
      const kind = manifestKind(file) ?? "manifest";
      const parse = NAME_PARSERS[baseName(file)];
      const text = kind === "compose" || parse ? await readText(root, file) : null;
      let name = text && parse ? parse(text) : null;
      if (PROJECT_FILE.test(file)) name = baseName(file).replace(PROJECT_FILE, "");
      const services = kind === "compose" && text ? composeServices(text, dirOf(file)) : [];
      return [file, { kind, name, services }];
    }),
  );
  return new Map(entries);
}

const LANGUAGES: Record<string, string> = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", rb: "Ruby", java: "Java", kt: "Kotlin", swift: "Swift",
  c: "C", h: "C", cc: "C++", cpp: "C++", hpp: "C++", cs: "C#", fs: "F#", php: "PHP",
  vue: "Vue", svelte: "Svelte", css: "CSS", scss: "CSS", sass: "CSS", less: "CSS", html: "HTML",
  md: "Markdown", mdx: "Markdown", sql: "SQL", sh: "Shell", bash: "Shell", ex: "Elixir",
  exs: "Elixir", dart: "Dart", scala: "Scala", lua: "Lua", tf: "Terraform", proto: "Protobuf",
  graphql: "GraphQL", gql: "GraphQL", prisma: "Prisma",
};

export function languageCounts(files: readonly string[]): { name: string; files: number }[] {
  const counts = new Map<string, number>();
  for (const file of files) {
    const language = LANGUAGES[file.slice(file.lastIndexOf(".") + 1).toLowerCase()];
    if (language && file.includes(".")) counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  return [...counts]
    .map(([name, count]) => ({ name, files: count }))
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name));
}

const ROLES: [RegExp, string][] = [
  [/^(?:tests?|__tests__|specs?|e2e|integration|cypress|playwright)$/i, "tests"],
  [/^(?:docs?|documentation|website)$/i, "docs"],
  [/^(?:scripts?|bin|tools?|tooling|hack)$/i, "scripts"],
  [/^\.(?:github|circleci|gitlab|buildkite)$/i, "CI"],
  [/^(?:client|web|frontend|ui|www|site|pages|views|components)$/i, "frontend"],
  [/^(?:server|api|backend|handlers|routes|controllers|daemon)$/i, "backend"],
  [/^(?:shared|common|lib|libs|core|utils?|internal|pkg)$/i, "shared code"],
  [/^(?:db|database|migrations?|prisma|schemas?|sql|models)$/i, "data"],
  [/^(?:infra|infrastructure|deploy|deployment|terraform|k8s|kubernetes|helm|docker|ops|\.devcontainer)$/i, "infrastructure"],
  [/^(?:config|configs|settings|\.vscode|\.claude|\.cursor)$/i, "config"],
  [/^(?:assets|static|public|images|img|fonts|media)$/i, "assets"],
  [/^(?:ios|android|mobile)$/i, "mobile"],
  [/^(?:apps|services)$/i, "services"],
  [/^(?:packages|modules|crates)$/i, "packages"],
];

export function roleOf(dir: string): string {
  const folder = dir.replace(/\/$/, "").split("/").pop() ?? "";
  return ROLES.find(([pattern]) => pattern.test(folder))?.[1] ?? "";
}

interface Seed {
  path: string;
  names: string[];
  manifests: string[];
  service: boolean;
}

function folderSeeds(files: readonly string[], taken: ReadonlyMap<string, Seed>): string[] {
  const under = (dir: string) => files.filter((file) => file.startsWith(dir));
  const childDirs = (dir: string) =>
    [...new Set(under(dir).map((file) => file.slice(dir.length)).filter((rest) => rest.includes("/")).map((rest) => `${dir}${rest.split("/")[0]}/`))];
  const folders: string[] = [];
  for (const top of childDirs("")) {
    if (!taken.has(top)) folders.push(top);
    const children = childDirs(top);
    if (under(top).length >= files.length * BIG_FOLDER_SHARE && children.length >= 2) {
      folders.push(...children.filter((child) => !taken.has(child)));
    }
  }
  return folders;
}

/** Services and packages from manifests, then top folders, and the subfolders of a big one. */
export function detectAreas(
  files: readonly string[],
  manifests: ReadonlyMap<string, Manifest>,
  rootName: string,
): Area[] {
  const seeds = new Map<string, Seed>();
  const seed = (dir: string): Seed => {
    const known = seeds.get(dir);
    if (known) return known;
    const created: Seed = { path: dir, names: [], manifests: [], service: false };
    seeds.set(dir, created);
    return created;
  };
  for (const [file, manifest] of manifests) {
    if (manifest.kind !== "compose") {
      const entry = seed(dirOf(file));
      entry.manifests.push(baseName(file));
      if (manifest.name) entry.names.push(manifest.name);
      entry.service ||= manifest.kind === "marker";
    }
    for (const service of manifest.services) {
      const target = seed(service.path);
      target.names.push(service.name);
      target.manifests.push(baseName(file));
      target.service = true;
    }
  }
  const named = [...seeds.values()].map((entry) => ({
    path: entry.path,
    name: entry.names[0] ?? (entry.path ? baseName(entry.path.slice(0, -1)) : rootName),
    kind: entry.service || entry.path.split("/").slice(0, -2).some((part) => SERVICE_PARENTS.test(part))
      ? ("service" as const)
      : ("package" as const),
    manifests: [...new Set(entry.manifests)],
  }));
  const folders = folderSeeds(files, seeds).map((dir) => ({
    path: dir,
    name: baseName(dir.slice(0, -1)),
    kind: "folder" as const,
    manifests: [],
  }));
  return [...named.sort((a, b) => a.path.localeCompare(b.path)), ...folders]
    .slice(0, MAX_AREAS)
    .map((area): Area => {
      const inside = files.filter((file) => file.startsWith(area.path));
      return {
        ...area,
        role: area.path ? roleOf(area.path) : "",
        files: inside.length,
        languages: languageCounts(inside).slice(0, 3).map((entry) => entry.name),
        summary: "",
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function guideFiles(files: readonly string[]): string[] {
  const guides = files.filter((file) => {
    const name = baseName(file);
    if (/^(?:AGENTS|CLAUDE|GEMINI)\.md$/i.test(name)) return true;
    if (file.startsWith(".github/workflows/") || file.startsWith(".cursor/rules/")) return true;
    if (/^\.github\/(?:pull_request_template|copilot-instructions)\.md$/i.test(file)) return true;
    return !file.includes("/") && /^(?:README|CONTRIBUTING|ARCHITECTURE)(?:\.\w+)?$|^\.cursorrules$/i.test(name);
  });
  const depth = (file: string) => file.split("/").length;
  return guides.sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, MAX_GUIDES);
}

const FIRST_SCRIPTS = ["check", "test", "lint", "typecheck", "build", "format", "dev", "start"];

/** Root package scripts and Makefile targets, as the commands to run them. */
export function commandsOf(files: readonly string[], packageJson: string | null, makefile: string | null): string[] {
  const commands: string[] = [];
  if (packageJson) {
    let runner = "npm run";
    if (files.includes("pnpm-lock.yaml")) runner = "pnpm run";
    else if (files.includes("yarn.lock")) runner = "yarn run";
    else if (files.includes("bun.lockb") || files.includes("bun.lock")) runner = "bun run";
    let scripts: string[] = [];
    try {
      scripts = Object.keys((JSON.parse(packageJson) as { scripts?: object }).scripts ?? {});
    } catch {
      // Not JSON; no scripts.
    }
    const rank = (name: string) => (FIRST_SCRIPTS.includes(name) ? FIRST_SCRIPTS.indexOf(name) : FIRST_SCRIPTS.length);
    const sorted = [...scripts].sort((a, b) => rank(a) - rank(b));
    commands.push(...sorted.slice(0, 10).map((name) => `${runner} ${name}`));
  }
  if (makefile) {
    const targets = [...makefile.matchAll(/^([A-Za-z][\w.-]*)\s*:(?!=)/gm)].map((match) => match[1] ?? "");
    commands.push(...[...new Set(targets)].slice(0, 8).map((target) => `make ${target}`));
  }
  return commands;
}

/** Inspects a project folder. Summaries start empty; the store keeps earlier ones. */
export async function inspectProject(
  rootPath: string,
  projectId: string,
  now = new Date(),
): Promise<ProjectKnowledge> {
  const root = await realpath(rootPath).catch(() => {
    throw new Error("The project folder was not found");
  });
  const listing = await listProjectFiles(root);
  const manifests = await readManifests(root, listing.files);
  const packageJson = listing.files.includes("package.json") ? await readText(root, "package.json") : null;
  const makefile = listing.files.includes("Makefile") ? await readText(root, "Makefile") : null;
  return {
    projectId,
    rootPath,
    inspectedAt: now.toISOString(),
    source: listing.source,
    files: listing.files,
    fileCount: listing.total,
    truncated: listing.truncated,
    areas: detectAreas(listing.files, manifests, path.basename(root)),
    languages: languageCounts(listing.files).slice(0, 8),
    guides: guideFiles(listing.files),
    commands: commandsOf(listing.files, packageJson, makefile),
    summary: "",
    summarizedAt: null,
  };
}
