// Splits a shell command into words, operators, and redirects, the way the shell would
// before running it. Expansions are kept as text and marked, since their values are unknown.

export interface Word {
  kind: "word";
  text: string;
  /** Contains `$` or backtick expansion, so the shell may change the text. */
  dynamic: boolean;
  /** Index of the first unquoted glob character, or -1. */
  globAt: number;
}
export type Token = Word | { kind: "op"; text: string } | { kind: "redirect"; text: string };

function readExpansion(input: string, start: number): number {
  const open = input[start + 1];
  if (input[start] === "`") {
    const end = input.indexOf("`", start + 1);
    return end < 0 ? input.length : end + 1;
  }
  if (open === "(" || open === "{") {
    const close = open === "(" ? ")" : "}";
    let depth = 0;
    for (let index = start + 1; index < input.length; index += 1) {
      if (input[index] === open) depth += 1;
      else if (input[index] === close && --depth === 0) return index + 1;
    }
    return input.length;
  }
  let index = start + 1;
  while (index < input.length && /[A-Za-z0-9_@*#?!-]/.test(input[index] as string)) index += 1;
  return index === start + 1 ? start + 1 : index;
}

/** Splits a command into words, operators, and redirects. Heredoc bodies are skipped. */
export function lexShell(input: string): Token[] {
  const tokens: Token[] = [];
  const heredocs: { delimiter: string; strip: boolean }[] = [];
  let text: string | null = null;
  let dynamic = false;
  let globAt = -1;
  let index = 0;
  const add = (value: string) => {
    text = (text ?? "") + value;
  };
  const flush = () => {
    if (text !== null) tokens.push({ kind: "word", text, dynamic, globAt });
    text = null;
    dynamic = false;
    globAt = -1;
  };
  const skipHeredocs = () => {
    for (const { delimiter, strip } of heredocs.splice(0)) {
      while (index < input.length) {
        const end = input.indexOf("\n", index) < 0 ? input.length : input.indexOf("\n", index);
        const line = input.slice(index, end);
        index = end + 1;
        if ((strip ? line.replace(/^\t+/, "") : line) === delimiter) break;
      }
    }
  };
  while (index < input.length) {
    const char = input[index] as string;
    const next = input[index + 1] ?? "";
    if (char === "\n") {
      flush();
      tokens.push({ kind: "op", text: ";" });
      index += 1;
      skipHeredocs();
    } else if (char === " " || char === "\t" || char === "\r") {
      flush();
      index += 1;
    } else if (char === "#" && text === null) {
      while (index < input.length && input[index] !== "\n") index += 1;
    } else if (char === "\\") {
      if (next !== "\n") add(next);
      index += 2;
    } else if (char === "'") {
      const end = input.indexOf("'", index + 1);
      const stop = end < 0 ? input.length : end;
      add(input.slice(index + 1, stop));
      index = stop + 1;
    } else if (char === '"') {
      let value = "";
      index += 1;
      while (index < input.length && input[index] !== '"') {
        const inner = input[index] as string;
        if (inner === "\\" && '"\\$`'.includes(input[index + 1] ?? "")) {
          value += input[index + 1];
          index += 2;
          continue;
        }
        if (inner === "$" || inner === "`") dynamic = true;
        value += inner;
        index += 1;
      }
      add(value);
      index += 1;
    } else if (char === "$" || char === "`") {
      const end = readExpansion(input, index);
      dynamic = true;
      add(input.slice(index, end));
      index = end;
    } else if ((char === "&" || char === "|") && next === char) {
      flush();
      tokens.push({ kind: "op", text: char + char });
      index += 2;
    } else if (char === "&" && next === ">") {
      flush();
      tokens.push({ kind: "redirect", text: ">" });
      index += input[index + 2] === ">" ? 3 : 2;
    } else if (char === "|" || char === ";" || char === "&" || char === "(" || char === ")") {
      flush();
      tokens.push({ kind: "op", text: char === "|" ? "|" : ";" });
      index += char === "|" && next === "&" ? 2 : 1;
    } else if (char === ">" || char === "<") {
      // A bare number before the arrow is a file descriptor, as in `2>/dev/null`.
      if (text !== null && /^\d+$/.test(text) && !dynamic) text = null;
      else flush();
      if (char === "<" && next === "<" && input[index + 2] !== "<") {
        index += 2;
        const strip = input[index] === "-";
        if (strip) index += 1;
        while (input[index] === " ") index += 1;
        let delimiter = "";
        while (index < input.length && !/[\s;&|<>]/.test(input[index] as string)) {
          if (!`'"\\`.includes(input[index] as string)) delimiter += input[index];
          index += 1;
        }
        heredocs.push({ delimiter, strip });
        continue;
      }
      let operator = char;
      index += 1;
      while (input[index] === "<" || (char === ">" && input[index] === ">")) {
        operator += input[index];
        index += 1;
      }
      if (input[index] === "&") {
        index += 1;
        while (/[0-9-]/.test(input[index] ?? "")) index += 1;
        continue;
      }
      if (input[index] === "|") index += 1;
      tokens.push({ kind: "redirect", text: operator });
    } else {
      if (globAt < 0 && (char === "*" || char === "?" || char === "[")) globAt = (text ?? "").length;
      add(char);
      index += 1;
    }
  }
  flush();
  return tokens;
}

export interface SimpleCommand {
  words: Word[];
  redirects: { operator: string; target: Word }[];
}

export function splitCommands(tokens: readonly Token[]): SimpleCommand[] {
  const list: SimpleCommand[] = [];
  let current: SimpleCommand = { words: [], redirects: [] };
  let pending: string | null = null;
  for (const token of tokens) {
    if (token.kind === "op") {
      pending = null;
      if (current.words.length > 0 || current.redirects.length > 0) list.push(current);
      current = { words: [], redirects: [] };
    } else if (token.kind === "redirect") {
      pending = token.text;
    } else if (pending) {
      current.redirects.push({ operator: pending, target: token });
      pending = null;
    } else {
      current.words.push(token);
    }
  }
  if (current.words.length > 0 || current.redirects.length > 0) list.push(current);
  return list;
}
