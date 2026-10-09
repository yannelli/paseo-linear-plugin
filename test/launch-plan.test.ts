import { describe, expect, it, vi } from "vitest";

// The plan's helpers are pure; stub the React Native imports the module pulls in.
vi.mock("../client/ui", () => ({ errorMessage: (error: unknown) => String(error) }));
vi.mock("@getpaseo/plugin/client", () => ({ usePaseo: () => null, useRpc: () => null }));
import type { AgentSelection } from "../client/agent-options";
import {
  agentLabel,
  assignmentRecord,
  type LaunchRequest,
  needsLinearTools,
  openWorkspace,
  type Paseo,
  placementOptions,
  resolvePlacement,
} from "../client/launch-plan";
import type { PaseoProjectOption } from "../client/queries";
import { GuidanceSchema, linearSettings } from "../shared/settings";

const project: PaseoProjectOption = {
  projectId: "p1",
  displayName: "App",
  rootPath: "/repo",
  kind: "git",
};

function placement(action: "implement" | "review", prNumber: number | null = null) {
  const options = placementOptions({
    action,
    prNumber,
    project,
    branchName: "me/pi-1-fix",
    target: null,
    agentWorkspace: null,
  });
  return {
    values: options.map((option) => option.value),
    worktree: resolvePlacement(options, null, action, "worktree")?.value,
    local: resolvePlacement(options, null, action, "workspace")?.value,
  };
}

describe("placement", () => {
  it("starts implementations in a new worktree unless isolation is off", () => {
    expect(placement("implement")).toEqual({
      values: ["worktree", "workspace"],
      worktree: "worktree",
      local: "workspace",
    });
  });

  it("reviews the pull request first, then the issue branch in a worktree", () => {
    expect(placement("review", 12)).toMatchObject({ worktree: "pull-request", local: "pull-request" });
    expect(placement("review")).toEqual({
      values: ["branch", "workspace"],
      worktree: "branch",
      local: "workspace",
    });
  });
});

describe("opening the issue branch", () => {
  function review(failure: Error) {
    const create = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue({ id: "w1" });
    const paseo = { workspaces: { create } } as unknown as Paseo;
    const request = {
      action: "review",
      placement: "branch",
      issue: { identifier: "PI-1", branchName: "me/pi-1-fix" },
      project,
    } as LaunchRequest;
    return { create, opened: openWorkspace(paseo, request) };
  }

  it("starts a new worktree when nobody pushed the branch", async () => {
    const { create, opened } = review(new Error("Unknown branch: me/pi-1-fix"));
    await expect(opened).resolves.toEqual({ id: "w1" });
    expect(create.mock.calls.map(([options]) => options.source.action)).toEqual([
      "checkout",
      "branch-off",
    ]);
    expect(create.mock.calls[1]?.[0].source).toMatchObject({ branchName: "me/pi-1-fix" });
  });

  it("reports other checkout failures", async () => {
    const { create, opened } = review(new Error("Branch already checked out"));
    await expect(opened).rejects.toThrow("Branch already checked out");
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("Linear tools at launch", () => {
  const tools = linearSettings.schema.parse({}).tools;
  const none = GuidanceSchema.parse({});

  it("asks for the tools only when an option needs them and they are on", () => {
    expect(needsLinearTools(none, tools, 0)).toBe(false);
    expect(needsLinearTools({ ...none, updateLinear: true }, tools, 0)).toBe(true);
    expect(needsLinearTools(none, tools, 1)).toBe(true);
    expect(needsLinearTools({ ...none, paseoSubagents: true }, { ...tools, enabled: false }, 2)).toBe(false);
  });

  it("names each chosen agent and keeps its config by issue key", () => {
    const selection = {
      agent: { id: "codex", label: "Codex" },
      model: { id: "gpt-5.5", label: "GPT-5.5" },
      effort: { id: "xhigh", label: "xhigh" },
      mode: { id: "auto", label: "Auto" },
    } as unknown as AgentSelection;
    expect(agentLabel(selection)).toBe("Codex · GPT-5.5 · Extra high");
    expect(assignmentRecord([{ identifier: "ENG-2", agent: selection }])).toEqual({
      "ENG-2": {
        config: { provider: "codex/gpt-5.5", thinkingOptionId: "xhigh", modeId: "auto" },
        label: "Codex · GPT-5.5 · Extra high",
      },
    });
  });
});
