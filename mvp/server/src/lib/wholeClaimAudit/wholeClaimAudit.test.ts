/**
 * Whole-Claim Audit 单元回归（Issue #78）。
 * 覆盖：可核查性修订只提升不降级 / 只命中真实 kept atom / type 不改写；
 * 解析夹紧；结论收权门四条不变量；audit artifact 永不成为 Evidence。
 */
import { describe, expect, it } from "vitest";
import {
  applyCheckabilityRevisions,
  applyConclusionGate,
  parseWholeClaimEvaluation,
  parseWholeClaimPlan,
  resolveQuestionAtomKey,
} from "./index.js";

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
