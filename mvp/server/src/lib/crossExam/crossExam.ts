/**
 * 有界质询：独立意见 → 可选定向补查 → 主调查回应，每条最多一轮。
 * 来源必须属于原命题的检索材料；生产结论由回应后的主调查给出。
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
  evidence?: AtomSearchSource[];
  evidenceGaps?: string[];
};

export type CrossExamAtomResult = {
  atom: string;
  primaryVerdict: string;
  secondVerdict: string;
  secondReason: string;
  secondModel: string;
  relation: CrossExamRelation;
  challenge?: string;
  response?: string;
  boundary?: string;
  sources?: AtomSearchSource[];
  status?: "answered" | "unresolved" | "failed";
  initialVerdict?: string;
  finalVerdict?: string;
  query?: string;
  searchStatus?: "completed" | "failed" | "not_run";
  searchSources?: AtomSearchSource[];
  stopReason?: string;
};

export type CrossExamOutcome = {
  ran: boolean;
  atoms: CrossExamAtomResult[];
  /** 确定性：每次分歧 -10，封顶 -20；全部一致为 0 */
  confidenceAdjustment: number;
  model: string;
  skippedReason?: string;
};

/** 裸模型调用口径（同 selfProof / evidenceLoop rewriter）。 */
export type CrossExamRawModelCall = (input: {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
}) => Promise<{ output: unknown; model: string }>;

export const CROSS_EXAM_SYSTEM_PROMPT = [
  "你是独立复核员。检查所给证据中的冲突或明确缺口。",
  "只依据给出的证据独立判断，不看主模型结论。不引入外部记忆的事实。",
  "输出 JSON：{\"verdict\": \"true|false|unverified\", \"reason\": \"一句话理由\", \"boundary\": \"证据能/不能支持什么\"}。",
  "证据不足以裁决时必须给 unverified，不要勉强站队。",
  "若有具体疑问，输出 challenge（可回答的质询）、sources（相关证据 URL）、query（最多一个定向补查问题）。没有疑问时 challenge 和 query 留空，不强行对抗。引用只能来自所给证据。",
].join("\n");

const crossExamSchema = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["true", "false", "unverified"] },
    reason: { type: "string" },
    boundary: { type: "string" },
    challenge: { type: "string" },
    query: { type: "string" },
    sources: { type: "array", items: { type: "string" } },
  },
  required: ["verdict", "reason"],
} as const;

/** 已绑定的证据冲突或明确证据缺口触发；来源列表的位置没有证据语义。 */
export function findCrossExamTargets(input: {
  verdicts: Array<Record<string, unknown>>;
  bundle: AtomSearchBundle;
  claimAtomKeyFn: (s: string) => string;
  maxTargets?: number;
}): CrossExamTarget[] {
  const cap = Math.min(MAX_CROSS_EXAM_ATOMS, input.maxTargets ?? MAX_CROSS_EXAM_ATOMS);
  const targets: CrossExamTarget[] = [];
  const seen = new Set<string>();
  for (const v of input.verdicts) {
    if (targets.length >= cap) break;
    if (!v || typeof v !== "object") continue;
    const atom = String(v.claimAtom ?? "").trim();
    if (!atom) continue;
    const key = input.claimAtomKeyFn(atom);
    if (seen.has(key)) continue;
    const evidence = input.bundle.byAtomKey[key] ?? [];
    const supporting = v.sourcesRelatedOnly ? [] : bindSources(v.supportingSources, evidence);
    const contradicting = bindSources(v.contradictingSources, evidence);
    const evidenceGaps = Array.isArray(v.evidenceGaps) ? v.evidenceGaps.filter((g): g is string => typeof g === "string" && !!g.trim()) : [];
    if (!(supporting.length && contradicting.length) && !evidenceGaps.length) continue;
    seen.add(key);
    targets.push({
      atom,
      atomKey: key,
      primaryVerdict: String(v.verdict ?? v.factCheckResult ?? "unknown").toLowerCase(),
      supporting,
      contradicting,
      evidence: evidence.filter(s => isHttp(s.url)),
      evidenceGaps,
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
    "其他已检索材料（未判定支持或反对）：",
    fmt(input.target.evidence ?? []),
    `明确证据缺口：${(input.target.evidenceGaps ?? []).join("；")}`,
    "只根据以上证据判断该说法。",
  ].join("\n");
}

/** 模型输出 → 规范第二意见；非法输出归为 unverified（宁谨慎不站队）。 */
export function parseSecondOpinion(
  output: unknown
): { verdict: "true" | "false" | "unverified"; reason: string; boundary: string; challenge?: string; query?: string; sources?: unknown[] } {
  const rec = (output ?? {}) as Record<string, unknown>;
  const raw = String(rec.verdict ?? "").trim().toLowerCase();
  const verdict: "true" | "false" | "unverified" =
    raw === "true" || raw === "false" ? raw : "unverified";
  return {
    verdict,
    reason: typeof rec.reason === "string" ? rec.reason.slice(0, 300) : "",
    boundary: typeof rec.boundary === "string" ? rec.boundary.slice(0, 300) : "",
    challenge: typeof rec.challenge === "string" ? rec.challenge.trim().slice(0, 600) : "",
    query: typeof rec.query === "string" ? rec.query.trim().slice(0, 240) : "",
    sources: Array.isArray(rec.sources) ? rec.sources : [],
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
      maxTokens: 800,
    });
    return { ...parseSecondOpinion(result?.output), model: result?.model ?? "" };
  };
}

/**
 * 每个命题最多一次质询、一次补查、一次回应。失败停止追加调用，保留未解决记录。
 * 未提供 respond 的旧调用者仍可读取单次第二意见及旧调整字段。
 */
export async function runCrossExam(options: {
  claim: string;
  targets: CrossExamTarget[];
  callSecondOpinion: ReturnType<typeof makeSecondOpinionCall>;
  signal?: AbortSignal;
  deadline?: number;
  shouldStop?: () => boolean;
  search?: (target: CrossExamTarget, query: string) => Promise<AtomSearchSource[]>;
  respond?: (target: CrossExamTarget, challenge: CrossExamAtomResult) => Promise<{ response: string; finalVerdict?: string; sources?: AtomSearchSource[] }>;
}): Promise<CrossExamOutcome> {
  const atoms: CrossExamAtomResult[] = [];
  let model = "";
  let attempted = false;
  let stopped = false;
  const shouldStop = () => stopped || !!options.signal?.aborted || (options.deadline != null && Date.now() >= options.deadline) || !!options.shouldStop?.();
  for (const target of options.targets.slice(0, MAX_CROSS_EXAM_ATOMS)) {
    const atom: CrossExamAtomResult = { atom: target.atom, primaryVerdict: target.primaryVerdict, initialVerdict: target.primaryVerdict, secondVerdict: "unverified", secondReason: "", secondModel: "", relation: "inconclusive", status: "unresolved", sources: [], searchStatus: "not_run" };
    atoms.push(atom);
    if (shouldStop()) { atom.stopReason = "质询已停止或时间预算不足"; continue; }
    try {
      attempted = true;
      const second = await options.callSecondOpinion({ claim: options.claim, target });
      model = model || second.model;
      Object.assign(atom, {
        secondVerdict: second.verdict,
        secondReason: second.reason,
        secondModel: second.model,
        relation: compareVerdicts(target.primaryVerdict, second.verdict),
        challenge: second.challenge,
        boundary: second.boundary,
        sources: bindSources(second.sources, target.evidence ?? [...target.supporting, ...target.contradicting]),
      });
      if (!atom.challenge) { atom.stopReason = "独立复核未提出具体质询"; continue; }
      if (shouldStop()) { atom.stopReason = "质询后时间预算不足或已取消，未回应"; continue; }
      if (second.query && options.search) {
        atom.query = second.query;
        try {
          atom.searchSources = await options.search(target, second.query);
          atom.searchStatus = "completed";
        } catch {
          atom.searchStatus = "failed";
          atom.stopReason = "定向补查未完成，未追加回应";
          stopped = true;
          continue;
        }
      }
      if (shouldStop()) { atom.stopReason = "回应前时间预算不足或已取消"; continue; }
      if (!options.respond) { atom.stopReason = "未接入主调查回应"; continue; }
      const response = await options.respond(target, atom);
      atom.response = response.response;
      atom.finalVerdict = response.finalVerdict;
      atom.sources = bindSources([...(atom.sources ?? []), ...(response.sources ?? [])], [...(target.evidence ?? [...target.supporting, ...target.contradicting]), ...(atom.searchSources ?? [])]);
      atom.status = response.response ? "answered" : "unresolved";
      if (!response.response) atom.stopReason = "主调查未返回针对该质询的回应";
    } catch {
      atom.status = atom.challenge ? "unresolved" : "failed";
      atom.stopReason = atom.challenge ? "主调查回应未完成" : "独立复核失败";
      if (!atom.challenge) atom.secondReason = "复核失败";
      stopped = true;
    }
  }
  return {
    ran: attempted,
    atoms,
    confidenceAdjustment: options.respond ? 0 : crossExamConfidenceAdjustment(atoms),
    model,
    ...(!attempted ? { skippedReason: atoms.length ? "质询已停止或时间预算不足" : "没有已绑定的证据冲突或明确证据缺口" } : {}),
  };
}

function isHttp(value: string): boolean {
  try { return ["http:", "https:"].includes(new URL(value).protocol); } catch { return false; }
}

function bindSources(raw: unknown, evidence: AtomSearchSource[]): AtomSearchSource[] {
  const urls = new Set((Array.isArray(raw) ? raw : []).map(s => typeof s === "string" ? s : String(s?.url ?? "")));
  return [...new Map(evidence.filter(s => isHttp(s.url) && urls.has(s.url)).map(s => [s.url, s])).values()];
}
