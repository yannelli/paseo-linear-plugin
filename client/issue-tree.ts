import type { IssueSummary } from "../shared/linear";

const STATE_ORDER = [
  "started",
  "unstarted",
  "triage",
  "backlog",
  "completed",
  "canceled",
  "duplicate",
];

export type IssueListRow =
  | { kind: "header"; key: string; state: IssueSummary["state"]; count: number }
  | {
      kind: "issue";
      key: string;
      issue: IssueSummary;
      depth: number;
      /** Sub-issues of this issue that are in the list. */
      childCount: number;
      collapsed: boolean;
    };

export interface RowOptions {
  nested: boolean;
  collapsed: ReadonlySet<string>;
}

// Groups issues by workflow state and keeps the server's order in each group. When nested, a
// sub-issue shows under its parent if the parent is in the list, whatever its own state is.
export function buildIssueRows(
  issues: readonly IssueSummary[],
  options: RowOptions,
): IssueListRow[] {
  const children = new Map<string, IssueSummary[]>();
  let roots: readonly IssueSummary[] = issues;
  if (options.nested) {
    const ids = new Set(issues.map((issue) => issue.id));
    const nestedRoots: IssueSummary[] = [];
    for (const issue of issues) {
      const parentId = issue.parent?.id;
      if (parentId && parentId !== issue.id && ids.has(parentId)) {
        children.set(parentId, [...(children.get(parentId) ?? []), issue]);
      } else {
        nestedRoots.push(issue);
      }
    }
    roots = nestedRoots;
  }

  const rows: IssueListRow[] = [];
  const placed = new Set<string>();
  const place = (issue: IssueSummary, depth: number) => {
    if (placed.has(issue.id)) return;
    placed.add(issue.id);
    const kids = children.get(issue.id) ?? [];
    const collapsed = kids.length > 0 && options.collapsed.has(issue.id);
    rows.push({ kind: "issue", key: issue.id, issue, depth, childCount: kids.length, collapsed });
    if (collapsed) {
      markPlaced(kids, children, placed);
      return;
    }
    for (const child of kids) place(child, depth + 1);
  };
  const addGroups = (issues: readonly IssueSummary[], prefix: string) => {
    for (const group of groupByState(issues)) {
      const state = group[0]?.state;
      if (!state) continue;
      rows.push({ kind: "header", key: `${prefix}-${state.name}`, state, count: group.length });
      for (const issue of group) place(issue, 0);
    }
  };

  addGroups(roots, "header");
  // Parent loops have no root. Show those issues at the top level so none disappear.
  addGroups(
    issues.filter((issue) => !placed.has(issue.id)),
    "loop",
  );
  return rows;
}

function markPlaced(
  issues: readonly IssueSummary[],
  children: ReadonlyMap<string, IssueSummary[]>,
  placed: Set<string>,
) {
  for (const issue of issues) {
    if (placed.has(issue.id)) continue;
    placed.add(issue.id);
    markPlaced(children.get(issue.id) ?? [], children, placed);
  }
}

function groupByState(issues: readonly IssueSummary[]): IssueSummary[][] {
  const groups = new Map<string, IssueSummary[]>();
  for (const issue of issues) {
    const key = issue.state.name;
    groups.set(key, [...(groups.get(key) ?? []), issue]);
  }
  return [...groups.values()].sort((a, b) => {
    const left = a[0]?.state;
    const right = b[0]?.state;
    if (!left || !right) return 0;
    const byType = STATE_ORDER.indexOf(left.type) - STATE_ORDER.indexOf(right.type);
    return byType !== 0 ? byType : left.position - right.position;
  });
}

/** Adds or removes one parent in the collapsed list. */
export function toggleCollapsed(collapsed: readonly string[], issueId: string): string[] {
  return collapsed.includes(issueId)
    ? collapsed.filter((id) => id !== issueId)
    : [...collapsed, issueId];
}

export type Crumb<T> = { kind: "issue"; ref: T } | { kind: "more"; hidden: number };

/** Keeps the root and the direct parent and folds the middle of a long parent chain. */
export function crumbTrail<T>(ancestors: readonly T[], maxShown: number): Crumb<T>[] {
  if (ancestors.length <= maxShown || maxShown < 2) {
    return ancestors.map((ref) => ({ kind: "issue", ref }));
  }
  const head = ancestors.slice(0, 1);
  const tail = ancestors.slice(ancestors.length - (maxShown - 1));
  return [
    ...head.map((ref) => ({ kind: "issue" as const, ref })),
    { kind: "more", hidden: ancestors.length - head.length - tail.length },
    ...tail.map((ref) => ({ kind: "issue" as const, ref })),
  ];
}
