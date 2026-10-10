/**
 * DEV 固定装置用的结果快照：用 buildInvestigationSnapshot 确定性构建，
 * 与 core 契约同源，不经手写 JSON。
 */
import { buildInvestigationSnapshot, type InvestigationSnapshotV1 } from "../lib/investigation";

const src = (url: string, title: string, snippet: string) => ({ url, title, snippet });

const noopKey = (s: string) => s.replace(/\u3000/g, " ").trim();

const MIXED_CLAIM = "维生素C能治感冒，而且每次感冒都应当输液。";
const MIXED_ATOM_A = "维生素C能治感冒";
const MIXED_ATOM_B = "每次感冒都应当输液";

export function mixedComplete(): InvestigationSnapshotV1 {
  const atomA = MIXED_ATOM_A;
  const atomB = MIXED_ATOM_B;
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

export function mixedWithoutSpans(): InvestigationSnapshotV1 {
  const snapshot = mixedComplete();
  return {
    ...snapshot,
    claims: snapshot.claims.map((claim) => {
      const next = { ...claim };
      delete next.originalSpan;
      return next;
    }),
  };
}
