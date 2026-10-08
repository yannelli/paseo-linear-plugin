import { describe, expect, it } from "vitest";
import { deriveActivity, type TimelineItemLike } from "../shared/activity";

const CWD = "/repo";
const read = (callId: string, path: string, status = "completed") =>
  ({ type: "tool_call", callId, name: "Read", status, detail: { type: "read", filePath: `/repo/${path}` } }) as TimelineItemLike;
const todos = (...items: [string, "pending" | "in_progress" | "completed"][]) =>
  ({ type: "todo", items: items.map(([text, status]) => ({ text, status, completed: status === "completed" })) }) as TimelineItemLike;

describe("agent focus", () => {
  it("follows file, then the issue whose todo started, then the next file", () => {
    const first = [read("a", "src/a.ts")];
    expect(deriveActivity(first, CWD).focus).toEqual({ kind: "file", path: "src/a.ts" });
    const started = [...first, todos(["ENG-2: build it", "in_progress"])];
    expect(deriveActivity(started, CWD).focus).toEqual({ kind: "issue", key: "ENG-2" });
    const next = [...started, read("b", "src/b.ts")];
    expect(deriveActivity(next, CWD).focus).toEqual({ kind: "file", path: "src/b.ts" });
  });

  it("does not move to the issue again when the same todo list is sent again", () => {
    const items = [
      todos(["ENG-2: build it", "in_progress"]),
      read("b", "src/b.ts"),
      todos(["ENG-2: build it", "in_progress"], ["ENG-3: test it", "pending"]),
    ];
    expect(deriveActivity(items, CWD).focus).toEqual({ kind: "file", path: "src/b.ts" });
  });

  it("keeps a call at the point where it started when later copies stream in", () => {
    const items = [
      read("a", "src/a.ts", "running"),
      read("b", "src/b.ts"),
      read("a", "src/a.ts", "completed"),
    ];
    expect(deriveActivity(items, CWD).focus).toEqual({ kind: "file", path: "src/b.ts" });
  });

  it("prefers a running call over newer finished work", () => {
    const items = [read("a", "src/a.ts", "running"), todos(["ENG-3: test it", "in_progress"])];
    expect(deriveActivity(items, CWD).focus).toEqual({ kind: "file", path: "src/a.ts" });
  });

  it("ignores files a subagent was asked about", () => {
    const launch = {
      type: "tool_call",
      callId: "agent-1",
      name: "Agent",
      status: "completed",
      detail: { type: "unknown", input: { subagent_type: "Explore", description: "Look", prompt: "Read src/c.ts" } },
    } as TimelineItemLike;
    expect(deriveActivity([read("a", "src/a.ts"), launch], CWD).focus).toEqual({ kind: "file", path: "src/a.ts" });
  });
});
