import { describe, expect, it } from "vitest";
import {
  ERROR_FRIENDLY_MESSAGE,
  errorTechDetail,
  formatReportReviewerStreamDetail,
  formatReportReviewerStreamTitle,
  isReportReviewerTool,
  reportReviewerIssueList,
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

describe("report_reviewer stream humanize", () => {
  it("detects tool by toolId / toolName / result shape", () => {
    expect(isReportReviewerTool("Report Reviewer (proposer-reviewer)", "report_reviewer")).toBe(true);
    expect(isReportReviewerTool(null, null, { passed: true, score: 80, issues: [] })).toBe(true);
    expect(isReportReviewerTool("Parallel Search", "parallel_search")).toBe(false);
  });

  it("title is 报告审稿 · 通过/需补证 · 分数", () => {
    expect(formatReportReviewerStreamTitle({ passed: true, score: 86, issues: [] }, "completed")).toBe(
      "报告审稿 · 通过 · 86"
    );
    expect(formatReportReviewerStreamTitle({ passed: false, score: 40, issues: [] }, "completed")).toBe(
      "报告审稿 · 需补证 · 40"
    );
    expect(formatReportReviewerStreamTitle(null, "running")).toBe("报告审稿");
  });

  it("issues list caps at 3 messages", () => {
    const issues = reportReviewerIssueList({
      passed: false,
      score: 30,
      issues: [
        { severity: "error", message: "结论过短" },
        { severity: "warn", message: "缺 canSay" },
        { severity: "error", message: "证据链不足" },
        { severity: "warn", message: "不应出现" },
      ],
    });
    expect(issues).toHaveLength(3);
    expect(issues.map((i) => i.message)).toEqual(["结论过短", "缺 canSay", "证据链不足"]);
    expect(formatReportReviewerStreamDetail({ passed: false, score: 30, issues: issues }, "completed")).toContain(
      "结论过短"
    );
  });
});
