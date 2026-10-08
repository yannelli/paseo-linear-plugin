import { lexShell, splitCommands, type Word } from "./shell-lexer";

// Agents that read through the shell (`cat`, `sed -n`, `grep`, `ls`) touch files without a Read
// tool call. This finds those files in a command, so Linear Live can show them. It only knows
// common read, search, and list commands; anything else yields no paths.

export interface ExploredDir {
  /** Repo-relative folder with a trailing slash; "" is the root. */
  path: string;
  /** Searched recursively, not only listed. */
  deep: boolean;
}

export interface ShellWrite {
  path: string;
  mode: "write" | "edit";
}

export interface ShellActivity {
  reads: string[];
  writes: ShellWrite[];
  dirs: ExploredDir[];
  pattern: string | null;
  summary: string;
}

const KEYWORDS = new Set(["do", "then", "else", "elif", "if", "while", "until", "!", "{", "time"]);
const WRAPPERS = new Set(["sudo", "command", "nice", "nohup", "env", "builtin", "exec"]);
// Not named in a summary: shell setup, and filters that only shape another command's output.
const NO_VERB = new Set(
  "cd echo printf true false sleep export set : head tail sort uniq wc cut tr grep egrep cat xargs"
    .split(" "),
);
const SUBCOMMANDS = new Set(["git", "npm", "npx", "bun", "bunx", "pnpm", "yarn", "gh", "linear"]);
const LONG_VALUES = new Set([
  "glob", "type", "type-not", "max-count", "context", "after-context", "before-context", "regexp",
  "file", "max-depth", "sort", "include", "exclude", "exclude-dir", "color", "colors", "encoding",
]);
const READERS: Record<string, string> = {
  cat: "", nl: "bdfhilnsvw", less: "", more: "", bat: "rlHm", tac: "", wc: "", file: "",
  stat: "c", head: "nc", tail: "ncs", sort: "ktoS", uniq: "fs", cut: "dfcb", diff: "", cmp: "",
  column: "st", xxd: "lsc", od: "", strings: "n", md5sum: "", sha256sum: "",
};
const SEARCHERS: Record<string, string> = {
  grep: "efABCmd", egrep: "efABCmd", fgrep: "efABCmd", rg: "efABCmgtTMdj", ag: "ABCmG",
  ack: "ABCm",
};

interface Parsed {
  options: Set<string>;
  values: Map<string, string[]>;
  positionals: Word[];
  /** Positionals after `--`. */
  dashed: Word[];
}

function parseArgs(args: readonly Word[], shortValues: string): Parsed {
  const parsed: Parsed = { options: new Set(), values: new Map(), positionals: [], dashed: [] };
  const value = (name: string, text: string | undefined) => {
    if (text !== undefined) parsed.values.set(name, [...(parsed.values.get(name) ?? []), text]);
  };
  let ended = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as Word;
    const { text } = arg;
    if (ended) parsed.dashed.push(arg);
    else if (text === "--") ended = true;
    else if (text === "-" || !text.startsWith("-") || arg.dynamic) parsed.positionals.push(arg);
    else if (text.startsWith("--")) {
      const [name = "", inline] = text.slice(2).split(/=(.*)/s);
      parsed.options.add(name);
      if (inline !== undefined) value(name, inline);
      else if (LONG_VALUES.has(name)) value(name, args[++index]?.text);
    } else {
      for (let at = 1; at < text.length; at += 1) {
        const flag = text[at] as string;
        parsed.options.add(flag);
        if (!shortValues.includes(flag)) continue;
        value(flag, at + 1 < text.length ? text.slice(at + 1) : args[++index]?.text);
        break;
      }
    }
  }
  return parsed;
}

const MAX_PATTERN = 28;

function hasExtension(path: string): boolean {
  return /[^./][^/]*\.[A-Za-z0-9]+$/.test(path.split("/").pop() ?? "");
}

function shortName(path: string): string {
  const parts = path.replace(/\/$/, "").split("/");
  return path.endsWith("/") ? parts.slice(-2).join("/") || "the repository" : (parts.pop() ?? path);
}

function names(paths: readonly string[]): string {
  const shown = [...new Set(paths.map(shortName))];
  const extra = shown.length - 2;
  return `${shown.slice(0, 2).join(", ")}${extra > 0 ? ` +${extra}` : ""}`;
}

export function parseShell(command: string, cwd: string, start = ""): ShellActivity {
  const root = cwd.replace(/\/+$/, "");
  const reads = new Set<string>();
  const writes = new Map<string, ShellWrite["mode"]>();
  const dirs = new Map<string, boolean>();
  const verbs: string[] = [];
  const env = new Map<string, Word[]>();
  let pattern: string | null = null;
  let base: string | null = start;

  const resolve = (raw: string, from: string | null): string | null => {
    let joined: string;
    if (raw.startsWith("/")) {
      if (raw === root || raw === `${root}/`) return "";
      if (!raw.startsWith(`${root}/`)) return null;
      joined = raw.slice(root.length + 1);
    } else if (from === null || raw.startsWith("~")) return null;
    else joined = from ? `${from}/${raw}` : raw;
    const parts: string[] = [];
    for (const part of joined.split("/")) {
      if (!part || part === ".") continue;
      if (part !== "..") parts.push(part);
      else if (parts.pop() === undefined) return null;
    }
    return parts.join("/");
  };
  const expand = (word: Word): Word[] => {
    if (!word.dynamic) return [word];
    const name = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(word.text)?.[1];
    return name ? (env.get(name) ?? []) : [];
  };
  const addDir = (path: string | null, deep: boolean) => {
    if (path === null) return;
    const dir = path === "" ? "" : `${path}/`;
    dirs.set(dir, deep || (dirs.get(dir) ?? false));
  };
  // A glob reads from its folder; a plain word is a file, or a folder when `asDir` says so.
  const target = (word: Word, from: string | null, asDir: (path: string) => boolean, deep = false) => {
    if (word.globAt >= 0) {
      const prefix = word.text.slice(0, word.globAt);
      addDir(resolve(prefix.slice(0, prefix.lastIndexOf("/") + 1), from), deep);
      return;
    }
    const path = resolve(word.text, from);
    if (path === null) return;
    if (path === "" || asDir(word.text)) addDir(path, deep);
    else reads.add(path);
  };
  const never = () => false;
  const noExtension = (text: string) => text.endsWith("/") || !hasExtension(text);

  for (const simple of splitCommands(lexShell(command))) {
    let words = simple.words;
    while (words[0] && (KEYWORDS.has(words[0].text) || /^[A-Za-z_]\w*=/.test(words[0].text))) {
      words = words.slice(1);
    }
    while (words[0] && WRAPPERS.has(words[0].text)) words = words.slice(1);
    const first = words[0]?.text;
    if (first === "for" && words[2]?.text === "in" && words[1]) {
      env.set(words[1].text, words.slice(3).flatMap(expand));
      continue;
    }
    const args = words.slice(1).flatMap(expand);
    for (const { operator, target: file } of simple.redirects) {
      if (file.dynamic || file.text.startsWith("/dev/")) continue;
      const path = resolve(file.text, base);
      if (path === null || path === "") continue;
      if (operator === "<") reads.add(path);
      else if (operator === ">" || operator === ">>") writes.set(path, operator === ">" ? "write" : "edit");
    }
    if (!first || first === "done" || first === "fi") continue;
    let from = base;
    let name = first.split("/").pop() ?? first;
    let rest = args;
    if (name === "cd" || name === "pushd") {
      base = args[0] ? resolve(args[0].text, base) : base;
      continue;
    }
    if (name === "git") {
      const global = parseArgs(args, "Cc");
      const at = args.findIndex((arg) => arg === global.positionals[0]);
      for (const dir of global.values.get("C") ?? []) from = resolve(dir, base);
      name = `git ${global.positionals[0]?.text ?? ""}`.trim();
      rest = at < 0 ? [] : args.slice(at + 1);
    }
    if (!NO_VERB.has(name)) {
      const sub = SUBCOMMANDS.has(name) ? args.find((arg) => !arg.text.startsWith("-")) : undefined;
      verbs.push(sub ? `${name} ${sub.text}` : name);
    }
    if (name in READERS) {
      for (const word of parseArgs(rest, READERS[name] ?? "").positionals) target(word, from, never);
    } else if (name === "sed" || name === "awk" || name === "gawk" || name === "jq") {
      const parsed = parseArgs(rest, name === "sed" ? "efl" : name === "jq" ? "" : "Ffv");
      const scripted = parsed.options.has("e") || parsed.options.has("f");
      const files = parsed.positionals.slice(scripted && name !== "jq" ? 0 : 1);
      const inPlace = name === "sed" && parsed.options.has("i");
      for (const word of files) {
        if (/^\w+=/.test(word.text)) continue;
        const path = resolve(word.text, from);
        if (inPlace && path) writes.set(path, "edit");
        else target(word, from, never);
      }
    } else if (name in SEARCHERS || name === "git grep") {
      const parsed = parseArgs(rest, SEARCHERS[name] ?? "efABCm");
      const listing = parsed.options.has("files");
      const given = parsed.values.get("e")?.[0] ?? parsed.values.get("regexp")?.[0];
      const explicit = given !== undefined || parsed.options.has("f") || listing;
      const paths = [...parsed.positionals.slice(explicit ? 0 : 1), ...parsed.dashed];
      // A grep in a pipe without files or -r filters output and searches nothing.
      const recursive = parsed.options.has("r") || parsed.options.has("R");
      const filter = /^[ef]?grep$/.test(name) && !recursive && paths.length === 0;
      if (filter) continue;
      if (!listing) pattern ??= given ?? parsed.positionals[0]?.text ?? null;
      if (paths.length === 0) addDir(from, true);
      for (const word of paths) target(word, from, noExtension, true);
    } else if (name === "ls" || name === "tree" || name === "find" || name === "fd") {
      const parsed = parseArgs(rest, name === "tree" ? "LPIo" : name === "fd" ? "etdE" : "");
      const deep = name !== "ls" || parsed.options.has("R");
      const expression = rest.findIndex((word) => /^[-(!]/.test(word.text));
      let paths = parsed.positionals;
      // find takes folders first and then an expression whose words are not paths.
      if (name === "find") paths = expression < 0 ? rest : rest.slice(0, expression);
      if (name === "fd") paths = paths.slice(1);
      if (paths.length === 0) addDir(from, deep);
      for (const word of paths) target(word, from, (text) => name !== "ls" || noExtension(text), deep);
    } else if (/^git (show|diff|log|blame|annotate)$/.test(name)) {
      const parsed = parseArgs(rest, "nSGL");
      for (const word of parsed.positionals) {
        const path = word.text.includes(":") ? word.text.slice(word.text.indexOf(":") + 1) : null;
        if (path) target({ ...word, text: path }, from, never);
      }
      for (const word of parsed.dashed) target(word, from, noExtension);
      if (name === "git blame" && parsed.dashed.length === 0) {
        const last = parsed.positionals.at(-1);
        if (last) target(last, from, never);
      }
    } else if (name === "git ls-files") {
      const parsed = parseArgs(rest, "x");
      const paths = [...parsed.positionals, ...parsed.dashed];
      if (paths.length === 0) addDir(from, true);
      for (const word of paths) target(word, from, noExtension, true);
    } else if (name === "tee" || name === "touch") {
      for (const word of parseArgs(rest, "").positionals) {
        const path = resolve(word.text, from);
        if (path) writes.set(path, name === "tee" && rest.some((w) => w.text === "-a") ? "edit" : "write");
      }
    } else if (name === "cp" || name === "mv") {
      const files = parseArgs(rest, "St").positionals;
      const destination = files.pop();
      for (const word of files) if (name === "cp") target(word, from, never);
      const path = destination ? resolve(destination.text, from) : null;
      if (path && hasExtension(path)) writes.set(path, "write");
    }
  }

  const writeList = [...writes].map(([path, mode]) => ({ path, mode }));
  const readList = [...reads].filter((path) => !writes.has(path));
  const dirList = [...dirs].map(([path, deep]) => ({ path, deep }));
  const parts: string[] = [];
  if (writeList.length > 0) parts.push(`wrote ${names(writeList.map((write) => write.path))}`);
  if (readList.length > 0) parts.push(`read ${names(readList)}`);
  if (pattern !== null) {
    const scope = dirList.filter((dir) => dir.deep && dir.path !== "").map((dir) => dir.path);
    const shown = pattern.replace(/\\\|/g, "|");
    const short = shown.length > MAX_PATTERN ? `${shown.slice(0, MAX_PATTERN - 1)}…` : shown;
    parts.push(`searched "${short}"${scope.length > 0 ? ` in ${names(scope)}` : ""}`);
  } else if (parts.length === 0 && dirList.length > 0) {
    parts.push(`listed ${names(dirList.map((dir) => dir.path || "./"))}`);
  }
  if (parts.length === 0 && verbs.length > 0) {
    const shown = [...new Set(verbs)];
    parts.push(`ran ${shown.slice(0, 2).join(", ")}${shown.length > 2 ? ` +${shown.length - 2}` : ""}`);
  }
  const summary = parts.slice(0, 2).join(", ") || "Ran a command";
  return {
    reads: readList,
    writes: writeList,
    dirs: dirList,
    pattern,
    summary: summary.charAt(0).toUpperCase() + summary.slice(1),
  };
}

const MAX_CACHED = 500;
const cache = new Map<string, ShellActivity>();

/** parseShell with a cache: the panel derives activity again on every timeline update. */
export function shellActivity(command: string, cwd: string, start = ""): ShellActivity {
  const key = `${cwd}\u0000${start}\u0000${command}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const parsed = parseShell(command, cwd, start);
  if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value as string);
  cache.set(key, parsed);
  return parsed;
}

/** The command as shown in the feed: one line, without a leading `cd` into the agent folder. */
export function displayCommand(command: string, cwd: string): string {
  const root = cwd.replace(/\/+$/, "");
  const firstLine = command.split("\n")[0] ?? command;
  return firstLine
    .replace(new RegExp(`^cd\\s+['"]?${root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?['"]?\\s*&&\\s*`), "")
    .replaceAll(`${root}/`, "")
    .trim();
}
