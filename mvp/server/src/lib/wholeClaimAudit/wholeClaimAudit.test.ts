/**
 * Whole-Claim Audit 单元回归（Issue #78）。
 * 覆盖：可核查性修订只提升不降级 / 只命中真实 kept atom / type 不改写；
 * 解析夹紧；结论收权门四条不变量；audit artifact 永不成为 Evidence。
 */
import { describe, expect, it } from "vitest";
import {
  applyCheckabilityRevisions,
  applyConclusionGate,
  buildScopedEvidence,
  compactVerdicts,
  needsConstrainedConclusion,
  parseWholeClaimEvaluation,
  parseWholeClaimPlan,
  repairGatedConclusion,
  resolveQuestionAtomKey,
} from "./index.js";
import { directAnswer } from "../publicCopy.js";
import { hasDirectionalBoundHttpUrl, normalizeReportCitations } from "../citationBinding.js";

describe("applyCheckabilityRevisions（§5/§12：模型语义决策，代码守不变量）", () => {
  it("false→true 提升：命中 kept atom 才应用，type 保持 normative 不改写", () => {
    const types = [{ text: "每次感冒都应当输液", verifiable: false, type: "normative" }];
    const result = applyCheckabilityRevisions(
      types,
      ["每次感冒都应当输液"],
      [{ claimAtom: "每次感冒都应当输液", verifiable: true, reason: "可由医学指南与适应症核查" }]
    );
    expect(result.applied).toHaveLength(1);
    expect(result.ignored).toHaveLength(0);
    expect(result.claimAtomTypes[0]).toMatchObject({ verifiable: true, type: "normative" });
  });

  it("不创建新原子：修订指向不存在的主张时整条忽略", () => {
    const types = [{ text: "原子A", verifiable: false, type: "value" }];
    const result = applyCheckabilityRevisions(types, ["原子A"], [
      { claimAtom: "模型自己发明的主张", verifiable: true, reason: "r" },
    ]);
    expect(result.applied).toHaveLength(0);
    expect(result.ignored[0]?.reasonCode).toBe("not-a-kept-atom");
    expect(result.claimAtomTypes).toHaveLength(1);
  });

  it("不降级：verifiable=false 的修订被丢弃；已是 true 的条目不动", () => {
    const types = [
      { text: "事实A", verifiable: true, type: "fact" },
      { text: "规范B", verifiable: false, type: "normative" },
    ];
    const result = applyCheckabilityRevisions(types, ["事实A", "规范B"], [
      { claimAtom: "事实A", verifiable: false, reason: "想降级" },
      { claimAtom: "规范B", verifiable: true, reason: "提升" },
      { claimAtom: "规范B", verifiable: true, reason: "重复提升" },
    ]);
    expect(result.applied).toHaveLength(1);
    expect(result.ignored.map((i) => i.reasonCode)).toEqual(["demote-not-allowed", "already-verifiable"]);
    expect(result.claimAtomTypes[0]).toMatchObject({ verifiable: true, type: "fact" });
  });

  it("输入非数组时原样直通；不改写入参数组", () => {
    expect(applyCheckabilityRevisions("x", [], []).claimAtomTypes).toBe("x");
    const types = [{ text: "A", verifiable: false, type: "value" }];
    applyCheckabilityRevisions(types, ["A"], [{ claimAtom: "A", verifiable: true, reason: "r" }]);
    expect(types[0]).toMatchObject({ verifiable: false });
  });
});

describe("解析夹紧", () => {
  it("planning：缺 overallQuestion 返回 null；auditQuestions 截到 3 条", () => {
    expect(parseWholeClaimPlan(null)).toBeNull();
    expect(parseWholeClaimPlan({ missing: 1 })).toBeNull();
    const plan = parseWholeClaimPlan({
      overallQuestion: "q",
      checkabilityRevisions: [{ claimAtom: "A", verifiable: true, reason: "r" }, { verifiable: true }],
      missingJustifications: Array.from({ length: 8 }, (_, i) => `g${i}`),
      auditQuestions: Array.from({ length: 6 }, (_, i) => ({ question: `q${i}`, reason: "r" })),
    });
    expect(plan?.checkabilityRevisions).toHaveLength(1);
    expect(plan?.missingJustifications).toHaveLength(5);
    expect(plan?.auditQuestions).toHaveLength(3);
  });

  it("evaluation：supportedWhere 与 biggestGap 全空返回 null", () => {
    expect(parseWholeClaimEvaluation({ missingJustifications: ["x"] })).toBeNull();
    expect(parseWholeClaimEvaluation({ supportedWhere: "s", biggestGap: "g" })).toMatchObject({
      supportedWhere: "s",
      biggestGap: "g",
    });
  });

  it("resolveQuestionAtomKey：target 必须命中真实 kept atom；无 target 是桥接问题", () => {
    expect(resolveQuestionAtomKey({ question: "q", reason: "r" }, ["A"])).toBeNull();
    expect(resolveQuestionAtomKey({ question: "q", reason: "r", targetClaimAtom: "A" }, ["A"])).not.toBeNull();
    expect(
      resolveQuestionAtomKey({ question: "q", reason: "r", targetClaimAtom: "没这句" }, ["A"])
    ).toBeNull();
  });
});

describe("applyConclusionGate（§11 收权门：结构化状态，不读结论文本）", () => {
  const atom = (url: string) => ({ url, title: "t", snippet: "s" });
  const bound = (verdict: string) => ({
    claimAtom: "A",
    verdict,
    supportingSources: [atom("https://t.test/a")],
    contradictingSources: [],
  });

  it("规则1：全部命题 not-applicable 时整句硬判定收成 unverified", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["政府应该禁止短视频"],
      claimAtomTypes: [{ text: "政府应该禁止短视频", verifiable: false, type: "value" }],
      subclaimVerdicts: [],
    });
    expect(result).toMatchObject({ changed: true, to: "unverified", rule: "all-atoms-not-applicable" });
    expect(report.verdictType).toBe("unverified");
  });

  it("规则2：有绑定材料但无 sourced-false 原子时，整句 false 收成 mixed_misleading（#78 真实形状）", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A", "B"],
      claimAtomTypes: [
        { text: "A", verifiable: true, type: "fact" },
        { text: "B", verifiable: false, type: "normative" },
      ],
      subclaimVerdicts: [bound("partial")],
    });
    expect(result).toMatchObject({ changed: true, to: "mixed_misleading", rule: "false-without-sourced-false-atom" });
  });

  it("规则2反例：确有带来源的 false 原子时整句 false 保留", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", supportingSources: [], contradictingSources: [atom("https://t.test/x")] },
      ],
    });
    expect(result.changed).toBe(false);
  });

  it("规则2/3：判词层完全没有绑定 URL 时不重复惩罚（留给 reportReviewer）", () => {
    const reportTrue: Record<string, unknown> = { verdictType: "true" };
    expect(
      applyConclusionGate(reportTrue, {
        claimAtoms: ["A"],
        claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
        subclaimVerdicts: [{ claimAtom: "A", verdict: "true", supportingSources: [], contradictingSources: [] }],
      }).changed
    ).toBe(false);
  });

  it("规则3：有绑定材料但 derived≠true 时整句 true 收权", () => {
    const report: Record<string, unknown> = { verdictType: "true" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
      subclaimVerdicts: [bound("partial")],
    });
    expect(result).toMatchObject({ changed: true, to: "mixed_misleading", rule: "true-without-sourced-true-atoms" });
  });

  it("规则4：audit 桥接缺口未解决时，硬 true/false 收成 unverified（A+B 真推不出 C 真）", () => {
    // true：A 有据之真支撑，但桥接缺口未解决 → 仍收。
    const reportTrue: Record<string, unknown> = { verdictType: "true" };
    expect(
      applyConclusionGate(reportTrue, {
        claimAtoms: ["A", "C"],
        claimAtomTypes: [
          { text: "A", verifiable: true, type: "fact" },
          { text: "C", verifiable: true, type: "fact" },
        ],
        subclaimVerdicts: [
          { claimAtom: "A", verdict: "true", supportingSources: [atom("https://t.test/a")], contradictingSources: [] },
        ],
        auditUnresolvedGaps: ["A 与 C 之间缺独立依据"],
      })
    ).toMatchObject({ changed: true, to: "unverified", rule: "audit-unresolved-bridge-gap" });
    // false：确有带来源的 false 原子（规则2放行），但桥接缺口未解决 → 收。
    const reportFalse: Record<string, unknown> = { verdictType: "false" };
    expect(
      applyConclusionGate(reportFalse, {
        claimAtoms: ["A", "C"],
        claimAtomTypes: [
          { text: "A", verifiable: true, type: "fact" },
          { text: "C", verifiable: true, type: "fact" },
        ],
        subclaimVerdicts: [
          { claimAtom: "A", verdict: "false", supportingSources: [], contradictingSources: [atom("https://t.test/x")] },
        ],
        auditUnresolvedGaps: ["A 与 C 之间缺独立依据"],
      })
    ).toMatchObject({ changed: true, to: "unverified", rule: "audit-unresolved-bridge-gap" });
  });

  it("非硬判定 / 缺 verdictType 时门不动", () => {
    expect(applyConclusionGate({ verdictType: "unverified" }, {}).changed).toBe(false);
    expect(applyConclusionGate({}, {}).changed).toBe(false);
  });
});

describe("repairGatedConclusion（Blocker 1：结构化 repair，不读原文）", () => {
  const src = (url: string) => ({ url, title: "t", snippet: "s" });

  it("demote 触发时重建 conclusion：gated lead 开头 + 保留有源判词 evidence + not-applicable 只作边界", () => {
    const report: Record<string, unknown> = {
      verdictType: "mixed_misleading",
      conclusion: "两条主张均不成立，普通感冒无需输液。",
      summaryForPublic: "两条主张均不成立。",
      recommendation: "不要相信。",
      evidenceChain: [{ layer: "命题", finding: "f", evidence: "e", boundary: "b", sourceRefs: [] }],
    };
    repairGatedConclusion(
      report,
      { changed: true, from: "false", to: "mixed_misleading", rule: "false-without-sourced-false-atom" },
      {
        nonVerifiableAtoms: [{ text: "每次感冒都应当输液", type: "normative" }],
        subclaimVerdicts: [
          {
            claimAtom: "维生素C能治感冒",
            verdict: "partial",
            evidence: "仅可能略微缓解症状。",
            supportingSources: [src("https://t.test/a")],
            contradictingSources: [],
          },
        ],
        auditUnresolvedGaps: [],
      }
    );
    const conclusion = String(report.conclusion);
    expect(conclusion.startsWith(directAnswer("mixed_misleading"))).toBe(true);
    expect(conclusion).not.toContain("均不成立");
    expect(conclusion).toContain("仅可能略微缓解症状");
    expect(conclusion).toContain("不适用真假判断");
    expect(String(report.summaryForPublic).startsWith(directAnswer("mixed_misleading"))).toBe(true);
    expect(String(report.recommendation)).toBe(directAnswer("mixed_misleading"));
    const chain = report.evidenceChain as Array<Record<string, unknown>>;
    expect(chain.some((layer) => layer.layer === "结论边界（整句收权）")).toBe(true);
  });

  it("audit 缺口规则重建时带出缺口边界；门没动时不碰原文", () => {
    const report: Record<string, unknown> = {
      verdictType: "unverified",
      conclusion: "原句成立。",
      evidenceChain: [],
    };
    repairGatedConclusion(
      report,
      { changed: true, from: "true", to: "unverified", rule: "audit-unresolved-bridge-gap" },
      {
        nonVerifiableAtoms: [],
        subclaimVerdicts: [],
        auditUnresolvedGaps: ["从 A、B 到 C 还缺适应症依据"],
      }
    );
    expect(String(report.conclusion)).toContain("仍缺关键依据");
    expect(String(report.summaryForPublic)).toContain("桥接依据仍未补齐");

    const untouched: Record<string, unknown> = { verdictType: "false", conclusion: "原文。" };
    repairGatedConclusion(untouched, { changed: false }, {});
    expect(untouched.conclusion).toBe("原文。");
    expect(untouched.evidenceChain).toBeUndefined();
  });
});

describe("applyConclusionGate postLiveness（Blocker 1：死证不得支撑硬结论）", () => {
  const atom = (url: string) => ({ url, title: "t", snippet: "s" });
  const checkable = [{ text: "A", verifiable: true, type: "fact" }];

  it("liveness 后唯一支撑死掉 → 硬 true 收为 unverified", () => {
    const report: Record<string, unknown> = { verdictType: "true" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: checkable,
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "true", supportingSources: [], contradictingSources: [] },
      ],
      postLiveness: true,
    });
    expect(result).toMatchObject({
      changed: true,
      to: "unverified",
      rule: "post-liveness-no-surviving-evidence",
    });
  });

  it("liveness 后唯一反证死掉 → 硬 false 收为 unverified（无短谣豁免时）", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: checkable,
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", supportingSources: [], contradictingSources: [] },
      ],
      postLiveness: true,
      allowUnboundHardFalse: false,
    });
    expect(result).toMatchObject({
      changed: true,
      to: "unverified",
      rule: "post-liveness-no-surviving-evidence",
    });
  });

  it("短谣存活辟谣豁免：聚合仍有存活 on-topic 辟谣时无绑定 false 保留", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: checkable,
      subclaimVerdicts: [],
      postLiveness: true,
      allowUnboundHardFalse: true,
    });
    expect(result.changed).toBe(false);
    expect(report.verdictType).toBe("false");
  });

  it("liveness 前行为不变：无绑定时留给 reviewer，不重复惩罚", () => {
    const report: Record<string, unknown> = { verdictType: "true" };
    expect(
      applyConclusionGate(report, {
        claimAtoms: ["A"],
        claimAtomTypes: checkable,
        subclaimVerdicts: [],
      }).changed
    ).toBe(false);
  });

  it("存活支撑仍在时硬 true 不动", () => {
    const report: Record<string, unknown> = { verdictType: "true" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: checkable,
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "true",
          supportingSources: [atom("https://t.test/a")],
          contradictingSources: [],
        },
      ],
      postLiveness: true,
    });
    expect(result.changed).toBe(false);
  });
});

describe("needsConstrainedConclusion（Blocker 3：最终结构约束触发 repair）", () => {
  it("reviewer 把 draft true 收到 unverified → 需要 repair，规则为 reviewer-demotion", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "true",
      finalVerdictType: "unverified",
      subclaimVerdicts: [],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
      earlyGate: { changed: false },
      mixedGuardDemoted: false,
    });
    expect(decision).toMatchObject({ needed: true, rule: "reviewer-demotion", from: "true", to: "unverified" });
  });

  it("draft 已是弱 verdict，但有 not-applicable Claim → 需要 repair", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "mixed_misleading",
      finalVerdictType: "mixed_misleading",
      subclaimVerdicts: [],
      nonVerifiableAtoms: [{ text: "立场句", type: "value" }],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
    });
    expect(decision).toMatchObject({ needed: true, rule: "weak-conclusion-audit-alignment" });
  });

  it("draft 已是弱 verdict，有未解决 audit 缺口 → 需要 repair", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "unverified",
      finalVerdictType: "unverified",
      subclaimVerdicts: [],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: ["桥接依据缺失"],
    });
    expect(decision.needed).toBe(true);
  });

  it("结构干净的弱结论（有源、无缺口、无立场句）→ 不 repair，保留 composer 原文", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "mixed_misleading",
      finalVerdictType: "mixed_misleading",
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "partial",
          supportingSources: [{ url: "https://t.test/a", title: "t", snippet: "s" }],
          contradictingSources: [],
        },
      ],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
    });
    expect(decision.needed).toBe(false);
  });

  it("finalGate 触发时规则优先采用 gate 规则", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "false",
      finalVerdictType: "mixed_misleading",
      subclaimVerdicts: [],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: true, from: "false", to: "mixed_misleading", rule: "false-without-sourced-false-atom" },
    });
    expect(decision).toMatchObject({ needed: true, rule: "false-without-sourced-false-atom" });
  });

  it("终态仍是合法硬 verdict，但存在 nonVerifiableAtoms → 需要 repair（不降级，只补边界）", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "false",
      finalVerdictType: "false",
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "false",
          supportingSources: [],
          contradictingSources: [{ url: "https://t.test/a", title: "t", snippet: "s" }],
        },
      ],
      nonVerifiableAtoms: [{ text: "B", type: "normative" }],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
      earlyGate: { changed: false },
    });
    expect(decision).toMatchObject({
      needed: true,
      rule: "hard-verdict-with-not-applicable-boundary",
      from: "false",
      to: "false",
    });
  });

  it("终态硬 verdict 且无 not-applicable → 不 repair", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "false",
      finalVerdictType: "false",
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "false",
          supportingSources: [],
          contradictingSources: [{ url: "https://t.test/a", title: "t", snippet: "s" }],
        },
      ],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
    });
    expect(decision.needed).toBe(false);
  });
});

describe("buildScopedEvidence（Blocker 2：局部 marker 显式映射到全局）", () => {
  it("Case A：两个 atom 各有局部 [1] → 全局 [1]/[2] 分别指向各自来源", () => {
    const { texts, globalSources } = buildScopedEvidence([
      {
        claimAtom: "A",
        verdict: "true",
        evidence: "A证据[1]",
        supportingSources: [{ url: "https://t.test/a", title: "A", snippet: "s" }],
        contradictingSources: [],
      },
      {
        claimAtom: "B",
        verdict: "true",
        evidence: "B证据[1]",
        supportingSources: [{ url: "https://t.test/b", title: "B", snippet: "s" }],
        contradictingSources: [],
      },
    ]);
    expect(globalSources.map((s) => s.url)).toEqual(["https://t.test/a", "https://t.test/b"]);
    expect(texts).toEqual(["A证据[1]", "B证据[2]"]);
  });

  it("Case B：第二 atom 的 support[1] contradict[2] → 全局顺延，不错绑到第一 atom", () => {
    const { texts, globalSources } = buildScopedEvidence([
      {
        claimAtom: "A",
        verdict: "true",
        evidence: "A证据[1]",
        supportingSources: [{ url: "https://t.test/a", title: "A", snippet: "s" }],
        contradictingSources: [],
      },
      {
        claimAtom: "B",
        verdict: "partial",
        evidence: "B支持[1]B反驳[2]",
        supportingSources: [{ url: "https://t.test/bs", title: "BS", snippet: "s" }],
        contradictingSources: [{ url: "https://t.test/bc", title: "BC", snippet: "s" }],
      },
    ]);
    expect(globalSources.map((s) => s.url)).toEqual([
      "https://t.test/a",
      "https://t.test/bs",
      "https://t.test/bc",
    ]);
    // 朴素复制会留下 B反驳[2]（指向 url-bs）；正确映射是 [3]（指向 url-bc）
    expect(texts).toEqual(["A证据[1]", "B支持[2]B反驳[3]"]);
  });

  it("映射不到存活来源的 marker 删除，不错绑", () => {
    const { texts } = buildScopedEvidence([
      {
        claimAtom: "A",
        verdict: "true",
        evidence: "证据见[1][9]。",
        supportingSources: [{ url: "https://t.test/a", title: "A", snippet: "s" }],
        contradictingSources: [],
      },
    ]);
    expect(texts).toEqual(["证据见[1]。"]);
  });
});

describe("repairGatedConclusion 在硬 verdict 保留时补边界（Blocker 1）", () => {
  it("overall false 由 A 合法支撑：保留 false，B 只作不适用边界，引用作用域正确", () => {
    const report: Record<string, unknown> = {
      verdictType: "false",
      conclusion: "A、B两条主张都不成立。",
      summaryForPublic: "两者都不成立。",
      recommendation: "不要相信。",
      evidenceChain: [],
      subclaimVerdicts: [
        {
          claimAtom: "A",
          verdict: "false",
          evidence: "A证据[1]",
          supportingSources: [],
          contradictingSources: [{ url: "https://t.test/a", title: "A", snippet: "s" }],
        },
      ],
    };
    repairGatedConclusion(
      report,
      { changed: true, from: "false", to: "false", rule: "hard-verdict-with-not-applicable-boundary" },
      {
        nonVerifiableAtoms: [{ text: "B", type: "normative" }],
        subclaimVerdicts: report.subclaimVerdicts,
        auditUnresolvedGaps: [],
      }
    );
    expect(report.verdictType).toBe("false");
    const conclusion = String(report.conclusion);
    expect(conclusion.startsWith(directAnswer("false"))).toBe(true);
    expect(conclusion).not.toContain("都不成立");
    expect(conclusion).toContain("不适用真假判断");
    expect(conclusion).toContain("A证据[1]");
    const summary = String(report.summaryForPublic);
    expect(summary.startsWith(directAnswer("false"))).toBe(true);
    expect(summary).not.toContain("两者都不成立");
    // 全局编号自洽：repair 后再 normalize 不得错绑
    normalizeReportCitations(report);
    const globals = report.citationSources as Array<{ url: string }>;
    expect(globals.map((s) => s.url)).toEqual(["https://t.test/a"]);
    expect(String(report.conclusion)).toContain("A证据[1]");
  });
});

describe("compactVerdicts（Blocker 2：related-only 不得计为 support）", () => {
  it("sourcesRelatedOnly=true 时 support/contradict 记 0，另列 relatedOnlyCount", () => {
    const out = compactVerdicts([
      {
        claimAtom: "A",
        verdict: "unverified",
        evidence: "e",
        supportingSources: [{ url: "https://t.test/1" }, { url: "https://t.test/2" }],
        contradictingSources: [],
        sourcesRelatedOnly: true,
      },
    ]);
    expect(out).toEqual([
      {
        claimAtom: "A",
        verdict: "unverified",
        supportCount: 0,
        contradictCount: 0,
        relatedOnlyCount: 2,
        sourcesRelatedOnly: true,
        evidence: "e",
      },
    ]);
  });

  it("普通判词计数不变，relatedOnlyCount 为 0", () => {
    const out = compactVerdicts([
      {
        claimAtom: "A",
        verdict: "false",
        evidence: "e",
        supportingSources: [],
        contradictingSources: [{ url: "https://t.test/1" }],
      },
    ]);
    expect(out[0]).toMatchObject({
      supportCount: 0,
      contradictCount: 1,
      relatedOnlyCount: 0,
      sourcesRelatedOnly: false,
    });
  });
});

describe("§14：Whole-Claim Audit 本身不是 Evidence", () => {
  it("audit 文本对象只含问题与理由字段，没有来源结构；suggestedQuery 不可充当来源", () => {
    const plan = parseWholeClaimPlan({
      overallQuestion: "q",
      checkabilityRevisions: [],
      missingJustifications: ["缺依据"],
      auditQuestions: [
        { question: "指南怎么说？", reason: "r", targetClaimAtom: "A", suggestedQuery: "感冒 静脉输液 指南" },
      ],
    });
    const text = JSON.stringify(plan);
    expect(text).not.toContain("https://");
    expect(text).not.toContain("url");
    // 审计产物即使被 JSON 序列化，也不含 InvestigationSource / EvidenceLink 的必备结构。
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(Array.isArray(parsed.auditQuestions)).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────
// Review 5128449568：方向契约共享定义 + 硬结论不得偷判未查清命题
// ───────────────────────────────────────────────────────────────

describe("hasDirectionalBoundHttpUrl（Review 5128449568 Blocker 3：共享方向契约）", () => {
  const s = { url: "https://t.test/a", title: "t", snippet: "s" };

  it("true 只认 supportingSources 的 http(s)；false 只认 contradictingSources 的 http(s)", () => {
    expect(hasDirectionalBoundHttpUrl({ verdict: "true", supportingSources: [s], contradictingSources: [] })).toBe(true);
    expect(hasDirectionalBoundHttpUrl({ verdict: "true", supportingSources: [], contradictingSources: [s] })).toBe(false);
    expect(hasDirectionalBoundHttpUrl({ verdict: "false", supportingSources: [], contradictingSources: [s] })).toBe(true);
    expect(hasDirectionalBoundHttpUrl({ verdict: "false", supportingSources: [s], contradictingSources: [] })).toBe(false);
  });

  it("related-only 永远不算；partial（mixed 语义）两侧都算；无 URL 不算", () => {
    expect(hasDirectionalBoundHttpUrl({ verdict: "true", supportingSources: [s], sourcesRelatedOnly: true })).toBe(false);
    expect(hasDirectionalBoundHttpUrl({ verdict: "false", contradictingSources: [s], sourcesRelatedOnly: true })).toBe(false);
    expect(hasDirectionalBoundHttpUrl({ verdict: "partial", supportingSources: [], contradictingSources: [s] })).toBe(true);
    expect(hasDirectionalBoundHttpUrl({ verdict: "true", supportingSources: [], contradictingSources: [] })).toBe(false);
  });
});

describe("applyConclusionGate 方向契约（Review 5128449568 Blocker 3）", () => {
  const atom = (u: string) => ({ url: u, title: "t", snippet: "s" });

  it("true + 仅错桶 contradict URL → 不得当 sourced true，整句 true 收权", () => {
    const report: Record<string, unknown> = { verdictType: "true" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "true", supportingSources: [], contradictingSources: [atom("https://t.test/x")] },
      ],
    });
    expect(result).toMatchObject({ changed: true, to: "unverified", rule: "true-without-sourced-true-atoms" });
  });

  it("false + 仅错桶 support URL → 不得当 sourced false，整句 false 收权", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", supportingSources: [atom("https://t.test/x")], contradictingSources: [] },
      ],
    });
    expect(result).toMatchObject({ changed: true, to: "unverified", rule: "false-without-sourced-false-atom" });
  });

  it("false + 反证桶有 URL → 方向一致，整句 false 保留（对齐后的合法形状）", () => {
    const report: Record<string, unknown> = { verdictType: "false" };
    const result = applyConclusionGate(report, {
      claimAtoms: ["A"],
      claimAtomTypes: [{ text: "A", verifiable: true, type: "fact" }],
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", supportingSources: [], contradictingSources: [atom("https://t.test/x")] },
      ],
    });
    expect(result.changed).toBe(false);
  });
});

describe("needsConstrainedConclusion 未查清边界（Review 5128449568 Blocker 1）", () => {
  const src = (u: string) => ({ url: u, title: "t", snippet: "s" });

  it("终态硬 false 由 A 合法支撑，但 B checkable-unverified → 需要 repair，只补边界不降级", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "false",
      finalVerdictType: "false",
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", supportingSources: [], contradictingSources: [src("https://t.test/a")] },
        { claimAtom: "B", verdict: "unverified", supportingSources: [], contradictingSources: [] },
      ],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
    });
    expect(decision).toMatchObject({
      needed: true,
      rule: "hard-verdict-with-unverified-boundary",
      from: "false",
      to: "false",
    });
  });

  it("终态硬 verdict 且存在方向不符（true 无支撑桶 URL）的 checkable atom → 需要 repair", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "true",
      finalVerdictType: "true",
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "true", supportingSources: [src("https://t.test/a")], contradictingSources: [] },
        { claimAtom: "B", verdict: "true", supportingSources: [], contradictingSources: [src("https://t.test/b")] },
      ],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
    });
    expect(decision).toMatchObject({ needed: true, rule: "hard-verdict-with-unverified-boundary" });
  });

  it("全部 checkable atom 方向有据时硬 verdict 不因本规则 repair", () => {
    const decision = needsConstrainedConclusion({
      draftVerdictType: "false",
      finalVerdictType: "false",
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", supportingSources: [], contradictingSources: [src("https://t.test/a")] },
      ],
      nonVerifiableAtoms: [],
      auditUnresolvedGaps: [],
      finalGate: { changed: false },
    });
    expect(decision.needed).toBe(false);
  });
});

describe("repairGatedConclusion 未查清边界文本（Review 5128449568 Blocker 1）", () => {
  it("硬 verdict 保留时的 repair 文本明确「哪些 checkable Claim 尚未查清、未计入该判断」", () => {
    const report: Record<string, unknown> = {
      verdictType: "false",
      conclusion: "旧文本",
      summaryForPublic: "旧文本",
      recommendation: "旧文本",
      evidenceChain: [],
    };
    repairGatedConclusion(
      report,
      { changed: true, from: "false", to: "false", rule: "hard-verdict-with-unverified-boundary" },
      {
        nonVerifiableAtoms: [],
        subclaimVerdicts: [
          {
            claimAtom: "A",
            verdict: "false",
            evidence: "对照研究[1]显示无效。",
            supportingSources: [],
            contradictingSources: [{ url: "https://t.test/a", title: "t", snippet: "s" }],
          },
          { claimAtom: "B", verdict: "unverified", evidence: "", supportingSources: [], contradictingSources: [] },
        ],
        auditUnresolvedGaps: [],
      }
    );
    const conclusion = String(report.conclusion ?? "");
    expect(conclusion).toContain(directAnswer("false"));
    expect(conclusion).toContain("「B」尚未查清");
    expect(conclusion).toContain("未计入该判断");
    expect(String(report.summaryForPublic ?? "")).toContain("尚未查清");
    const chain = report.evidenceChain as Array<Record<string, unknown>>;
    expect(String(chain.at(-1)?.finding ?? "")).toContain("尚未查清");
  });
});
