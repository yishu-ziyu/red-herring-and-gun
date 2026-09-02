/**
 * CrossExam — 冲突触发的第二模型交叉复核（真辩论）— G3 / P1，ADR 待补记录。
 *
 * 取代 buildConsensusDebate 的规则假演：只在证据冲突（同一原子支撑与反证同时非空）时触发，
 * 第二个模型（国产优先）独立复核该原子，与 fact_checker 判词对照。
 * 决策纪律不变：触发、轮数（1 轮）、分歧如何影响分数 = 确定性代码；LLM 只做独立第二意见。
 * 分歧不重写判词——降可信度、标注 contested，报告与 SSE 可见。
 */
import type { AtomSearchBundle, AtomSearchSource } from "../atomSearch.js";

export const MAX_CROSS_EXAM_ATOMS = 2;

export type CrossExamRelation = "agree" | "disagree" | "inconclusive";

export type CrossExamTarget = {
  atom: string;
  atomKey: string;
  primaryVerdict: string;
  supporting: AtomSearchSource[];
  contradicting: AtomSearchSource[];
};

export type CrossExamAtomResult = {
  atom: string;
  primaryVerdict: string;
  secondVerdict: string;
  secondReason: string;
  secondModel: string;
  relation: CrossExamRelation;
};

export type CrossExamOutcome = {
  ran: boolean;
  atoms: CrossExamAtomResult[];
  /** 确定性：每次分歧 -10，封顶 -20；全部一致为 0 */
  confidenceAdjustment: number;
  model: string;
};

/** 裸模型调用口径（同 selfProof / evidenceLoop rewriter）。 */
export type CrossExamRawModelCall = (input: {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
}) => Promise<{ output: unknown; model: string }>;

export const CROSS_EXAM_SYSTEM_PROMPT = [
  "你是独立复核员。主核查模型对某条说法的判断存在证据冲突（既有支撑也有反证）。",
  "只依据给出的证据独立判断，不看主模型结论。不引入外部记忆的事实。",
  "输出 JSON：{\"verdict\": \"true|false|unverified\", \"reason\": \"一句话理由\", \"boundary\": \"证据能/不能支持什么\"}。",
  "证据不足以裁决时必须给 unverified，不要勉强站队。",
].join("\n");

const crossExamSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["true", "false", "unverified"] },
    reason: { type: "string" },
    boundary: { type: "string" },
  },
  required: ["verdict", "reason"],
} as const;

/** 冲突触发（纯函数）：支撑与反证同时非空的判词，与 evidenceLoop 的 conflict 同一条规则。 */
export function findCrossExamTargets(input: {
  verdicts: Array<Record<string, unknown>>;
  bundle: AtomSearchBundle;
  claimAtomKeyFn: (s: string) => string;
  maxTargets?: number;
}): CrossExamTarget[] {
  const cap = input.maxTargets ?? MAX_CROSS_EXAM_ATOMS;
  const targets: CrossExamTarget[] = [];
  const seen = new Set<string>();
  for (const v of input.verdicts) {
    if (targets.length >= cap) break;
    if (!v || typeof v !== "object") continue;
    const atom = String(v.claimAtom ?? "").trim();
    if (!atom) continue;
    const support = Array.isArray(v.supportingSources) ? v.supportingSources.length : 0;
    const contra = Array.isArray(v.contradictingSources) ? v.contradictingSources.length : 0;
    if (support === 0 || contra === 0) continue;
    const key = input.claimAtomKeyFn(atom);
    if (seen.has(key)) continue;
    seen.add(key);
    const evidence = input.bundle.byAtomKey[key] ?? [];
    targets.push({
      atom,
      atomKey: key,
      primaryVerdict: String(v.verdict ?? v.factCheckResult ?? "unknown").toLowerCase(),
      supporting: evidence.slice(0, 3),
      contradicting: evidence.slice(-3),
    });
  }
  return targets;
}

export function buildCrossExamUserContent(input: {
  claim: string;
  target: CrossExamTarget;
}): string {
  const fmt = (list: AtomSearchSource[]) =>
    list.length > 0
      ? list.map((s, i) => `${i + 1}. ${s.title}｜${s.snippet}（${s.url}）`).join("\n")
      : "（无）";
  return [
    `原句：${input.claim}`,
    `待复核说法：${input.target.atom}`,
    "支撑证据：",
    fmt(input.target.supporting),
    "反证证据：",
    fmt(input.target.contradicting),
    "只根据以上证据判断该说法。",
  ].join("\n");
}

/** 模型输出 → 规范第二意见；非法输出归为 unverified（宁谨慎不站队）。 */
export function parseSecondOpinion(
  output: unknown
): { verdict: "true" | "false" | "unverified"; reason: string; boundary: string } {
  const rec = (output ?? {}) as { verdict?: unknown; reason?: unknown; boundary?: unknown };
  const raw = String(rec.verdict ?? "").trim().toLowerCase();
  const verdict: "true" | "false" | "unverified" =
    raw === "true" || raw === "false" ? raw : "unverified";
  return {
    verdict,
    reason: typeof rec.reason === "string" ? rec.reason.slice(0, 300) : "",
    boundary: typeof rec.boundary === "string" ? rec.boundary.slice(0, 300) : "",
  };
}

/** 主/第二判词对照：第二意见 unverified = inconclusive（不惩罚，只记录）。 */
export function compareVerdicts(primary: string, second: string): CrossExamRelation {
  if (second === "unverified") return "inconclusive";
  const p = primary.toLowerCase();
  if (p === second) return "agree";
  // partial/exaggerated 与任一确定判词不算硬分歧
  if (p === "partial" || p === "exaggerated" || p === "unknown" || p === "") return "inconclusive";
  return "disagree";
}

export function crossExamConfidenceAdjustment(atoms: CrossExamAtomResult[]): number {
  const disagreements = atoms.filter((a) => a.relation === "disagree").length;
  if (disagreements === 0) return 0;
  return Math.max(-20, -10 * disagreements);
}

/** 第二意见语义调用（prompt/解析都在域内）；失败向上抛，由调用方决定跳过。 */
export function makeSecondOpinionCall(callRaw: CrossExamRawModelCall) {
  return async (input: { claim: string; target: CrossExamTarget }) => {
    const result = await callRaw({
      systemPrompt: CROSS_EXAM_SYSTEM_PROMPT,
      userContent: buildCrossExamUserContent(input),
      responseSchema: crossExamSchema as object,
      maxTokens: 400,
    });
    return { ...parseSecondOpinion(result?.output), model: result?.model ?? "" };
  };
}

/**
 * 主循环：对每个冲突原子跑一次第二意见（1 轮，无辩论往复——分歧留给确定性代码处置）。
 * 单原子失败不阻断：该原子记 inconclusive，reason 记失败。
 */
export async function runCrossExam(options: {
  claim: string;
  targets: CrossExamTarget[];
  callSecondOpinion: ReturnType<typeof makeSecondOpinionCall>;
}): Promise<CrossExamOutcome> {
  const atoms: CrossExamAtomResult[] = [];
  let model = "";
  for (const target of options.targets) {
    try {
      const second = await options.callSecondOpinion({ claim: options.claim, target });
      model = model || second.model;
      atoms.push({
        atom: target.atom,
        primaryVerdict: target.primaryVerdict,
        secondVerdict: second.verdict,
        secondReason: second.reason,
        secondModel: second.model,
        relation: compareVerdicts(target.primaryVerdict, second.verdict),
      });
    } catch (error) {
      atoms.push({
        atom: target.atom,
        primaryVerdict: target.primaryVerdict,
        secondVerdict: "unverified",
        secondReason: error instanceof Error ? `复核失败：${error.message}` : "复核失败",
        secondModel: "",
        relation: "inconclusive",
      });
    }
  }
  return {
    ran: atoms.length > 0,
    atoms,
    confidenceAdjustment: crossExamConfidenceAdjustment(atoms),
    model,
  };
}
