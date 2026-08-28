/**
 * Evidence Sufficiency Loop — ADR-004 + Search Policy (ADR-005).
 * 确定性内核：触发判定、缺口驱动 query、信息增益判停、停止原因。
 * LLM 只做语义改写（注入，失败回退缺口/模板）；检索走 searchOne 注入。
 * 无证据 ≠ 假：循环只补证据，判决仍由 fact_checker / 报告收束负责。
 */
import type { AtomSearchBundle, AtomSearchSource, SearchOneAtom } from "../atomSearch.js";
import { IMAGE_ORIGIN_NOT_FOUND, attachImageOriginToBundle } from "../imageOrigin/index.js";
import {
  assessEvidenceGap,
  classifyResultKind,
  computeInformationGain,
  formatHopDetail,
  GAIN_STOP_THRESHOLD,
  queriesForGap,
  type PursuitAction,
  type PursuitHop,
  type QueryPurpose,
  type ResultKind,
} from "../evidencePursuit/index.js";

export const MAX_EVIDENCE_LOOP_ROUNDS = 2;
/** 翻案续期：pass 上限。判词仍翻转中且问题仍产证据 → 再来一个 pass（总轮数 ≤ 4/原子）。 */
export const MAX_EVIDENCE_LOOP_PASSES = 2;
export const MAX_EVIDENCE_LOOP_TARGETS = 3;
const MAX_QUERIES_PER_ROUND = 2;
const MAX_SOURCES_PER_ATOM = 8;

export type EvidenceLoopTrigger = "unverified" | "conflict";

export type EvidenceLoopStopReason =
  | "evidence-found"
  | "no-new-evidence"
  | "rewrite-empty"
  | "search-failed";

export type EvidenceLoopTarget = {
  atom: string;
  atomKey: string;
  trigger: EvidenceLoopTrigger;
};

export type EvidenceLoopRoundLog = {
  round: number;
  query: string;
  sourceCount: number;
  newSourceCount: number;
  ok: boolean;
  purpose?: QueryPurpose;
  goal?: string;
  resultKind?: ResultKind;
  gain?: number;
  missingAfter?: string[];
  action?: PursuitAction;
};

export type EvidenceLoopAtomOutcome = {
  atom: string;
  atomKey: string;
  trigger: EvidenceLoopTrigger;
  rounds: EvidenceLoopRoundLog[];
  stopReason: EvidenceLoopStopReason;
};

export type EvidenceLoopOutcome = {
  ran: boolean;
  atoms: EvidenceLoopAtomOutcome[];
  totalNewSources: number;
  /** 拿到新证据 → 调用方应重跑一次 fact_checker（条件重判） */
  recheckFactChecker: boolean;
  /** 翻案续期实际跑的 pass 数（1 = 单 pass 即停；≥2 = 续期触发过） */
  passes?: number;
  /** 证据追索 hops（前端过程层消费；与 rounds 同源） */
  pursuitHops?: PursuitHop[];
};

export type EvidenceLoopHooks = {
  onLoopStart?: (targets: EvidenceLoopTarget[]) => void;
  onRoundStart?: (info: {
    atom: string;
    round: number;
    query: string;
    trigger: EvidenceLoopTrigger;
    goal?: string;
    purpose?: QueryPurpose;
    missingEvidence?: string[];
  }) => void;
  onRoundResult?: (info: {
    atom: string;
    round: number;
    query: string;
    sourceCount: number;
    newSourceCount: number;
    goal?: string;
    purpose?: QueryPurpose;
    resultKind?: ResultKind;
    gain?: number;
    missingAfter?: string[];
    action?: PursuitAction;
    detail?: string;
  }) => void;
  onAtomStopped?: (info: { atom: string; rounds: number; reason: EvidenceLoopStopReason }) => void;
};

export type RewriteQueryModelCall = (input: {
  claim: string;
  atom: string;
  round: number;
  priorQueries: string[];
  strategy: string;
}) => Promise<{ queries: string[]; model: string }>;

/** 裸模型调用（同 selfProof 的 SelfProofModelCall 口径），由 handlers 注入。 */
export type RewriteRawModelCall = (input: {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
}) => Promise<{ output: unknown; model: string }>;

const REWRITE_SYSTEM_PROMPT = [
  "你是检索查询改写器。一条中文可核查判断第一轮检索未命中，需要换角度再查。",
  "只改写检索词，不判断真假。输出 JSON：{\"queries\": [\"...\", \"...\"]}。",
  "改写规则：",
  "1. 换词汇空间：口语说法换成官方/媒体正式口径（如 电瓶车→电动自行车，P图→合成图片）。",
  "2. 加锚点：上下文里有年份、机构、地名、人名就带上（时间锚点优先）。",
  "3. 按本轮策略改：官方来源词=指向通报/辟谣/发布；原文语境=指出处/原始发布/数据来源。",
  "4. 每条不超过 30 字，不加引号、不加解释，不要复述已试过的查询。",
  "输出恰好 1-2 条。",
].join("\n");

const rewriteQuerySchema = {
  type: "object",
  properties: {
    queries: { type: "array", items: { type: "string" } },
  },
  required: ["queries"],
} as const;

export function buildRewriteUserContent(input: {
  claim: string;
  atom: string;
  round: number;
  priorQueries: string[];
  strategy: string;
}): string {
  const tried = input.priorQueries.length
    ? input.priorQueries.map((q) => `- ${q}`).join("\n")
    : "-（首轮）";
  return [
    `原句：${input.claim}`,
    `待补查判断：${input.atom}`,
    `本轮策略：${input.strategy}（第 ${input.round} 轮）`,
    "已试过的查询（不要重复）：",
    tried,
  ].join("\n");
}

/** 模型输出 → 干净 query 列表：剥引号、压空白、丢空串、去重、截上限。 */
export function parseRewriteQueries(
  output: unknown,
  maxQueries = MAX_QUERIES_PER_ROUND
): string[] {
  const raw = (output as { queries?: unknown } | undefined)?.queries;
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const q of raw) {
    if (typeof q !== "string") continue;
    const cleaned = q
      .replace(/^["'「『\s]+|["'」』\s]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned || cleaned.length > 60) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= maxQueries) break;
  }
  return out;
}

/** 把裸模型调用绑成语义改写调用；任何失败抛给上层回退确定性模板。 */
export function makeRewriteQueryCall(callRaw: RewriteRawModelCall): RewriteQueryModelCall {
  return async (input) => {
    const result = await callRaw({
      systemPrompt: REWRITE_SYSTEM_PROMPT,
      userContent: buildRewriteUserContent(input),
      responseSchema: rewriteQuerySchema as object,
      maxTokens: 200,
    });
    return { queries: parseRewriteQueries(result?.output), model: result?.model ?? "" };
  };
}

const UNVERIFIED_STATUSES = new Set(["unverified", "unknown", "cannot_verify", ""]);

/** 确定性改写兜底：round 1 官方来源词，round 2 原文语境，round ≥3 当事方与原始数据（续期策略）。 */
export function fallbackRewriteQueries(
  atom: string,
  round: number,
  opts?: { needImageOrigin?: boolean }
): string[] {
  const a = atom.replace(/\s+/g, " ").trim();
  if (opts?.needImageOrigin) {
    if (round <= 1) return [`${a} 原图 出处`, `${a} 首发`];
    if (round === 2) return [`${a} 原图 首发`, `${a} 出处`];
    return [`${a} 原图 首发`, `${a} 当事方 回应`];
  }
  if (round <= 1) return [`${a} 官方通报`, `${a} 辟谣`];
  if (round === 2) return [`${a} 原文 出处`, `${a} 数据来源`];
  return [`${a} 当事方 回应`, `${a} 原始数据 发布`];
}

/**
 * 触发判定（纯函数）：
 * - conflict：支撑与反证同时非空（模型显式给出两侧来源）；
 * - unverified：无判词，或判词状态为 unverified 类。
 * 注意：fact 阶段的 subclaimVerdicts 是模型原始输出，URL 绑定在报告组装时才发生，
 * 所以不能用「来源为空」当未证实信号——那会把正向判词全部误触发。
 */
export function findLoopTargets(input: {
  atomsSearched: string[];
  verdicts: Array<Record<string, unknown>>;
  claimAtomKeyFn: (s: string) => string;
  maxTargets?: number;
}): EvidenceLoopTarget[] {
  const cap = input.maxTargets ?? MAX_EVIDENCE_LOOP_TARGETS;
  const byKey = new Map<string, Record<string, unknown>>();
  for (const v of input.verdicts) {
    if (!v || typeof v !== "object") continue;
    const atom = String(v.claimAtom ?? "").trim();
    if (!atom) continue;
    const key = input.claimAtomKeyFn(atom);
    if (!byKey.has(key)) byKey.set(key, v);
  }

  const targets: EvidenceLoopTarget[] = [];
  for (const atom of input.atomsSearched) {
    const key = input.claimAtomKeyFn(atom);
    const verdict = byKey.get(key);
    if (!verdict) {
      targets.push({ atom, atomKey: key, trigger: "unverified" });
      continue;
    }
    const support = Array.isArray(verdict.supportingSources) ? verdict.supportingSources.length : 0;
    const contra = Array.isArray(verdict.contradictingSources) ? verdict.contradictingSources.length : 0;
    if (support > 0 && contra > 0) {
      targets.push({ atom, atomKey: key, trigger: "conflict" });
      continue;
    }
    const status = String(verdict.verdict ?? verdict.factCheckResult ?? "")
      .trim()
      .toLowerCase();
    if (UNVERIFIED_STATUSES.has(status)) {
      targets.push({ atom, atomKey: key, trigger: "unverified" });
    }
  }
  targets.sort((a, b) => {
    if (a.trigger === b.trigger) return 0;
    return a.trigger === "conflict" ? -1 : 1;
  });
  return targets.slice(0, cap);
}

/** 检索结果 → 可用来源（与 atomSearch 同一归一口径；拒绝无 http(s) URL 的条目）。 */
function extractSources(result: unknown): AtomSearchSource[] {
  const sources = (result as { sources?: unknown })?.sources;
  if (!Array.isArray(sources)) return [];
  const out: AtomSearchSource[] = [];
  for (let i = 0; i < sources.length && i < 24; i += 1) {
    const rec = sources[i] as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    const url = String(rec.url || rec.link || "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      url,
      title: String(rec.title || rec.name || "").slice(0, 200),
      snippet: String(rec.condensedSnippet || rec.snippet || rec.summary || rec.content || "").slice(0, 320),
      credibility: typeof rec.credibility === "string" ? rec.credibility : undefined,
    });
  }
  return out;
}

/**
 * 把补查来源合入 bundle（byAtomKey / forAgent / aggregate.sources，全 URL 去重）。
 * 返回新增条数（边际增益的度量）。
 */
export function mergeSourcesIntoBundle(
  bundle: AtomSearchBundle,
  atomKey: string,
  incoming: AtomSearchSource[],
  claimAtomKeyFn: (s: string) => string
): number {
  const existing = bundle.byAtomKey[atomKey] ?? [];
  const seen = new Set(existing.map((s) => s.url));
  const aggregateSeen = new Set(
    bundle.aggregate.sources.map((s) => String((s as { url?: unknown }).url ?? ""))
  );
  const next = [...existing];
  let added = 0;
  for (const src of incoming) {
    if (next.length >= MAX_SOURCES_PER_ATOM) break;
    if (!src?.url || seen.has(src.url)) continue;
    seen.add(src.url);
    next.push(src);
    added += 1;
    if (!aggregateSeen.has(src.url)) {
      aggregateSeen.add(src.url);
      bundle.aggregate.sources.push({
        url: src.url,
        title: src.title,
        snippet: src.snippet,
        ...(src.credibility ? { credibility: src.credibility } : {}),
      });
    }
  }
  if (added > 0) {
    bundle.byAtomKey[atomKey] = next;
    const forAgentItem = bundle.forAgent.find((f) => claimAtomKeyFn(f.claimAtom) === atomKey);
    if (forAgentItem) forAgentItem.sources = next;
    else bundle.forAgent.push({ claimAtom: atomKey, sources: next });
  }
  return added;
}

function verdictSideCounts(
  verdicts: Array<Record<string, unknown>>,
  atomKey: string,
  claimAtomKeyFn: (s: string) => string
): { supportingCount: number; contradictingCount: number } {
  for (const v of verdicts) {
    if (!v || typeof v !== "object") continue;
    if (claimAtomKeyFn(String(v.claimAtom ?? "").trim()) !== atomKey) continue;
    return {
      supportingCount: Array.isArray(v.supportingSources) ? v.supportingSources.length : 0,
      contradictingCount: Array.isArray(v.contradictingSources) ? v.contradictingSources.length : 0,
    };
  }
  return { supportingCount: 0, contradictingCount: 0 };
}

type RoundPlan = {
  queries: string[];
  purpose: QueryPurpose;
  goal: string;
  missing: string[];
};

async function planRoundQueries(
  options: {
    claim: string;
    callRewriteModel?: RewriteQueryModelCall;
    needImageOrigin?: boolean;
    bundle?: Pick<AtomSearchBundle, "imageOrigin">;
  },
  target: EvidenceLoopTarget,
  round: number,
  priorQueries: Set<string>,
  sources: AtomSearchSource[],
  sideCounts: { supportingCount: number; contradictingCount: number }
): Promise<RoundPlan> {
  const gap = assessEvidenceGap({
    atom: target.atom,
    sources,
    trigger: target.trigger,
    supportingCount: sideCounts.supportingCount,
    contradictingCount: sideCounts.contradictingCount,
  });
  if (options.needImageOrigin && options.bundle?.imageOrigin?.status !== "found") {
    const originQs = fallbackRewriteQueries(target.atom, round, { needImageOrigin: true }).filter(
      (q) => !priorQueries.has(q)
    );
    if (originQs.length > 0) {
      const missing = gap.missingEvidence.includes("原图出处")
        ? gap.missingEvidence
        : [...gap.missingEvidence, "原图出处"].slice(0, 6);
      return {
        queries: originQs.slice(0, MAX_QUERIES_PER_ROUND),
        purpose: gap.nextPurpose,
        goal: "查原图出处",
        missing,
      };
    }
  }
  const strategy = round <= 1 ? "官方来源词" : round === 2 ? "原文语境" : "当事方与原始数据";
  if (options.callRewriteModel) {
    try {
      const out = await options.callRewriteModel({
        claim: options.claim,
        atom: target.atom,
        round,
        priorQueries: [...priorQueries],
        strategy,
      });
      if (Array.isArray(out?.queries)) {
        const queries = out.queries
          .filter((q): q is string => typeof q === "string" && q.trim().length > 0)
          .map((q) => q.replace(/\s+/g, " ").trim())
          .slice(0, MAX_QUERIES_PER_ROUND);
        if (queries.length > 0) {
          return { queries, purpose: gap.nextPurpose, goal: gap.goalLabel, missing: gap.missingEvidence };
        }
      }
    } catch {
      // 改写模型失败 → 回退缺口驱动 / 模板，不阻断循环
    }
  }
  const driven = queriesForGap({
    atom: target.atom,
    gap,
    priorQueries,
    round,
  });
  const queries = (
    driven.length > 0 ? driven : fallbackRewriteQueries(target.atom, round, { needImageOrigin: options.needImageOrigin })
  ).slice(0, MAX_QUERIES_PER_ROUND);
  return { queries, purpose: gap.nextPurpose, goal: gap.goalLabel, missing: gap.missingEvidence };
}

/**
 * 主循环（每原子）：
 * - 轮内按缺口驱动的 query 试探；信息增益过线 → 停 "evidence-found"（够重判）；
 * - 新 URL 若只是同站转载（增益≈0）继续下一问，不把转载当证据；
 * - 整轮无有效增益 → 预算内换下一策略；预算耗尽 → "no-new-evidence"；
 * - 没有未用过的 query → "rewrite-empty"；检索抛错 → "search-failed"。
 * 预算：targets ≤ 3 × rounds ≤ 2 × 每轮 query ≤ 2 = 最多 12 次补查。
 */
export async function runEvidenceLoop(options: {
  claim: string;
  bundle: AtomSearchBundle;
  factVerdicts: Array<Record<string, unknown>>;
  searchOne: SearchOneAtom;
  claimAtomKeyFn: (s: string) => string;
  callRewriteModel?: RewriteQueryModelCall;
  maxRounds?: number;
  maxTargets?: number;
  /** 续期 pass 的起始轮号（默认 1）；round 3+ 走「当事方与原始数据」策略。 */
  startRound?: number;
  /** atomKey → 已问过的查询（续期 pass 注入，避免重复问法）。 */
  seedQueriesByAtomKey?: Record<string, string[]>;
  /** Screenshot case: prefer 原图/首发 queries; never promote text hits to imageOrigin. */
  needImageOrigin?: boolean;
  hooks?: EvidenceLoopHooks;
}): Promise<EvidenceLoopOutcome> {
  const maxRounds = Math.max(1, options.maxRounds ?? MAX_EVIDENCE_LOOP_ROUNDS);
  const startRound = Math.max(1, options.startRound ?? 1);
  const targets = findLoopTargets({
    atomsSearched: options.bundle.atomsSearched,
    verdicts: options.factVerdicts,
    claimAtomKeyFn: options.claimAtomKeyFn,
    maxTargets: options.maxTargets,
  });
  if (targets.length === 0) {
    return { ran: false, atoms: [], totalNewSources: 0, recheckFactChecker: false };
  }
  options.hooks?.onLoopStart?.(targets);

  const atoms: EvidenceLoopAtomOutcome[] = [];
  const pursuitHops: PursuitHop[] = [];
  let totalNewSources = 0;
  let hopNo = 0;
  let meaningfulEvidence = false;

  for (const target of targets) {
    const rounds: EvidenceLoopRoundLog[] = [];
    const priorQueries = new Set<string>([target.atom]);
    for (const q of options.seedQueriesByAtomKey?.[target.atomKey] ?? []) {
      if (q) priorQueries.add(q);
    }
    let stopReason: EvidenceLoopStopReason = "no-new-evidence";
    const sideCounts = verdictSideCounts(options.factVerdicts, target.atomKey, options.claimAtomKeyFn);

    for (let round = startRound; round < startRound + maxRounds; round += 1) {
      const existing = options.bundle.byAtomKey[target.atomKey] ?? [];
      const plan = await planRoundQueries(
        options,
        target,
        round,
        priorQueries,
        existing,
        sideCounts
      );
      const fresh = plan.queries.filter((q) => !priorQueries.has(q));
      if (fresh.length === 0) {
        stopReason = "rewrite-empty";
        break;
      }
      let roundFoundNew = false;
      let roundSearchFailed = false;
      for (const query of fresh) {
        priorQueries.add(query);
        hopNo += 1;
        const existingNow = options.bundle.byAtomKey[target.atomKey] ?? [];
        options.hooks?.onRoundStart?.({
          atom: target.atom,
          round,
          query,
          trigger: target.trigger,
          goal: plan.goal,
          purpose: plan.purpose,
          missingEvidence: plan.missing,
        });
        let result: unknown;
        try {
          result = await options.searchOne(query);
        } catch {
          const failLog: EvidenceLoopRoundLog = {
            round,
            query,
            sourceCount: 0,
            newSourceCount: 0,
            ok: false,
            purpose: plan.purpose,
            goal: plan.goal,
            resultKind: "empty",
            gain: 0,
            missingAfter: plan.missing,
            action: "stop",
          };
          rounds.push(failLog);
          options.hooks?.onRoundResult?.({
            atom: target.atom,
            round,
            query,
            sourceCount: 0,
            newSourceCount: 0,
            goal: plan.goal,
            purpose: plan.purpose,
            resultKind: "empty",
            gain: 0,
            missingAfter: plan.missing,
            action: "stop",
            detail: formatHopDetail(failLog),
          });
          roundSearchFailed = true;
          break;
        }
        const incoming = extractSources(result);
        const gapBefore = assessEvidenceGap({
          atom: target.atom,
          sources: existingNow,
          trigger: target.trigger,
          supportingCount: sideCounts.supportingCount,
          contradictingCount: sideCounts.contradictingCount,
        });
        const added = mergeSourcesIntoBundle(
          options.bundle,
          target.atomKey,
          incoming,
          options.claimAtomKeyFn
        );
        totalNewSources += added;
        const afterSources = options.bundle.byAtomKey[target.atomKey] ?? [];
        const gapAfter = assessEvidenceGap({
          atom: target.atom,
          sources: afterSources,
          trigger: target.trigger,
          supportingCount: sideCounts.supportingCount,
          contradictingCount: sideCounts.contradictingCount,
        });
        const { gain } = computeInformationGain({
          existing: existingNow,
          incoming,
          gapBefore,
          gapAfter,
        });
        const resultKind = classifyResultKind(incoming, existingNow, target.atom);
        const enough = gain >= GAIN_STOP_THRESHOLD;
        const action: PursuitAction = enough ? "stop" : "continue";
        const log: EvidenceLoopRoundLog = {
          round,
          query,
          sourceCount: incoming.length,
          newSourceCount: added,
          ok: true,
          purpose: plan.purpose,
          goal: plan.goal,
          resultKind,
          gain,
          missingAfter: gapAfter.missingEvidence,
          action,
        };
        rounds.push(log);
        const hop: PursuitHop = {
          hop: hopNo,
          atom: target.atom,
          goal: plan.goal,
          purpose: plan.purpose,
          query,
          resultKind,
          newEvidence: added,
          missingAfter: gapAfter.missingEvidence,
          gain,
          action,
        };
        pursuitHops.push(hop);
        options.hooks?.onRoundResult?.({
          atom: target.atom,
          round,
          query,
          sourceCount: incoming.length,
          newSourceCount: added,
          goal: plan.goal,
          purpose: plan.purpose,
          resultKind,
          gain,
          missingAfter: gapAfter.missingEvidence,
          action,
          detail: formatHopDetail(hop),
        });
        if (enough) {
          roundFoundNew = true;
          meaningfulEvidence = true;
          break;
        }
      }
      if (roundSearchFailed) {
        stopReason = "search-failed";
        break;
      }
      if (roundFoundNew) {
        stopReason = "evidence-found";
        break;
      }
      // 整轮无有效增益 → 预算内换下一策略（action=switch 记在下一轮 goal）
    }

    for (let i = pursuitHops.length - 1; i >= 0; i -= 1) {
      if (pursuitHops[i].atom === target.atom) {
        pursuitHops[i].stopReason = stopReason;
        break;
      }
    }

    atoms.push({ atom: target.atom, atomKey: target.atomKey, trigger: target.trigger, rounds, stopReason });
    options.hooks?.onAtomStopped?.({ atom: target.atom, rounds: rounds.length, reason: stopReason });
  }

  if (options.needImageOrigin) {
    const origin = options.bundle.imageOrigin;
    if (!origin || origin.status !== "found") {
      attachImageOriginToBundle(options.bundle, origin ?? {
        status: "not_found",
        channel: "none",
        label: IMAGE_ORIGIN_NOT_FOUND,
      });
    }
  }

  return {
    ran: true,
    atoms,
    totalNewSources,
    recheckFactChecker: meaningfulEvidence,
    pursuitHops,
  };
}
