import { describe, expect, it } from "vitest";
import { toFriendlyError, toPublicStreamEvent } from "./handlers";
import { ProviderFallbackError } from "./lib/providerRouter";

const FALLBACK = "核查流程未能完成，请稍后重试";

describe("toFriendlyError — 顶层 error 出口收口", () => {
  it("普通 Error 时只返回友好文案，原始诊断不进入公开事件", () => {
    const raw =
      "request_id=req_9f2c quota=1000 provider=deepseek {\"error\":{\"message\":\"over limit\"}}";
    const info = toFriendlyError(new Error(raw), FALLBACK);

    expect(info.message).toBe(FALLBACK);
    // 原始诊断不得出现在用户可读 message
    expect(info.message).not.toContain("request_id");
    expect(info.message).not.toContain("quota");
    expect(info.message).not.toContain("deepseek");
    expect(info.message).not.toContain("over limit");
    expect(info.detail).toBeUndefined();
    expect(info.providerErrors).toBeUndefined();
  });

  it("ProviderFallbackError 也只返回调用方给定的公开文案", () => {
    const providerErrors = ["[deepseek:dp-v4] 401", "[minimax:m3] timeout"];
    const err = new ProviderFallbackError("所有备用模型均已调用失败，请检查模型配置或稍后重试", providerErrors);
    const info = toFriendlyError(err, FALLBACK);

    expect(info.message).toBe(FALLBACK);
    expect(info.message).not.toContain("401");
    expect(info.message).not.toContain("timeout");
    expect(info.detail).toBeUndefined();
    expect(info.providerErrors).toBeUndefined();
  });

  it("非 Error 非 string 的未知异常用 fallback 兜底，且无泄漏", () => {
    const info = toFriendlyError({ unexpected: "boom 401 quota" }, FALLBACK);
    expect(info.message).toBe(FALLBACK);
    expect(info.detail).toBeUndefined();
    expect(info.message).not.toContain("401");
    expect(info.message).not.toContain("quota");
  });

  it("SSE egress removes provider diagnostics even if an internal caller supplies them", () => {
    const event = toPublicStreamEvent({
      type: "agent_error",
      error: "DeepSeek quota exceeded",
      detail: "request_id=req_secret",
      providerErrors: ["[minimax] invalid api key"],
    });

    expect(event).toEqual({
      type: "agent_error",
      error: "这一步没能完成，核查会按现有材料继续",
    });
    expect(JSON.stringify(event)).not.toMatch(/DeepSeek|quota|request_id|minimax|api key/i);
  });

  it("SSE egress scrubs provider model names and latencyMs nested inside steps and reports", () => {
    const event = toPublicStreamEvent({
      type: "complete",
      claim: "原句",
      steps: [
        {
          agent: "rumor_detector",
          model: "minimax:MiniMax-M2.7-highspeed",
          latencyMs: 21500,
          output: { claimAtomSelfProof: { kept: [], model: "minimax:MiniMax-M2.7-highspeed" } },
        },
        {
          agent: "report_composer",
          model: "fallback:deterministic-report",
          latencyMs: 40,
        },
      ],
      finalReport: { verdictType: "false", _scoreSource: "minimax:MiniMax-M2.7-highspeed" },
    });

    const text = JSON.stringify(event);
    expect(text).not.toMatch(/minimax/i);
    expect(text).not.toContain("latencyMs");
    expect(text).toContain("fallback:deterministic-report");
    expect((event.finalReport as Record<string, unknown>).verdictType).toBe("false");
  });
});
