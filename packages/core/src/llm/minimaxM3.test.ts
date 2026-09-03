import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildMiniMaxMessagesBody,
  miniMaxCallOptions,
  miniMaxM3ThinkingType,
  miniMaxMaxTokensForModel,
} from "./minimaxM3.js";

beforeEach(() => {
  vi.stubEnv("MINIMAX_M3_THINKING", "");
  vi.stubEnv("MINIMAX_M3_MAX_TOKENS", "");
  vi.stubEnv("MINIMAX_M3_MIN_MAX_TOKENS", "");
});

describe("minimaxM3", () => {
  it("effort low disables thinking; otherwise adaptive; max_tokens 用工单值", () => {
    expect(miniMaxM3ThinkingType({}, "MiniMax-M3", "low")).toBe("disabled");
    expect(miniMaxM3ThinkingType({}, "MiniMax-M3", "medium")).toBe("adaptive");
    expect(miniMaxCallOptions({}, "MiniMax-M3", 800, "low")).toEqual({
      maxTokens: 800,
      thinking: "disabled",
    });
    expect(miniMaxCallOptions({}, "MiniMax-M3", 4096, "medium")).toEqual({
      maxTokens: 4096,
      thinking: "adaptive",
    });
  });

  it("does not attach thinking controls to non-M3 models", () => {
    expect(miniMaxM3ThinkingType({}, "MiniMax-M2.5")).toBeUndefined();
    expect(buildMiniMaxMessagesBody({
      model: "MiniMax-M2.5",
      systemPrompt: "sys",
      userContent: "user",
      maxTokens: 800,
      thinking: miniMaxM3ThinkingType({}, "MiniMax-M2.5"),
    })).not.toHaveProperty("thinking");
  });

  it("reserves enough output budget for M2.7 highspeed reasoning plus JSON", () => {
    expect(miniMaxMaxTokensForModel({}, "MiniMax-M2.7-highspeed", 1200)).toBe(4096);
    expect(
      miniMaxMaxTokensForModel(
        { MINIMAX_M27_MIN_MAX_TOKENS: "6000" },
        "MiniMax-M2.7-highspeed",
        1200
      )
    ).toBe(6000);
  });

  it("only turns thinking off when explicitly disabled", () => {
    expect(miniMaxM3ThinkingType({ MINIMAX_M3_THINKING: "disabled" }, "MiniMax-M3")).toBe("disabled");
    expect(miniMaxMaxTokensForModel({ MINIMAX_M3_MAX_TOKENS: "524288" }, "MiniMax-M3", 800)).toBe(524288);
    expect(miniMaxMaxTokensForModel({}, "MiniMax-M3", 800)).toBe(800);
  });
});
