import { describe, expect, it } from "vitest";
import { mergePreferences, parsePreferences, withLaunch } from "../client/agent-preferences";

describe("agent preferences", () => {
  it("reads Paseo's stored preferences and ignores anything unreadable", () => {
    const stored = JSON.stringify({
      provider: "claude",
      providerPreferences: { claude: { model: "opus", thinkingByModel: { opus: "high" } } },
      favoriteModels: [],
      isolation: "worktree",
    });
    expect(parsePreferences(stored)).toMatchObject({
      provider: "claude",
      providerPreferences: { claude: { model: "opus", thinkingByModel: { opus: "high" } } },
    });
    expect(parsePreferences(null)).toEqual({});
    expect(parsePreferences("{not json")).toEqual({});
    expect(parsePreferences(JSON.stringify({ provider: 3 }))).toEqual({});
  });

  it("layers plugin launches over Paseo per provider and model", () => {
    const paseo = {
      provider: "codex",
      providerPreferences: {
        codex: { model: "gpt", mode: "auto" },
        claude: { model: "sonnet", mode: "default", thinkingByModel: { sonnet: "low" } },
      },
    };
    const launched = withLaunch({}, { agent: "claude", model: "opus", effort: "high", mode: null });
    expect(mergePreferences(paseo, launched)).toEqual({
      provider: "claude",
      providerPreferences: {
        codex: { model: "gpt", mode: "auto" },
        claude: { model: "opus", mode: "default", thinkingByModel: { sonnet: "low", opus: "high" } },
      },
    });
  });
});
