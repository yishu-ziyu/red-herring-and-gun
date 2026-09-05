/**
 * DEV-only 固定装置：按脚本回放 investigation_snapshot，驱动真实组件树
 * 生成确定性的调查中 / 完成 / 争议 / 中断界面（截图与走查用）。
 * 仅在 import.meta.env.DEV 下被动态 import，不进生产 bundle。
 */
import { buildInvestigationSnapshot } from "@rhg/core/investigation";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";

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
  crossExam?: { status: string; response: string };
};

// 与三张参考图同一题材：三条命题、可支持/反驳/待核对/相关材料/争议齐备。
const ATOMS: AtomSpec[] = [
  {
    atom: "隔夜菜会直接致癌",
    search: [
      src("https://piyao.example.org/overnight-dishes", "世卫组织辟谣平台：无「隔夜菜致癌」结论", "官方声明未提及隔夜菜直接致癌"),
      src("https://nutrition.example.cn/nitrite-facts", "食品科学解读：亚硝酸盐与致癌的量效关系", "正常冷藏隔夜菜亚硝酸盐远低于中毒剂量"),
    ],
    verdict: {
      verdict: "false",
      evidence: "多方权威机构与研究指出，正常储存的隔夜菜本身不会直接导致癌症[1]。",
      boundary: "不适用于已明显变质、被霉菌污染的食物",
      contradicting: [src("https://piyao.example.org/overnight-dishes", "世卫组织辟谣平台：无「隔夜菜致癌」结论", "官方声明未提及隔夜菜直接致癌")],
    },
  },
  {
    atom: "隔夜菜会产生大量有害物质，等于吃毒药",
    search: [
      src("https://cdc.example.cn/storage-safety", "疾控中心：家庭食品储存与致病菌预防", "不当储存可能滋生致病菌"),
      src("https://pkuph.example.org/nitrite-risk", "临床营养研究：不同人群的风险阈值与摄入量", "合理加热与冷藏下风险较低"),
      src("https://course.example.org/poison-terms", "科普：什么是「毒药」——剂量决定毒性", "脱离剂量的毒性表述不成立"),
    ],
    verdict: {
      verdict: "exaggerated",
      evidence: "不当储存确实可能产生有害物质，但「等于吃毒药」夸大了常规食用风险[2]。",
      supporting: [src("https://cdc.example.cn/storage-safety", "疾控中心：家庭食品储存与致病菌预防", "不当储存可能滋生致病菌")],
      contradicting: [src("https://course.example.org/poison-terms", "科普：什么是「毒药」——剂量决定毒性", "脱离剂量的毒性表述不成立")],
      gaps: ["缺少对常温存放 24 小时以上样本的定向检测数据"],
    },
    crossExam: { status: "answered", response: "分歧来自剂量与储存条件：疾控提醒的是不当储存风险，而常温短存放不构成「毒药」级危害。" },
  },
  {
    atom: "只要冷藏保存，隔夜菜就一定安全",
    search: [
      src("https://diet.example.cn/leftover-guide", "膳食指南：隔夜菜冷藏期限与回热建议", "冷藏超过 3 天或反复回热仍有风险"),
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
    input.crossExam = {
      ran: true,
      atoms: ATOMS.filter((a) => a.crossExam).map((a) => ({ atom: a.atom, ...a.crossExam, secondVerdict: "false" })),
    };
    input.pursuitHops = [
      { hop: 1, atom: ATOMS[1]!.atom, goal: "找常温久放样本的检测数据", purpose: "gap", query: "隔夜菜 常温 24小时 检测", resultKind: "partial", newEvidence: 0, missingAfter: ["常温久放样本检测"], gain: 0, action: "stop" },
    ];
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

export type FixtureName =
  | "investigating"
  | "judging"
  | "complete"
  | "interrupted"
  | "conflict"
  | "image-found"
  | "image-missing";

export function getDevFixture(
  name: FixtureName
): (emit: (event: OrchestrateStreamEvent) => void) => () => void {
  return (emit) => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(setTimeout(fn, ms));
    };
    const emitSnapshot = (phase: "investigating" | "judging" | "complete") =>
      emit({ type: "investigation_snapshot", investigation: staged(phase), timestamp: Date.now() });

    if (name === "investigating") {
      at(60, () => emitSnapshot("investigating"));
    } else if (name === "judging") {
      at(60, () => emitSnapshot("investigating"));
      at(360, () => emitSnapshot("judging"));
    } else if (name === "interrupted") {
      at(60, () => emitSnapshot("investigating"));
      at(360, () => emit({ type: "investigation_snapshot", investigation: interruptedSnapshot(), timestamp: Date.now() }));
    } else {
      // complete / conflict / image-found / image-missing：完整走完三段。
      at(60, () => emitSnapshot("investigating"));
      at(360, () => emitSnapshot("judging"));
      at(900, () => {
        emitSnapshot("complete");
        const extra: Record<string, unknown> = {};
        if (name === "image-found") {
          extra.imageOrigin = { status: "found", channel: "reverse-image", url: "https://weibo.example.com/first-post-2023", title: "最早发布：某美食博主 2023 年帖子", label: "原图出处" };
        } else if (name === "image-missing") {
          extra.imageOrigin = { status: "not_found", channel: "none", label: "原图出处未查到" };
        }
        at(120, () =>
          emit({
            type: "complete",
            finalReport: { conclusion: "见调查结论。", ...extra, investigation: staged("complete") } as Record<string, unknown>,
            timestamp: Date.now(),
          })
        );
      });
    }
    return () => timers.forEach(clearTimeout);
  };
}
