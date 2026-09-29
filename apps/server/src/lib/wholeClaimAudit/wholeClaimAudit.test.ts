/**
 * Whole-Claim Audit 单元回归（Issue #78）。
 * 覆盖：可核查性修订只提升不降级 / 只命中真实 kept atom / type 不改写；
 * 解析夹紧；结论说明的局部 [n] 映射；audit artifact 永不成为 Evidence。
 * （原「结论收权门」的测试随门一起删除：它们防的失败已改写成对整句规则表的检查，
 *  见 domain/verdict.test.ts、sentenceVerdict.test.ts、casePipeline/finalizeReport.verdict.test.ts。）
 */
import { describe, expect, it } from "vitest";
import {
  applyCheckabilityRevisions,
  buildScopedEvidence,
  compactVerdicts,
  parseWholeClaimEvaluation,
  parseWholeClaimPlan,
  resolveQuestionAtomKey,
} from "./index.js";
import { hasDirectionalBoundHttpUrl } from "../citationBinding.js";

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

