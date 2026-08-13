import { describe, expect, it } from "vitest";
import {
  BYO_PROVIDER_PRESETS,
  chipLabelFromCatalog,
  matchByoPreset,
  mergeByoPresets,
  urlsMatch,
} from "./byoProviderPresets";

function preset(id: string) {
  const found = BYO_PROVIDER_PRESETS.find((item) => item.id === id);
  if (!found) throw new Error(`missing preset ${id}`);
  return found;
}

describe("byoProviderPresets", () => {
  it("keeps the settings page to a short vendor list, not a relay directory", () => {
    expect(BYO_PROVIDER_PRESETS.map((item) => item.id)).toEqual([
      "deepseek",
      "minimax",
      "360",
      "stepfun",
      "kimi",
      "openai",
    ]);
  });

  it("uses OpenAI-compatible URLs even when models.dev lists something else", () => {
    expect(preset("deepseek").baseUrl).toBe("https://api.deepseek.com/v1");
    expect(preset("minimax").baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(preset("minimax").baseUrl).not.toMatch(/anthropic/);
    expect(preset("360").baseUrl).toBe("https://api.360.cn/v1");
    expect(preset("openai").baseUrl).toBe("https://api.openai.com/v1");
    expect(preset("kimi").baseUrl).toBe("https://api.moonshot.cn/v1");
    expect(preset("stepfun").baseUrl).toBe("https://api.stepfun.com/v1");
  });

  it("still recognizes models.dev / historical aliases", () => {
    expect(matchByoPreset("https://api.deepseek.com")?.id).toBe("deepseek");
    expect(matchByoPreset("https://api.minimaxi.com/anthropic/v1")?.id).toBe("minimax");
    expect(matchByoPreset("https://api.openai.com/v1")?.id).toBe("openai");
  });

  it("takes chip labels from models.dev names, stripped for the row", () => {
    expect(preset("deepseek").models.slice(0, 2)).toEqual([
      { id: "deepseek-v4-flash", label: "V4 Flash" },
      { id: "deepseek-v4-pro", label: "V4 Pro" },
    ]);
    expect(preset("deepseek").models.map((model) => model.id)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      "deepseek-chat",
      "deepseek-reasoner",
    ]);
    expect(preset("openai").models.slice(0, 4).map((model) => model.id)).toEqual([
      "gpt-5.6",
      "gpt-5.5",
      "gpt-5.4",
      "gpt-5.4-mini",
    ]);
    expect(preset("openai").defaultModel).toBe("gpt-5.4-mini");
    expect(preset("stepfun").models[0]).toEqual({
      id: "step-3.7-flash",
      label: "3.7 Flash",
    });
    expect(preset("kimi").models.slice(0, 3).map((model) => model.id)).toEqual([
      "kimi-k3",
      "kimi-k2.6",
      "kimi-k2.7-code-highspeed",
    ]);
    expect(preset("kimi").defaultModel).toBe("kimi-k3");
  });

  it("keeps overlay-only models that models.dev does not list", () => {
    expect(preset("360").models.map((model) => model.id)).toEqual([
      "360gpt2-pro",
      "360gpt-pro",
      "360gpt-turbo",
    ]);
  });

  it("brings over mainstream chat models and skips non-chat / retired ids", () => {
    const openaiIds = preset("openai").models.map((model) => model.id);
    expect(openaiIds).toContain("gpt-5.6");
    expect(openaiIds).toContain("gpt-5.4-mini");
    expect(openaiIds).toContain("gpt-4o");
    expect(openaiIds.some((id) => /embedding|gpt-image|realtime|3\.5-turbo/i.test(id))).toBe(
      false
    );
    expect(openaiIds.length).toBeGreaterThan(10);

    expect(preset("minimax").models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed"])
    );
    expect(preset("kimi").models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["kimi-k3", "kimi-k2.5", "kimi-k2.7-code"])
    );
    expect(preset("kimi").models.some((model) => /0905|0711|preview/.test(model.id))).toBe(
      false
    );
    expect(preset("stepfun").models.map((model) => model.id)).toEqual(
      expect.arrayContaining(["step-3.7-flash", "step-3.5-flash"])
    );
    expect(preset("stepfun").models.every((model) => !/tts|asr|audio|^step-[12]-/i.test(model.id))).toBe(
      true
    );
  });

  it("lets overlay labels and catalog names merge without taking models.dev URLs", () => {
    const merged = mergeByoPresets(
      [
        {
          id: "minimax",
          name: "MiniMax",
          modelsDevId: "minimax-cn",
          baseUrl: "https://api.minimaxi.com/v1",
          models: [{ id: "MiniMax-M3" }],
          defaultModel: "MiniMax-M3",
        },
      ],
      {
        "minimax-cn": {
          id: "minimax-cn",
          name: "MiniMax (minimaxi.com)",
          api: "https://api.minimaxi.com/anthropic/v1",
          models: [{ id: "MiniMax-M3", name: "MiniMax-M3", status: "active" }],
        },
      }
    );

    expect(merged[0].baseUrl).toBe("https://api.minimaxi.com/v1");
    expect(merged[0].aliases).toContain("https://api.minimaxi.com/anthropic/v1");
    expect(merged[0].models[0].label).toBe("MiniMax-M3");
  });

  it("strips vendor prefixes for chips", () => {
    expect(chipLabelFromCatalog("DeepSeek V4 Flash", ["DeepSeek"])).toBe("V4 Flash");
    expect(chipLabelFromCatalog("Kimi K2 Thinking", ["Kimi"])).toBe("K2 Thinking");
  });

  it("treats a missing /v1 as the same endpoint", () => {
    expect(urlsMatch("https://api.deepseek.com/v1", "https://api.deepseek.com")).toBe(true);
  });
});
