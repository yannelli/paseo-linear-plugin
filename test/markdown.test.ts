import { describe, expect, it } from "vitest";
import {
  type MarkdownInline,
  parseMarkdown,
  safeUrl,
  taskItems,
  toggleTask,
} from "../shared/markdown";

const text = (value: string) => ({ type: "text", text: value });
const code = (value: string) => ({ type: "code", text: value });
const strong = (...children: unknown[]) => ({ type: "strong", children });
const em = (...children: unknown[]) => ({ type: "emphasis", children });
const link = (url: string, ...children: unknown[]) => ({ type: "link", url, children });
const para = (...children: unknown[]) => ({ type: "paragraph", children });
const item = (...children: unknown[]) => ({ checked: null, children });
const bullets = (...items: unknown[]) => ({ type: "list", ordered: false, start: 1, items });

// Inline nodes of a source that should parse to exactly one paragraph.
function inline(source: string): MarkdownInline[] {
  const blocks = parseMarkdown(source);
  expect(blocks).toHaveLength(1);
  const [block] = blocks;
  return block?.type === "paragraph" ? block.children : [];
}

describe("parseMarkdown blocks", () => {
  it("returns no blocks for empty or blank input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("  \n\n\t\n")).toEqual([]);
  });

  it("parses ATX headings and leaves #tags as text", () => {
    expect(parseMarkdown("# One\n### Three ###\n###### Six\n####### seven\n#tag")).toEqual([
      { type: "heading", level: 1, children: [text("One")] },
      { type: "heading", level: 3, children: [text("Three")] },
      { type: "heading", level: 6, children: [text("Six")] },
      para(text("####### seven #tag")),
    ]);
  });

  it("joins soft wraps with spaces and keeps hard breaks", () => {
    expect(parseMarkdown("first line\nsecond line\n\nhard  \nbreak\\\nend")).toEqual([
      para(text("first line second line")),
      para(text("hard"), { type: "break" }, text("break"), { type: "break" }, text("end")),
    ]);
  });

  it("nests lists by indentation and keeps the ordered start", () => {
    const source = "3. three\n4. four\n   - nested\n     - deeper\n5. five";
    expect(parseMarkdown(source)).toEqual([
      {
        type: "list",
        ordered: true,
        start: 3,
        items: [
          item(para(text("three"))),
          item(
            para(text("four")),
            bullets(item(para(text("nested")), bullets(item(para(text("deeper")))))),
          ),
          item(para(text("five"))),
        ],
      },
    ]);
  });

  it("nests with tabs, splits list kinds, and folds lazy lines into the item", () => {
    expect(parseMarkdown("- a\n\t- b\nstill b\n1) one")).toEqual([
      bullets(item(para(text("a")), bullets(item(para(text("b still b")))))),
      { type: "list", ordered: true, start: 1, items: [item(para(text("one")))] },
    ]);
  });

  it("keeps a loose list together across blank lines", () => {
    expect(parseMarkdown("- a\n\n  more a\n\n- b")).toEqual([
      bullets(item(para(text("a")), para(text("more a"))), item(para(text("b")))),
    ]);
  });

  it("parses task items", () => {
    const [list] = parseMarkdown("- [ ] todo\n- [x] done\n* [X] also done\n- plain");
    expect(list).toEqual(
      bullets(
        { checked: false, children: [para(text("todo"))] },
        { checked: true, children: [para(text("done"))] },
        { checked: true, children: [para(text("also done"))] },
        item(para(text("plain"))),
      ),
    );
  });

  it("keeps fenced code verbatim without parsing markdown inside", () => {
    const source = "```ts\nconst a = **b**;\n- not a list\n\n  # indented\n```\n~~~\nplain\n~~~";
    expect(parseMarkdown(source)).toEqual([
      { type: "code", language: "ts", text: "const a = **b**;\n- not a list\n\n  # indented" },
      { type: "code", language: null, text: "plain" },
    ]);
    expect(parseMarkdown("```\nunclosed\n\nstill code")).toEqual([
      { type: "code", language: null, text: "unclosed\n\nstill code" },
    ]);
  });

  it("parses blockquotes recursively", () => {
    expect(parseMarkdown("> quote **bold**\n> - item\n>\n> > nested\n\nafter")).toEqual([
      {
        type: "blockquote",
        children: [
          para(text("quote "), strong(text("bold"))),
          bullets(item(para(text("item")))),
          { type: "blockquote", children: [para(text("nested"))] },
        ],
      },
      para(text("after")),
    ]);
  });

  it("parses horizontal rules", () => {
    const rule = { type: "rule" };
    expect(parseMarkdown("a\n\n---\n***\n___\n- - -")).toEqual([
      para(text("a")),
      rule,
      rule,
      rule,
      rule,
    ]);
  });

  it("parses GFM tables with alignment and padded rows", () => {
    const source =
      "Intro\n| Name | Value |\n| :--- | ---: |\n| `a` | **b** |\n| c \\| d |\n\nafter";
    expect(parseMarkdown(source)).toEqual([
      para(text("Intro")),
      {
        type: "table",
        align: ["left", "right"],
        header: [[text("Name")], [text("Value")]],
        rows: [
          [[code("a")], [strong(text("b"))]],
          [[text("c | d")], []],
        ],
      },
      para(text("after")),
    ]);
  });
});

describe("parseMarkdown inline", () => {
  it("nests bold, code, links, italic and strikethrough", () => {
    expect(
      inline("**bold with `code` and [link](https://x.dev)** *em* _em2_ ~~gone~~ ***both***"),
    ).toEqual([
      strong(text("bold with "), code("code"), text(" and "), link("https://x.dev", text("link"))),
      text(" "),
      em(text("em")),
      text(" "),
      em(text("em2")),
      text(" "),
      { type: "strike", children: [text("gone")] },
      text(" "),
      strong(em(text("both"))),
    ]);
  });

  it("handles emphasis nested inside emphasis", () => {
    expect(inline("*foo **bar***")).toEqual([em(text("foo "), strong(text("bar")))]);
    expect(inline("**a *b* c**")).toEqual([strong(text("a "), em(text("b")), text(" c"))]);
  });

  it("does not treat snake_case or spaced asterisks as emphasis", () => {
    expect(inline("snake_case_words and file_name.ts")).toEqual([
      text("snake_case_words and file_name.ts"),
    ]);
    expect(inline("2 * 3 * 4 and **")).toEqual([text("2 * 3 * 4 and **")]);
    expect(inline("_snake_case_")).toEqual([em(text("snake_case"))]);
    expect(inline("café_au_lait и_так_далее")).toEqual([text("café_au_lait и_так_далее")]);
  });

  it("parses code spans with matching backtick runs", () => {
    expect(inline("``a ` b`` and `**raw**` and `unclosed")).toEqual([
      code("a ` b"),
      text(" and "),
      code("**raw**"),
      text(" and `unclosed"),
    ]);
  });

  it("autolinks angle URLs, emails and bare URLs", () => {
    expect(inline("<https://a.dev/x> and https://b.dev/y. (https://c.dev) <me@x.dev>")).toEqual([
      link("https://a.dev/x", text("https://a.dev/x")),
      text(" and "),
      link("https://b.dev/y", text("https://b.dev/y")),
      text(". ("),
      link("https://c.dev", text("https://c.dev")),
      text(") "),
      link("mailto:me@x.dev", text("me@x.dev")),
    ]);
  });

  it("does not autolink inside link text and keeps parens in URLs", () => {
    expect(inline("[https://a.dev](https://b.dev/Foo_(bar))")).toEqual([
      link("https://b.dev/Foo_(bar)", text("https://a.dev")),
    ]);
  });

  it("renders images as links with alt text", () => {
    const source = "![screenshot](https://uploads.linear.app/x.png) ![](https://u.dev/y.png)";
    expect(inline(source)).toEqual([
      link("https://uploads.linear.app/x.png", text("screenshot")),
      text(" "),
      link("https://u.dev/y.png", text("image")),
    ]);
  });

  it("turns unsafe link schemes into plain text", () => {
    const source =
      "[click](javascript:alert(1)) and <javascript:alert(2)> ![x](data:image/png;base64,AA)";
    expect(inline(source)).toEqual([text("click and javascript:alert(2) x")]);
    expect(inline("[rel](/issues/1) [file](file:///etc/passwd)")).toEqual([text("rel file")]);
  });

  it("applies backslash escapes", () => {
    expect(parseMarkdown("\\# not heading\n\n\\- not list")).toEqual([
      para(text("# not heading")),
      para(text("- not list")),
    ]);
    expect(inline("\\*not em\\* \\`not code\\` a\\_b \\[x](y) C:\\path")).toEqual([
      text("*not em* `not code` a_b [x](y) C:\\path"),
    ]);
  });
});

describe("safeUrl", () => {
  it("allows only http, https and mailto", () => {
    expect(safeUrl(" https://linear.app/a ")).toBe("https://linear.app/a");
    expect(safeUrl("HTTP://example.com")).toBe("HTTP://example.com");
    expect(safeUrl("mailto:a@b.dev")).toBe("mailto:a@b.dev");
    const unsafe = ["javascript:alert(1)", "data:text/html,x", "file:///etc", "/rel", ""];
    for (const url of [...unsafe, "https://", " \tjavascript:x"]) expect(safeUrl(url)).toBeNull();
  });
});

describe("parseMarkdown robustness", () => {
  it("never throws on malformed input", () => {
    const inputs = ["**", "[", "](", "[a](", "```", "> ", "- ", "|", "~~", "`", "![", "<", "_"];
    inputs.push("*a", "\\", "| a |\n|---|", "1.", "- [ ]", "[a]( b", "<a@b>", "~~~ js");
    for (const source of inputs) expect(() => parseMarkdown(source)).not.toThrow();
    expect(() => parseMarkdown(`${">".repeat(500)} deep`)).not.toThrow();
    expect(() => parseMarkdown(`${"*a ".repeat(2000)}`)).not.toThrow();
    expect(() => parseMarkdown(`${"  ".repeat(200)}- x\n`.repeat(50))).not.toThrow();
  });
});

describe("Linear description", () => {
  it("parses a realistic issue description", () => {
    const source =
      "Combine the escalation line and transfer offer.\n\nBranch: `fix/tool-call-latency`\n\n" +
      "## Work\n\n* In `lib/a.ts`, move the offer into the node and remove `EscalationNode`.\n" +
      "* Keep **Extract** as the first node.\n  * nested detail\n\n1. one\n2. two";
    expect(parseMarkdown(source)).toEqual([
      para(text("Combine the escalation line and transfer offer.")),
      para(text("Branch: "), code("fix/tool-call-latency")),
      { type: "heading", level: 2, children: [text("Work")] },
      bullets(
        item(
          para(
            text("In "),
            code("lib/a.ts"),
            text(", move the offer into the node and remove "),
            code("EscalationNode"),
            text("."),
          ),
        ),
        item(
          para(text("Keep "), strong(text("Extract")), text(" as the first node.")),
          bullets(item(para(text("nested detail")))),
        ),
      ),
      {
        type: "list",
        ordered: true,
        start: 1,
        items: [item(para(text("one"))), item(para(text("two")))],
      },
    ]);
  });
});

describe("toggleTask", () => {
  const states = (source: string) => taskItems(parseMarkdown(source)).map((item) => item.checked);

  it("numbers tasks in document order, through nested lists and quotes", () => {
    const source = "- [ ] a\n  - [x] b\n- plain\n> - [ ] c\n>   1. [X] d";
    expect(states(source)).toEqual([false, true, false, true]);
  });

  it("flips only the box character", () => {
    expect(toggleTask("- [ ] todo\n- [x] done", 0)).toBe("- [x] todo\n- [x] done");
    expect(toggleTask("- [ ] todo\n- [x] done", 1)).toBe("- [ ] todo\n- [ ] done");
    expect(toggleTask("* [X] **bold** text", 0)).toBe("* [ ] **bold** text");
    expect(toggleTask("3) [ ] ordered", 0)).toBe("3) [x] ordered");
  });

  it("flips the right one of two identical items", () => {
    expect(toggleTask("- [ ] same\n- [ ] same", 1)).toBe("- [ ] same\n- [x] same");
  });

  it("reaches tasks in nested lists and quotes", () => {
    const source = "- [ ] a\n  - [x] b\n> - [ ] c\n>   1. [X] d";
    expect(toggleTask(source, 1)).toBe("- [ ] a\n  - [ ] b\n> - [ ] c\n>   1. [X] d");
    expect(toggleTask(source, 2)).toBe("- [ ] a\n  - [x] b\n> - [x] c\n>   1. [X] d");
    expect(toggleTask(source, 3)).toBe("- [ ] a\n  - [x] b\n> - [ ] c\n>   1. [ ] d");
  });

  it("skips task syntax inside fenced code", () => {
    const source = "```\n- [ ] code\n```\n- [ ] real\n  ```\n  - [ ] nested code\n  ```\n- [ ] last";
    expect(states(source)).toEqual([false, false]);
    expect(toggleTask(source, 0)).toBe(source.replace("- [ ] real", "- [x] real"));
    expect(toggleTask(source, 1)).toBe(source.replace("- [ ] last", "- [x] last"));
  });

  it("keeps CRLF line endings", () => {
    expect(toggleTask("intro\r\n\r\n- [ ] a\r\n- [ ] b\r\n", 1)).toBe(
      "intro\r\n\r\n- [ ] a\r\n- [x] b\r\n",
    );
  });

  it("returns null when the task does not exist", () => {
    expect(toggleTask("- [ ] only", 1)).toBeNull();
    expect(toggleTask("- [ ] only", -1)).toBeNull();
    expect(toggleTask("- [ ] only", 0.5)).toBeNull();
    expect(toggleTask("no tasks here", 0)).toBeNull();
  });
});
