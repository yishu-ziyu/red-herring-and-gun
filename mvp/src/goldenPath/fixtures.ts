/**
 * Golden Path UI fixtures：用 #51 的 buildInvestigationSnapshot 确定性构建
 * 5 类 golden case + 边界快照。与 core 契约同源，不经手写 JSON。
 */
import { buildInvestigationSnapshot, type InvestigationSnapshotV1 } from "@rhg/core/investigation";

const src = (url: string, title: string, snippet: string) => ({ url, title, snippet });

const noopKey = (s: string) => s.replace(/\u3000/g, " ").trim();

export const REFUTED_CLAIM = "世界卫生组织已经宣布喝隔夜水会致癌。";
export const REFUTED_ATOM = "喝隔夜水会致癌";
const refuteUrl = "https://piyao.org.cn/overnight-water";

export function refutedComplete(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: REFUTED_CLAIM,
      phase: "complete",
      claimAtoms: [REFUTED_ATOM],
      claimAtomTypes: [{ text: REFUTED_ATOM, verifiable: true, type: "causal" }],
      atomSearchBundle: {
        atomsSearched: [REFUTED_ATOM],
        byAtomKey: { [REFUTED_ATOM]: [src(refuteUrl, "世卫组织辟谣平台：无此结论", "官方声明未提及隔夜水致癌")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: REFUTED_ATOM,
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
    },
    { claimAtomKeyFn: noopKey }
  );
}

export const SUPPORTED_CLAIM = "空气中氧气约占体积的两成。";
export const SUPPORTED_ATOM = "空气中氧气约占体积的两成";
const supportUrl = "https://www.gov.cn/air-composition";

export function supportedComplete(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: SUPPORTED_CLAIM,
      phase: "complete",
      claimAtoms: [SUPPORTED_ATOM],
      claimAtomTypes: [{ text: SUPPORTED_ATOM, verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: [SUPPORTED_ATOM],
        byAtomKey: { [SUPPORTED_ATOM]: [src(supportUrl, "标准大气成分", "氧气 20.9%")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: SUPPORTED_ATOM,
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
    },
    { claimAtomKeyFn: noopKey }
  );
}

export const MIXED_CLAIM = "维生素C能治感冒，而且每次感冒都应当输液。";

export function mixedComplete(): InvestigationSnapshotV1 {
  const atomA = "维生素C能治感冒";
  const atomB = "每次感冒都应当输液";
  const aUrl = "https://journal.example/vc-cold";
  const bRefute = "https://health.gov.cn/iv-fact";
  return buildInvestigationSnapshot(
    {
      originalClaim: MIXED_CLAIM,
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
    },
    { claimAtomKeyFn: noopKey }
  );
}

export const UNRESOLVED_CLAIM = "某小区本月的自来水异味来自新增消毒工艺。";

export function unresolvedComplete(): InvestigationSnapshotV1 {
  const atom = "某小区本月的自来水异味来自新增消毒工艺";
  return buildInvestigationSnapshot(
    {
      originalClaim: UNRESOLVED_CLAIM,
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
    },
    { claimAtomKeyFn: noopKey }
  );
}

export const CONFLICT_CLAIM = "新规要求 2026 年起电动车必须装识别芯片。";

const conflictBase = (() => {
  const atom = "新规要求 2026 年起电动车必须装识别芯片";
  const support = "https://gov.example/notice-2026";
  const refute = "https://fact.example/rumor-chip";
  return {
    atom,
    support,
    refute,
    input: {
      originalClaim: CONFLICT_CLAIM,
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: {
          [atom]: [
            src(support, "某地试点通知", "试点要求登记识别芯片"),
            src(refute, "全国性新规查证", "无全国统一识别芯片要求"),
          ],
        },
      },
    },
    verdict: {
      claimAtom: atom,
      verdict: "unverified",
      evidence: "试点通知与全国查证并存，适用范围存在分歧。",
      boundary: "",
      supportingSources: [src(support, "某地试点通知", "试点要求登记识别芯片")],
      contradictingSources: [src(refute, "全国性新规查证", "无全国统一识别芯片要求")],
      evidenceGaps: [],
    },
  };
})();

export function conflictKnownReason(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      ...conflictBase.input,
      phase: "complete",
      subclaimVerdicts: [conflictBase.verdict],
      crossExam: {
        ran: true,
        atoms: [
          {
            atom: conflictBase.atom,
            status: "answered",
            response: "分歧来自适用范围：试点通知只覆盖某地，不是全国新规。",
            secondVerdict: "false",
          },
        ],
      },
      report: { conclusion: "该说法把地方试点说成了全国新规。", verdictType: "unverified" },
    },
    { claimAtomKeyFn: noopKey }
  );
}

export function conflictUnknownReason(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      ...conflictBase.input,
      phase: "complete",
      subclaimVerdicts: [conflictBase.verdict],
      report: { conclusion: "试点与全国口径并存，需以正式文件为准。", verdictType: "unverified" },
    },
    { claimAtomKeyFn: noopKey }
  );
}

export const INVESTIGATING_CLAIM = "某市下周将试点无人驾驶公交。";

export function investigatingUnassessed(): InvestigationSnapshotV1 {
  const atom = "某市下周将试点无人驾驶公交";
  return buildInvestigationSnapshot(
    {
      originalClaim: INVESTIGATING_CLAIM,
      phase: "investigating",
      claimAtoms: [atom],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: { [atom]: [src("https://news.example/autobus", "试点报道", "官方征集意见稿")] },
      },
    },
    { claimAtomKeyFn: noopKey }
  );
}

export function interruptedPartial(): InvestigationSnapshotV1 {
  const atomA = "某地高铁昨因大风全线停运";
  const atomB = "全线停运持续三天";
  return buildInvestigationSnapshot(
    {
      originalClaim: "某地高铁昨因大风全线停运，将持续三天。",
      phase: "interrupted",
      claimAtoms: [atomA, atomB],
      atomSearchBundle: {
        atomsSearched: [atomA],
        byAtomKey: { [atomA]: [src("https://rail.example/notice", "铁路公告", "部分车次停运")] },
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
    },
    { claimAtomKeyFn: noopKey }
  );
}

export const LONG_CLAIM_PREFIX = "据通报，";

export function longClaimComplete(): InvestigationSnapshotV1 {
  const tail = "并且主管部门将在验收通过后统一公布改造车辆清单与补贴发放进度。";
  const atom = "某市宣布全市出租车将在今年内完成智能终端升级改造，" + tail.repeat(6);
  const support = "https://gov.example/taxi-upgrade";
  return buildInvestigationSnapshot(
    {
      originalClaim: LONG_CLAIM_PREFIX + atom,
      phase: "complete",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: [atom],
        byAtomKey: { [`${atom.slice(0, 180)}…`]: [src(support, "升级改造通知", "年内完成改造")] },
      },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "true",
          evidence: "官方通报确认年内完成改造[1]。",
          boundary: "",
          supportingSources: [src(support, "升级改造通知", "年内完成改造")],
          contradictingSources: [],
          evidenceGaps: [],
        },
      ],
      report: {
        conclusion: "该说法属实，年内完成智能终端升级改造。",
        verdictType: "true",
        citationSources: [{ url: support, title: "升级改造通知", snippet: "" }],
      },
    },
    { claimAtomKeyFn: noopKey }
  );
}
