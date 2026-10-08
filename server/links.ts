import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  aliasesFrom,
  type FileLink,
  fileReferences,
  GO_PACKAGE,
  joinPath,
  type LinkContext,
  type LinkKind,
  parseLooseJson,
  type Reference,
} from "../shared/links";

// Reads the files on the Linear Live graph and resolves the links between them. Every path is
// checked against the agent's folder after symlinks resolve, so a link cannot reach outside it.

const MAX_BYTES = 512 * 1024;
const MAX_LINKS = 3000;
const MAX_PACKAGES = 100;
const CONTEXT_TTL_MS = 60_000;
const STRENGTH: Record<LinkKind, number> = { import: 3, link: 2, mention: 1 };

const contexts = new Map<string, { at: number; context: Promise<LinkContext> }>();
const parsed = new Map<string, Reference[]>();

function inside(root: string, resolved: string): boolean {
  return resolved === root || resolved.startsWith(`${root}${path.sep}`);
}

async function resolveInside(root: string, relative: string): Promise<string | null> {
  const resolved = await realpath(path.resolve(root, relative)).catch(() => null);
  return resolved && inside(root, resolved) ? resolved : null;
}

async function readText(root: string, relative: string): Promise<string | null> {
  const resolved = await resolveInside(root, relative);
  if (!resolved) return null;
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile() || info.size > MAX_BYTES) return null;
  const text = await readFile(resolved, "utf8").catch(() => null);
  return text && !text.slice(0, 1024).includes("\u0000") ? text : null;
}

async function readJson(root: string, relative: string): Promise<unknown> {
  const text = await readText(root, relative);
  return text === null ? null : parseLooseJson(text);
}

// Workspace packages from package.json or pnpm-workspace.yaml, as "dir/*" or exact folders.
async function workspacePackages(root: string): Promise<LinkContext["packages"]> {
  const manifest = (await readJson(root, "package.json")) as { workspaces?: string[] | { packages?: string[] } } | null;
  const patterns = Array.isArray(manifest?.workspaces) ? manifest.workspaces : (manifest?.workspaces?.packages ?? []);
  const pnpm = await readText(root, "pnpm-workspace.yaml");
  if (pnpm) patterns.push(...[...pnpm.matchAll(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/gm)].map((match) => match[1] ?? ""));
  const dirs: string[] = [];
  for (const pattern of patterns) {
    const clean = pattern.replace(/\/+$/, "");
    if (clean.startsWith("!") || clean.includes("**")) continue;
    if (!clean.endsWith("/*")) {
      dirs.push(clean);
      continue;
    }
    const parent = clean.slice(0, -2);
    const resolved = await resolveInside(root, parent);
    const entries = resolved ? await readdir(resolved, { withFileTypes: true }).catch(() => []) : [];
    for (const entry of entries) if (entry.isDirectory()) dirs.push(`${parent}/${entry.name}`);
  }
  const packages = new Map<string, { dir: string; entry: string | null }>();
  for (const dir of dirs.slice(0, MAX_PACKAGES)) {
    const pkg = (await readJson(root, `${dir}/package.json`)) as Record<string, unknown> | null;
    if (!pkg || typeof pkg.name !== "string") continue;
    const exported = pkg.exports as unknown;
    const dot = typeof exported === "string" ? exported : (exported as Record<string, unknown> | undefined)?.["."];
    const entry = [pkg.source, pkg.module, pkg.main, typeof dot === "string" ? dot : null].find((value) => typeof value === "string");
    packages.set(pkg.name, { dir, entry: typeof entry === "string" ? joinPath(dir, entry) : null });
  }
  return packages;
}

async function buildContext(root: string): Promise<LinkContext> {
  const aliases = [];
  for (const file of ["tsconfig.json", "jsconfig.json"]) aliases.push(...aliasesFrom(await readJson(root, file)));
  const goMod = await readText(root, "go.mod");
  const goModule = goMod ? (/^module\s+(\S+)/m.exec(goMod)?.[1] ?? null) : null;
  return { aliases, packages: await workspacePackages(root), goModule };
}

function linkContext(root: string): Promise<LinkContext> {
  const cached = contexts.get(root);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached.context;
  const context = buildContext(root);
  contexts.set(root, { at: Date.now(), context });
  return context;
}

async function references(root: string, relative: string, context: LinkContext): Promise<Reference[]> {
  const resolved = await resolveInside(root, relative);
  const info = resolved ? await stat(resolved).catch(() => null) : null;
  if (!info?.isFile()) return [];
  const key = `${root}\u0000${relative}\u0000${info.mtimeMs}\u0000${info.size}`;
  const known = parsed.get(key);
  if (known) return known;
  const text = await readText(root, relative);
  const found = text === null ? [] : fileReferences(relative, text, context);
  if (parsed.size > 5000) parsed.clear();
  parsed.set(key, found);
  return found;
}

/** Links from each of the files to other files in the agent's folder. */
export async function fileLinks(cwd: string, files: readonly string[]): Promise<FileLink[]> {
  const root = await realpath(cwd);
  const context = await linkContext(root);
  const exists = new Map<string, Promise<boolean>>();
  const isFile = (relative: string) => {
    let known = exists.get(relative);
    if (!known) {
      known = resolveInside(root, relative).then(async (resolved) => Boolean(resolved && (await stat(resolved)).isFile())).catch(() => false);
      exists.set(relative, known);
    }
    return known;
  };
  const goFiles = async (dir: string) => {
    const resolved = await resolveInside(root, dir);
    const entries = resolved ? await readdir(resolved, { withFileTypes: true }).catch(() => []) : [];
    return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".go")).map((entry) => `${dir}/${entry.name}`);
  };
  const best = new Map<string, FileLink>();
  for (const from of new Set(files)) {
    for (const reference of await references(root, from, context)) {
      let targets: string[] = [];
      for (const candidate of reference.candidates) {
        if (candidate.endsWith(GO_PACKAGE)) {
          targets = await goFiles(candidate.slice(0, -GO_PACKAGE.length));
          break;
        }
        if (await isFile(candidate)) {
          targets = [candidate];
          break;
        }
      }
      for (const to of targets) {
        if (to === from) continue;
        const id = `${from}>${to}`;
        const known = best.get(id);
        if (!known || STRENGTH[reference.kind] > STRENGTH[known.kind]) best.set(id, { from, to, kind: reference.kind });
      }
      if (best.size >= MAX_LINKS) return [...best.values()];
    }
  }
  return [...best.values()];
}
