// Small parser for Linear-flavored markdown. Pure and runtime-neutral so the client
// renderer and the tests share it. Unknown syntax falls back to text; it never throws.

export type MarkdownText = { type: "text"; text: string };
export type MarkdownCode = { type: "code"; text: string };
export type MarkdownSpan = { type: "strong" | "emphasis" | "strike"; children: MarkdownInline[] };
export type MarkdownLink = { type: "link"; url: string; children: MarkdownInline[] };
export type MarkdownBreak = { type: "break" };
export type MarkdownInline =
  | MarkdownText
  | MarkdownCode
  | MarkdownSpan
  | MarkdownLink
  | MarkdownBreak;

export type MarkdownHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type MarkdownAlign = "left" | "center" | "right" | null;
export type MarkdownTableRow = MarkdownInline[][];
/** `checked` is null for a plain item, true or false for a task item. */
export type MarkdownListItem = { checked: boolean | null; children: MarkdownBlock[] };

export type MarkdownBlock =
  | { type: "heading"; level: MarkdownHeadingLevel; children: MarkdownInline[] }
  | { type: "paragraph"; children: MarkdownInline[] }
  | { type: "list"; ordered: boolean; start: number; items: MarkdownListItem[] }
  | { type: "code"; language: string | null; text: string }
  | { type: "blockquote"; children: MarkdownBlock[] }
  | { type: "rule" }
  | { type: "table"; align: MarkdownAlign[]; header: MarkdownTableRow; rows: MarkdownTableRow[] };

const MAX_DEPTH = 12;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const QUOTE = /^ {0,3}> ?/;
const LIST_ITEM = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TASK = /^\[([ xX])\](?:[ \t]+|$)/;
const DIVIDER = /^[ \t]*\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

export function safeUrl(url: string): string | null {
  const trimmed = url.trim();
  return /^(?:https?:\/\/|mailto:)\S/i.test(trimmed) ? trimmed : null;
}

export function parseMarkdown(source: string): MarkdownBlock[] {
  const text = typeof source === "string" ? source : "";
  try {
    return parseBlocks(text.replace(/\r\n?/g, "\n").split("\n"), 0);
  } catch {
    return text.trim() ? [{ type: "paragraph", children: [{ type: "text", text }] }] : [];
  }
}

function isBlank(line: string | undefined): boolean {
  return line === undefined || /^[ \t]*$/.test(line);
}

// Leading whitespace in columns (tabs stop at multiples of 4), measured up to `limit`.
function leading(line: string, limit = Infinity): { cols: number; chars: number } {
  let cols = 0;
  let chars = 0;
  for (; chars < line.length && cols < limit; chars++) {
    if (line[chars] === " ") cols += 1;
    else if (line[chars] === "\t") cols += 4 - (cols % 4);
    else break;
  }
  return { cols, chars };
}

const indentOf = (line: string) => leading(line).cols;

function dedent(line: string, cols: number): string {
  const lead = leading(line, cols);
  return " ".repeat(Math.max(0, lead.cols - cols)) + line.slice(lead.chars);
}

type Fence = { indent: number; marker: string; language: string | null };

function openFence(line: string): Fence | null {
  const match = FENCE.exec(line);
  if (!match || (match[2][0] === "`" && match[3].includes("`"))) return null;
  const language = match[3].trim().split(/\s+/)[0] || null;
  return { indent: match[1].length, marker: match[2], language };
}

function closesFence(line: string, marker: string): boolean {
  const run = /^ {0,3}(`+|~+)[ \t]*$/.exec(line)?.[1];
  return run !== undefined && run[0] === marker[0] && run.length >= marker.length;
}

// Escaped pipes become a placeholder so they survive the split, then turn back into "|".
function splitRow(line: string): string[] {
  const row = line.trim().replace(/\\\|/g, "\u0000").replace(/^\|/, "").replace(/\|$/, "");
  return row.split("|").map((cell) => cell.replace(/\u0000/g, "|").trim());
}

function alignOf(cell: string): MarkdownAlign {
  const left = cell.startsWith(":");
  const right = cell.endsWith(":");
  return left && right ? "center" : right ? "right" : left ? "left" : null;
}

function isTableStart(lines: string[], i: number): boolean {
  const divider = lines[i + 1];
  if (divider === undefined || !lines[i].includes("|") || !divider.includes("|")) return false;
  return DIVIDER.test(divider) && splitRow(lines[i]).length === splitRow(divider).length;
}

// True when the line starts a block that may interrupt a paragraph. Lists only
// interrupt with a non-empty bullet or a list starting at 1, as in CommonMark.
function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i];
  if (HEADING.test(line) || RULE.test(line) || QUOTE.test(line) || openFence(line)) return true;
  if (isTableStart(lines, i)) return true;
  const item = LIST_ITEM.exec(line);
  if (!item?.[4]?.trim()) return false;
  return !/\d/.test(item[2]) || parseInt(item[2], 10) === 1;
}

function parseBlocks(lines: string[], depth: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = openFence(line);
    const heading = HEADING.exec(line);
    if (isBlank(line)) i++;
    else if (fence) i = parseFence(lines, i, fence, blocks);
    else if (heading) {
      const level = heading[1].length as MarkdownHeadingLevel;
      blocks.push({ type: "heading", level, children: parseInline(heading[2] ?? "") });
      i++;
    } else if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      i++;
    } else if (depth < MAX_DEPTH && QUOTE.test(line)) i = parseQuote(lines, i, depth, blocks);
    else if (depth < MAX_DEPTH && LIST_ITEM.test(line)) i = parseList(lines, i, depth, blocks);
    else if (isTableStart(lines, i)) i = parseTable(lines, i, blocks);
    else i = parseParagraph(lines, i, blocks);
  }
  return blocks;
}

function parseFence(lines: string[], start: number, fence: Fence, out: MarkdownBlock[]): number {
  const body: string[] = [];
  let i = start + 1;
  while (i < lines.length && !closesFence(lines[i], fence.marker)) {
    body.push(dedent(lines[i++], fence.indent));
  }
  out.push({ type: "code", language: fence.language, text: body.join("\n") });
  return i + 1;
}

function parseQuote(lines: string[], start: number, depth: number, out: MarkdownBlock[]): number {
  const body: string[] = [];
  let i = start;
  for (; i < lines.length; i++) {
    const line = lines[i];
    if (QUOTE.test(line)) body.push(line.replace(QUOTE, ""));
    else if (isBlank(line) || isBlank(body[body.length - 1]) || startsBlock(lines, i)) break;
    else body.push(line);
  }
  out.push({ type: "blockquote", children: parseBlocks(body, depth + 1) });
  return i;
}

function parseList(lines: string[], start: number, depth: number, out: MarkdownBlock[]): number {
  const kind = (marker: string) => /\d/.test(marker);
  const first = LIST_ITEM.exec(lines[start]);
  const ordered = kind(first?.[2] ?? "-");
  const items: MarkdownListItem[] = [];
  let i = start;
  let match = first;
  while (match && kind(match[2]) === ordered) {
    const indent = indentOf(match[1]);
    const contentCol = indent + match[2].length + Math.min(match[3]?.length ?? 1, 4);
    const task = TASK.exec(match[4] ?? "");
    const body = [(match[4] ?? "").slice(task?.[0].length ?? 0)];
    let j = i + 1;
    // Lines indented 2+ columns past the marker belong to the item, as do blank lines
    // followed by such a line. Unindented text is a lazy paragraph continuation.
    while (j < lines.length) {
      const line = lines[j];
      if (isBlank(line)) {
        let k = j;
        while (k < lines.length && isBlank(lines[k])) k++;
        if (k >= lines.length || indentOf(lines[k]) < indent + 2) break;
        for (; j < k; j++) body.push("");
      } else if (indentOf(line) >= indent + 2) {
        body.push(dedent(line, contentCol));
        j++;
      } else if (LIST_ITEM.test(line) || startsBlock(lines, j)) break;
      else {
        body.push(line);
        j++;
      }
    }
    items.push({ checked: task ? task[1] !== " " : null, children: parseBlocks(body, depth + 1) });
    i = j;
    let k = j;
    while (k < lines.length && isBlank(lines[k])) k++;
    match = k < lines.length ? LIST_ITEM.exec(lines[k]) : null;
    if (match && kind(match[2]) === ordered) i = k;
  }
  const startAt = ordered ? parseInt(first?.[2] ?? "1", 10) : 1;
  out.push({ type: "list", ordered, start: startAt, items });
  return Math.max(i, start + 1);
}

function parseTable(lines: string[], start: number, out: MarkdownBlock[]): number {
  const header = splitRow(lines[start]);
  const align = splitRow(lines[start + 1]).map(alignOf);
  const cells = (row: string[]) => header.map((_, c) => parseInline(row[c] ?? ""));
  const rows: MarkdownTableRow[] = [];
  let i = start + 2;
  while (i < lines.length && lines[i].includes("|") && !startsBlock(lines, i)) {
    rows.push(cells(splitRow(lines[i++])));
  }
  out.push({ type: "table", align, header: cells(header), rows });
  return i;
}

function parseParagraph(lines: string[], start: number, out: MarkdownBlock[]): number {
  const body = [lines[start]];
  let i = start + 1;
  while (i < lines.length && !isBlank(lines[i]) && !startsBlock(lines, i)) body.push(lines[i++]);
  out.push({ type: "paragraph", children: parseInline(joinLines(body)) });
  return i;
}

// Soft wraps become spaces. Two trailing spaces or a trailing backslash become "\n",
// which the inline parser turns into a break node.
function joinLines(lines: string[]): string {
  return lines
    .map((raw, k) => {
      const line = raw.trimStart();
      if (k === lines.length - 1) return line.trimEnd();
      if (/ {2,}$/.test(line)) return `${line.trimEnd()}\n`;
      if (/(?:^|[^\\])\\$/.test(line)) return `${line.slice(0, -1)}\n`;
      return `${line.trimEnd()} `;
    })
    .join("");
}

type Token = { nodes: MarkdownInline[]; end: number };

const PUNCT = /[!-/:-@[-`{-~]/;
const ESCAPED = /\\([!-/:-@[-`{-~])/g;
// Letters and digits, approximated with ranges instead of \p{L} so older JS engines
// parse it. Skips the general punctuation, symbol and emoji (surrogate) ranges.
const ALNUM = /[0-9A-Za-zÀ-ɏͰ-῿Ⰰ-퟿豈-ￜ]/;
const SPECIAL = /[\\\n`*_~[!<hH]/g;
const AUTOLINK = /<(?:([a-z][a-z0-9+.-]{1,31}:[^\s<>]*)|([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+))>/iy;
const BARE_URL = /https?:\/\/[^\s<>]+/iy;
// "(url)" or "(url "title")". The url is <wrapped> or may hold one level of balanced parens.
const LINK_DEST =
  /\([ \t]*(?:<([^<>\n]*)>|((?:[^\s()\\]|\\.|\((?:[^\s()\\]|\\.)*\))*))(?:[ \t\n]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t\n]*\)/y;
const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);
const isWord = (ch: string | undefined) => ch !== undefined && ALNUM.test(ch);
const textToken = (text: string, end: number): Token => ({ nodes: [{ type: "text", text }], end });

// Caps delimiter and bracket scans per top-level inline run so that adversarial input
// stays linear. Once spent, the remaining delimiters are kept as plain text.
let scanBudget = 0;

function parseInline(text: string, depth = 0, inLink = false): MarkdownInline[] {
  if (depth === 0) scanBudget = 50000;
  if (depth > MAX_DEPTH) return text ? [{ type: "text", text }] : [];
  const out: MarkdownInline[] = [];
  let i = 0;
  while (i < text.length) {
    const token = readToken(text, i, depth, inLink);
    for (const node of token.nodes) push(out, node);
    i = Math.max(token.end, i + 1);
  }
  return out;
}

function push(out: MarkdownInline[], node: MarkdownInline): void {
  const last = out[out.length - 1];
  if (node.type !== "text") out.push(node);
  else if (last?.type === "text") last.text += node.text;
  else if (node.text) out.push({ type: "text", text: node.text });
}

function readToken(text: string, i: number, depth: number, inLink: boolean): Token {
  const ch = text[i];
  const next = text[i + 1];
  if (ch === "\\" && next !== undefined && PUNCT.test(next)) return textToken(next, i + 2);
  if (ch === "\n") return { nodes: [{ type: "break" }], end: i + 1 };
  if (ch === "`") {
    const span = codeSpan(text, i);
    if (span) return { nodes: [{ type: "code", text: span.text }], end: span.end };
    const run = runLength(text, i);
    return textToken("`".repeat(run), i + run);
  }
  if (ch === "*" || ch === "_" || ch === "~") return emphasis(text, i, depth, inLink);
  if (!inLink) {
    let token: Token | null = null;
    if (ch === "[" || (ch === "!" && next === "[")) token = readLink(text, i, depth);
    else if (ch === "<") token = readAutolink(text, i);
    else if (ch === "h" || ch === "H") token = readBareUrl(text, i);
    if (token) return token;
  }
  SPECIAL.lastIndex = i + 1;
  const end = SPECIAL.exec(text)?.index ?? text.length;
  return textToken(text.slice(i, end), end);
}

function runLength(text: string, i: number): number {
  let n = 0;
  while (text[i + n] === text[i]) n++;
  return n;
}

function codeSpan(text: string, i: number): { text: string; end: number } | null {
  const size = runLength(text, i);
  for (let j = text.indexOf("`", i + size); j >= 0; j = text.indexOf("`", j)) {
    const run = runLength(text, j);
    if (run === size) {
      let code = text.slice(i + size, j).replace(/\n/g, " ");
      if (/^ .*[^ ].* $/.test(code)) code = code.slice(1, -1);
      return { text: code, end: j + run };
    }
    j += run;
  }
  return null;
}

function emphasis(text: string, i: number, depth: number, inLink: boolean): Token {
  const ch = text[i];
  const run = runLength(text, i);
  if (isSpace(text[i + run]) || (ch === "_" && isWord(text[i - 1]))) {
    return textToken(text.slice(i, i + run), i + run);
  }
  const sizes = [3, 2, 1].filter((size) => size <= run && (ch !== "~" || size === 2));
  for (const size of sizes) {
    const close = findCloser(text, i + size, ch, size);
    if (close < 0) continue;
    const children = parseInline(text.slice(i + size, close), depth + 1, inLink);
    let node: MarkdownInline = { type: size === 1 ? "emphasis" : "strong", children };
    if (ch === "~") node = { type: "strike", children };
    if (size === 3) node = { type: "strong", children: [{ type: "emphasis", children }] };
    return { nodes: [node], end: close + size };
  }
  return textToken(ch, i + 1);
}

// Finds the closing delimiter run, skipping escapes, code spans and nested openers of
// the same character. Returns the index where the closing `size` characters begin.
function findCloser(text: string, from: number, ch: string, size: number): number {
  let nested = 0;
  let j = from;
  while (j < text.length && scanBudget-- > 0) {
    const c = text[j];
    if (c === "\\") j += 2;
    else if (c === "`") j = codeSpan(text, j)?.end ?? j + runLength(text, j);
    else if (c !== ch) j++;
    else {
      const run = runLength(text, j);
      const before = text[j - 1];
      const after = text[j + run];
      if (j > from && !isSpace(before) && !(ch === "_" && isWord(after))) {
        const used = Math.min(nested, run);
        nested -= used;
        if (run - used >= size) return j + used;
      } else if (!isSpace(after) && !(ch === "_" && isWord(before))) nested += run;
      j += run;
    }
  }
  return -1;
}

function readLink(text: string, i: number, depth: number): Token | null {
  const image = text[i] === "!";
  const open = image ? i + 1 : i;
  let close = -1;
  for (let j = open, level = 0; j < text.length && close < 0 && scanBudget-- > 0; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === "[") level++;
    else if (text[j] === "]" && --level === 0) close = j;
  }
  LINK_DEST.lastIndex = close + 1;
  const dest = close < 0 ? null : LINK_DEST.exec(text);
  if (!dest) return null;
  const target = (dest[1] ?? dest[2]).replace(ESCAPED, "$1");
  let children = parseInline(text.slice(open + 1, close), depth + 1, true);
  if (children.length === 0) children = [{ type: "text", text: image ? "image" : target }];
  const url = safeUrl(target);
  const end = close + 1 + dest[0].length;
  return { nodes: url ? [{ type: "link", url, children }] : children, end };
}

function readAutolink(text: string, i: number): Token | null {
  AUTOLINK.lastIndex = i;
  const match = AUTOLINK.exec(text);
  if (!match) return null;
  const label: MarkdownInline[] = [{ type: "text", text: match[1] ?? match[2] }];
  const url = safeUrl(match[1] ?? `mailto:${match[2]}`);
  const end = i + match[0].length;
  return { nodes: url ? [{ type: "link", url, children: label }] : label, end };
}

function readBareUrl(text: string, i: number): Token | null {
  if (isWord(text[i - 1])) return null;
  BARE_URL.lastIndex = i;
  let url = BARE_URL.exec(text)?.[0] ?? "";
  const count = (ch: string) => url.split(ch).length - 1;
  while (/[.,:;!?'"*_~)\]]$/.test(url) && !(url.endsWith(")") && count("(") >= count(")"))) {
    url = url.slice(0, -1);
  }
  const safe = safeUrl(url);
  const label: MarkdownInline[] = [{ type: "text", text: url }];
  if (!safe) return null;
  return { nodes: [{ type: "link", url: safe, children: label }], end: i + url.length };
}

/** Task items in document order. Renderers number checkboxes with this walk. */
export function taskItems(blocks: MarkdownBlock[]): MarkdownListItem[] {
  const out: MarkdownListItem[] = [];
  const walk = (children: MarkdownBlock[]) => {
    for (const block of children) {
      if (block.type === "blockquote") walk(block.children);
      if (block.type !== "list") continue;
      for (const item of block.items) {
        if (item.checked !== null) out.push(item);
        walk(item.children);
      }
    }
  };
  walk(blocks);
  return out;
}

// A "[ ]" or "[x]" after any quote and list markers. The parser has the final word.
const TASK_LINE = /^((?:[ \t]*(?:>[ \t]?|(?:[-*+]|\d{1,9}[.)])[ \t]+))+)\[[ xX]\](?=[ \t]|$)/;

const taskStates = (source: string) => taskItems(parseMarkdown(source)).map((item) => item.checked);

// Flips task `ordinal` (0-based, `taskItems` order) by changing only its box character.
// Returns null when no line maps to that task, so callers never save a guess.
export function toggleTask(source: string, ordinal: number): string | null {
  const before = taskStates(source);
  if (!Number.isInteger(ordinal) || ordinal < 0 || ordinal >= before.length) return null;
  const parts = source.split(/(\r\n?|\n)/);
  let offset = 0;
  let candidate = 0;
  for (let k = 0; k < parts.length; k += 2) {
    const match = TASK_LINE.exec(parts[k]);
    // Every task is a candidate and both run in document order, so earlier ones can't match.
    if (match && candidate++ >= ordinal) {
      const at = offset + match[1].length + 1;
      const next = `${source.slice(0, at)}${source[at] === " " ? "x" : " "}${source.slice(at + 1)}`;
      const after = taskStates(next);
      const flipsOnly = (state: boolean | null, n: number) => (n === ordinal) !== (state === before[n]);
      if (after.length === before.length && after.every(flipsOnly)) return next;
    }
    offset += parts[k].length + (parts[k + 1]?.length ?? 0);
  }
  return null;
}
