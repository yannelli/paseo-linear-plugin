import { describe, expect, it, vi } from "vitest";

vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null }));
vi.mock("@getpaseo/plugin/client/react-native", () => ({ Icon: () => null }));
vi.mock("react-native", () => ({ Pressable: () => null, StyleSheet: { absoluteFillObject: {} }, Text: () => null, View: () => null }));
vi.mock("../client/ui", () => ({ usePressableStyle: () => ({}) }));
vi.mock("../client/provider-icon", () => ({ ProviderIcon: () => null }));
vi.mock("../client/live-issues", () => ({ MONO: "mono" }));
vi.mock("../client/live-timeline", () => ({ useAgentTimelines: () => new Map(), useSubagentLogs: () => ({ runs: [], checkedAt: 0 }) }));
import { childIssueKey, sameProject } from "../client/live-agents";

describe("child agents", () => {
  it("reads the issue from the Linear label, else a key at the start of the title", () => {
    expect(childIssueKey({ "linear.issue": "eng-7" }, "Other")).toBe("ENG-7");
    expect(childIssueKey({}, "ENG-42: Add the form")).toBe("ENG-42");
    expect(childIssueKey(undefined, "Fix ENG-42 later")).toBeNull();
    expect(childIssueKey(undefined, null)).toBeNull();
  });

  it("puts worktrees of the same project on the parent's map", () => {
    const projects = new Map([["w-parent", "p1"], ["w-child", "p1"], ["w-other", "p2"], ["w-none", null]]);
    expect(sameProject(projects, "w-parent", "w-child")).toBe(true);
    expect(sameProject(projects, "w-parent", "w-other")).toBe(false);
    expect(sameProject(projects, "w-none", "w-none")).toBe(false);
    expect(sameProject(undefined, "w-parent", "w-child")).toBe(false);
  });
});
