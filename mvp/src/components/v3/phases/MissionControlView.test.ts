import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ERROR_FRIENDLY_MESSAGE,
  errorTechDetail,
  formatReportReviewerStreamDetail,
  formatReportReviewerStreamTitle,
  isInterruptedFinalReport,
  isReportReviewerTool,
  processStallNotice,
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

  it("passes through the daily-check exhausted copy and hides infra detail", () => {
    const { message, techDetail } = resolveErrorPresentation({
      code: "checks_exhausted",
      message: "今天的免费核查用完了。登录后每天可查 3 条。",
      detail: RAW_ERROR,
    });
    expect(message).toBe("今天的免费核查用完了。登录后每天可查 3 条。");
    expect(techDetail).toBe("");
  });

  it("still hides a spoofed checks_exhausted payload that is not the product copy", () => {
    const { message } = resolveErrorPresentation({
      code: "checks_exhausted",
      message: RAW_ERROR,
    });
    expect(message).toBe(ERROR_FRIENDLY_MESSAGE);
    expect(message).not.toContain("quota");
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

describe("processStallNotice", () => {
  it("检索/对照超过约 1 分钟无新步骤时给出人话说明", () => {
    expect(
      processStallNotice({ runStatus: "running", msSinceLastEvent: 60000, humanStage: "对照公开报道" })
    ).toBe("还在查公开来源，可能比较慢。");
    expect(
      processStallNotice({ runStatus: "running", msSinceLastEvent: 90000, humanStage: "对照公开报道" })
    ).toBe("这一步没有新进展，可以取消后重试。");
  });

  it("未卡住或已结束时不提示", () => {
    expect(
      processStallNotice({ runStatus: "running", msSinceLastEvent: 20000, humanStage: "对照公开报道" })
    ).toBe("");
    expect(
      processStallNotice({ runStatus: "completed", msSinceLastEvent: 120000, humanStage: "整理结论" })
    ).toBe("");
  });
});

describe("isInterruptedFinalReport", () => {
  it("treats error-boundary reports as interrupted, not unfinished verdicts", () => {
    expect(isInterruptedFinalReport({ _source: "error-boundary", verdictType: "unverified" })).toBe(true);
    expect(isInterruptedFinalReport({ verdictType: "unverified" })).toBe(false);
    expect(isInterruptedFinalReport(null)).toBe(false);
  });
});

describe("live check process face", () => {
  it("does not mount MissionProcessShell in MissionControlView", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "MissionControlView.tsx"), "utf8");
    expect(src).not.toMatch(/<MissionProcessShell\b/);
    expect(src).not.toMatch(/<ControllerRail\b/);
    expect(src).toMatch(/<ApodexRunView\b/);
    expect(src).not.toMatch(/MissionThoughtFold/);
  });
});
