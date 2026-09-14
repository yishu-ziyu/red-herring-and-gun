/**
 * 同一案追问快路径分类器（契约 docs/evals/2026-09-13-followup-fast-path.md Evaluator 1）。
 */
import { describe, expect, it } from "vitest";
import {
  FOLLOW_UP_MARKER,
  applyFollowUpAnswerLead,
  collapseFollowUpAtoms,
  extractPriorVerifiedAtoms,
  followUpCoveredByAtom,
  followUpQuestionOf,
  followUpReuseFromClientBrief,
  parsePriorRoundBrief,
  planFollowUpReuse,
  priorReportFromVisibleBrief,
  priorRoundLookupOf,
} from "./followUpReuse.js";

const ATOM_NITRITE = "隔夜菜的亚硝酸盐含量会超标";
const ATOM_POISON = "吃了隔夜菜会导致中毒";
const URL_A = "https://cdc.example/leftover-nitrite";
const URL_B = "https://who.example/foodborne";

function priorReport(atoms: Array<{ text: string; verdict: string; url?: string }>) {
  return {
    verdictType: "mixed_misleading",
    conclusion: "隔夜菜亚硝酸盐会升高，但普通家庭剂量谈不上中毒。",
    subclaimVerdicts: atoms.map((atom) => ({
      claimAtom: atom.text,
      verdict: atom.verdict,
      supportingSources: atom.url
        ? [{ url: atom.url, title: `${atom.text} 的出处`, snippet: "公开材料" }]
        : [],
      contradictingSources: [],
    })),
  };
}

const FULL_DOSSIER = priorReport([
  { text: ATOM_NITRITE, verdict: "true", url: URL_A },
  { text: ATOM_POISON, verdict: "false", url: URL_B },
]);

function composed(followUp: string): string {
  return [
    followUp,
    "",
    `（${FOLLOW_UP_MARKER}）`,
    "原对象：隔夜菜亚硝酸盐超标，吃了会中毒。",
    `上一轮回答：隔夜菜亚硝酸盐会升高，但普通家庭剂量谈不上中毒。`,
    "请直接回答这次追问。需要新证据再检索。不要只重复上一轮结论。",
  ].join("\n");
}

describe("followUpQuestionOf", () => {
  it("裁到标记之前，多行追问整段保留", () => {
    expect(followUpQuestionOf(composed("那剂量到底危险吗？\n第二行"))).toBe("那剂量到底危险吗？\n第二行");
  });

  it("没有标记则整段当追问", () => {
    expect(followUpQuestionOf("只是一句追问")).toBe("只是一句追问");
  });
});

describe("extractPriorVerifiedAtoms", () => {
  it("只收已核且带 http(s) URL 的命题", () => {
    const atoms = extractPriorVerifiedAtoms(
      priorReport([
        { text: ATOM_NITRITE, verdict: "true", url: URL_A },
        { text: ATOM_POISON, verdict: "unverified" },
        { text: "没有链接的已核", verdict: "false" },
      ])
    );
    expect(atoms.map((atom) => atom.text)).toEqual([ATOM_NITRITE]);
    expect(atoms[0]!.evidence[0]!.url).toBe(URL_A);
  });

  it("不是报告对象 → 空", () => {
    expect(extractPriorVerifiedAtoms(null)).toEqual([]);
    expect(extractPriorVerifiedAtoms("nope")).toEqual([]);
  });
});

describe("followUpCoveredByAtom", () => {
  it("已核命题的问句形式算覆盖（子串）", () => {
    expect(followUpCoveredByAtom("吃了隔夜菜会导致中毒吗", ATOM_POISON)).toBe(true);
  });

  it("人物/日期/链接变了不算覆盖", () => {
    expect(followUpCoveredByAtom("2月6日那条说隔夜菜会中毒", "2月5日那条说隔夜菜会中毒")).toBe(false);
    expect(
      followUpCoveredByAtom("https://weibo.com/a 这条是真的吗", "https://weibo.com/b 这条是真的吗")
    ).toBe(false);
  });
});

describe("planFollowUpReuse", () => {
  it("追问被已核命题覆盖 → 无新命题，lookup 给出上一轮 URL", () => {
    const plan = planFollowUpReuse({
      claim: composed("吃了隔夜菜会导致中毒吗？"),
      priorReport: FULL_DOSSIER,
      priorClaim: "隔夜菜亚硝酸盐超标，吃了会中毒。",
      priorCreatedAt: Date.parse("2026-09-12T12:00:00.000Z"),
    });
    expect(plan).not.toBeNull();
    expect(plan!.newAtoms).toEqual([]);
    expect(plan!.atoms).toEqual([ATOM_NITRITE, ATOM_POISON]);
    expect(plan!.originDate).toBe("2026-09-12");
    const injection = priorRoundLookupOf(plan!)(ATOM_POISON);
    expect(injection?.evidence.map((item) => item.url)).toEqual([URL_B]);
    expect(injection?.priorVerdict).toBe("false");
  });

  it("新冒出来的小问题 → 只把追问收成新命题，已核命题仍在 reused", () => {
    const plan = planFollowUpReuse({
      claim: composed("那隔夜海鲜呢？会不会同样中毒？"),
      priorReport: FULL_DOSSIER,
      priorClaim: "隔夜菜亚硝酸盐超标，吃了会中毒。",
      priorCreatedAt: Date.parse("2026-09-12T12:00:00.000Z"),
    });
    expect(plan).not.toBeNull();
    expect(plan!.newAtoms).toEqual(["那隔夜海鲜呢？会不会同样中毒？"]);
    expect(plan!.reused.map((atom) => atom.text)).toEqual([ATOM_NITRITE, ATOM_POISON]);
    expect(priorRoundLookupOf(plan!)(plan!.newAtoms[0]!)).toBeNull();
    expect(priorRoundLookupOf(plan!)(ATOM_NITRITE)?.evidence[0]!.url).toBe(URL_A);
  });

  it("上一轮没有可点开的 URL → 计划为 null，不得假装快路径", () => {
    expect(
      planFollowUpReuse({
        claim: composed("所以呢？"),
        priorReport: priorReport([{ text: ATOM_NITRITE, verdict: "true" }]),
        priorClaim: "隔夜菜会中毒",
      })
    ).toBeNull();
  });
});

describe("访客可见材料 → 同一套分类器", () => {
  const guestBrief = {
    originalClaim: "隔夜菜亚硝酸盐超标，吃了会中毒。",
    conclusion: "隔夜菜亚硝酸盐会升高，但普通家庭剂量谈不上中毒。",
    claims: [
      {
        text: ATOM_NITRITE,
        judgment: "supported" as const,
        evidence: [{ url: URL_A, title: "疾控说明", excerpt: "冷藏会升高", role: "support" as const }],
      },
      {
        text: ATOM_POISON,
        judgment: "refuted" as const,
        evidence: [{ url: URL_B, title: "食源性疾病", excerpt: "谈不上中毒", role: "contradict" as const }],
      },
    ],
  };

  it("只收下命题、判断、可点开出处、结论；内部字段丢掉", () => {
    const parsed = parsePriorRoundBrief({
      ...guestBrief,
      claims: [
        {
          ...guestBrief.claims[0],
          id: "claim-secret",
          finding: "内部 finding 不得上行",
          limitation: "内部 limitation",
          provenance: "knowledge",
          evidence: [
            {
              ...guestBrief.claims[0]!.evidence[0],
              finding: "抽屉未展开的内部句",
              provenance: "prior-round",
            },
          ],
        },
      ],
      systemPrompt: "请直接回答这次追问。需要新证据再检索。不要只重复上一轮结论。",
    });
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual({
      originalClaim: guestBrief.originalClaim,
      conclusion: guestBrief.conclusion,
      claims: [guestBrief.claims[0]],
    });
    expect(JSON.stringify(parsed)).not.toContain("finding");
    expect(JSON.stringify(parsed)).not.toContain("claim-secret");
    expect(JSON.stringify(parsed)).not.toContain("systemPrompt");
  });

  it("无 http URL → null，不得假装快路径", () => {
    expect(
      parsePriorRoundBrief({
        originalClaim: "隔夜菜会中毒",
        conclusion: "没有出处",
        claims: [{ text: ATOM_NITRITE, judgment: "supported", evidence: [{ url: "not-a-url", title: "x", role: "support" }] }],
      })
    ).toBeNull();
    expect(followUpReuseFromClientBrief(null)).toBeNull();
  });

  it("覆盖追问 → 无新命题、lookup 给出上一轮 URL", () => {
    const plan = planFollowUpReuse({
      claim: composed("吃了隔夜菜会导致中毒吗？"),
      priorReport: priorReportFromVisibleBrief(guestBrief),
      priorClaim: guestBrief.originalClaim,
      priorCreatedAt: Date.parse("2026-09-12T12:00:00.000Z"),
    });
    expect(plan).not.toBeNull();
    expect(plan!.newAtoms).toEqual([]);
    expect(priorRoundLookupOf(plan!)(ATOM_POISON)?.evidence.map((item) => item.url)).toEqual([URL_B]);
  });

  it("人物/日期/链接变了 → 只把追问收成新命题", () => {
    const plan = planFollowUpReuse({
      claim: composed("2月6日那条说隔夜菜会中毒"),
      priorReport: priorReportFromVisibleBrief({
        ...guestBrief,
        claims: [
          {
            text: "2月5日那条说隔夜菜会中毒",
            judgment: "refuted",
            evidence: [{ url: URL_B, title: "旧帖", excerpt: "旧日期", role: "contradict" }],
          },
        ],
      }),
      priorClaim: "2月5日那条说隔夜菜会中毒",
    });
    expect(plan).not.toBeNull();
    expect(plan!.newAtoms).toEqual(["2月6日那条说隔夜菜会中毒"]);
  });
});

describe("追问必须答这句追问", () => {
  it("把拆散的流行病学 / IARC / 临床收成这句追问本身", () => {
    const claim = composed("这一说法在流行病学或临床医学中是否有可靠的实验数据支持？");
    const out = collapseFollowUpAtoms(claim, [
      "流行病学中是否有可靠数据",
      "临床医学中是否有可靠数据",
      "IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估",
      "有没有直接研究",
    ]);
    expect(out[0]).toContain("流行病学");
    expect(out.length).toBeLessThanOrEqual(2);
    expect(out.some((atom) => atom.includes("IARC"))).toBe(false);
  });

  it("结论第一句用 IARC 顶替时改写成这句追问", () => {
    const claim = composed("这一说法在流行病学或临床医学中是否有可靠的实验数据支持？");
    const report: Record<string, unknown> = {
      verdictType: "unverified",
      conclusion: "「IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估」站不住。",
    };
    applyFollowUpAnswerLead(report, claim);
    expect(String(report.conclusion)).toContain("流行病学");
    expect(String(report.conclusion).startsWith("「IARC")).toBe(false);
  });

  it("已经直接答了这句追问，不因为缺四字切片而改写", () => {
    const report: Record<string, unknown> = {
      verdictType: "mixed_misleading",
      conclusion: "直接回答这句追问：普通家庭剂量谈不上中毒。",
    };
    applyFollowUpAnswerLead(report, composed("吃了隔夜菜会导致中毒吗？"));
    expect(String(report.conclusion)).toBe("直接回答这句追问：普通家庭剂量谈不上中毒。");
  });
});
