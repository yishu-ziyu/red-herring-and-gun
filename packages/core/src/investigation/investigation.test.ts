import { describe, expect, it } from "vitest";

import {
  buildInvestigationSnapshot,
  rebuildInvestigationFromReport,
  assertInvestigationInvariants,
  validateInvestigationSnapshot,
  InvestigationSnapshotSchema,
  type InvestigationSnapshotV1,
} from "./index.js";

const keyFn = (s: string) => s.replace(/\u3000/g, " ").trim();

function src(url: string, title: string, snippet = "") {
  return { url, title, snippet };
}

function scanKeys(value: unknown, banned: RegExp, path = ""): string[] {
  const hits: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((item, i) => hits.push(...scanKeys(item, banned, `${path}[${i}]`)));
    return hits;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (banned.test(k)) hits.push(`${path}.${k}`);
      hits.push(...scanKeys(v, banned, `${path}.${k}`));
    }
  }
  return hits;
}

const IMPLEMENTATION_KEY_RE = /^(provider|model|agent|agentName|agentIcon|toolName|tool|token|latencyMs|systemPrompt|userContent|RRF|pipeline)$/i;

function expectCleanContract(snapshot: InvestigationSnapshotV1) {
  expect(scanKeys(snapshot, IMPLEMENTATION_KEY_RE)).toEqual([]);
  assertInvestigationInvariants(snapshot);
}

describe("golden case 1：明确错误", () => {
  const claim = "世界卫生组织已经宣布喝隔夜水会致癌。";
  const atom = "喝隔夜水会致癌";
  const refuteUrl = "https://piyao.org.cn/overnight-water";
  const snapshot = buildInvestigationSnapshot({
    originalClaim: claim,
    phase: "complete",
    claimAtoms: [atom],
    claimAtomTypes: [{ text: atom, verifiable: true, type: "causal" }],
    atomSearchBundle: {
      atomsSearched: [atom],
      byAtomKey: { [atom]: [src(refuteUrl, "世卫组织辟谣平台：无此结论", "官方声明未提及隔夜水致癌")] },
    },
    subclaimVerdicts: [
      {
        claimAtom: atom,
        verdict: "false",
        evidence: "世卫组织辟谣平台声明无此结论[1]。",
        boundary: "只覆盖声明发布时间前的公开记录",
        supportingSources: [],
        contradictingSources: [src(refuteUrl, "世卫组织辟谣平台：无此结论", "官方声明未提及隔夜水致癌")],
        evidenceGaps: [],
      },
    ],
    report: {
      conclusion: "原句站不住。世界卫生组织没有发布过这一结论。",
      verdictType: "false",
      citationSources: [{ url: refuteUrl, title: "世卫组织辟谣平台：无此结论", snippet: "" }],
      checkedAt: "2026-09-06T08:00:00.000Z",
    },
    checkedAt: "2026-09-06T08:00:00.000Z",
  }, { claimAtomKeyFn: keyFn });

  it("judgment=refuted 且绑定反驳来源", () => {
    expect(snapshot.claims[0]!.judgment).toBe("refuted");
    const roles = snapshot.claims[0]!.evidence.map((l) => l.role);
    expect(roles).toContain("contradict");
    const sourceIds = snapshot.claims[0]!.evidence.filter((l) => l.role === "contradict").map((l) => l.sourceId);
    for (const id of sourceIds) {
      expect(snapshot.sources.find((s) => s.id === id)?.url).toBe(refuteUrl);
    }
    expect(snapshot.conclusion?.directAnswer).toContain("原句站不住");
    expect(snapshot.conclusion?.judgment).toBe("refuted");
    expect(snapshot.phase).toBe("complete");
    expectCleanContract(snapshot);
  });
});

describe("golden case 2：基本正确", () => {
  const claim = "空气中氧气约占体积的两成。";
  const atom = "空气中氧气约占体积的两成";
  const supportUrl = "https://www.gov.cn/air-composition";
  const snapshot = buildInvestigationSnapshot({
    originalClaim: claim,
    phase: "complete",
    claimAtoms: [atom],
    claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
    atomSearchBundle: {
      atomsSearched: [atom],
      byAtomKey: { [atom]: [src(supportUrl, "标准大气成分", "氧气 20.9%")] },
    },
    subclaimVerdicts: [
      {
        claimAtom: atom,
        verdict: "true",
        evidence: "标准大气成分表显示氧气占 20.9%[1]。",
        boundary: "",
        supportingSources: [src(supportUrl, "标准大气成分", "氧气 20.9%")],
        contradictingSources: [],
        evidenceGaps: [],
      },
    ],
    report: {
      conclusion: "会。公开标准大气成分表显示氧气约占 20.9%。",
      verdictType: "true",
      citationSources: [{ url: supportUrl, title: "标准大气成分", snippet: "" }],
    },
  }, { claimAtomKeyFn: keyFn });

  it("judgment=supported 且支持来源可解析", () => {
    expect(snapshot.claims[0]!.judgment).toBe("supported");
    expect(snapshot.claims[0]!.evidence.some((l) => l.role === "support")).toBe(true);
    expect(snapshot.conclusion?.judgment).toBe("supported");
    expectCleanContract(snapshot);
  });
});

describe("golden case 3：半真半假", () => {
  const claim = "维生素C能治感冒，而且每次感冒都应当输液。";
  const atomA = "维生素C能治感冒";
  const atomB = "每次感冒都应当输液";
  const aUrl = "https://journal.example/vc-cold";
  const bRefute = "https://health.gov.cn/iv-fact";
  const snapshot = buildInvestigationSnapshot({
    originalClaim: claim,
    phase: "complete",
    claimAtoms: [atomA, atomB],
    claimAtomTypes: [
      { text: atomA, verifiable: true, type: "causal" },
      { text: atomB, verifiable: true, type: "fact" },
    ],
    atomSearchBundle: {
      atomsSearched: [atomA, atomB],
      byAtomKey: {
        [atomA]: [src(aUrl, "维C与普通感冒病程研究", "缩短病程约 8%")],
        [atomB]: [src(bRefute, "输液指征说明", "普通感冒无输液指征")],
      },
    },
    subclaimVerdicts: [
      {
        claimAtom: atomA,
        verdict: "partial",
        evidence: "研究显示补充维C只缩短病程约 8%，不是治疗[1]。",
        boundary: "不覆盖重症",
        supportingSources: [src(aUrl, "维C与普通感冒病程研究", "缩短病程约 8%")],
        contradictingSources: [],
        evidenceGaps: [],
      },
      {
        claimAtom: atomB,
        verdict: "false",
        evidence: "临床指征说明普通感冒不应输液[1]。",
        boundary: "",
        supportingSources: [],
        contradictingSources: [src(bRefute, "输液指征说明", "普通感冒无输液指征")],
        evidenceGaps: [],
      },
    ],
    report: {
      conclusion: "只有前半截有依据且被夸大；后半截站不住。",
      verdictType: "mixed_misleading",
      citationSources: [
        { url: aUrl, title: "维C与普通感冒病程研究", snippet: "" },
        { url: bRefute, title: "输液指征说明", snippet: "" },
      ],
    },
  }, { claimAtomKeyFn: keyFn });

  it("两条独立命题各自判断，不压成单一真假", () => {
    const judgments = snapshot.claims.map((c) => c.judgment);
    expect(judgments).toEqual(["mixed", "refuted"]);
    expect(snapshot.conclusion?.judgment).toBe("mixed");
    expect(snapshot.claims.map((c) => c.order)).toEqual([0, 1]);
    expectCleanContract(snapshot);
  });
});

describe("golden case 4：证据不足", () => {
  const claim = "某小区本月的自来水异味来自新增消毒工艺。";
  const atom = "某小区本月的自来水异味来自新增消毒工艺";
  const snapshot = buildInvestigationSnapshot({
    originalClaim: claim,
    phase: "complete",
    claimAtoms: [atom],
    claimAtomTypes: [{ text: atom, verifiable: true, type: "causal" }],
    atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: [] } },
    subclaimVerdicts: [
      {
        claimAtom: atom,
        verdict: "unverified",
        evidence: "",
        boundary: "",
        supportingSources: [],
        contradictingSources: [],
        evidenceGaps: ["该原子定向检索无结果，待补证"],
      },
    ],
    report: {
      conclusion: "公开材料还撑不住这条说法，异味来源仍未查清。",
      verdictType: "unverified",
      citationSources: [],
    },
  }, { claimAtomKeyFn: keyFn });

  it("judgment=unresolved、Gap open、不判 refuted", () => {
    expect(snapshot.claims[0]!.judgment).toBe("unresolved");
    expect(snapshot.claims[0]!.gaps.length).toBeGreaterThan(0);
    expect(snapshot.claims[0]!.gaps.every((g) => g.status === "open")).toBe(true);
    expect(snapshot.claims[0]!.evidence).toEqual([]);
    expect(snapshot.conclusion?.judgment).toBe("unresolved");
    expectCleanContract(snapshot);
  });

  it("Gap 允许无来源", () => {
    for (const gap of snapshot.claims[0]!.gaps) {
      expect(gap.resolvedBySourceIds).toBeUndefined();
    }
  });
});

describe("golden case 5：真实冲突", () => {
  const claim = "新规要求 2026 年起电动车必须装识别芯片。";
  const atom = "新规要求 2026 年起电动车必须装识别芯片";
  const supportUrl = "https://gov.example/notice-2026";
  const refuteUrl = "https://fact.example/rumor-chip";
  const base = {
    originalClaim: claim,
    claimAtoms: [atom],
    claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
    atomSearchBundle: {
      atomsSearched: [atom],
      byAtomKey: {
        [atom]: [
          src(supportUrl, "某地试点通知", "试点要求登记识别芯片"),
          src(refuteUrl, "全国性新规查证", "无全国统一识别芯片要求"),
        ],
      },
    },
  };
  const verdict = {
    claimAtom: atom,
    verdict: "unverified",
    evidence: "试点通知与全国查证并存，适用范围存在分歧。",
    boundary: "",
    supportingSources: [src(supportUrl, "某地试点通知", "试点要求登记识别芯片")],
    contradictingSources: [src(refuteUrl, "全国性新规查证", "无全国统一识别芯片要求")],
    evidenceGaps: [],
  };

  it("质询已回应：reasonStatus=known 且带 reason", () => {
    const snapshot = buildInvestigationSnapshot({
      ...base,
      phase: "complete",
      subclaimVerdicts: [verdict],
      crossExam: {
        ran: true,
        atoms: [
          {
            atom,
            status: "answered",
            response: "分歧来自适用范围：试点通知只覆盖某地，不是全国新规。",
            secondVerdict: "false",
          },
        ],
      },
      report: { conclusion: "该说法把地方试点说成了全国新规。", verdictType: "unverified" },
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.conflicts.length).toBe(1);
    const conflict = snapshot.conflicts[0]!;
    expect(conflict.reasonStatus).toBe("known");
    expect(conflict.reason).toContain("适用范围");
    expect(conflict.unresolved).toBe(true);
    expect(conflict.sides.map((s) => s.position).sort()).toEqual(["contradict", "support"]);
    expectCleanContract(snapshot);
  });

  it("crossExam 未运行：冲突仍存在，reasonStatus=unknown 且不带 reason", () => {
    const snapshot = buildInvestigationSnapshot({
      ...base,
      phase: "complete",
      subclaimVerdicts: [verdict],
      report: { conclusion: "试点与全国口径并存，需以正式文件为准。", verdictType: "unverified" },
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.conflicts.length).toBe(1);
    const conflict = snapshot.conflicts[0]!;
    expect(conflict.reasonStatus).toBe("unknown");
    expect(conflict.reason).toBeUndefined();
    expectCleanContract(snapshot);
  });

  it("模型意见不同但证据单侧：不生成 Conflict", () => {
    const snapshot = buildInvestigationSnapshot({
      ...base,
      phase: "complete",
      subclaimVerdicts: [{ ...verdict, contradictingSources: [], verdict: "true", evidence: "试点通知支持该说法。" }],
      crossExam: {
        ran: true,
        atoms: [{ atom, status: "answered", secondVerdict: "false", relation: "disagree", response: "" }],
      },
      report: { conclusion: "试点范围内成立。", verdictType: "true" },
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.conflicts).toEqual([]);
    expectCleanContract(snapshot);
  });
});

describe("证据关系边界", () => {
  it("sourcesRelatedOnly 映射 context-only，绝不算 support", () => {
    const claim = "某种床垫能治失眠。";
    const atom = "某种床垫能治失眠";
    const fillUrl = "https://shop.example/mattress-ad";
    const snapshot = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "complete",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: true, type: "causal" }],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: { [atom]: [src(fillUrl, "床垫广告页", "宣称改善睡眠")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "unverified",
          evidence: "检索只命中销售页，无临床证据。",
          boundary: "",
          supportingSources: [src(fillUrl, "床垫广告页", "宣称改善睡眠")],
          contradictingSources: [],
          evidenceGaps: ["待补证"],
          sourcesRelatedOnly: true,
        },
      ],
      report: { conclusion: "公开材料撑不住这条说法。", verdictType: "unverified" },
    }, { claimAtomKeyFn: keyFn });
    const roles = snapshot.claims[0]!.evidence.map((l) => l.role);
    expect(roles).toEqual(["context-only"]);
    expect(roles).not.toContain("support");
    expect(snapshot.claims[0]!.judgment).toBe("unresolved");
    expectCleanContract(snapshot);
  });

  it("judgment supported/refuted 无绑定来源时收敛 unresolved（生产 demote 同向）", () => {
    const claim = "某地昨天发生了 5.0 级地震。";
    const atom = "某地昨天发生了 5.0 级地震";
    const snapshot = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "complete",
      claimAtoms: [atom],
      atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: [] } },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "false",
          evidence: "核查模型声称有反证。",
          boundary: "",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      report: { conclusion: "公开材料撑不住这一结论。", verdictType: "unverified" },
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.claims[0]!.judgment).toBe("unresolved");
    expectCleanContract(snapshot);
  });

  it("幻觉 URL（不在检索集）不进快照", () => {
    const claim = "某品牌奶粉被召回。";
    const atom = "某品牌奶粉被召回";
    const hallucinated = "https://fake-news.example/recall";
    const snapshot = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "judging",
      claimAtoms: [atom],
      atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: [] } },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "true",
          evidence: "召回公告见[1]。",
          boundary: "",
          supportingSources: [src(hallucinated, "召回公告", "")],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.claims[0]!.evidence).toEqual([]);
    expect(snapshot.claims[0]!.judgment).toBe("unresolved");
  });
});

describe("unassessed 生命周期", () => {
  const claim = "某市下周将试点无人驾驶公交。";
  const atom = "某市下周将试点无人驾驶公交";
  const url = "https://news.example/autobus";
  const bundle = {
    atomsSearched: [atom],
    byAtomKey: { [atom]: [src(url, "试点报道", "官方征集意见稿")] },
  };

  it("检索返回后、核查前：unassessed；judging/complete 不残留", () => {
    const investigating = buildInvestigationSnapshot(
      { originalClaim: claim, phase: "investigating", claimAtoms: [atom], atomSearchBundle: bundle },
      { claimAtomKeyFn: keyFn }
    );
    expect(investigating.claims[0]!.evidence.map((l) => l.role)).toEqual(["unassessed"]);
    expect(investigating.claims[0]!.progress).toBe("searching");
    assertInvestigationInvariants(investigating);

    const complete = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "complete",
      claimAtoms: [atom],
      atomSearchBundle: bundle,
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "unverified",
          evidence: "报道只有征集意见，未发正式文件。",
          boundary: "",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: ["待补证"],
        },
      ],
      report: { conclusion: "还没有正式文件，查不清。", verdictType: "unverified" },
    }, { claimAtomKeyFn: keyFn });
    const roles = complete.claims[0]!.evidence.map((l) => l.role);
    expect(roles).toContain("context-only");
    expect(roles).not.toContain("unassessed");
    expectCleanContract(complete);
  });
});

describe("中断与历史", () => {
  const claim = "某地高铁昨因大风全线停运。";
  const atomA = "某地高铁昨因大风全线停运";
  const atomB = "全线停运持续三天";
  const url = "https://rail.example/notice";

  it("interrupted：保留已获得数据，无 conclusion，未判命题标 interrupted", () => {
    const snapshot = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "interrupted",
      claimAtoms: [atomA, atomB],
      atomSearchBundle: {
        atomsSearched: [atomA],
        byAtomKey: { [atomA]: [src(url, "铁路公告", "部分车次停运")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: atomA,
          verdict: "unverified",
          evidence: "公告只提到部分车次。",
          boundary: "",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: ["待补证"],
        },
      ],
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.phase).toBe("interrupted");
    expect(snapshot.conclusion).toBeUndefined();
    expect(snapshot.claims[0]!.progress).toBe("complete");
    expect(snapshot.claims[1]!.progress).toBe("interrupted");
    expect(snapshot.claims[1]!.judgment).toBeNull();
    expect(snapshot.sources.length).toBe(1);
    assertInvestigationInvariants(snapshot);
  });

  it("旧历史报告（无 investigation、无 bundle）：确定性重建为 complete", () => {
    const stored = {
      conclusion: "该说法只对试点范围成立。",
      verdictType: "unverified",
      claimItems: [
        { text: "新规要求装识别芯片", verifiable: true, type: "fact", verdict: { claimAtom: "新规要求装识别芯片", verdict: "unverified", evidence: "试点通知与全国查证并存。", supportingSources: [{ url: "https://gov.example/a", title: "试点通知", snippet: "s" }], contradictingSources: [], evidenceGaps: ["待补证"] } },
        { text: "这消息传得很快", verifiable: false, type: "价值" },
      ],
      subclaimVerdicts: [
        { claimAtom: "新规要求装识别芯片", verdict: "unverified", evidence: "试点通知与全国查证并存。", supportingSources: [{ url: "https://gov.example/a", title: "试点通知", snippet: "s" }], contradictingSources: [], evidenceGaps: ["待补证"] },
      ],
      nonVerifiableAtoms: [{ text: "这消息传得很快", type: "价值" }],
      crossExam: { ran: false, skippedReason: "没有已绑定的证据冲突或明确证据缺口", atoms: [] },
      checkedAt: "2026-08-01T10:00:00.000Z",
    };
    const snapshot = rebuildInvestigationFromReport({ report: stored, claim: "新规要求装识别芯片" });
    expect(snapshot.phase).toBe("complete");
    expect(snapshot.originalClaim).toBe("新规要求装识别芯片");
    expect(snapshot.claims.length).toBe(2);
    const first = snapshot.claims[0]!;
    expect(first.judgment).toBe("unresolved");
    expect(first.evidence.map((l) => l.role)).toContain("support");
    expect(snapshot.claims[1]!.checkability).toBe("not-applicable");
    expect(snapshot.claims[1]!.judgment).toBe("not-applicable");
    expect(snapshot.checkedAt).toBe("2026-08-01T10:00:00.000Z");
    expect(snapshot.conclusion?.directAnswer).toContain("试点");
    assertInvestigationInvariants(snapshot);
  });

  it("error-boundary 报告重建为 interrupted，不补 conclusion", () => {
    const stored = { _source: "error-boundary", conclusion: "核查超过时限，先给中间结论。", verdictType: "unverified" };
    const snapshot = rebuildInvestigationFromReport({ report: stored, claim: "某说法" });
    expect(snapshot.phase).toBe("interrupted");
    expect(snapshot.conclusion).toBeUndefined();
    expect(snapshot.claims).toEqual([]);
  });
});

describe("命题透明", () => {
  it("逐字命中给真实 span；改写命题不给 span", () => {
    const claim = "世界卫生组织已经宣布喝隔夜水会致癌。";
    const verbatim = "喝隔夜水会致癌";
    const paraphrase = "隔夜水致癌说";
    const snapshot = buildInvestigationSnapshot(
      { originalClaim: claim, phase: "decomposed", claimAtoms: [verbatim, paraphrase] },
      { claimAtomKeyFn: keyFn }
    );
    expect(snapshot.claims[0]!.originalSpan).toEqual({ start: 10, end: 17 });
    expect(snapshot.claims[1]!.originalSpan).toBeUndefined();
  });

  it("超 180 字命题：text 不截断，内部关系经内部 key 正常 join", () => {
    const tail = "并且主管部门将在验收通过后统一公布改造车辆清单与补贴发放进度。";
    const atom = "某市宣布全市出租车将在今年内完成智能终端升级改造，" + tail.repeat(6);
    expect(atom.length).toBeGreaterThan(180);
    const supportUrl = "https://gov.example/taxi-upgrade";
    // 生产 byAtomKey 的键是 claimAtomKey 产物（180 截断 + 省略号），这里按生产形状写。
    const truncatedKey = `${atom.slice(0, 180)}…`;
    // 不传 claimAtomKeyFn：走内置 defaultClaimAtomKey（全角空格规范化 + 180 截断）。
    const snapshot = buildInvestigationSnapshot({
      originalClaim: `据通报，${atom}`,
      phase: "complete",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: { [truncatedKey]: [src(supportUrl, "升级改造通知", "年内完成改造")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "true",
          evidence: "官方通报确认年内完成改造[1]。",
          boundary: "",
          supportingSources: [src(supportUrl, "升级改造通知", "年内完成改造")],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      report: {
        conclusion: "该说法属实，年内完成智能终端升级改造。",
        verdictType: "true",
        citationSources: [{ url: supportUrl, title: "升级改造通知", snippet: "" }],
      },
    });
    const claim = snapshot.claims[0]!;
    expect(claim.text).toBe(atom);
    expect(claim.text).not.toContain("…");
    expect(claim.judgment).toBe("supported");
    expect(claim.evidence.map((l) => l.role)).toContain("support");
    expect(claim.originalSpan).toEqual({ start: 4, end: 4 + atom.length });
    expect(snapshot.conclusion?.claimIds).toEqual([claim.id]);
    expectCleanContract(snapshot);
  });

  it("全角空格：key 规范化但展示文本保留原样，span 按真实文本定位", () => {
    const atom = "空气中\u3000氧气约占两成";
    const supportUrl = "https://www.gov.cn/air";
    const snapshot = buildInvestigationSnapshot({
      originalClaim: `有人说，${atom}。`,
      phase: "complete",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: { "空气中 氧气约占两成": [src(supportUrl, "大气成分", "氧气约占两成")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "true",
          evidence: "标准大气成分显示氧气约占两成[1]。",
          boundary: "",
          supportingSources: [src(supportUrl, "大气成分", "氧气约占两成")],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
    });
    const claim = snapshot.claims[0]!;
    expect(claim.text).toBe(atom);
    expect(claim.text).toContain("\u3000");
    expect(claim.judgment).toBe("supported");
    expect(claim.evidence.some((l) => l.role === "support")).toBe(true);
    expect(claim.originalSpan).toEqual({ start: 4, end: 4 + atom.length });
    expectCleanContract(snapshot);
  });

  it("立场条 checkability=not-applicable，judgment=not-applicable", () => {
    const claim = "我觉得这部电影拍得很难看。";
    const atom = "我觉得这部电影拍得很难看";
    const snapshot = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "decomposed",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: false, type: "value" }],
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.claims[0]!.checkability).toBe("not-applicable");
    expect(snapshot.claims[0]!.judgment).toBe("not-applicable");
    expect(snapshot.claims[0]!.evidence).toEqual([]);
  });

  it("conclusion judgment=not-applicable：整句无可核查命题", () => {
    const claim = "我觉得今天天气很好。";
    const atom = "我觉得今天天气很好";
    const snapshot = buildInvestigationSnapshot({
      originalClaim: claim,
      phase: "complete",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: false, type: "value" }],
      report: { conclusion: "这是个人感受，不适用真假判断。", verdictType: "unverified" },
    }, { claimAtomKeyFn: keyFn });
    expect(snapshot.conclusion?.judgment).toBe("not-applicable");
  });
});

describe("schema 与不变量", () => {
  it("拒绝实现层字段（closed schema）", () => {
    const bad = {
      schemaVersion: 1,
      originalClaim: "x",
      phase: "received",
      claims: [],
      sources: [],
      conflicts: [],
      provider: "minimax",
    };
    expect(() => validateInvestigationSnapshot(bad)).toThrow();
  });

  it("整份快照无实现层键", () => {
    const snapshot = buildInvestigationSnapshot({
      originalClaim: "某说法",
      phase: "complete",
      claimAtoms: ["某说法"],
      atomSearchBundle: { atomsSearched: ["某说法"], byAtomKey: { 某说法: [src("https://a.example/x", "a", "b")] } },
      subclaimVerdicts: [{ claimAtom: "某说法", verdict: "true", evidence: "e", supportingSources: [src("https://a.example/x", "a", "b")], contradictingSources: [], evidenceGaps: [] }],
      crossExam: { ran: true, atoms: [{ atom: "某说法", status: "answered", response: "r" }] },
      pursuitHops: [{ hop: 1, atom: "某说法", goal: "找原始发布", purpose: "primary", query: "q", resultKind: "primary", newEvidence: 1, missingAfter: ["原始来源"], gain: 0.4, action: "stop" }],
      report: { conclusion: "成立。", verdictType: "true", causalBoundary: "不推出因果", citationSources: [{ url: "https://a.example/x", title: "a", snippet: "b" }], checkedAt: "2026-09-06T00:00:00.000Z" },
    }, { claimAtomKeyFn: keyFn });
    expect(scanKeys(snapshot, IMPLEMENTATION_KEY_RE)).toEqual([]);
    expect(snapshot.conflicts).toEqual([]);
    expect(snapshot.claims[0]!.gaps[0]?.consequence).toContain("找原始发布");
    expectCleanContract(snapshot);
  });

  it("invariants 抓住引用不解析", () => {
    const snapshot = validateInvestigationSnapshot({
      schemaVersion: 1,
      originalClaim: "x",
      phase: "received",
      claims: [
        {
          id: "claim-1",
          text: "x",
          order: 0,
          checkability: "checkable",
          progress: "pending",
          judgment: null,
          evidence: [{ sourceId: "src-404", role: "support" }],
          gaps: [],
        },
      ],
      sources: [],
      conflicts: [],
    });
    expect(() => assertInvestigationInvariants(snapshot)).toThrow(/does not resolve/);
  });

  it("schemaVersion 不是 1 会被拒", () => {
    expect(() =>
      validateInvestigationSnapshot({
        schemaVersion: 2,
        originalClaim: "x",
        phase: "received",
        claims: [],
        sources: [],
        conflicts: [],
      })
    ).toThrow();
    expect(InvestigationSnapshotSchema.properties).toHaveProperty("schemaVersion");
  });
});
