import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MINIMAX_M3_RECOMMENDED_MAX_TOKENS,
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
  it("keeps adaptive thinking on for MiniMax-M3 and uses MiniMax's recommended output budget", () => {
    expect(miniMaxM3ThinkingType({}, "MiniMax-M3")).toBe("adaptive");
    expect(miniMaxCallOptions({}, "MiniMax-M3", 800)).toEqual({
      maxTokens: MINIMAX_M3_RECOMMENDED_MAX_TOKENS,
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

  it("填表类带 temperature 0，开 thinking 时不带", () => {
    expect(buildMiniMaxMessagesBody({
      model: "MiniMax-M2.7-highspeed",
      systemPrompt: "sys",
      userContent: "user",
      maxTokens: 800,
      temperature: 0,
    })).toMatchObject({ temperature: 0 });
    expect(buildMiniMaxMessagesBody({
      model: "MiniMax-M3",
      systemPrompt: "sys",
      userContent: "user",
      maxTokens: 800,
      thinking: "adaptive",
      temperature: 0,
    })).not.toHaveProperty("temperature");
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
    expect(miniMaxMaxTokensForModel({ MINIMAX_M3_MIN_MAX_TOKENS: "5500" }, "MiniMax-M3", 800)).toBe(
      MINIMAX_M3_RECOMMENDED_MAX_TOKENS
    );
  });
});
