// BDD 行为用例 S1-S4：buildStepFunRequestBody 的 wire body 构造
// 背景：StepFun reasoning 系列（step-3.7-flash）拒收 response_format / temperature / reasoning_effort，
// 三者皆会触发 400 Invalid request。这是用户遇到 6+ 次的根因。
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildStepFunPlanBody,
  buildStepFunRequestBody,
  callMiniMaxAgent,
  callStepFunAgent,
  callStepFunPlanAgent,
} from "./agentProviders.js";

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

describe("buildStepFunPlanBody", () => {
  const base = {
    model: "step-3.7-flash",
    systemPrompt: "sys",
    userContent: "user",
    maxTokens: 4096,
  };

  it("low → thinking budget 1024 且 max_tokens 加上预算", () => {
    const body = buildStepFunPlanBody({ ...base, reasoningEffort: "low" });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(body.max_tokens).toBe(4096 + 1024);
  });

  it("medium → thinking budget 4096 且 max_tokens 加上预算", () => {
    const body = buildStepFunPlanBody({ ...base, reasoningEffort: "medium" });
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 4096 });
    expect(body.max_tokens).toBe(4096 + 4096);
  });

  it("high → 不发 thinking 且 max_tokens 原值", () => {
    const body = buildStepFunPlanBody({ ...base, reasoningEffort: "high" });
    expect(body).not.toHaveProperty("thinking");
    expect(body.max_tokens).toBe(4096);
  });
});

describe("callMiniMaxAgent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, ok = true) {
    return {
      ok,
      text: async () => JSON.stringify(body),
    };
  }

  it("sends adaptive thinking for MiniMax-M3 and returns text JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [
          { type: "thinking", thinking: "先拆命题" },
          { type: "text", text: '{"severity":"low"}' },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callMiniMaxAgent({
      baseUrl: "https://api.minimaxi.com/anthropic",
      apiKey: "sk-mm",
      model: "MiniMax-M3",
      systemPrompt: "sys",
      userContent: "user",
      maxTokens: 131072,
    });

    expect(result.text).toBe('{"severity":"low"}');
    expect(result.reasoning).toBe("先拆命题");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.thinking).toEqual({ type: "adaptive" });
    expect(body.stream).toBe(true);
    expect(body.max_tokens).toBe(131072);
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.minimaxi.com/anthropic/v1/messages");
  });

  it("streams thinking deltas to onThinking before the JSON text arrives", async () => {
    const sse =
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "先看原句" } })}\n\n` +
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "thinking_delta", thinking: "是否可核。" } })}\n\n` +
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: '{"severity":"low"}' } })}\n\n`;
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sse));
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
      headers: { get: () => "text/event-stream" },
    });
    vi.stubGlobal("fetch", fetchMock);
    const seen: string[] = [];

    const result = await callMiniMaxAgent({
      baseUrl: "https://api.minimaxi.com/anthropic",
      apiKey: "sk-mm",
      model: "MiniMax-M3",
      systemPrompt: "sys",
      userContent: "user",
      maxTokens: 131072,
      onThinking: (text) => seen.push(text),
    });

    expect(seen).toEqual(["先看原句", "先看原句是否可核。"]);
    expect(result.reasoning).toBe("先看原句是否可核。");
    expect(result.text).toBe('{"severity":"low"}');
  });
});

describe("StepFun token plan（Anthropic 协议 /step_plan）", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(body: unknown, ok = true) {
    return {
      ok,
      text: async () => JSON.stringify(body),
    };
  }

  it("plan 端点：/v1/messages + Bearer + system 字段，解析 thinking/text 块", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        content: [
          { type: "thinking", thinking: "先核对证据" },
          { type: "text", text: '{"verdict":"false"}' },
        ],
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callStepFunPlanAgent({
      baseUrl: "https://api.stepfun.com/step_plan",
      apiKey: "sk-sf",
      model: "step-3.7-flash",
      systemPrompt: "你是复核员",
      userContent: "判断",
      maxTokens: 512,
    });

    expect(result.text).toBe('{"verdict":"false"}');
    expect(result.reasoning).toBe("先核对证据");
    expect(result.model).toBe("stepfun:step-3.7-flash");
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.stepfun.com/step_plan/v1/messages");
    const init = fetchMock.mock.calls[0][1] as { headers: Record<string, string>; body: string };
    expect(init.headers.Authorization).toBe("Bearer sk-sf");
    expect(init.headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(init.body);
    expect(body.system).toBe("你是复核员");
    expect(body.messages).toEqual([{ role: "user", content: "判断" }]);
    expect(body.max_tokens).toBe(512);
  });

  it("callStepFunAgent 把 reasoningEffort 传进 plan 路径", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: [{ type: "text", text: '{"ok":true}' }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await callStepFunAgent({
      baseUrl: "https://api.stepfun.com/step_plan",
      apiKey: "sk-sf",
      model: "step-3.7-flash",
      systemPrompt: "s",
      userContent: "u",
      maxTokens: 4096,
      reasoningEffort: "low",
    });
    const body = JSON.parse((fetchMock.mock.calls[0][1] as { body: string }).body);
    expect(body.thinking).toEqual({ type: "enabled", budget_tokens: 1024 });
    expect(body.max_tokens).toBe(4096 + 1024);
  });

  it("callStepFunAgent 按 baseUrl 分流：含 /step_plan 走 plan 路径，否则 OpenAI 路径", async () => {
    const planBody = { content: [{ type: "text", text: '{"ok":true}' }] };
    const openAiBody = { choices: [{ message: { content: '{"ok":true}' } }] };
    const fetchMock = vi.fn(async (_url: string) => ({
      ok: true,
      text: async () => JSON.stringify(_url.includes("/step_plan") ? planBody : openAiBody),
      json: async () => (_url.includes("/step_plan") ? planBody : openAiBody),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await callStepFunAgent({
      baseUrl: "https://api.stepfun.com/step_plan",
      apiKey: "sk-sf",
      model: "step-3.7-flash",
      systemPrompt: "s",
      userContent: "u",
      maxTokens: 256,
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.stepfun.com/step_plan/v1/messages");

    await callStepFunAgent({
      baseUrl: "https://api.stepfun.com/v1",
      apiKey: "sk-sf",
      model: "step-2-mini",
      systemPrompt: "s",
      userContent: "u",
      maxTokens: 256,
    });
    expect(fetchMock.mock.calls[1][0]).toBe("https://api.stepfun.com/v1/chat/completions");
  });

  it("plan 端点报错透传：quota/402 文本进错误信息", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "quota exceeded", type: "quota_exceeded" } }, false)
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callStepFunPlanAgent({
        baseUrl: "https://api.stepfun.com/step_plan",
        apiKey: "sk-sf",
        model: "step-3.7-flash",
        systemPrompt: "s",
        userContent: "u",
        maxTokens: 256,
      })
    ).rejects.toThrow("quota exceeded");
  });

  it("plan 端点无 text 块（纯 thinking 截断）→ 显式报错不返回空文本", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ content: [{ type: "thinking", thinking: "思考中截断" }] })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callStepFunPlanAgent({
        baseUrl: "https://api.stepfun.com/step_plan",
        apiKey: "sk-sf",
        model: "step-3.7-flash",
        systemPrompt: "s",
        userContent: "u",
        maxTokens: 64,
      })
    ).rejects.toThrow("没有返回可解析文本");
  });
});
