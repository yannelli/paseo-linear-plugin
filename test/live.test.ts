import { describe, expect, it } from "vitest";
import { deriveActivity, relativePath } from "../shared/activity";
import type { WorkflowState } from "../shared/linear";
import { dirOf, lastJsonObject, semanticMap } from "../shared/live";
import { applyProposal, proposalDiffs } from "../shared/project-setup";
import { isInternalAgent } from "../shared/prompts";
import { emptyProjectConfig, projectEnabled, withProjectAccess } from "../shared/settings";
import { planStatusMoves, progressByKey, todoKey, todoLabel } from "../shared/todo-sync";

const states: WorkflowState[] = [
  { id: "backlog", name: "Backlog", type: "backlog", color: "#bbb", position: 0 },
  { id: "todo", name: "Todo", type: "unstarted", color: "#ccc", position: 1 },
  { id: "progress", name: "In Progress", type: "started", color: "#f2c94c", position: 2 },
  { id: "review", name: "In Review", type: "started", color: "#4cb782", position: 3 },
  { id: "done", name: "Done", type: "completed", color: "#5e6ad2", position: 4 },
  { id: "canceled", name: "Canceled", type: "canceled", color: "#999", position: 5 },
];
const at = (id: string) => states.find((state) => state.id === id) as WorkflowState;
const issue = (identifier: string, stateId: string) => ({
  id: identifier.toLowerCase(),
  identifier,
  state: at(stateId),
});
const todo = (text: string, status: "pending" | "in_progress" | "completed") => ({
  text,
  status,
  completed: status === "completed",
});

describe("todo keys", () => {
  it("accepts colon, dash, and bracket prefixes and ignores keys mid-sentence", () => {
    expect(todoKey("ENG-12: add queue")).toBe("ENG-12");
    expect(todoKey("eng-12 - add queue")).toBe("ENG-12");
    expect(todoKey("[ENG-12] add queue")).toBe("ENG-12");
    expect(todoKey("- ENG-12: add queue")).toBe("ENG-12");
    expect(todoKey("Fix the bug from ENG-12")).toBeNull();
    expect(todoLabel("ENG-12: add queue")).toBe("add queue");
  });

  it("aggregates several todos per key", () => {
    const progress = progressByKey([
      todo("ENG-2: a", "completed"),
      todo("ENG-2: b", "in_progress"),
      todo("ENG-3: c", "pending"),
      todo("untagged", "completed"),
    ]);
    expect(progress.get("ENG-2")).toEqual({ key: "ENG-2", total: 2, completed: 1, inProgress: 1 });
    expect(progress.get("ENG-3")?.total).toBe(1);
    expect(progress.size).toBe(2);
  });
});

describe("status moves", () => {
  const parent = (stateId: string, children: ReturnType<typeof issue>[]) => ({
    ...issue("ENG-1", stateId),
    children,
  });

  it("starts a sub-issue and the parent when work begins", () => {
    const moves = planStatusMoves({
      parent: parent("todo", [issue("ENG-2", "todo"), issue("ENG-3", "todo")]),
      progress: progressByKey([todo("ENG-2: a", "in_progress"), todo("ENG-3: b", "pending")]),
      states,
    });
    expect(moves.map((move) => [move.identifier, move.to.id])).toEqual([
      ["ENG-2", "progress"],
      ["ENG-1", "progress"],
    ]);
  });

  it("finishes sub-issues and stops the parent at review, never Done", () => {
    const moves = planStatusMoves({
      parent: parent("progress", [issue("ENG-2", "progress"), issue("ENG-3", "done")]),
      progress: progressByKey([todo("ENG-2: a", "completed"), todo("ENG-2: b", "completed")]),
      states,
    });
    expect(moves.map((move) => [move.identifier, move.to.id])).toEqual([
      ["ENG-2", "done"],
      ["ENG-1", "review"],
    ]);
  });

  it("never moves backward, never touches canceled issues, and ignores other keys", () => {
    const moves = planStatusMoves({
      parent: parent("review", [issue("ENG-2", "done"), issue("ENG-3", "canceled")]),
      progress: progressByKey([
        todo("ENG-2: redo", "in_progress"),
        todo("ENG-3: revive", "in_progress"),
        todo("OPS-9: unrelated", "completed"),
      ]),
      states,
    });
    expect(moves).toEqual([]);
  });

  it("skips sub-issues whose state belongs to another team", () => {
    const foreign = { id: "x", identifier: "OPS-4", state: { ...at("todo"), id: "ops-todo" } };
    const moves = planStatusMoves({
      parent: parent("progress", [foreign]),
      progress: progressByKey([todo("OPS-4: a", "completed")]),
      states,
    });
    expect(moves).toEqual([]);
  });
});

describe("activity", () => {
  const cwd = "/work/tree";
  const call = (callId: string, detail: Record<string, unknown>, status = "completed") => ({
    type: "tool_call",
    callId,
    name: "tool",
    status,
    detail,
  });

  it("derives touched files, diff counts, and the latest todo list", () => {
    const activity = deriveActivity(
      [
        call("1", { type: "read", filePath: "/work/tree/src/a.ts" }),
        call("2", { type: "edit", filePath: "src/a.ts", unifiedDiff: "--- a\n+++ b\n+x\n+y\n-z" }),
        call("3", { type: "write", filePath: "./src/new.ts", content: "a\nb\nc\n" }),
        call("4", { type: "search", query: "queue", filePaths: ["/work/tree/src/q.ts"] }),
        call("5", { type: "shell", command: "npm test", exitCode: 1 }, "failed"),
        { type: "todo", items: [todo("ENG-2: a", "in_progress")] },
        call("6", { type: "read", filePath: "/etc/passwd" }),
      ],
      cwd,
    );
    const byPath = new Map(activity.files.map((file) => [file.path, file]));
    expect(byPath.get("src/a.ts")).toMatchObject({ reads: 1, edits: 1, added: 2, removed: 1 });
    expect(byPath.get("src/new.ts")).toMatchObject({ created: true, added: 3 });
    expect(byPath.get("src/q.ts")?.last).toBe("search");
    expect(byPath.has("/etc/passwd")).toBe(false);
    expect(activity.events[0]?.text).toBe("Read passwd");
    expect(activity.events[1]).toMatchObject({ kind: "shell", exitCode: 1, status: "failed" });
    expect(activity.todos).toHaveLength(1);
  });

  it("keeps one event per call id and prefers a running call as current", () => {
    const activity = deriveActivity(
      [
        call("1", { type: "read", filePath: "src/a.ts" }),
        call("2", { type: "edit", filePath: "src/b.ts" }, "running"),
        call("3", { type: "read", filePath: "src/c.ts" }),
        call("2", { type: "edit", filePath: "src/b.ts", newString: "x" }, "running"),
      ],
      cwd,
    );
    expect(activity.events).toHaveLength(3);
    expect(activity.current?.path).toBe("src/b.ts");
  });

  it("rejects paths that leave the agent folder", () => {
    expect(relativePath("../secret.ts", cwd)).toBeNull();
    expect(relativePath("/work/tree/src/x.ts", cwd)).toBe("src/x.ts");
    expect(relativePath("/work/treehouse/x.ts", cwd)).toBeNull();
  });
});

describe("ticket text map", () => {
  it("assigns paths to the sub-issue their line names, else to the parent", () => {
    const map = semanticMap(
      {
        identifier: "ENG-1",
        title: "Offline drafts",
        description: [
          "Store drafts in `src/storage/drafts-db.ts`.",
          "ENG-3 changes src/sync/queue.ts and `src/sync/`.",
          "See https://example.com/docs/page.html for context.",
        ].join("\n"),
        children: [
          { identifier: "ENG-2", title: "Badge in Composer.tsx" },
          { identifier: "ENG-3", title: "Sync queue" },
        ],
      },
      new Date("2026-10-07T00:00:00Z"),
    );
    expect(map.files).toEqual([
      { path: "Composer.tsx", issue: "ENG-2" },
      { path: "src/storage/drafts-db.ts", issue: "ENG-1" },
      { path: "src/sync/queue.ts", issue: "ENG-3" },
      { path: "src/sync/", issue: "ENG-3" },
    ]);
    expect(dirOf("src/sync/queue.ts")).toBe("src/sync/");
    expect(dirOf("README.md")).toBe("");
  });
});

describe("agent replies", () => {
  it("finds the last JSON object in a fenced block, plain text, or prose", () => {
    expect(lastJsonObject('Done.\n```json\n{"a":1}\n```\n```json\n{"b":2}\n```')).toEqual({ b: 2 });
    expect(lastJsonObject('{"files":[]}')).toEqual({ files: [] });
    expect(lastJsonObject('Here it is: {"steps":["x"]} hope that helps')).toEqual({ steps: ["x"] });
    expect(lastJsonObject("no json here")).toBeNull();
  });

  it("marks explore and setup agents as internal", () => {
    expect(isInternalAgent({ "linear.explore": "ENG-1" })).toBe(true);
    expect(isInternalAgent({ "linear.issue": "ENG-1" })).toBe(false);
    expect(isInternalAgent(undefined)).toBe(false);
  });
});

describe("project setup proposals", () => {
  const config = emptyProjectConfig({ projectId: "p", displayName: "Shop", rootPath: "/shop" });
  const proposal = {
    instructions: "Use pnpm.",
    steps: [" Run pnpm test ", ""],
    implement: "",
    review: "Check migrations.",
  };

  it("lists only fields that change and appends accepted prompt text", () => {
    const diffs = proposalDiffs({ ...config, instructions: "Use pnpm." }, proposal);
    expect(diffs.map((diff) => diff.field)).toEqual(["steps", "review"]);
    expect(applyProposal(proposal, new Set(["steps", "review"]))).toEqual({
      steps: ["Run pnpm test"],
      review: { mode: "append", text: "Check migrations." },
    });
  });
});

describe("project access", () => {
  it("lets a project switch override the all-projects switch", () => {
    const on = { allProjects: true, projects: {} };
    const off = withProjectAccess(on, "p1", false);
    expect(off.projects).toEqual({ p1: false });
    expect(projectEnabled(off, "p1")).toBe(false);
    expect(projectEnabled(off, "p2")).toBe(true);
    expect(withProjectAccess(off, "p1", true).projects).toEqual({});
    const onlyOne = withProjectAccess({ allProjects: false, projects: {} }, "p3", true);
    expect(projectEnabled(onlyOne, "p3")).toBe(true);
    expect(projectEnabled(onlyOne, "p4")).toBe(false);
    expect(projectEnabled(onlyOne, null)).toBe(false);
  });
});
