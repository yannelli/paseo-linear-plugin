import { describe, expect, it } from "vitest";
import type { WorkflowState } from "../shared/linear";
import { projectEnabled, withProjectAccess } from "../shared/settings";
import { latestTodos, planStatusMoves, progressByKey, todoKey } from "../shared/todo-sync";

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

describe("todos in the timeline", () => {
  it("reads the latest todo list and skips other items", () => {
    const first = [todo("ENG-2: a", "pending")];
    const second = [todo("ENG-2: a", "completed")];
    const items = [
      { type: "todo", items: first },
      { type: "assistant_message", text: "Done." },
      { type: "todo", items: second },
      { type: "tool_call", name: "Read" },
    ];
    expect(latestTodos(items)).toBe(second);
    expect(latestTodos([{ type: "assistant_message" }])).toBeNull();
    expect(latestTodos([{ type: "todo" }])).toBeNull();
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
