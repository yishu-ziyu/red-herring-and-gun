// BDD 行为用例 S1-S4：buildStepFunRequestBody 的 wire body 构造
// 背景：StepFun reasoning 系列（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
// 三者皆会触发 400 Invalid request。这是用户遇到 6+ 次的根因。
import { describe, expect, it } from "vitest";
import { buildStepFunRequestBody } from "./agentProviders.js";

describe("buildStepFunRequestBody", () => {
  const messages = [
    { role: "system", content: "你是核查 Agent" },
    { role: "user", content: "分析这条 claim" },
  ];

  // S1: reasoning 模型剥掉三个 incompatible 字段,只留 model/messages/max_tokens
  it("S1: drops response_format / temperature / reasoning_effort for step-3.7-flash", () => {
    const body = buildStepFunRequestBody({
      model: "step-3.7-flash",
      messages,
      maxTokens: 4096,
      responseFormat: { type: "json_object" },
      temperature: 0.3,
      reasoningEffort: "low",
    });
    expect(body).toEqual({
      model: "step-3.7-flash",
      messages,
      max_tokens: 4096,
    });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  // S2: 普通 chat 模型三个字段全保留(行为回归保护)
  it("S2: keeps all three fields for plain chat model step-2-mini", () => {
    const body = buildStepFunRequestBody({
      model: "step-2-mini",
      messages,
      maxTokens: 1000,
      responseFormat: { type: "json_object" },
      temperature: 0.3,
      reasoningEffort: "high",
    });
    expect(body).toEqual({
      model: "step-2-mini",
      messages,
      max_tokens: 1000,
      response_format: { type: "json_object" },
      temperature: 0.3,
      reasoning_effort: "high",
    });
  });

  // S3: 视觉路径调用方不传 reasoningEffort(原本就没该字段),reasoning 模型仍正确剥掉另两个
  it("S3: vision call shape (no reasoningEffort) still strips response_format / temperature for reasoning model", () => {
    const body = buildStepFunRequestBody({
      model: "step-3.7-flash",
      messages,
      maxTokens: 1200,
      responseFormat: { type: "json_object" },
      temperature: 0.1,
    });
    expect(body).toEqual({
      model: "step-3.7-flash",
      messages,
      max_tokens: 1200,
    });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("temperature");
  });

  // S4: 大小写不敏感(API 返回的 model id 偶尔大写或带 -FLASH 后缀变体)
  it("S4: matches reasoning-model regex case-insensitively", () => {
    const variants = ["STEP-3.7-FLASH", "Step-3.7-Flash", "step-3.7-FLASH"];
    for (const model of variants) {
      const body = buildStepFunRequestBody({
        model,
        messages,
        maxTokens: 1000,
        responseFormat: { type: "json_object" },
        temperature: 0.3,
        reasoningEffort: "low",
      });
      expect(body).not.toHaveProperty("response_format");
      expect(body).not.toHaveProperty("temperature");
      expect(body).not.toHaveProperty("reasoning_effort");
    }
  });
});
