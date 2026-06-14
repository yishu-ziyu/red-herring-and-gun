import { describe, expect, it } from "vitest";
import { computeCredibilityScore } from "./credibilityScore";

describe("computeCredibilityScore", () => {
  // ─── 场景 1：典型谣言（严重谣言特征 + false 判定 + 低信源）───

  it("高分场景：true + high confidence + 高信源 + 支持证据", () => {
    const result = computeCredibilityScore(
      {
        severity: "low",
        rumorIndicators: [],
        detectedPatterns: [],
      },
      {
        factCheckResult: "true",
        confidence: "high",
        keyFindings: ["多源证实"],
        counterEvidence: [],
        sources: ["来源A", "来源B"],
      },
      {
        sourceReliability: "high",
        verifiedSources: ["官方声明"],
        questionableSources: [],
        missingSources: [],
        verificationNotes: "来源可追溯",
      },
      {
        sources: [
          { direction: "support", credibility: "高" },
          { direction: "support", credibility: "中" },
        ],
        supportingEvidence: ["官方确认"],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      }
    );

    console.log("场景1 (应高分):", result);
    expect(result.score).toBeGreaterThan(60);
    expect(result.label).not.toBe("高度可疑");
  });

  // ─── 场景 2：典型谣言（高严重度 + false + 矛盾证据）───

  it("低分场景：false + high confidence + 低信源 + 矛盾证据", () => {
    const result = computeCredibilityScore(
      {
        severity: "high",
        rumorIndicators: ["匿名信源", "恐惧诉求", "情绪煽动", "虚假紧迫性"],
        detectedPatterns: [" conspiracy 暗示"],
      },
      {
        factCheckResult: "false",
        confidence: "high",
        keyFindings: [],
        counterEvidence: ["官方辟谣"],
        sources: [],
      },
      {
        sourceReliability: "low",
        verifiedSources: [],
        questionableSources: ["匿名爆料"],
        missingSources: ["原始出处"],
        verificationNotes: "无法追溯",
      },
      {
        sources: [
          { direction: "contradict", credibility: "高" },
          { direction: "support", credibility: "低" },
        ],
        supportingEvidence: [],
        contradictingEvidence: ["官方辟谣"],
        unresolvedEvidenceGaps: ["缺少原始出处"],
      }
    );

    console.log("场景2 (应低分):", result);
    expect(result.score).toBeLessThan(40);
  });

  // ─── 场景 3：存疑（partial + unverified + 证据不足）───

  it("中等分数：partial + medium confidence + 证据不足", () => {
    const result = computeCredibilityScore(
      {
        severity: "medium",
        rumorIndicators: ["模糊引用"],
        detectedPatterns: ["断章取义"],
      },
      {
        factCheckResult: "partial",
        confidence: "medium",
        keyFindings: ["部分成立"],
        counterEvidence: ["存在夸大"],
        sources: ["来源A"],
      },
      {
        sourceReliability: "medium",
        verifiedSources: ["来源A"],
        questionableSources: [],
        missingSources: ["原始研究"],
        verificationNotes: "部分可追溯",
      },
      {
        sources: [
          { direction: "support", credibility: "中" },
          { direction: "neutral", credibility: "低" },
        ],
        supportingEvidence: ["部分佐证"],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: ["缺少原始研究"],
      }
    );

    console.log("场景3 (应中低分):", result);
    expect(result.score).toBeGreaterThanOrEqual(30);
    expect(result.score).toBeLessThan(60);
  });

  // ─── 场景 4：unverified 且无来源 → 门控生效 ──

  it("unverified + 无可靠来源 → 封顶 50 分", () => {
    const result = computeCredibilityScore(
      {
        severity: "medium",
        rumorIndicators: ["匿名信源"],
        detectedPatterns: [],
      },
      {
        factCheckResult: "unverified",
        confidence: "low",
        keyFindings: [],
        counterEvidence: [],
        sources: [],
      },
      {
        sourceReliability: "unverified",
        verifiedSources: [],
        questionableSources: [],
        missingSources: [],
        verificationNotes: "无法验证",
      },
      {
        sources: [],
        supportingEvidence: [],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      }
    );

    console.log("场景4 (unverified 门控):", result);
    expect(result.score).toBeLessThanOrEqual(50);
  });

  // ─── 场景 5：边界值：全 0 输入 ──

  it("全 0 输入 → 约 50 分（中性基线）", () => {
    const result = computeCredibilityScore(
      {
        severity: "low",
        rumorIndicators: [],
        detectedPatterns: [],
      },
      {
        factCheckResult: "unverified",
        confidence: "low",
        keyFindings: [],
        counterEvidence: [],
        sources: [],
      },
      {
        sourceReliability: "unverified",
        verifiedSources: [],
        questionableSources: [],
        missingSources: [],
        verificationNotes: "",
      },
      {
        sources: [],
        supportingEvidence: [],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      }
    );

    console.log("场景5 (零输入基线):", result);
    // 零输入时 supportForce=0, refuteForce=0, baseScore=0, normalized=50
    // 惩罚项为 0，所以最终约 50
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThanOrEqual(60);
  });

  // ─── 场景 6：同方向多证据的 log₂ 收敛效果 ──

  it("多个支持信号不会线性膨胀分数", () => {
    const result = computeCredibilityScore(
      {
        severity: "low",
        rumorIndicators: [],
        detectedPatterns: [],
      },
      {
        factCheckResult: "true",
        confidence: "high",
        keyFindings: Array.from({ length: 10 }, (_, i) => `发现${i}`),
        counterEvidence: [],
        sources: Array.from({ length: 5 }, (_, i) => `来源${i}`),
      },
      {
        sourceReliability: "high",
        verifiedSources: Array.from({ length: 10 }, (_, i) => `验证源${i}`),
        questionableSources: [],
        missingSources: [],
        verificationNotes: "",
      },
      {
        sources: [
          { direction: "support", credibility: "高" },
          { direction: "support", credibility: "高" },
          { direction: "support", credibility: "高" },
          { direction: "support", credibility: "高" },
          { direction: "support", credibility: "高" },
        ],
        supportingEvidence: Array.from({ length: 10 }, (_, i) => `支持${i}`),
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      }
    );

    console.log("场景6 (多支持信号收敛):", result);
    // log₂(3+1) ≈ 2，不会因为 10 个发现就膨胀到荒谬高分
    expect(result.score).toBeGreaterThan(60);
    expect(result.score).toBeLessThan(100);
  });

  // ─── 断言行覆盖 ──

  it("breakdown 每个维度都有值", () => {
    const result = computeCredibilityScore(
      {
        severity: "medium",
        rumorIndicators: ["绝对化表述"],
        detectedPatterns: [],
      },
      {
        factCheckResult: "partial",
        confidence: "medium",
        keyFindings: ["部分成立"],
        counterEvidence: ["存在夸大"],
        sources: ["来源A"],
      },
      {
        sourceReliability: "medium",
        verifiedSources: ["来源A"],
        questionableSources: [],
        missingSources: ["原始出处"],
        verificationNotes: "",
      },
      {
        sources: [{ direction: "support", credibility: "中" }],
        supportingEvidence: ["佐证"],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      }
    );

    const b = result.breakdown;
    expect(typeof b.factCheckSignal).toBe("number");
    expect(typeof b.searchSignal).toBe("number");
    expect(typeof b.sourceSignal).toBe("number");
    expect(typeof b.rumorPenalty).toBe("number");
    expect(typeof b.missingPenalty).toBe("number");
    expect(typeof b.supportForce).toBe("number");
    expect(typeof b.refuteForce).toBe("number");
  });
});
