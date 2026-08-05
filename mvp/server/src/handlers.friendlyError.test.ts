import { describe, expect, it } from "vitest";
import { toFriendlyError } from "./handlers";
import { ProviderFallbackError } from "./lib/providerRouter";

const FALLBACK = "核查流程未能完成，请稍后重试";

describe("toFriendlyError — 顶层 error 出口收口", () => {
  it("普通 Error 时 message 只放友好文案，原始诊断进 detail 且不进 message", () => {
    const raw =
      "request_id=req_9f2c quota=1000 provider=deepseek {\"error\":{\"message\":\"over limit\"}}";
    const info = toFriendlyError(new Error(raw), FALLBACK);

    expect(info.message).toBe(FALLBACK);
    // 原始诊断不得出现在用户可读 message
    expect(info.message).not.toContain("request_id");
    expect(info.message).not.toContain("quota");
    expect(info.message).not.toContain("deepseek");
    expect(info.message).not.toContain("over limit");
    // 原始诊断进入结构化 detail 字段
    expect(info.detail).toBe(raw);
    expect(info.providerErrors).toBeUndefined();
  });

  it("ProviderFallbackError 时复用其友好文案，并透传 providerErrors", () => {
    const providerErrors = ["[deepseek:dp-v4] 401", "[minimax:m3] timeout"];
    const err = new ProviderFallbackError("所有备用模型均已调用失败，请检查模型配置或稍后重试", providerErrors);
    const info = toFriendlyError(err, FALLBACK);

    expect(info.message).toContain("所有备用模型均已调用失败");
    expect(info.message).not.toContain("401");
    expect(info.message).not.toContain("timeout");
    expect(info.detail).toBeUndefined();
    expect(info.providerErrors).toEqual(providerErrors);
  });

  it("非 Error 非 string 的未知异常用 fallback 兜底，且无泄漏", () => {
    const info = toFriendlyError({ unexpected: "boom 401 quota" }, FALLBACK);
    expect(info.message).toBe(FALLBACK);
    expect(info.detail).toBeUndefined();
    expect(info.message).not.toContain("401");
    expect(info.message).not.toContain("quota");
  });
});