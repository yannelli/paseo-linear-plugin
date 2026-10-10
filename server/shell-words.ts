import { type Dirent, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

// Splits a command the way bash or zsh would, for the read-only check. It models quotes,
// backslashes, and wildcards, and returns null for any other shell syntax.

export interface ShellWord {
  /** The word after quote removal. */
  text: string;
  /** The word as a wildcard pattern, with quoted characters escaped; null without wildcards. */
  glob: string | null;
}

/** Text the shell would expand or treat as syntax when it is not quoted. */
const SYNTAX = /[`$;&<>(){}~#!^\n\r]/;
const WILDCARD = "*?[";
const GLOB_SPECIAL = "*?[]\\";

/** The words of each command in a pipeline, or null for syntax this check does not model. */
export function shellWords(command: string): ShellWord[][] | null {
  const commands: ShellWord[][] = [[]];
  let text: string | null = null;
  let pattern = "";
  let wild = false;
  const add = (char: string, quoted: boolean) => {
    text = (text ?? "") + char;
    pattern += quoted && GLOB_SPECIAL.includes(char) ? `\\${char}` : char;
    if (!quoted && WILDCARD.includes(char)) wild = true;
  };
  const end = () => {
    if (text !== null) commands[commands.length - 1]?.push({ text, glob: wild ? pattern : null });
    text = null;
    pattern = "";
    wild = false;
  };
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index] as string;
    if (char === " " || char === "\t") end();
    else if (char === "|") {
      end();
      commands.push([]);
    } else if (char === "'") {
      const close = command.indexOf("'", index + 1);
      if (close < 0) return null;
      text ??= "";
      for (const inner of command.slice(index + 1, close)) add(inner, true);
      index = close;
    } else if (char === '"') {
      text ??= "";
      for (index += 1; command[index] !== '"'; index += 1) {
        const inner = command[index];
        if (inner === undefined || inner === "$" || inner === "`") return null;
        const next = command[index + 1];
        if (inner === "\\" && next !== undefined && '$`"\\'.includes(next)) {
          add(next, true);
          index += 1;
        } else add(inner, true);
      }
    } else if (char === "\\") {
      const next = command[index + 1];
      if (next === undefined || next === "\n" || next === "\r") return null;
      add(next, true);
      index += 1;
    } else if (SYNTAX.test(char) || (char === "=" && text === null)) {
      // zsh expands a word that starts with = to the path of a program.
      return null;
    } else add(char, false);
  }
  end();
  return commands.every((words) => words.length > 0) ? commands : null;
}

export function realPath(filePath: string): string | null {
  try {
    return realpathSync(filePath);
  } catch {
    return null;
  }
}

const SEPARATORS = path.sep === "\\" ? /[\\/]+/ : /\/+/;

/** Resolves a path as the kernel does, each link before the ".." after it. Null when a part is missing. */
export function physicalPath(filePath: string, cwd: string): string | null {
  const root = path.isAbsolute(filePath) ? path.parse(filePath).root : null;
  let current = root ?? realPath(cwd) ?? path.resolve(cwd);
  for (const part of (root ? filePath.slice(root.length) : filePath).split(SEPARATORS)) {
    if (part === "" || part === ".") continue;
    if (part === "..") current = path.dirname(current);
    else {
      const next = realPath(path.join(current, part));
      if (next === null) return null;
      current = next;
    }
  }
  return current;
}

/** Folder entries the expansion may read before it gives up and the command is denied. */
const MAX_ENTRIES = 20_000;
const REGEX_SPECIAL = /[.*+?^${}()|[\]\\/]/g;

function hasWildcard(segment: string): boolean {
  for (let index = 0; index < segment.length; index += 1) {
    if (segment[index] === "\\") index += 1;
    else if (WILDCARD.includes(segment[index] as string)) return true;
  }
  return false;
}

const unescape = (segment: string) => segment.replace(/\\(.)/g, "$1");

/** Matches more names than any shell setting would: * and ? match dotfiles, [...] any one character. */
function segmentRegex(segment: string): RegExp {
  let source = "";
  for (let index = 0; index < segment.length; index += 1) {
    const char = segment[index] as string;
    const close = char === "[" ? segment.indexOf("]", index + 2) : -1;
    if (char === "\\") {
      source += (segment[index + 1] ?? "").replace(REGEX_SPECIAL, "\\$&");
      index += 1;
    } else if (char === "*") source += ".*";
    else if (char === "?") source += ".";
    else if (close > 0) {
      source += ".";
      index = close;
    } else source += char.replace(REGEX_SPECIAL, "\\$&");
  }
  return new RegExp(`^${source}$`, "s");
}

/** The paths a word with wildcards can expand to, or null when the folders hold too many entries.
 *  A ** segment lists everything below, as zsh does, and adds each link it does not enter. */
export function expandGlob(glob: string, cwd: string): string[] | null {
  let budget = MAX_ENTRIES;
  const list = (base: string): Dirent[] | null => {
    const folder = physicalPath(base || ".", cwd);
    let entries: Dirent[];
    try {
      entries = folder === null ? [] : readdirSync(folder, { withFileTypes: true });
    } catch {
      return [];
    }
    budget -= entries.length;
    return budget < 0 ? null : entries;
  };
  const join = (base: string, name: string) => (base === "" ? name : base.endsWith("/") ? base + name : `${base}/${name}`);
  const links: string[] = [];
  let bases = [glob.startsWith("/") ? "/" : ""];
  for (const segment of glob.split("/")) {
    if (segment === "") continue;
    const next: string[] = [];
    if (!hasWildcard(segment)) {
      for (const base of bases) next.push(join(base, unescape(segment)));
    } else if (/^\*{2,}$/.test(segment)) {
      const queue = [...bases];
      next.push(...bases);
      for (let base = queue.shift(); base !== undefined; base = queue.shift()) {
        const entries = list(base);
        if (entries === null) return null;
        for (const entry of entries) {
          const child = join(base, entry.name);
          next.push(child);
          // zsh follows links into folders only with three stars.
          if (entry.isSymbolicLink() && segment.length > 2) links.push(child);
          else if (entry.isDirectory() && entry.name !== ".git") queue.push(child);
        }
      }
    } else {
      const regex = segmentRegex(segment);
      const dots = unescape(segment).startsWith(".") ? [".", ".."] : [];
      for (const base of bases) {
        const entries = list(base);
        if (entries === null) return null;
        for (const name of [...dots, ...entries.map((entry) => entry.name)]) {
          if (regex.test(name)) next.push(join(base, name));
        }
      }
    }
    bases = next;
  }
  return [...bases.filter((base) => base !== ""), ...links];
}
