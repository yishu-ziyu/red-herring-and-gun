import { describe, expect, it } from "vitest";
import { reviewAndRepairReport } from "./reportReviewer";

describe("reviewAndRepairReport (server)", () => {
  it("fails thin report and repairs required fields", () => {
    const result = reviewAndRepairReport(
      {
        verdictType: "maybe",
        conclusion: "ok",
        credibilityScore: 999,
      },
      { claim: "测试命题" }
    );

    expect(result.passed).toBe(false);
    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.repaired.credibilityScore).toBe(50);
    expect(Array.isArray(result.repaired.evidenceChain)).toBe(true);
    expect((result.repaired.evidenceChain as unknown[]).length).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(result.repaired.canSay)).toBe(true);
    expect(Array.isArray(result.repaired.cannotSay)).toBe(true);
    expect(Array.isArray(result.repaired.closureActions)).toBe(true);
    expect(result.repaired._review).toEqual(
      expect.objectContaining({
        reviewer: "deterministic-report-reviewer",
        passed: false,
      })
    );
  });

  it("passes a complete report", () => {
    const result = reviewAndRepairReport({
      verdictType: "mixed_misleading",
      conclusion: "存在夸大，核心事实部分成立。",
      credibilityScore: 42,
      summaryForPublic: "该说法有夸大成分。",
      recommendation: "勿二次传播未经核实细节。",
      canSay: ["可说存在夸大"],
      cannotSay: ["不能当成完全虚假"],
      evidenceChain: [
        { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
        { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
        { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability", score: 50 },
        { dimension: "evidence_completeness", score: 40 },
        { dimension: "consistency", score: 60 },
        { dimension: "recency", score: 55 },
        { dimension: "authority", score: 45 },
      ],
      closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
    });

    expect(result.passed).toBe(true);
    expect(result.issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("downgrades overclaim true when fact check is unverified", () => {
    const result = reviewAndRepairReport(
      {
        verdictType: "true",
        conclusion: "完全正确。",
        credibilityScore: 90,
        canSay: ["可说属实"],
        cannotSay: ["无"],
        evidenceChain: [
          { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
          { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
          { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
        ],
        confidenceDimensions: [
          { dimension: "source_reliability" },
          { dimension: "evidence_completeness" },
          { dimension: "consistency" },
          { dimension: "recency" },
          { dimension: "authority" },
        ],
      },
      {
        previousOutputs: [{ factCheckResult: "unverified" }],
      }
    );

    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.issues.some((i) => i.code === "overclaim")).toBe(true);
  });

  it("true 且无有据 URL → unverified", () => {
    const result = reviewAndRepairReport({
      verdictType: "true",
      conclusion: "完全正确，有公开记录支持。",
      credibilityScore: 80,
      canSay: ["可说属实"],
      cannotSay: ["无"],
      evidenceChain: [
        { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
        { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
        { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability" },
        { dimension: "evidence_completeness" },
        { dimension: "consistency" },
        { dimension: "recency" },
        { dimension: "authority" },
      ],
      closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
      subclaimVerdicts: [{ claimAtom: "A", verdict: "true", supportingSources: [] }],
    });

    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.issues.some((i) => i.code === "unsourced_hard_verdict")).toBe(true);
  });

  it("false 仅 related-only 且对题辟谣 → 仍 false（boundTiny）", () => {
    const result = reviewAndRepairReport(
      {
        verdictType: "false",
        conclusion: "不能信。该短谣已被官方辟谣。",
        credibilityScore: 20,
        canSay: ["可说已被辟谣"],
        cannotSay: ["不能当新闻转发"],
        evidenceChain: [
          { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
          { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
          { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
        ],
        confidenceDimensions: [
          { dimension: "source_reliability" },
          { dimension: "evidence_completeness" },
          { dimension: "consistency" },
          { dimension: "recency" },
          { dimension: "authority" },
        ],
        closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
        subclaimVerdicts: [
          {
            claimAtom: "电瓶车被偷送到非洲",
            verdict: "false",
            sourcesRelatedOnly: true,
            supportingSources: [
              {
                url: "https://www.piyao.org.cn/x",
                title: "合肥警方：P图编造电瓶车被偷至非洲",
                snippet: "不实 辟谣",
              },
            ],
          },
        ],
      },
      { claim: "电瓶车被偷送到非洲" }
    );

    expect(result.repaired.verdictType).toBe("false");
    expect(result.issues.some((i) => i.code === "unsourced_hard_verdict")).toBe(false);
  });

  it("false 仅 related-only 但对题辟谣不成立 → unverified", () => {
    const result = reviewAndRepairReport(
      {
        verdictType: "false",
        conclusion: "不能信。检索只有无关相关页。",
        credibilityScore: 20,
        canSay: ["可说还缺对题来源"],
        cannotSay: ["不能当已证伪"],
        evidenceChain: [
          { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
          { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
          { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
        ],
        confidenceDimensions: [
          { dimension: "source_reliability" },
          { dimension: "evidence_completeness" },
          { dimension: "consistency" },
          { dimension: "recency" },
          { dimension: "authority" },
        ],
        closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
        subclaimVerdicts: [
          {
            claimAtom: "甘南所有景点一律免费",
            verdict: "false",
            sourcesRelatedOnly: true,
            supportingSources: [{ url: "https://www.piyao.org.cn/x", title: "辟谣", snippet: "不实" }],
          },
        ],
      },
      { claim: "甘南所有景点一律免费" }
    );

    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.issues.some((i) => i.code === "unsourced_hard_verdict")).toBe(true);
  });

  it("true 仅 related-only URL → unverified", () => {
    const result = reviewAndRepairReport({
      verdictType: "true",
      conclusion: "能信。检索垫了相关页。",
      credibilityScore: 80,
      canSay: ["可说有相关检索"],
      cannotSay: ["不能当已证实"],
      evidenceChain: [
        { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
        { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
        { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability" },
        { dimension: "evidence_completeness" },
        { dimension: "consistency" },
        { dimension: "recency" },
        { dimension: "authority" },
      ],
      closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "true",
          sourcesRelatedOnly: true,
          supportingSources: [{ url: "https://gov.cn/1", title: "相关", snippet: "检索垫" }],
        },
      ],
    });

    expect(result.repaired.verdictType).toBe("unverified");
    expect(result.issues.some((i) => i.code === "unsourced_hard_verdict")).toBe(true);
  });

  it("false 有非 related-only 绑定 URL → 仍 false", () => {
    const result = reviewAndRepairReport({
      verdictType: "false",
      conclusion: "不能信。官方通报已否定。",
      credibilityScore: 20,
      canSay: ["可说已被否定"],
      cannotSay: ["不能当新闻"],
      evidenceChain: [
        { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
        { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
        { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability" },
        { dimension: "evidence_completeness" },
        { dimension: "consistency" },
        { dimension: "recency" },
        { dimension: "authority" },
      ],
      closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "false",
          contradictingSources: [{ url: "https://gov.cn/1", title: "通报", snippet: "不实" }],
        },
      ],
    });

    expect(result.repaired.verdictType).toBe("false");
    expect(result.issues.some((i) => i.code === "unsourced_hard_verdict")).toBe(false);
  });

  it("true 有非 related-only 绑定 URL → 仍 true", () => {
    const result = reviewAndRepairReport({
      verdictType: "true",
      conclusion: "完全正确，有公开记录支持。",
      credibilityScore: 80,
      canSay: ["可说属实"],
      cannotSay: ["无"],
      evidenceChain: [
        { layer: "a", finding: "f1", evidence: "e1", boundary: "b1", sourceRefs: [] },
        { layer: "b", finding: "f2", evidence: "e2", boundary: "b2", sourceRefs: [] },
        { layer: "c", finding: "f3", evidence: "e3", boundary: "b3", sourceRefs: [] },
      ],
      confidenceDimensions: [
        { dimension: "source_reliability" },
        { dimension: "evidence_completeness" },
        { dimension: "consistency" },
        { dimension: "recency" },
        { dimension: "authority" },
      ],
      closureActions: [{ type: "archive_doubt", label: "归档", content: "x", status: "ready" }],
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "true",
          supportingSources: [{ url: "https://gov.cn/1", title: "通报", snippet: "属实" }],
        },
      ],
    });

    expect(result.repaired.verdictType).toBe("true");
    expect(result.issues.some((i) => i.code === "unsourced_hard_verdict")).toBe(false);
  });

  it("does not pad an interrupted error-boundary report into a finished dossier", () => {
    const result = reviewAndRepairReport({
      verdictType: "unverified",
      conclusion: "这次没查完，结论还没写出来。",
      credibilityScore: 30,
      citationSources: [{ title: "公开材料", url: "https://example.com/a" }],
      _source: "error-boundary",
    });

    expect(result.passed).toBe(false);
    expect(result.repaired._source).toBe("error-boundary");
    expect(result.repaired.evidenceChain).toBeUndefined();
    expect(result.issues.some((i) => i.code === "error_boundary")).toBe(true);
  });
});
