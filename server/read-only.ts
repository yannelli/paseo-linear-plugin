import path from "node:path";
import type { PermissionAnswer, PermissionRequest } from "./agent-runs";
import { expandGlob, physicalPath, realPath, type ShellWord, shellWords } from "./shell-words";

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

/** How a search program reads its flags, so the check knows which word is the pattern. */
interface SearchFlags {
  /** Short options without a value. */
  plain: string;
  /** Short options that always take a value. */
  value: string;
  /** Long options without a value, and long options that always take one. */
  plainLong: readonly string[];
  valueLong: readonly string[];
}

const DIGITS = "0123456789";
const SEARCH_FLAGS: Record<string, SearchFlags> = {
  rg: {
    plain: "0abcHhiIlnNopqsSUuvVwxz.PF",
    value: "ABCdEgjMmrtT",
    plainLong: [
      "ignore-case", "smart-case", "case-sensitive", "line-number", "no-line-number", "word-regexp",
      "line-regexp", "files-with-matches", "files-without-match", "count", "count-matches",
      "invert-match", "only-matching", "fixed-strings", "hidden", "no-ignore", "no-ignore-vcs",
      "no-heading", "heading", "with-filename", "no-filename", "column", "vimgrep", "json",
      "multiline", "pcre2", "text", "trim", "stats", "null", "pretty", "quiet", "no-messages",
    ],
    valueLong: ["glob", "iglob", "type", "type-not", "max-count", "max-depth", "after-context", "before-context", "context"],
  },
  grep: {
    plain: `${DIGITS}abcEFGHhiIlLnoPqrsTUuvVwxyZz`,
    value: "ABCdDm",
    plainLong: [
      "recursive", "line-number", "ignore-case", "files-with-matches", "files-without-match",
      "word-regexp", "line-regexp", "invert-match", "count", "only-matching", "extended-regexp",
      "fixed-strings", "basic-regexp", "perl-regexp", "with-filename", "no-filename", "no-messages",
      "quiet", "silent", "text", "null", "null-data", "byte-offset", "color", "colour",
    ],
    valueLong: ["include", "exclude", "exclude-dir", "max-count"],
  },
  "git grep": {
    plain: `${DIGITS}acEFGHhiIlLnopPqrvwWz`,
    value: "ABCm",
    plainLong: [
      "line-number", "ignore-case", "files-with-matches", "name-only", "files-without-match",
      "word-regexp", "invert-match", "count", "only-matching", "extended-regexp", "fixed-strings",
      "basic-regexp", "perl-regexp", "cached", "untracked", "no-index", "full-name", "heading",
      "break", "show-function", "function-context", "text", "null", "quiet", "column", "color",
    ],
    valueLong: ["max-depth", "after-context", "before-context", "max-count"],
  },
};

/** -e, -f, and their long names make every operand a path. GNU tools also take a prefix. */
function namesPatterns(text: string): boolean {
  if (/^-[^-]/.test(text)) return /[ef]/.test(text);
  const name = text.slice(2).split("=")[0] ?? "";
  return text.startsWith("--") && name !== "" && ["regexp", "file", "files", "type-list"].some((long) => long.startsWith(name));
}

/**
 * Indexes of the words a search program reads as patterns, which need no path check. It reads
 * flags from the left and stops at the first one it does not know, so later words keep the check.
 */
function patternWords(program: string, args: readonly ShellWord[]): Set<number> {
  const flags = SEARCH_FLAGS[program];
  const patterns = new Set<number>();
  if (!flags) return patterns;
  const end = args.findIndex((word) => word.text === "--");
  const explicit = args.slice(0, end < 0 ? args.length : end).some((word) => namesPatterns(word.text));
  for (let index = 0; index < args.length; index += 1) {
    const { text, glob } = args[index] as ShellWord;
    if (glob !== null) return patterns;
    if (text === "--") {
      if (!explicit && args[index + 1]?.glob === null) patterns.add(index + 1);
      return patterns;
    }
    if (text.startsWith("--")) {
      const name = text.slice(2).split("=")[0] ?? "";
      if (name === "regexp") {
        if (text.includes("=")) patterns.add(index);
        else patterns.add(++index);
      } else if (flags.valueLong.includes(name) && !text.includes("=")) index += 1;
      else if (!text.includes("=") && !flags.plainLong.includes(name)) return patterns;
      continue;
    }
    if (text.startsWith("-") && text.length > 1) {
      for (let at = 1; at < text.length; at += 1) {
        const letter = text[at] as string;
        if (flags.plain.includes(letter)) continue;
        const attached = at + 1 < text.length;
        if (letter === "e") patterns.add(attached ? index : index + 1);
        else if (letter !== "f" && !flags.value.includes(letter)) return patterns;
        if (!attached) index += 1;
        break;
      }
      continue;
    }
    if (!explicit) patterns.add(index);
    return patterns;
  }
  return patterns;
}

/** False when the path exists outside the folder, also through a link. A missing path cannot leak. */
function insideFolder(filePath: string, cwd: string): boolean {
  const real = physicalPath(filePath, cwd);
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

const allowedWord = (program: string, text: string, cwd: string) =>
  !unsafeFlag(program, text) && !leavesFolder(program, text, cwd);

/** A pattern word: only the flag letters in front of an attached -e pattern are checked. */
function allowedPattern(program: string, text: string): boolean {
  if (!/^-[^-]/.test(text)) return true;
  return !unsafeFlag(program, text.slice(0, text.indexOf("e") + 1));
}

export function readOnlyCommand(command: string, cwd: string): boolean {
  const commands = shellWords(command.replace(/\s2>\s*\/dev\/null/g, " ").trim());
  if (!commands) return false;
  return commands.every((words) => {
    const [first, second] = words;
    if (!first || first.glob !== null) return false;
    const git = first.text === "git";
    if (git ? second?.glob !== null || !GIT_COMMANDS.has(second.text) : !PROGRAMS.has(first.text)) return false;
    const program = git ? `git ${second?.text}` : first.text;
    const args = words.slice(git ? 2 : 1);
    const patterns = patternWords(program, args);
    return args.every((word, index) => {
      if (patterns.has(index)) return allowedPattern(program, word.text);
      if (word.glob === null) return allowedWord(program, word.text, cwd);
      // The shell passes the matches, or the word itself when nothing matches.
      const matches = expandGlob(word.glob, cwd);
      if (matches === null) return false;
      return (matches.length > 0 ? matches : [word.text]).every((text) => allowedWord(program, text, cwd));
    });
  });
}

/** Prompt lines that match what readOnlyAnswer allows. */
export const READ_ONLY_RULES = [
  "Read and search only. Do not create, edit, or delete files.",
  "To find files, use your read and search tools, or these shell commands, one at a time and",
  "without redirection: ls, find, rg, grep, cat, head, tail, wc, git ls-files, git grep.",
  "Keep paths inside this folder. Other commands are denied.",
  "Work alone: do not start subagents or background tasks.",
];

const DENIED =
  "Not allowed in this read-only run. Read and search files in this repository only, one " +
  "command at a time, without redirection.";

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
