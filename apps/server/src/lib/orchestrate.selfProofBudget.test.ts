import { afterEach, describe, expect, it, vi } from "vitest";

// 只替掉 provider 路由，保留 orchestrate 的真实接线：这一组测的是「自证调用有没有带上阶段预算」。
vi.mock("./providerRouter.js", () => ({
  callAgentWithFallback: vi.fn(async () => ({ output: { results: [] }, model: "stub:model", latencyMs: 1 })),
  providerOrderForAgent: vi.fn(() => ["minimax", "stepfun", "codex"]),
}));

import { createOrchestrateAdapter } from "./orchestrate.js";
import { callAgentWithFallback } from "./providerRouter.js";

const fallbackMock = vi.mocked(callAgentWithFallback);

const SELF_PROOF_STAGE_BUDGET_MS_DEFAULT = 45_000;
const SELF_PROOF_ATTEMPT_TIMEOUT_CAP_MS_DEFAULT = 25_000;

function callSelfProofOnce(env: Record<string, string>) {
  const adapter = createOrchestrateAdapter({ env, codexBin: "/usr/bin/codex" });
  return adapter.makeSelfProofCaller("隔夜菜亚硝酸盐超标百倍直接致癌？", undefined)({
    systemPrompt: "sys",
    userContent: "user",
    responseSchema: { type: "object" },
    maxTokens: 600,
  });
}

function optionsOfLastCall() {
  const params = fallbackMock.mock.calls.at(-1)?.[0] as
    | { options?: { deadlineMs?: number; attemptTimeoutCapMs?: number } }
    | undefined;
  return params?.options ?? {};
}

describe("orchestrate 自证阶段硬预算接线（主路 P1 Change H）", () => {
  afterEach(() => {
    fallbackMock.mockClear();
  });

  it("未配 env 时用默认值：阶段 45 秒、单次尝试 25 秒", async () => {
    const before = Date.now();
    await callSelfProofOnce({ MINIMAX_API_KEY: "sk-mm" });
    const options = optionsOfLastCall();

    expect(fallbackMock).toHaveBeenCalledTimes(1);
    expect(options.attemptTimeoutCapMs).toBe(SELF_PROOF_ATTEMPT_TIMEOUT_CAP_MS_DEFAULT);
    expect(options.deadlineMs).toBeGreaterThanOrEqual(before + SELF_PROOF_STAGE_BUDGET_MS_DEFAULT);
    expect(options.deadlineMs).toBeLessThan(before + SELF_PROOF_STAGE_BUDGET_MS_DEFAULT + 2_000);
  });

  it("env 可覆盖两个预算值", async () => {
    await callSelfProofOnce({
      MINIMAX_API_KEY: "sk-mm",
      ORCHESTRATE_SELFPROOF_STAGE_BUDGET_MS: "900",
      ORCHESTRATE_SELFPROOF_ATTEMPT_TIMEOUT_CAP_MS: "300",
    });
    const options = optionsOfLastCall();

    expect(options.attemptTimeoutCapMs).toBe(300);
    expect(options.deadlineMs).toBeLessThanOrEqual(Date.now() + 900);
  });

  it("每次自证调用各拿一份新预算（管道重试不会共享同一个 deadline）", async () => {
    const adapter = createOrchestrateAdapter({ env: { MINIMAX_API_KEY: "sk-mm" }, codexBin: "/usr/bin/codex" });
    const caller = adapter.makeSelfProofCaller("同一句话", undefined);
    const input = {
      systemPrompt: "sys",
      userContent: "user",
      responseSchema: { type: "object" },
      maxTokens: 600,
    };

    await caller(input);
    const first = optionsOfLastCall().deadlineMs ?? 0;
    await new Promise((resolve) => setTimeout(resolve, 25));
    await caller(input);
    const second = optionsOfLastCall().deadlineMs ?? 0;

    expect(second).toBeGreaterThan(first);
  });
});
