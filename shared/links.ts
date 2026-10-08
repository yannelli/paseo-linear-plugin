// Links between repository files, for the Linear Live graph: code imports in common languages,
// links in Markdown, HTML, and CSS, entry points in package files, and repo paths named in
// config and scripts. Pure: the daemon reads the files and checks which candidates exist.

export type LinkKind = "import" | "link" | "mention";

export interface FileLink {
  from: string;
  to: string;
  kind: LinkKind;
}

/** A reference found in a file, with the repo paths it may point to, best first. */
export interface Reference {
  kind: LinkKind;
  candidates: string[];
}

export interface LinkContext {
  /** Path aliases from tsconfig or jsconfig, such as "@/" to "src/". */
  aliases: readonly { prefix: string; targets: readonly string[] }[];
  /** Workspace packages by name, with their folder and entry file. */
  packages: ReadonlyMap<string, { dir: string; entry: string | null }>;
  /** The module path from go.mod. */
  goModule: string | null;
}

export const EMPTY_CONTEXT: LinkContext = { aliases: [], packages: new Map(), goModule: null };

const SCRIPT_EXTENSIONS = [".ts", ".tsx", ".d.ts", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".json", ".vue", ".svelte"];
/** A Go import names a package folder; this suffix asks the daemon for the folder's Go files. */
export const GO_PACKAGE = "/*.go";

function extension(file: string): string {
  const name = file.split("/").pop() ?? file;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot).toLowerCase() : "";
}

function dirname(file: string): string {
  const index = file.lastIndexOf("/");
  return index < 0 ? "" : file.slice(0, index);
}

/** Joins and normalizes a repo path; null when it leaves the repository. */
export function joinPath(base: string, target: string): string | null {
  const parts: string[] = [];
  for (const part of `${base}/${target}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.length ? parts.join("/") : null;
}

function all(pattern: RegExp, text: string, group = 1): string[] {
  return [...text.matchAll(pattern)].map((match) => match[group] ?? "").filter(Boolean);
}

// A script specifier may leave out the extension, name a folder with an index file, or name
// the .js file that a .ts file compiles to.
function scriptCandidates(base: string): string[] {
  const list = [base, ...SCRIPT_EXTENSIONS.map((ext) => base + ext), ...SCRIPT_EXTENSIONS.map((ext) => `${base}/index${ext}`)];
  const compiled = /\.(m|c)?jsx?$/.exec(base);
  if (compiled) {
    const stem = base.slice(0, -compiled[0].length);
    list.unshift(`${stem}.ts`, `${stem}.tsx`, `${stem}.${compiled[1] ?? ""}ts`);
  }
  return list;
}

function scriptSpecifier(from: string, spec: string, context: LinkContext): string[] {
  if (spec.startsWith(".")) {
    const base = joinPath(dirname(from), spec);
    return base ? scriptCandidates(base) : [];
  }
  for (const alias of context.aliases) {
    if (!spec.startsWith(alias.prefix)) continue;
    return alias.targets.flatMap((target) => {
      const base = joinPath(target, spec.slice(alias.prefix.length));
      return base ? scriptCandidates(base) : [];
    });
  }
  for (const [name, pkg] of context.packages) {
    if (spec === name && pkg.entry) return scriptCandidates(pkg.entry);
    if (spec.startsWith(`${name}/`)) {
      const base = joinPath(pkg.dir, spec.slice(name.length + 1));
      return base ? [...scriptCandidates(base), ...scriptCandidates(joinPath(pkg.dir, `src/${spec.slice(name.length + 1)}`) ?? base)] : [];
    }
  }
  return [];
}

function scriptImports(text: string): string[] {
  return [
    ...all(/\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*["']([^"']+)["']/g, text),
    ...all(/\bimport\s*["']([^"']+)["']/g, text),
    ...all(/\b(?:require|import)\s*\(\s*["']([^"']+)["']\s*\)/g, text),
  ];
}

function pythonImports(from: string, text: string): string[][] {
  const results: string[][] = [];
  const module = (base: string, name: string) => {
    const stem = joinPath(base, name.replace(/\./g, "/"));
    return stem ? [`${stem}.py`, `${stem}.pyi`, `${stem}/__init__.py`] : [];
  };
  for (const match of text.matchAll(/^\s*from\s+(\.*)([\w.]*)\s+import\s+([\w*, ()]+)/gm)) {
    const [, dots = "", name = "", names = ""] = match;
    if (dots) {
      let base = dirname(from);
      for (let level = 1; level < dots.length; level += 1) base = dirname(base);
      if (name) results.push(module(base, name));
      else for (const item of names.replace(/[()]/g, "").split(",")) results.push(module(base, item.trim()));
    } else results.push([...module("", name), ...module("src", name)]);
  }
  for (const match of text.matchAll(/^\s*import\s+([\w.]+(?:\s*,\s*[\w.]+)*)/gm)) {
    for (const name of (match[1] ?? "").split(",")) results.push([...module("", name.trim()), ...module("src", name.trim())]);
  }
  return results;
}

function goImports(text: string, context: LinkContext): string[][] {
  if (!context.goModule) return [];
  const prefix = `${context.goModule}/`;
  const specs = [...all(/^\s*import\s+(?:\w+\s+)?"([^"]+)"/gm, text)];
  for (const block of all(/^\s*import\s*\(([\s\S]*?)\)/gm, text)) specs.push(...all(/"([^"]+)"/g, block));
  return specs.filter((spec) => spec.startsWith(prefix)).map((spec) => [`${spec.slice(prefix.length)}${GO_PACKAGE}`]);
}

function rustImports(from: string, text: string): string[][] {
  const name = from.split("/").pop() ?? "";
  const own = /^(mod|lib|main)\.rs$/.test(name) ? dirname(from) : joinPath(dirname(from), name.replace(/\.rs$/, ""));
  const results = all(/^\s*(?:pub\s+)?mod\s+(\w+)\s*;/gm, text).map((mod) => [`${own ?? ""}/${mod}.rs`, `${own ?? ""}/${mod}/mod.rs`].map((file) => file.replace(/^\//, "")));
  for (const spec of all(/^\s*(?:pub\s+)?use\s+crate::([\w:]+)/gm, text)) {
    const parts = spec.split("::");
    for (let size = parts.length; size > 0; size -= 1) {
      const stem = `src/${parts.slice(0, size).join("/")}`;
      results.push([`${stem}.rs`, `${stem}/mod.rs`]);
    }
  }
  return results;
}

// Repo paths named in config, scripts, and prose: a word with a slash and an extension, or a
// relative path. Each is tried from the file's folder and from the repository root.
function mentions(from: string, text: string): string[][] {
  const words = all(/(?:^|[\s"'`(=:,[])((?:\.{1,2}\/)?[\w@.-]+(?:\/[\w@.-]+)+\.[A-Za-z][\w]{0,7})(?=$|[\s"'`),:;\]#?])/gm, text);
  return [...new Set(words)].map((word) => {
    const local = joinPath(dirname(from), word);
    const rooted = word.startsWith(".") ? null : joinPath("", word);
    return [local, rooted].filter((candidate): candidate is string => candidate !== null);
  });
}

function markdownLinks(from: string, text: string): string[][] {
  return all(/\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g, text)
    .map((target) => target.split("#")[0] ?? "")
    .filter((target) => target && !/^[a-z][\w+.-]*:/i.test(target))
    .map((target) => {
      const resolved = target.startsWith("/") ? joinPath("", target) : joinPath(dirname(from), decodeURI(target));
      return resolved ? [resolved, `${resolved}/README.md`] : [];
    });
}

function packageEntries(from: string, text: string): string[][] {
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return [];
  }
  const strings: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") strings.push(value);
    else if (value && typeof value === "object") for (const inner of Object.values(value)) collect(inner);
  };
  for (const key of ["main", "module", "types", "typings", "bin", "exports", "browser"]) collect(pkg[key]);
  const dir = dirname(from);
  const entries = strings.filter((value) => /^\.?\.?\/?[\w@.-]/.test(value) && !value.includes("*"));
  const scripts = mentions(from, Object.values((pkg.scripts as Record<string, string>) ?? {}).join("\n"));
  return [...entries.map((value) => [joinPath(dir, value)].filter((entry): entry is string => entry !== null)), ...scripts];
}

/** The references in one file, with candidate paths for each. */
export function fileReferences(from: string, text: string, context: LinkContext = EMPTY_CONTEXT): Reference[] {
  const ext = extension(from);
  const name = from.split("/").pop() ?? "";
  const refs: Reference[] = [];
  const add = (kind: LinkKind, lists: string[][]) => {
    for (const candidates of lists) if (candidates.length) refs.push({ kind, candidates });
  };
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts", ".vue", ".svelte", ".astro"].includes(ext)) {
    add("import", scriptImports(text).map((spec) => scriptSpecifier(from, spec, context)));
  } else if (ext === ".py" || ext === ".pyi") add("import", pythonImports(from, text));
  else if (ext === ".go") add("import", goImports(text, context));
  else if (ext === ".rs") add("import", rustImports(from, text));
  else if (ext === ".rb") {
    add("import", all(/\brequire_relative\s*\(?\s*["']([^"']+)["']/g, text).map((spec) => {
      const base = joinPath(dirname(from), spec);
      return base ? [base.endsWith(".rb") ? base : `${base}.rb`] : [];
    }));
  } else if ([".css", ".scss", ".sass", ".less"].includes(ext)) {
    add("link", all(/@(?:import|use|forward)\s+(?:url\()?["']([^"']+)["']/g, text).map((spec) => {
      const base = joinPath(dirname(from), spec);
      if (!base) return [];
      const partial = `${dirname(base)}/_${base.split("/").pop()}`.replace(/^\//, "");
      return [base, `${base}.css`, `${base}.scss`, `${partial}.scss`, `${base}.less`];
    }));
  } else if (ext === ".md" || ext === ".mdx") add("link", markdownLinks(from, text));
  else if (ext === ".html" || ext === ".htm") {
    add("link", all(/\b(?:src|href)\s*=\s*["']([^"'#?]+)["']/g, text)
      .filter((target) => !/^[a-z][\w+.-]*:|^\/\//i.test(target))
      .map((target) => [joinPath(target.startsWith("/") ? "" : dirname(from), target)].filter((value): value is string => value !== null)));
  } else if (name === "package.json") add("link", packageEntries(from, text));
  else if (/^[tj]sconfig(\..+)?\.json$/.test(name)) {
    add("link", all(/"extends"\s*:\s*"(\.[^"]+)"/g, text).map((spec) => {
      const base = joinPath(dirname(from), spec);
      return base ? [base, `${base}.json`] : [];
    }));
  }
  // Every text file can name repo paths, as a workflow names the script it runs.
  add("mention", mentions(from, text));
  return refs;
}

/** Reads tsconfig paths, such as {"@/*": ["./src/*"]}, as prefix aliases. */
export function aliasesFrom(config: unknown, configDir = ""): LinkContext["aliases"] {
  const options = (config as { compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> } })?.compilerOptions;
  const base = joinPath(configDir, options?.baseUrl ?? ".") ?? "";
  return Object.entries(options?.paths ?? {}).flatMap(([pattern, targets]) => {
    if (!pattern.endsWith("*") || !Array.isArray(targets)) return [];
    const resolved = targets
      .filter((target) => typeof target === "string" && target.endsWith("*"))
      .map((target) => joinPath(base, target.slice(0, -1)) ?? "");
    return [{ prefix: pattern.slice(0, -1), targets: resolved }];
  });
}

/** Strips comments and trailing commas, which tsconfig files allow. */
export function parseLooseJson(text: string): unknown {
  const clean = text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (match, string: string | undefined) => string ?? "")
    .replace(/,(\s*[}\]])/g, "$1");
  try {
    return JSON.parse(clean);
  } catch {
    return null;
  }
}
