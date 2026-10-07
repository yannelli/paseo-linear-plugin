import { describe, expect, it } from "vitest";
import { buildIssueRows, crumbTrail, toggleCollapsed } from "../client/issue-tree";
import type { IssueSummary } from "../shared/linear";

const todo = { id: "s-todo", name: "Todo", type: "unstarted", color: "#999", position: 1 };
const doing = { id: "s-doing", name: "In Progress", type: "started", color: "#fc0", position: 2 };

function issue(id: string, parent: string | null, state = todo): IssueSummary {
  return {
    id,
    identifier: `ENG-${id}`,
    title: `Issue ${id}`,
    url: `https://linear.app/acme/issue/ENG-${id}`,
    branchName: `eng-${id}`,
    priority: 0,
    priorityLabel: "No priority",
    updatedAt: "2026-10-01T00:00:00.000Z",
    state,
    assignee: null,
    team: { id: "t", key: "ENG", name: "Engineering" },
    project: null,
    labels: [],
    parent: parent ? { id: parent, identifier: `ENG-${parent}`, title: `Issue ${parent}` } : null,
  };
}

const shape = (rows: ReturnType<typeof buildIssueRows>) =>
  rows.map((row) =>
    row.kind === "header" ? `# ${row.state.name} ${row.count}` : `${"  ".repeat(row.depth)}${row.issue.id}`,
  );

describe("issue tree", () => {
  const issues = [issue("1", null), issue("2", "1", doing), issue("3", "2"), issue("4", "99")];

  it("nests sub-issues under parents in the list, across states", () => {
    expect(shape(buildIssueRows(issues, { nested: true, collapsed: new Set() }))).toEqual([
      "# Todo 2",
      "1",
      "  2",
      "    3",
      "4",
    ]);
  });

  it("keeps a flat list grouped by state when nesting is off", () => {
    expect(shape(buildIssueRows(issues, { nested: false, collapsed: new Set() }))).toEqual([
      "# In Progress 1",
      "2",
      "# Todo 3",
      "1",
      "3",
      "4",
    ]);
  });

  it("hides every level under a collapsed parent and reports its direct sub-issues", () => {
    const rows = buildIssueRows(issues, { nested: true, collapsed: new Set(["1"]) });
    expect(shape(rows)).toEqual(["# Todo 2", "1", "4"]);
    expect(rows[1]).toMatchObject({ childCount: 1, collapsed: true });
  });

  it("shows issues in a parent loop instead of dropping them", () => {
    const loop = [issue("a", "b"), issue("b", "a")];
    const ids = buildIssueRows(loop, { nested: true, collapsed: new Set() })
      .filter((row) => row.kind === "issue")
      .map((row) => row.key);
    expect(ids.sort()).toEqual(["a", "b"]);
  });

  it("toggles a collapsed parent", () => {
    expect(toggleCollapsed(["1"], "2")).toEqual(["1", "2"]);
    expect(toggleCollapsed(["1", "2"], "1")).toEqual(["2"]);
  });
});

describe("breadcrumb trail", () => {
  it("folds the middle of a long chain", () => {
    expect(crumbTrail(["a", "b", "c", "d"], 2)).toEqual([
      { kind: "issue", ref: "a" },
      { kind: "more", hidden: 2 },
      { kind: "issue", ref: "d" },
    ]);
    expect(crumbTrail(["a", "b"], 2)).toHaveLength(2);
  });
});
