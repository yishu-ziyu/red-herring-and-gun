/**
 * DEV-only 固定装置：按脚本回放 investigation_snapshot，驱动真实组件树
 * 生成确定性的调查中 / 完成 / 争议 / 中断界面（截图与走查用）。
 * 仅在 import.meta.env.DEV 下被动态 import，不进生产 bundle。
 */
import { buildInvestigationSnapshot } from "../lib/investigation";
import { createActivityLog } from "../lib/investigation";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";
import type { InvestigationSnapshotV1 } from "../lib/investigation";
import { mixedComplete, mixedWithoutSpans } from "./fixtures";

const src = (url: string, title: string, snippet: string) => ({ url, title, snippet });
const noopKey = (s: string) => s.replace(/\u3000/g, " ").trim();

export const FIXTURE_CLAIM = "隔夜菜会致癌，吃了等于吃毒药。";

type AtomSpec = {
  atom: string;
  search: Array<{ url: string; title: string; snippet: string }>;
  verdict?: {
    verdict: string;
    evidence: string;
    boundary?: string;
    supporting?: Array<{ url: string; title: string; snippet: string }>;
    contradicting?: Array<{ url: string; title: string; snippet: string }>;
    gaps?: string[];
    relatedOnly?: boolean;
  };
};

// 与三张参考图同一题材：三条命题、可支持/反驳/待核对/相关材料/争议齐备。
const ATOMS: AtomSpec[] = [
  {
    atom: "隔夜菜会直接致癌",
    search: [
      src("https://www.who.int/overnight-dishes", "世卫组织辟谣平台：无「隔夜菜致癌」结论", "官方声明未提及隔夜菜直接致癌"),
      src("https://nutrition.example.cn/nitrite-facts", "食品科学解读：亚硝酸盐与致癌的量效关系", "正常冷藏隔夜菜亚硝酸盐远低于中毒剂量"),
    ],
    verdict: {
      verdict: "false",
      evidence: "多方权威机构与研究指出，正常储存的隔夜菜本身不会直接导致癌症[1]。",
      boundary: "不适用于已明显变质、被霉菌污染的食物",
      contradicting: [src("https://www.who.int/overnight-dishes", "世卫组织辟谣平台：无「隔夜菜致癌」结论", "官方声明未提及隔夜菜直接致癌")],
    },
  },
  {
    atom: "隔夜菜会产生大量有害物质，等于吃毒药",
    search: [
      src("https://www.chinacdc.cn/storage-safety", "疾控中心：家庭食品储存与致病菌预防", "不当储存可能滋生致病菌"),
      src("https://pkuph.example.org/nitrite-risk", "临床营养研究：不同人群的风险阈值与摄入量", "合理加热与冷藏下风险较低"),
      src("https://www.kepuchina.cn/poison-terms", "科普：什么是「毒药」——剂量决定毒性", "脱离剂量的毒性表述不成立"),
    ],
    verdict: {
      verdict: "exaggerated",
      evidence: "不当储存确实可能产生有害物质，但「等于吃毒药」夸大了常规食用风险[2]。",
      supporting: [src("https://www.chinacdc.cn/storage-safety", "疾控中心：家庭食品储存与致病菌预防", "不当储存可能滋生致病菌")],
      contradicting: [src("https://www.kepuchina.cn/poison-terms", "科普：什么是「毒药」——剂量决定毒性", "脱离剂量的毒性表述不成立")],
      gaps: ["缺少对常温存放 24 小时以上样本的定向检测数据"],
    },
  },
  {
    atom: "只要冷藏保存，隔夜菜就一定安全",
    search: [
      src("https://dg.cnsoc.org/leftover-guide", "膳食指南：隔夜菜冷藏期限与回热建议", "冷藏超过 3 天或反复回热仍有风险"),
    ],
    // 判词未回来：进入 unassessed / 待核对（investigating 阶段）；
    // complete 阶段给出 relatedOnly（仅相关，不冒充证据位）。
  },
];

function staged(phase: "investigating" | "judging" | "complete") {
  const input: Record<string, unknown> = {
    originalClaim: FIXTURE_CLAIM,
    phase,
    claimAtoms: ATOMS.map((a) => a.atom),
    claimAtomTypes: ATOMS.map((a) => ({ text: a.atom, verifiable: true, type: "fact" })),
    atomSearchBundle: {
      atomsSearched: ATOMS.slice(0, phase === "investigating" ? 2 : 3).map((a) => a.atom),
      byAtomKey: Object.fromEntries(
        ATOMS.slice(0, phase === "investigating" ? 2 : 3).map((a) => [a.atom, a.search])
      ),
    },
  };
  if (phase !== "investigating") {
    input.subclaimVerdicts = ATOMS.filter((a) => a.verdict).map((a) => ({
      claimAtom: a.atom,
      verdict: a.verdict!.verdict,
      evidence: a.verdict!.evidence,
      boundary: a.verdict!.boundary ?? "",
      supportingSources: a.verdict!.supporting ?? [],
      contradictingSources: a.verdict!.contradicting ?? [],
      evidenceGaps: a.verdict!.gaps ?? [],
    }));
    if (phase === "judging") {
      // 第三条只检索到、未判定：unassessed 暂态
      input.subclaimVerdicts = (input.subclaimVerdicts as unknown[]).slice(0, 2);
    }
  }
  if (phase === "complete") {
    (input.subclaimVerdicts as Array<Record<string, unknown>>).forEach((v, i) => {
      if (i === 1) v.sourcesRelatedOnly = false;
    });
    input.report = {
      conclusion: "现有证据不支持「隔夜菜会直接致癌、吃了等于吃毒药」。不当储存确有风险，但常规冷藏并彻底回热的隔夜菜，风险远低于说法描述；「一定安全」也不成立，冷藏超过三天仍应丢弃。",
      verdictType: "mixed_misleading",
      causalBoundary: "该说法把「不当储存的风险」夸大成了「吃就中毒」，不能由证据推出",
      citationSources: ATOMS.flatMap((a) => a.search).map((s) => ({ url: s.url, title: s.title, snippet: s.snippet })),
      checkedAt: "2026-09-06T09:30:00.000Z",
    };
  }
  return buildInvestigationSnapshot(input as Parameters<typeof buildInvestigationSnapshot>[0], { claimAtomKeyFn: noopKey });
}

function interruptedSnapshot() {
  const base = staged("investigating");
  return { ...base, phase: "interrupted" as const };
}

function sourceAuditSnapshot() {
  const snap = staged("complete");
  const supportClaim = snap.claims.find((claim) => claim.evidence.some((item) => item.role === "support"));
  const support = supportClaim?.evidence.find((item) => item.role === "support");
  if (support) {
    support.limitation = "不能由「不当储存可能有害」推出「吃了等于吃毒药」。";
  }
  const deadId = snap.claims[0]?.evidence[0]?.sourceId;
  const dead = deadId ? snap.sources.find((source) => source.id === deadId) : undefined;
  if (dead) dead.reachable = false;
  return snap;
}

function receivedSnapshot(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: FIXTURE_CLAIM,
      phase: "received",
    },
    { claimAtomKeyFn: noopKey }
  );
}

function decomposedSnapshot(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: FIXTURE_CLAIM,
      phase: "decomposed",
      claimAtoms: ATOMS.map((a) => a.atom),
      claimAtomTypes: ATOMS.map((a) => ({ text: a.atom, verifiable: true, type: "fact" })),
    },
    { claimAtomKeyFn: noopKey }
  );
}

export type FixtureName =
  | "received"
  | "decomposed"
  | "first-beat"
  | "journey"
  | "investigating"
  | "judging"
  | "complete"
  | "interrupted"
  | "conflict"
  | "mixed"
  | "nospan"
  | "settling"
  | "source-audit"
  | "replay";

/** Issue #63 取证：三条材料从待核对归到支持 / 反驳 / 相关材料。确定性 fixture，不是真实 SSE。 */
function settlingBefore() {
  const atom = "隔夜菜会直接致癌";
  const pack = [
    src("https://www.who.int/overnight-dishes", "世卫组织辟谣平台：无「隔夜菜致癌」结论", "官方声明未提及隔夜菜直接致癌"),
    src("https://nutrition.example.cn/nitrite-facts", "食品科学解读：亚硝酸盐与致癌的量效关系", "正常冷藏隔夜菜亚硝酸盐远低于中毒剂量"),
    src("https://dg.cnsoc.org/leftover-guide", "膳食指南：隔夜菜冷藏期限与回热建议", "冷藏超过 3 天或反复回热仍有风险"),
  ];
  return buildInvestigationSnapshot(
    {
      originalClaim: FIXTURE_CLAIM,
      phase: "investigating",
      claimAtoms: [atom],
      claimAtomTypes: [{ text: atom, verifiable: true, type: "causal" }],
      atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: pack } },
    },
    { claimAtomKeyFn: noopKey }
  );
}

function settlingAfter() {
  const before = settlingBefore();
  const roleByUrl: Record<string, "support" | "contradict" | "context-only"> = {
    "https://www.who.int/overnight-dishes": "contradict",
    "https://nutrition.example.cn/nitrite-facts": "support",
    "https://dg.cnsoc.org/leftover-guide": "context-only",
  };
  const urlById = Object.fromEntries(before.sources.map((s) => [s.id, s.url]));
  return {
    ...before,
    phase: "judging" as const,
    claims: before.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.map((link) => {
        const role = roleByUrl[urlById[link.sourceId] ?? ""] ?? link.role;
        return {
          ...link,
          role,
          ...(role === "support" ? { finding: "公开材料不支持「直接致癌」的说法。" } : {}),
        };
      }),
    })),
  };
}

function journeyResult(): InvestigationSnapshotV1 {
  const result = staged("complete");
  const unread = staged("judging").claims[2];
  return {
    ...result,
    claims: result.claims.map((claim, index) => index === 2 ? {
      ...unread,
      progress: "complete",
      judgment: "unresolved",
      label: "unresolved",
      reason: "这个要点暂时查不清。我们只找到 1 份资料（膳食指南），还没读完，没有算进判断。它提到冷藏超过 3 天或反复回热仍有风险。",
    } : {
      ...claim,
      progress: "complete",
      reason: ATOMS[index].verdict?.evidence.replace(/\[\d+\]/g, "") ?? "",
    }),
  };
}

function journeyFrame(
  result: InvestigationSnapshotV1,
  { phase = "investigating", done = 0, active = -1, found = 0, conflict = true }: {
    phase?: InvestigationSnapshotV1["phase"];
    done?: number;
    active?: number;
    found?: number;
    conflict?: boolean;
  },
): InvestigationSnapshotV1 {
  const claims = result.claims.map((claim, index) => {
    if (index < done) return claim;
    const urls = new Set(index === active ? ATOMS[index].search.slice(0, found).map((source) => source.url) : []);
    const ids = new Set(result.sources.filter((source) => urls.has(source.url)).map((source) => source.id));
    const { label: _label, reason: _reason, boundary: _boundary, ...pending } = claim;
    return {
      ...pending,
      progress: index === active ? "searching" as const : "pending" as const,
      judgment: null,
      gaps: [],
      evidence: claim.evidence.filter((link) => ids.has(link.sourceId)).map((link) => {
        const { finding: _finding, quote: _quote, relationReason: _relationReason, ...foundLink } = link;
        return { ...foundLink, role: "unassessed" as const };
      }),
    };
  });
  const ids = new Set(claims.flatMap((claim) => claim.evidence.map((link) => link.sourceId)));
  const finished = new Set(claims.slice(0, done).map((claim) => claim.id));
  const { conclusion: _conclusion, checkedAt: _checkedAt, ...inProgress } = result;
  return {
    ...(phase === "complete" ? result : inProgress),
    phase,
    claims,
    sources: result.sources.filter((source) => ids.has(source.id)),
    conflicts: conflict ? result.conflicts.filter((item) => finished.has(item.claimId)) : [],
  };
}

export function getDevFixture(
  name: FixtureName
): (emit: (event: OrchestrateStreamEvent) => void) => () => void {
  return (emit) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms));
    };
    // DEV 固定装置也走生产同一套投影：先发快照，再发引用它的活动。
    const log = createActivityLog({ runId: `fixture-${name}` });
    let previousSnapshot: InvestigationSnapshotV1 | null = null;
    const emitWithActivity = (investigation: InvestigationSnapshotV1) => {
      emit({ type: "investigation_snapshot", investigation, timestamp: Date.now() });
      for (const activity of log.project(previousSnapshot, investigation)) {
        emit({ type: "investigation_activity", activity, timestamp: Date.now() });
      }
      previousSnapshot = investigation;
    };
    const emitSearchStarted = (query: string) => {
      for (const activity of log.recordSearchStarted(query)) {
        emit({ type: "investigation_activity", activity, timestamp: Date.now() });
      }
    };
    const emitSnapshot = (phase: "investigating" | "judging" | "complete") =>
      emitWithActivity(staged(phase));

    if (name === "investigating" || name === "judging" || name === "conflict") {
      at(40, () => emitSearchStarted("隔夜菜 致癌"));
    }

    if (name === "journey") {
      const result = journeyResult();
      const frames: Array<[number, Parameters<typeof journeyFrame>[1]]> = [
        [1800, { phase: "decomposed" }],
        [2800, { active: 0 }],
        [3800, { active: 0, found: 1 }],
        [4700, { active: 0, found: 2 }],
        [6000, { active: 0, found: 2, phase: "judging" }],
        [7600, { done: 1 }],
        [9000, { done: 1, active: 1 }],
        [10000, { done: 1, active: 1, found: 1 }],
        [11000, { done: 1, active: 1, found: 2 }],
        [12000, { done: 1, active: 1, found: 3 }],
        [13500, { done: 1, active: 1, found: 3, phase: "judging" }],
        [15000, { done: 2, conflict: false }],
        [16300, { done: 2 }],
        [17800, { done: 2, active: 2 }],
        [18800, { done: 2, active: 2, found: 1 }],
        [20100, { done: 2, active: 2, found: 1, phase: "judging" }],
        [21200, { done: 3, phase: "judging" }],
      ];
      at(60, () => emitWithActivity(receivedSnapshot()));
      for (const [ms, frame] of frames) {
        at(ms, () => {
          emitWithActivity(journeyFrame(result, frame));
          if (frame.active !== undefined && !frame.found) emitSearchStarted(ATOMS[frame.active].atom);
        });
      }
      at(22400, () => {
        emitWithActivity(result);
        emit({
          type: "complete",
          finalReport: { conclusion: result.conclusion?.directAnswer, investigation: result },
          timestamp: Date.now(),
        });
      });
      return () => timers.forEach(clearTimeout);
    } else if (name === "replay") {
      const pack = (window as unknown as { __RHG_REPLAY?: { frames?: Array<{ delayMs?: number; investigation: unknown; complete?: boolean }> } }).__RHG_REPLAY;
      const frames = pack?.frames ?? [];
      for (const frame of frames) {
        at(frame.delayMs ?? 60, () => {
          emitWithActivity(frame.investigation as InvestigationSnapshotV1);
          if (frame.complete) {
            emit({
              type: "complete",
              finalReport: { investigation: frame.investigation } as Record<string, unknown>,
              timestamp: Date.now(),
            });
          }
        });
      }
      return () => timers.forEach(clearTimeout);
    } else if (name === "mixed") {
      const snap = mixedComplete();
      at(60, () => emitWithActivity(snap));
      return () => timers.forEach(clearTimeout);
    } else if (name === "nospan") {
      const snap = mixedWithoutSpans();
      at(60, () => emitWithActivity(snap));
      return () => timers.forEach(clearTimeout);
    } else if (name === "settling") {
      at(80, () => emitWithActivity(settlingBefore()));
      at(1400, () => emitWithActivity(settlingAfter()));
    } else if (name === "source-audit") {
      const audit = sourceAuditSnapshot();
      at(60, () => emitWithActivity(staged("investigating")));
      at(360, () => emitWithActivity(staged("judging")));
      at(900, () => {
        emitWithActivity(audit);
        at(120, () =>
          emit({
            type: "complete",
            finalReport: { conclusion: "见调查结论。", investigation: audit } as Record<string, unknown>,
            timestamp: Date.now(),
          })
        );
      });
    } else if (name === "received") {
      at(60, () => emitWithActivity(receivedSnapshot()));
      return () => timers.forEach(clearTimeout);
    } else if (name === "decomposed") {
      at(60, () => emitWithActivity(decomposedSnapshot()));
      return () => timers.forEach(clearTimeout);
    } else if (name === "first-beat") {
      at(60, () => emitWithActivity(receivedSnapshot()));
      at(1800, () => emitWithActivity(decomposedSnapshot()));
      at(4000, () => emitSnapshot("investigating"));
      at(6800, () => emitSnapshot("judging"));
      at(9800, () => {
        emitSnapshot("complete");
        at(120, () =>
          emit({
            type: "complete",
            finalReport: { conclusion: "见调查结论。", investigation: staged("complete") } as Record<string, unknown>,
            timestamp: Date.now(),
          })
        );
      });
      return () => timers.forEach(clearTimeout);
    } else if (name === "investigating") {
      at(60, () => emitSnapshot("investigating"));
    } else if (name === "judging") {
      at(60, () => emitSnapshot("investigating"));
      at(360, () => emitSnapshot("judging"));
    } else if (name === "interrupted") {
      at(60, () => emitSnapshot("investigating"));
      at(360, () => emitWithActivity(interruptedSnapshot()));
    } else {
      // complete / conflict：完整走完三段。
      at(60, () => emitSnapshot("investigating"));
      at(360, () => emitSnapshot("judging"));
      at(900, () => {
        emitSnapshot("complete");
        at(120, () =>
          emit({
            type: "complete",
            finalReport: { conclusion: "见调查结论。", investigation: staged("complete") } as Record<string, unknown>,
            timestamp: Date.now(),
          })
        );
      });
    }
    return () => timers.forEach(clearTimeout);
  };
}
