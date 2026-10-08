import { describe, expect, it } from "vitest";
import { deriveActivity, type TimelineItemLike } from "../shared/activity";

const CWD = "/repo";
const call = (callId: string, name: string, status: string, detail: Record<string, unknown>) =>
  ({ type: "tool_call", callId, name, status, detail }) as TimelineItemLike;

// The order Claude's Agent tool streams in, as recorded from a live run.
const launch = call("agent-1", "Agent", "completed", {
  type: "unknown",
  input: {
    subagent_type: "Explore",
    description: "Read two files and report first exports",
    prompt: "Read shared/settings.ts and shared/live.ts. Report the first export of each.",
  },
  output: { output: "Async agent launched successfully." },
});
const report = (status: string) =>
  call("task-1", "Task", status, {
    type: "sub_agent",
    subAgentType: "Explore",
    description: "Read two files and report first exports",
    log: "",
    actions: [],
  });

describe("subagents", () => {
  it("joins the launch and the report into one run with the files its prompt names", () => {
    const activity = deriveActivity([launch, report("running")], CWD);
    expect(activity.subagents).toEqual([
      {
        key: "Explore\u0000Read two files and report first exports",
        type: "Explore",
        description: "Read two files and report first exports",
        status: "running",
        targets: ["shared/settings.ts", "shared/live.ts"],
        order: 0,
      },
    ]);
    expect(activity.events.map((event) => [event.kind, event.text, event.status])).toEqual([
      ["agent", "Explore: Read two files and report first exports", "running"],
    ]);
    expect(activity.events[0]?.paths).toEqual(["shared/settings.ts", "shared/live.ts"]);
  });

  it("does not take the launch call's completion as the subagent finishing", () => {
    expect(deriveActivity([launch], CWD).subagents[0]?.status).toBe("running");
    expect(deriveActivity([launch, report("completed")], CWD).subagents[0]?.status).toBe("completed");
  });

  it("skips waits for background agents and reads stored runs without a prompt", () => {
    const stored = call("a", "Agent", "completed", {
      type: "sub_agent",
      subAgentType: "Explore",
      description: "Map the settings screens",
      log: "",
    });
    const wait = call("b", "Agent", "completed", {
      type: "sub_agent",
      subAgentType: "Explore",
      description: "Wait for agent results",
      log: "",
    });
    const activity = deriveActivity([stored, wait], CWD);
    expect(activity.subagents.map((run) => [run.description, run.status, run.targets])).toEqual([
      ["Map the settings screens", "completed", []],
    ]);
    expect(activity.events).toHaveLength(1);
  });
});
