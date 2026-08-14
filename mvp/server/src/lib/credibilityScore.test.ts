import { describe, expect, it } from "vitest";
import { computeCredibilityScore, type CredibilityScoreResult } from "./credibilityScore";

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

  // ─── 校准：主裁决不被次级信源反转 ──

  it("false 时 medium/high 信源不托高分数（sourceSignal 归零）", () => {
    const withMediumSource = computeCredibilityScore(
      { severity: "medium", rumorIndicators: [], detectedPatterns: [] },
      {
        factCheckResult: "false",
        confidence: "high",
        keyFindings: [],
        counterEvidence: ["官方辟谣"],
        sources: [],
      },
      {
        sourceReliability: "medium",
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
    const withLowSource = computeCredibilityScore(
      { severity: "medium", rumorIndicators: [], detectedPatterns: [] },
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
        questionableSources: ["匿名"],
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

    expect(withMediumSource.breakdown.sourceSignal).toBe(0);
    expect(withLowSource.breakdown.sourceSignal).toBe(-0.4);
    // medium 信源不得托高已判假：分数应落在低可信带，且不低于 low 信源（low 仍可再压）
    expect(withMediumSource.score).toBeLessThanOrEqual(20);
    expect(withLowSource.score).toBeLessThanOrEqual(withMediumSource.score);
  });

  it("partial + medium 信源分数落在 mixed 低分带（约 10-35）", () => {
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

    expect(result.breakdown.sourceSignal).toBe(0);
    expect(result.score).toBeGreaterThanOrEqual(10);
    expect(result.score).toBeLessThanOrEqual(35);
  });
});

// ─── 公式回归闸门（Plan P0-4） ─────────────────────────────
//
// 目的：固化 computeCredibilityScore 在已知 fixture 上的精确输出。
// 任何对公式权重、SCORE_LABELS、惩罚系数、归一化/门控逻辑的改动
// 都必须同步更新本快照；否则 CI 红线 fail。
//
// 工作流：
//   1) 修改公式 → 跑 `pnpm vitest run --update` 刷新快照
//   2) PR review 必须人工确认新快照符合预期（不是测试"改对就好"）
//
// 显式禁止 expect.soft、toMatchInlineSnapshot 之外的隐式容忍。

describe("computeCredibilityScore · 公式回归快照 (P0-4)", () => {
  // 固化 6 个 fixture，覆盖：高分 / 低分 / 中等 / unverified门控 / 零基线 / 多信号收敛
  const fixtures: ReadonlyArray<{
    readonly id: string;
    readonly rumor: Parameters<typeof computeCredibilityScore>[0];
    readonly factCheck: Parameters<typeof computeCredibilityScore>[1];
    readonly source: Parameters<typeof computeCredibilityScore>[2];
    readonly search: Parameters<typeof computeCredibilityScore>[3];
    readonly expected: {
      readonly score: number;
      readonly label: string;
      readonly verdict: CredibilityScoreResult["verdict"];
      readonly breakdown: CredibilityScoreResult["breakdown"];
    };
  }> = [
    {
      id: "S1 · 高分：true + high + 高信源 + 支持证据",
      rumor: { severity: "low", rumorIndicators: [], detectedPatterns: [] },
      factCheck: {
        factCheckResult: "true",
        confidence: "high",
        keyFindings: ["多源证实"],
        counterEvidence: [],
        sources: ["来源A", "来源B"],
      },
      source: {
        sourceReliability: "high",
        verifiedSources: ["官方声明"],
        questionableSources: [],
        missingSources: [],
        verificationNotes: "来源可追溯",
      },
      search: {
        sources: [
          { direction: "support", credibility: "高" },
          { direction: "support", credibility: "中" },
        ],
        supportingEvidence: ["官方确认"],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      },
      expected: {
        score: 91,
        label: "高度可信",
        verdict: "true",
        breakdown: {
          factCheckSignal: 0.9,
          searchSignal: 0.5,
          sourceSignal: 0.9,
          rumorPenalty: 0.2,
          missingPenalty: 0,
          supportForce: 1.53,
          refuteForce: 0,
        },
      },
    },
    {
      id: "S2 · 低分：false + high + 低信源 + 矛盾证据",
      rumor: {
        severity: "high",
        rumorIndicators: ["匿名信源", "恐惧诉求", "情绪煽动", "虚假紧迫性"],
        detectedPatterns: [" conspiracy 暗示"],
      },
      factCheck: {
        factCheckResult: "false",
        confidence: "high",
        keyFindings: [],
        counterEvidence: ["官方辟谣"],
        sources: [],
      },
      source: {
        sourceReliability: "low",
        verifiedSources: [],
        questionableSources: ["匿名爆料"],
        missingSources: ["原始出处"],
        verificationNotes: "无法追溯",
      },
      search: {
        sources: [
          { direction: "contradict", credibility: "高" },
          { direction: "support", credibility: "低" },
        ],
        supportingEvidence: [],
        contradictingEvidence: ["官方辟谣"],
        unresolvedEvidenceGaps: ["缺少原始出处"],
      },
      expected: {
        score: 0,
        label: "高度可疑",
        verdict: "false",
        breakdown: {
          factCheckSignal: -0.9,
          searchSignal: -0.5,
          sourceSignal: -0.4,
          rumorPenalty: 1,
          missingPenalty: 0.05,
          supportForce: 0,
          refuteForce: -1.2,
        },
      },
    },
    {
      id: "S3 · 中等：partial + medium + 证据不足",
      rumor: {
        severity: "medium",
        rumorIndicators: ["模糊引用"],
        detectedPatterns: ["断章取义"],
      },
      factCheck: {
        factCheckResult: "partial",
        confidence: "medium",
        keyFindings: ["部分成立"],
        counterEvidence: ["存在夸大"],
        sources: ["来源A"],
      },
      source: {
        sourceReliability: "medium",
        verifiedSources: ["来源A"],
        questionableSources: [],
        missingSources: ["原始研究"],
        verificationNotes: "部分可追溯",
      },
      search: {
        sources: [
          { direction: "support", credibility: "中" },
          { direction: "neutral", credibility: "低" },
        ],
        supportingEvidence: ["部分佐证"],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: ["缺少原始研究"],
      },
      expected: {
        score: 35,
        label: "低可信",
        verdict: "partial",
        breakdown: {
          factCheckSignal: 0.03,
          searchSignal: 0.15,
          sourceSignal: 0,
          rumorPenalty: 0.55,
          missingPenalty: 0.05,
          supportForce: 0.15,
          refuteForce: 0,
        },
      },
    },
    {
      id: "S4 · 门控：unverified + 零来源 → 封顶 50",
      rumor: {
        severity: "medium",
        rumorIndicators: ["匿名信源"],
        detectedPatterns: [],
      },
      factCheck: {
        factCheckResult: "unverified",
        confidence: "low",
        keyFindings: [],
        counterEvidence: [],
        sources: [],
      },
      source: {
        sourceReliability: "unverified",
        verifiedSources: [],
        questionableSources: [],
        missingSources: [],
        verificationNotes: "无法验证",
      },
      search: {
        sources: [],
        supportingEvidence: [],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      },
      expected: {
        score: 36,
        label: "低可信",
        verdict: "unverified",
        breakdown: {
          factCheckSignal: 0,
          searchSignal: 0,
          sourceSignal: 0,
          rumorPenalty: 0.55,
          missingPenalty: 0,
          supportForce: 0,
          refuteForce: 0,
        },
      },
    },
    {
      id: "S5 · 零基线：全 0 输入 → 中性 50 附近",
      rumor: { severity: "low", rumorIndicators: [], detectedPatterns: [] },
      factCheck: {
        factCheckResult: "unverified",
        confidence: "low",
        keyFindings: [],
        counterEvidence: [],
        sources: [],
      },
      source: {
        sourceReliability: "unverified",
        verifiedSources: [],
        questionableSources: [],
        missingSources: [],
        verificationNotes: "",
      },
      search: {
        sources: [],
        supportingEvidence: [],
        contradictingEvidence: [],
        unresolvedEvidenceGaps: [],
      },
      expected: {
        score: 45,
        label: "存疑",
        verdict: "unverified",
        breakdown: {
          factCheckSignal: 0,
          searchSignal: 0,
          sourceSignal: 0,
          rumorPenalty: 0.2,
          missingPenalty: 0,
          supportForce: 0,
          refuteForce: 0,
        },
      },
    },
    {
      id: "S6 · log₂ 收敛：10 个支持信号不膨胀",
      rumor: { severity: "low", rumorIndicators: [], detectedPatterns: [] },
      factCheck: {
        factCheckResult: "true",
        confidence: "high",
        keyFindings: Array.from({ length: 10 }, (_, i) => `发现${i}`),
        counterEvidence: [],
        sources: Array.from({ length: 5 }, (_, i) => `来源${i}`),
      },
      source: {
        sourceReliability: "high",
        verifiedSources: Array.from({ length: 10 }, (_, i) => `验证源${i}`),
        questionableSources: [],
        missingSources: [],
        verificationNotes: "",
      },
      search: {
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
      },
      expected: {
        score: 94,
        label: "高度可信",
        verdict: "true",
        breakdown: {
          factCheckSignal: 0.9,
          searchSignal: 0.66,
          sourceSignal: 0.9,
          rumorPenalty: 0.2,
          missingPenalty: 0,
          supportForce: 1.64,
          refuteForce: 0,
        },
      },
    },
  ];

  for (const fx of fixtures) {
    it(`[snapshot] ${fx.id}`, () => {
      const result = computeCredibilityScore(fx.rumor, fx.factCheck, fx.source, fx.search);

      // 整结果精确比对（这是闸门，不允许四舍五入容忍）
      expect(result.score).toBe(fx.expected.score);
      expect(result.label).toBe(fx.expected.label);
      expect(result.verdict).toBe(fx.expected.verdict);

      // breakdown 逐维精确比对
      expect(result.breakdown.factCheckSignal).toBe(fx.expected.breakdown.factCheckSignal);
      expect(result.breakdown.searchSignal).toBe(fx.expected.breakdown.searchSignal);
      expect(result.breakdown.sourceSignal).toBe(fx.expected.breakdown.sourceSignal);
      expect(result.breakdown.rumorPenalty).toBe(fx.expected.breakdown.rumorPenalty);
      expect(result.breakdown.missingPenalty).toBe(fx.expected.breakdown.missingPenalty);
      expect(result.breakdown.supportForce).toBe(fx.expected.breakdown.supportForce);
      expect(result.breakdown.refuteForce).toBe(fx.expected.breakdown.refuteForce);
    });
  }

  // SCORE_LABELS 不可被改动（plan §4 冻结项）
  it("[snapshot] SCORE_LABELS 文本与区间不可变更", async () => {
    const { SCORE_LABELS } = await import("./credibilityScore");
    expect(SCORE_LABELS).toEqual([
      { min: 80, label: "高度可信" },
      { min: 60, label: "基本可信" },
      { min: 40, label: "存疑" },
      { min: 20, label: "低可信" },
      { min: 0, label: "高度可疑" },
    ]);
  });
});
