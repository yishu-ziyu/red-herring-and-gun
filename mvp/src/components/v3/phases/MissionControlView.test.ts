import { describe, expect, it } from "vitest";
import {
  ERROR_FRIENDLY_MESSAGE,
  errorTechDetail,
  resolveErrorPresentation,
} from "./MissionControlView";

// 原始错误里可能出现的敏感/诊断片段：request_id、quota、provider 名、原始 JSON。
const RAW_ERROR =
  "request_id=req_9f2c quota=1000 provider=deepseek {\"error\":{\"message\":\"over limit\"}}";

describe("MissionControlView error 友好化（原始诊断不下主线）", () => {
  it("主线 message 只含友好文案，request_id/quota/provider 名/原始 JSON 不出现在用户可读字段", () => {
    const { message, techDetail } = resolveErrorPresentation({ error: RAW_ERROR });

    expect(message).toBe(ERROR_FRIENDLY_MESSAGE);
    expect(message).not.toContain("request_id");
    expect(message).not.toContain("quota");
    expect(message).not.toContain("deepseek");
    expect(message).not.toContain("over limit");
    expect(message).not.toContain("req_9f2c");

    // 原始诊断进入折叠区 techDetail
    expect(techDetail).toContain("request_id");
    expect(techDetail).toContain("quota");
    expect(techDetail).toContain("deepseek");
    expect(techDetail).toContain("over limit");
  });

  it("后端结构化 detail 字段优先生效到 techDetail，主线仍为友好文案", () => {
    const { message, techDetail } = resolveErrorPresentation({
      message: "核查流程未能完成，请稍后重试",
      detail: RAW_ERROR,
    });
    expect(message).toBe(ERROR_FRIENDLY_MESSAGE);
    expect(techDetail).toBe(RAW_ERROR);
  });

  it("providerErrors 明细进入 techDetail 而非主线", () => {
    const { message, techDetail } = resolveErrorPresentation({
      providerErrors: ["[deepseek:dp-v4] 401", "[minimax:m3] quota exceeded"],
    });
    expect(message).toBe(ERROR_FRIENDLY_MESSAGE);
    expect(message).not.toContain("401");
    expect(techDetail).toContain("401");
    expect(techDetail).toContain("quota exceeded");
    expect(techDetail).toContain("deepseek");
  });

  it("errorTechDetail 无任何诊断时回退到默认文案", () => {
    expect(errorTechDetail({})).toBe("Orchestrate 流式调用失败");
  });
});