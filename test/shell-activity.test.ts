import { describe, expect, it } from "vitest";
import { deriveActivity, type TimelineItemLike } from "../shared/activity";
import { displayCommand, parseShell } from "../shared/shell-activity";

const CWD = "/repo";
const parse = (command: string) => parseShell(command, CWD);

describe("shell commands that read files", () => {
  it("expands a for loop over quoted paths", () => {
    const result = parse(
      'for f in "app/(auth)/layout.tsx" "app/(admin)/layout.tsx"; do echo "=== $f"; cat -n "$f"; done; ' +
        'grep -n "function SidebarInset" -A 15 components/ui/sidebar.tsx',
    );
    expect(result.reads).toEqual([
      "app/(auth)/layout.tsx",
      "app/(admin)/layout.tsx",
      "components/ui/sidebar.tsx",
    ]);
    expect(result.summary).toBe('Read layout.tsx, sidebar.tsx, searched "function SidebarInset"');
  });

  it("reads sed ranges, head, git show paths, and files after cd", () => {
    expect(parse("sed -n '90,110p;455,470p' 'app/(admin)/syncs/page.tsx'").reads).toEqual([
      "app/(admin)/syncs/page.tsx",
    ]);
    expect(parse("head -60 .agents/skills/linear/SKILL.md").reads).toEqual([
      ".agents/skills/linear/SKILL.md",
    ]);
    expect(
      parse("git show c7ccd17 -- 'app/(auth)/layout.tsx' | grep '^[-+]' | head -30").reads,
    ).toEqual(["app/(auth)/layout.tsx"]);
    expect(parse("git show HEAD:src/a.ts").reads).toEqual(["src/a.ts"]);
    expect(parse("cd src && cat a.ts").reads).toEqual(["src/a.ts"]);
    expect(parse("cd /repo && cat a.ts").reads).toEqual(["a.ts"]);
    expect(parse("git status -sb && ls && cat AGENTS.md 2>/dev/null | head -150").reads).toEqual([
      "AGENTS.md",
    ]);
  });

  it("ignores paths outside the folder and expansions it cannot know", () => {
    expect(parse("cat /etc/passwd ../x.ts ~/notes.md").reads).toEqual([]);
    expect(parse('cat "$(git ls-files | head -1)"').reads).toEqual([]);
    expect(parse("cat /repo/src/a.ts").reads).toEqual(["src/a.ts"]);
  });
});

describe("shell commands that search and list", () => {
  it("searches folders recursively and skips a grep that filters a pipe", () => {
    const result = parse('grep -rn "<main" app components --include=*.tsx | grep -v test');
    expect(result.reads).toEqual([]);
    expect(result.dirs).toEqual([
      { path: "app/", deep: true },
      { path: "components/", deep: true },
    ]);
    expect(result.summary).toBe('Searched "<main" in app, components');
  });

  it("reads files named by a search and explores the folder of a glob", () => {
    const result = parse("grep -n 'Empty\\|Error' 'app/(auth)/home/page.tsx' 'app/(admin)/x/[orgId]/'*.tsx");
    expect(result.reads).toEqual(["app/(auth)/home/page.tsx"]);
    expect(result.dirs).toEqual([{ path: "app/(admin)/x/[orgId]/", deep: true }]);
  });

  it("lists escaped folders, the root, and rg and find scopes", () => {
    const listed = parse("ls app/\\(auth\\) components/ui; ls playwright* 2>/dev/null");
    expect(listed.dirs).toEqual([
      { path: "app/(auth)/", deep: false },
      { path: "components/ui/", deep: false },
      { path: "", deep: false },
    ]);
    expect(listed.summary).toBe("Listed app/(auth), components/ui +1");
    expect(parse("rg -n useThing src -g '*.tsx'").dirs).toEqual([{ path: "src/", deep: true }]);
    expect(parse('find . -name "*.md" -path "*skills*" -print').dirs).toEqual([
      { path: "", deep: true },
    ]);
  });

  it("names the commands when nothing touched a file", () => {
    const result = parse(
      'linear issue view ENG-350 2>&1 | head -40; git -C /repo branch -r | grep -iE "queue|eng-35"',
    );
    expect(result.reads).toEqual([]);
    expect(result.pattern).toBeNull();
    expect(result.summary).toBe("Ran linear issue, git branch");
  });
});

describe("shell commands that write", () => {
  it("writes redirect targets and skips heredoc bodies", () => {
    const result = parse("cat > src/new.ts <<'EOF'\ncat other.ts\nEOF\necho done > /dev/null");
    expect(result.writes).toEqual([{ path: "src/new.ts", mode: "write" }]);
    expect(result.reads).toEqual([]);
  });

  it("edits with sed -i, tee -a, and append redirects", () => {
    expect(parse("sed -i 's/a/b/' src/a.ts").writes).toEqual([{ path: "src/a.ts", mode: "edit" }]);
    expect(parse("echo hi | tee -a log/out.txt").writes).toEqual([
      { path: "log/out.txt", mode: "edit" },
    ]);
    expect(parse("echo x >> notes.md").writes).toEqual([{ path: "notes.md", mode: "edit" }]);
  });
});

it("shows the command without a cd into the agent folder", () => {
  expect(displayCommand("cd /repo && ls /repo/src\nmore", CWD)).toBe("ls src");
});

describe("activity from shell calls", () => {
  const shell = (callId: string, command: string, extra: Record<string, unknown> = {}) =>
    ({
      type: "tool_call",
      callId,
      name: "Bash",
      status: "completed",
      detail: { type: "shell", command, ...extra },
    }) as TimelineItemLike;

  it("touches files that shell calls read and wrote, and hides bookkeeping tools", () => {
    const activity = deriveActivity(
      [
        shell("1", "cat src/a.ts && ls src/lib"),
        shell("2", "echo x > src/b.ts", { exitCode: 1 }),
        shell("3", "echo x > src/c.ts"),
        { type: "tool_call", callId: "4", name: "TaskCreate", status: "completed", detail: {} },
      ],
      CWD,
    );
    expect(activity.files.map((file) => [file.path, file.reads, file.edits, file.created])).toEqual([
      ["src/c.ts", 0, 1, true],
      ["src/a.ts", 1, 0, false],
    ]);
    expect(activity.dirs).toEqual([{ path: "src/lib/", deep: false, order: 0 }]);
    expect(activity.events.map((event) => [event.kind, event.text])).toEqual([
      ["write", "Wrote c.ts"],
      ["write", "Wrote b.ts"],
      ["read", "Read a.ts"],
    ]);
    expect(activity.events[2]?.detail).toBe("cat src/a.ts && ls src/lib");
  });
});

it("shortens long search patterns in the summary", () => {
  expect(parse("grep -rn 'CallSearch\\|CallTablePagination\\|EmptyState' app").summary).toBe(
    'Searched "CallSearch|CallTablePaginat…" in app',
  );
});
