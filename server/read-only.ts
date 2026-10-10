import { realpathSync } from "node:fs";
import path from "node:path";
import type { PermissionAnswer, PermissionRequest } from "./agent-runs";

// Some Claude builds search only through the shell, so internal agents may run a short list of
// commands that read. The check splits a command into the words the shell passes on, so quotes
// and backslashes cannot hide a flag. Anything it does not model is denied.

const PROGRAMS = new Set(["ls", "find", "rg", "grep", "cat", "head", "tail", "wc", "pwd"]);
const GIT_COMMANDS = new Set(["ls-files", "grep"]);

/** Flags that run programs, write or delete files, follow links, or never finish. */
interface FlagRule {
  /** Whole words, such as find's -exec. */
  words?: readonly string[];
  /** Long options, with or without a value after "=". */
  long?: readonly string[];
  /** Letters that are unsafe anywhere in a short option group, such as -nL. */
  short?: string;
}

const FIND_ACTIONS = ["-exec", "-execdir", "-ok", "-okdir", "-delete", "-fls", "-L", "-follow", "-files0-from"];
const FLAG_RULES: Record<string, FlagRule> = {
  find: { words: FIND_ACTIONS },
  rg: { long: ["pre", "pre-glob", "hostname-bin", "follow"], short: "L" },
  grep: { long: ["dereference-recursive"], short: "R" },
  ls: { long: ["dereference"], short: "L" },
  tail: { long: ["follow", "retry"], short: "fF" },
  wc: { long: ["files0-from"] },
  "git grep": { long: ["open-files-in-pager"], short: "O" },
};

function unsafeFlag(program: string, word: string): boolean {
  const rule = FLAG_RULES[program];
  if (!rule || !word.startsWith("-")) return false;
  if (rule.words?.includes(word) || (program === "find" && word.startsWith("-fprint"))) return true;
  if (word.startsWith("--")) {
    // GNU tools and git also take a unique prefix, such as --deref for --dereference.
    const name = word.slice(2).split("=")[0] ?? "";
    return name !== "" && (rule.long ?? []).some((long) => long.startsWith(name));
  }
  return [...(rule.short ?? "")].some((letter) => word.includes(letter));
}

/** Text the shell would expand or treat as syntax when it is not quoted. */
const SHELL_SYNTAX = /[`$;&<>(){}~*?[\]#!\n\r]/;

/** The words of each command in a pipeline, or null for syntax this check does not model. */
export function shellWords(command: string): string[][] | null {
  const commands: string[][] = [[]];
  let word: string | null = null;
  const end = () => {
    if (word !== null) commands[commands.length - 1]?.push(word);
    word = null;
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
      word = (word ?? "") + command.slice(index + 1, close);
      index = close;
    } else if (char === '"') {
      let text = "";
      for (index += 1; command[index] !== '"'; index += 1) {
        const inner = command[index];
        if (inner === undefined || inner === "$" || inner === "`") return null;
        const next = command[index + 1];
        if (inner === "\\" && next !== undefined && '$`"\\'.includes(next)) {
          text += next;
          index += 1;
        } else text += inner;
      }
      word = (word ?? "") + text;
    } else if (char === "\\") {
      const next = command[index + 1];
      if (next === undefined || next === "\n" || next === "\r") return null;
      word = (word ?? "") + next;
      index += 1;
    } else if (SHELL_SYNTAX.test(char)) return null;
    else word = (word ?? "") + char;
  }
  end();
  return commands.every((words) => words.length > 0) ? commands : null;
}

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

function realPath(filePath: string): string | null {
  try {
    return realpathSync(filePath);
  } catch {
    return null;
  }
}

/** False when the path is outside the folder, also through a link. A missing path cannot leak. */
function insideFolder(filePath: string, cwd: string): boolean {
  const same = filePath.replace(/\/+$/, "") === cwd.replace(/\/+$/, "");
  if (!same && relativePath(filePath, cwd) === null) return false;
  const real = realPath(path.resolve(cwd, filePath));
  if (real === null) return true;
  const relative = path.relative(realPath(cwd) ?? path.resolve(cwd), real);
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** A word that names a path outside the folder, also as the value of a flag such as --file=. */
function leavesFolder(program: string, word: string, cwd: string): boolean {
  const outside = (part: string) => part !== "" && !insideFolder(part, cwd);
  const value = word.includes("=") ? word.slice(word.indexOf("=") + 1) : "";
  if (word.startsWith("--")) return outside(value);
  // A short option can carry its value, such as -f/etc/passwd, so check what follows each letter.
  if (word.startsWith("-")) return [...word].some((_, index) => index > 1 && outside(word.slice(index)));
  // Git pathspec magic such as :/ reaches the top of the repository, above this folder.
  if (program.startsWith("git ") && word.startsWith(":")) return true;
  return outside(word) || outside(value);
}

export function readOnlyCommand(command: string, cwd: string): boolean {
  const commands = shellWords(command.replace(/\s2>\s*\/dev\/null/g, " ").trim());
  if (!commands) return false;
  return commands.every(([first = "", ...rest]) => {
    const git = first === "git";
    if (git ? !GIT_COMMANDS.has(rest[0] ?? "") : !PROGRAMS.has(first)) return false;
    const program = git ? `git ${rest[0]}` : first;
    const args = git ? rest.slice(1) : rest;
    return args.every((word) => !unsafeFlag(program, word) && !leavesFolder(program, word, cwd));
  });
}

/** Prompt lines that match what readOnlyAnswer allows. */
export const READ_ONLY_RULES = [
  "Read and search only. Do not create, edit, or delete files.",
  "To find files, use your read and search tools, or these shell commands, one at a time and",
  "without redirection: ls, find, rg, grep, cat, head, tail, wc, git ls-files, git grep.",
  "Quote wildcards, such as find . -name '*.ts'. Keep paths inside this folder.",
  "Other commands are denied.",
  "Work alone: do not start subagents or background tasks.",
];

const DENIED =
  "Not allowed in this read-only run. Read and search files in this repository only, one " +
  "command at a time, without redirection or unquoted wildcards.";

/** No one watches internal agents, so the plugin answers their prompts: reads yes, else no. */
export function readOnlyAnswer(request: PermissionRequest, cwd: string): PermissionAnswer {
  if (request.kind === "question") {
    return { behavior: "deny", message: "No one can answer here. Decide yourself and continue." };
  }
  const detail = request.detail;
  const input = request.input as { command?: unknown; path?: unknown; workdir?: unknown; cwd?: unknown } | undefined;
  // Without a detail, the tool input is the only place a provider puts the command.
  const command = detail?.type === "shell" ? detail.command : detail ? undefined : input?.command;
  const searchPath = typeof input?.path === "string" ? input.path : null;
  const workdir = [input?.workdir, input?.cwd].find((value) => typeof value === "string") as string | undefined;
  const allowed =
    request.kind === "tool" &&
    ((detail?.type === "read" && insideFolder(detail.filePath, cwd)) ||
      (detail?.type === "search" &&
        detail.toolName !== "web_search" &&
        (searchPath === null || insideFolder(searchPath, cwd))) ||
      (typeof command === "string" &&
        (workdir === undefined || insideFolder(workdir, cwd)) &&
        readOnlyCommand(command, cwd)));
  return allowed ? { behavior: "allow" } : { behavior: "deny", message: DENIED };
}
