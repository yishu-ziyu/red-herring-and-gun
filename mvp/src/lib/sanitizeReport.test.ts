import { describe, expect, it } from "vitest";
import { sanitizeReport } from "./sanitizeReport";

describe("sanitizeReport", () => {
  it("drops cannotSay entries containing 'exceed' / 'exceeded'", () => {
    const r = sanitizeReport({
      allowed: ["A"],
      blocked: ["B", "Exa Search 调用失败: credits limit exceeded"],
    });
    expect(r.allowed).toEqual(["A"]);
    expect(r.blocked).toEqual(["B"]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("exceeded");
  });

  it("drops entries containing 'quota' or 'credits'", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "quota exceeded",
        "credits exhausted",
        "credit limit reached",
      ],
    });
    expect(r.blocked).toEqual([]);
    expect(r.warnings.length).toBe(3);
  });

  it("drops entries with 调用失败 / 调用异常 / 超时", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "搜索调用失败: 网络断开",
        "模型调用异常",
        "请求超时,稍后重试",
        "验证失败",
      ],
    });
    // "验证失败" is a legitimate Chinese phrase - must NOT be dropped
    expect(r.blocked).toEqual(["验证失败"]);
    expect(r.warnings.length).toBe(3);
  });

  it("drops entries with timeout / time out / time-out", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "request timeout",
        "connection time out",
        "time-out reached",
        "已生成 3 条候选证据",
      ],
    });
    expect(r.blocked).toEqual(["已生成 3 条候选证据"]);
    expect(r.warnings.length).toBe(3);
  });

  it("drops entries with api error / API_error / api-error patterns", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "API error: 500",
        "api_error happened",
        "api-error raised",
        "本段是普通结论",
      ],
    });
    expect(r.blocked).toEqual(["本段是普通结论"]);
    expect(r.warnings.length).toBe(3);
  });

  it("drops entries starting with Error: / Exception", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "Error: network down",
        "Exception thrown at line 12",
        "常规条目",
      ],
    });
    expect(r.blocked).toEqual(["常规条目"]);
    expect(r.warnings.length).toBe(2);
  });

  it("drops entries containing emoji", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: ["🚨 任务失败", "🔥 再次失败", "普通结论"],
    });
    expect(r.blocked).toEqual(["普通结论"]);
    expect(r.warnings.length).toBe(2);
  });

  it("drops entries with localhost / 127.x / 10.x.x.x", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "请连接 http://localhost:3000",
        "服务在 127.0.0.1:8080",
        "内网 10.0.0.5",
        "公网服务正常",
      ],
    });
    expect(r.blocked).toEqual(["公网服务正常"]);
    expect(r.warnings.length).toBe(3);
  });

  it("drops entries with http(s)://.../(api|v1) URL fragment", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: [
        "POST https://internal.example.com/api/search 失败",
        "GET https://x.com/v1/models 报错",
        "普通描述",
      ],
    });
    expect(r.blocked).toEqual(["普通描述"]);
    expect(r.warnings.length).toBe(2);
  });

  it("keeps long legitimate Chinese entries untouched", () => {
    const longText =
      "这条线索目前仅有单一样本，不足以支持因果归因。建议补足时间序列与替代解释后再做判断。";
    const r = sanitizeReport({
      allowed: [longText],
      blocked: ["Exa Search 调用失败: api error"],
    });
    expect(r.allowed).toEqual([longText]);
    expect(r.blocked).toEqual([]);
    expect(r.warnings.length).toBe(1);
  });

  it("preserves 验证失败 (legitimate Chinese phrase, must NOT be dropped)", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: ["验证失败", "进一步核查仍未通过"],
    });
    expect(r.blocked).toEqual(["验证失败", "进一步核查仍未通过"]);
    expect(r.warnings).toEqual([]);
  });

  it("drops API 调用失败 (infra phrase, must be dropped)", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: ["API 调用失败", "正常结论"],
    });
    expect(r.blocked).toEqual(["正常结论"]);
    expect(r.warnings.length).toBe(1);
    expect(r.warnings[0]).toContain("调用失败");
  });

  it("returns empty arrays for empty input", () => {
    const r = sanitizeReport({ allowed: [], blocked: [] });
    expect(r.allowed).toEqual([]);
    expect(r.blocked).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.drops).toEqual([]);
  });

  it("exposes raw dropped entries in drops[] for dev debugging", () => {
    const r = sanitizeReport({
      allowed: [],
      blocked: ["API 调用失败", "正常"],
    });
    expect(r.drops).toEqual(["API 调用失败"]);
    expect(r.blocked).toEqual(["正常"]);
  });
});