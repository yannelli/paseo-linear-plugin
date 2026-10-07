import { describe, expect, it } from "vitest";
import { agentChoices, agentConfig, resolveAgent } from "../client/agent-options";

const efforts = [
  { id: "low", label: "Low" },
  { id: "high", label: "High", isDefault: true },
];

const full = {
  entries: [
    {
      provider: "claude",
      label: "Claude",
      status: "ready",
      modes: [
        { id: "default", label: "Ask" },
        { id: "bypass", label: "Full access" },
      ],
      defaultModeId: "default",
      models: [
        { id: "opus", label: "Opus", thinkingOptions: efforts, defaultThinkingOptionId: "low" },
        { id: "sonnet", label: "Sonnet", isDefault: true },
        { id: "hidden", label: "Hidden", isSelectable: false },
      ],
    },
    { provider: "codex", label: "Codex", status: "loading", models: [{ id: "gpt", label: "GPT" }] },
    { provider: "off", status: "ready", enabled: false, models: [{ id: "x", label: "X" }] },
  ],
};

describe("agent choices", () => {
  it("reads full snapshot entries and drops unusable agents and models", () => {
    const agents = agentChoices(full);
    expect(agents.map((agent) => agent.id)).toEqual(["claude"]);
    expect(agents[0]?.models.map((model) => model.id)).toEqual(["opus", "sonnet"]);
    expect(agents[0]?.models[0]).toMatchObject({
      defaultEffortId: "low",
      efforts: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    });
    expect(agents[0]?.models[1]).toMatchObject({ efforts: [], defaultEffortId: null });
  });

  it("reads effort sets from the compact snapshot", () => {
    const agents = agentChoices({
      entries: [],
      compactSnapshot: {
        thinkingSets: [{ options: efforts, defaultOptionId: "high" }],
        entries: [
          {
            provider: "codex",
            status: "ready",
            models: [
              { id: "a", label: "A", thinkingSet: 0 },
              { id: "b", label: "B", thinkingSet: 0, defaultThinkingOptionId: "low" },
              { id: "c", label: "C" },
            ],
          },
        ],
      },
    });
    const models = agents[0]?.models ?? [];
    expect(models.map((model) => [model.id, model.efforts.length, model.defaultEffortId])).toEqual([
      ["a", 2, "high"],
      ["b", 2, "low"],
      ["c", 0, null],
    ]);
  });

  it("falls back to defaults and drops an effort the new model does not have", () => {
    const agents = agentChoices(full);
    const none = { agent: null, model: null, effort: null, mode: null };
    const configured = resolveAgent(agents, none, "claude/opus");
    expect(configured && agentConfig(configured)).toEqual({
      provider: "claude/opus",
      thinkingOptionId: "low",
      modeId: "default",
    });
    const sonnet = resolveAgent(agents, { ...none, model: "sonnet", effort: "high" }, "");
    expect(sonnet && agentConfig(sonnet)).toEqual({ provider: "claude/sonnet", modeId: "default" });
    expect(resolveAgent([], none, "")).toBeNull();
  });
});
