/**
 * reactObserve.ts — Book Ch.1 ReAct 轻量「观察」层
 *
 * 生产路径仍是：DAG 预取 search → 单次 LLM（非多轮 tool calling）。
 * 本模块把已有材料（searchResult + 前序 steps）显式压成 reactTrace：
 *   thoughtHint (Think) → observations (Observe) → nextActionHint (Act 建议)
 *
 * 注入 fact_checker / source_validator 的 agentInput。
 * full ReAct 多轮工具环见 deepagents-poc/（不进生产）。
 */

import type { Search360Response } from "../schemas";

export type ReactObserveAgentId = "fact_checker" | "source_validator";

/** UI / report 可见的二次反证检索提示文案 */
export const SECOND_PASS_COUNTER_SEARCH_HINT = "建议二次反证检索";

export interface ReactObservation {
  /** 观察类别 */
  kind: "search" | "upstream" | "gap" | "quality" | "memory" | "note";
  summary: string;
  detail?: string;
  /** 材料出处，便于审计 */
  source?: string;
}

export interface ReactTrace {
  /** Think：本步应如何推理的短提示 */
  thoughtHint: string;
  /** Observe：已观测到的环境/工具结果（非模型自言） */
  observations: ReactObservation[];
  /** Act 建议：下一步优先动作（仍由单次 LLM 在输出合同内完成） */
  nextActionHint: string;
  /**
   * fact_checker 路径：检索反证为空且缺口≥2 时为 true。
   * 完成后可驱动 speculative_update / report 注入。
   */
  shouldSecondPassCounterSearch?: boolean;
}

export interface ReactObserveStep {
  agent: string;
  output?: Record<string, unknown> | null;
  status?: string;
}

export interface BuildReactTraceInput {
  agentId: ReactObserveAgentId | string;
  claim?: string;
  searchResult?: Search360Response | null;
  previousSteps?: ReactObserveStep[];
  memoryHitCount?: number;
}

function asStringArray(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, limit);
}

function countSources(list: unknown): number {
  return Array.isArray(list) ? list.length : 0;
}

function findStep(steps: ReactObserveStep[] | undefined, agent: string): ReactObserveStep | undefined {
  return steps?.find((s) => s.agent === agent);
}

function searchObservations(searchResult?: Search360Response | null): ReactObservation[] {
  if (!searchResult) {
    return [
      {
        kind: "search",
        summary: "搜索材料尚未就绪",
        detail: "无 search360 结果可观察",
        source: "search360",
      },
    ];
  }

  const supportN = countSources(searchResult.supportingEvidence);
  const contradictN = countSources(searchResult.contradictingEvidence);
  const sourceN = countSources(searchResult.sources);
  const gaps = asStringArray(searchResult.unresolvedEvidenceGaps, 4);
  const origin = searchResult._source ?? "unknown";

  const observations: ReactObservation[] = [
    {
      kind: "search",
      summary: `检索返回 support=${supportN} contradict=${contradictN} sources=${sourceN}`,
      detail:
        typeof searchResult.answer === "string" && searchResult.answer.trim()
          ? searchResult.answer.trim().slice(0, 160)
          : undefined,
      source: `search360:${origin}`,
    },
  ];

  if (supportN === 0 && contradictN === 0 && sourceN === 0) {
    observations.push({
      kind: "gap",
      summary: "支持侧与反驳侧均无可用来源",
      source: "search360",
    });
  } else if (contradictN === 0) {
    observations.push({
      kind: "gap",
      summary: "反证材料为空，核查时需显式标记反证缺口",
      source: "search360",
    });
  }

  if (gaps.length > 0) {
    observations.push({
      kind: "gap",
      summary: `检索层未决缺口 ${gaps.length} 项`,
      detail: gaps.join("；"),
      source: "search360.unresolvedEvidenceGaps",
    });
  }

  if (origin === "tool-error" || origin === "demo-fallback") {
    observations.push({
      kind: "quality",
      summary: `检索源质量警示：${origin}`,
      detail: typeof searchResult.traceText === "string" ? searchResult.traceText.slice(0, 120) : undefined,
      source: "search360",
    });
  }

  return observations;
}

function rumorUpstreamObservations(steps?: ReactObserveStep[]): ReactObservation[] {
  const rumor = findStep(steps, "rumor_detector");
  if (!rumor?.output) return [];

  const atoms = asStringArray(rumor.output.claimAtoms, 5);
  const needed = asStringArray(rumor.output.neededEvidence, 4);
  const types = asStringArray(rumor.output.rumorTypes, 3);
  const out: ReactObservation[] = [];

  if (atoms.length > 0) {
    out.push({
      kind: "upstream",
      summary: `分诊给出 ${atoms.length} 个原子命题`,
      detail: atoms.join(" | "),
      source: "upstream:rumor_detector",
    });
  }
  if (needed.length > 0) {
    out.push({
      kind: "upstream",
      summary: `待查证据需求 ${needed.length} 项`,
      detail: needed.join("；"),
      source: "upstream:rumor_detector.neededEvidence",
    });
  }
  if (types.length > 0) {
    out.push({
      kind: "upstream",
      summary: `谣言类型标签：${types.join("、")}`,
      source: "upstream:rumor_detector.rumorTypes",
    });
  }
  return out;
}

function factUpstreamObservations(steps?: ReactObserveStep[]): ReactObservation[] {
  const fact = findStep(steps, "fact_checker");
  if (!fact?.output) return [];

  const verdict =
    typeof fact.output.factCheckResult === "string" ? fact.output.factCheckResult : "unknown";
  const confidence =
    typeof fact.output.confidence === "string" ? fact.output.confidence : undefined;
  const gaps = asStringArray(fact.output.unresolvedEvidenceGaps, 4);

  const out: ReactObservation[] = [
    {
      kind: "upstream",
      summary: `事实核查结论=${verdict}${confidence ? ` confidence=${confidence}` : ""}`,
      source: "upstream:fact_checker",
    },
  ];
  if (gaps.length > 0) {
    out.push({
      kind: "gap",
      summary: `核查员标注未决缺口 ${gaps.length} 项`,
      detail: gaps.join("；"),
      source: "upstream:fact_checker.unresolvedEvidenceGaps",
    });
  }
  return out;
}

function thoughtHintFor(agentId: string): string {
  if (agentId === "fact_checker") {
    return "Think：对照 claimAtoms 与 search360 的支持/反驳材料，只使用已观察证据写结论，缺口写入 unresolvedEvidenceGaps。";
  }
  if (agentId === "source_validator") {
    return "Think：核验来源域名、独立性与可追溯性；URL/标题必须来自已观察材料，禁止编造。";
  }
  return "Think：基于已观察材料推理，禁止虚构工具结果。";
}

function nextActionHintFor(
  agentId: string,
  searchResult?: Search360Response | null,
  steps?: ReactObserveStep[]
): string {
  const contradictN = countSources(searchResult?.contradictingEvidence);
  const supportN = countSources(searchResult?.supportingEvidence);
  const searchGaps = asStringArray(searchResult?.unresolvedEvidenceGaps, 8);
  const factGaps = asStringArray(findStep(steps, "fact_checker")?.output?.unresolvedEvidenceGaps, 8);
  const totalGaps = searchGaps.length + factGaps.length;

  if (agentId === "fact_checker") {
    if (!searchResult) {
      return "Act：无检索材料时降低置信度，列出必须补检索的问题，勿编造来源。";
    }
    if (contradictN === 0 && supportN > 0) {
      return "Act：支持侧有材料但反证为空——结论偏 partial/unverified，并写出反证检索缺口。";
    }
    if (supportN === 0 && contradictN === 0) {
      return "Act：双侧皆空——输出低置信与 unresolvedEvidenceGaps，指出需要的官方/原始材料。";
    }
    if (totalGaps >= 2) {
      return "Act：缺口≥2——优先对齐 neededEvidence，逐条标注仍缺什么可核材料。";
    }
    return "Act：综合支持/反驳证据给出 factCheckResult，引用仅限 search360 中出现的来源。";
  }

  if (agentId === "source_validator") {
    if (contradictN === 0) {
      return "Act：反证来源缺失时，对支持侧来源更严格打分，并标出独立性/可追溯风险。";
    }
    if (totalGaps >= 2) {
      return "Act：结合核查缺口复核来源，标记不可用或弱来源，勿补写未出现的 URL。";
    }
    return "Act：对 search360 与前序引用逐条校验可信度与独立性，输出可进入报告的信源判断。";
  }

  return "Act：基于 observations 完成合同字段输出。";
}

/** 生产注入白名单 */
export function shouldInjectReactTrace(agentId: string): agentId is ReactObserveAgentId {
  return agentId === "fact_checker" || agentId === "source_validator";
}

/**
 * 纯函数：检索反证为空 且 未决缺口≥2 → 建议二次反证检索。
 * gaps 可来自 searchResult 或 fact_checker.output.unresolvedEvidenceGaps。
 */
export function computeShouldSecondPassCounterSearch(input: {
  searchResult?: Search360Response | null;
  unresolvedEvidenceGaps?: unknown;
}): boolean {
  const contradictN = countSources(input.searchResult?.contradictingEvidence);
  if (contradictN > 0) return false;
  const gaps = asStringArray(input.unresolvedEvidenceGaps, 20);
  return gaps.length >= 2;
}

/**
 * 纯函数：为 fact_checker / source_validator 构建显式 ReAct 观察对象。
 * 其他 agentId 返回 null（调用方可跳过注入）。
 */
export function buildReactTrace(input: BuildReactTraceInput): ReactTrace | null {
  if (!shouldInjectReactTrace(input.agentId)) {
    return null;
  }

  const agentId = input.agentId;
  const observations: ReactObservation[] = [];

  if (agentId === "fact_checker") {
    observations.push(...rumorUpstreamObservations(input.previousSteps));
    observations.push(...searchObservations(input.searchResult));
  } else {
    observations.push(...rumorUpstreamObservations(input.previousSteps));
    observations.push(...factUpstreamObservations(input.previousSteps));
    observations.push(...searchObservations(input.searchResult));
  }

  if ((input.memoryHitCount ?? 0) > 0) {
    observations.push({
      kind: "memory",
      summary: `历史案例召回 ${input.memoryHitCount} 条（仅作参考，不可替代本案证据）`,
      source: "memory",
    });
  }

  if (observations.length === 0) {
    observations.push({
      kind: "note",
      summary: "暂无结构化观察材料",
      source: "reactObserve",
    });
  }

  const trace: ReactTrace = {
    thoughtHint: thoughtHintFor(agentId),
    observations,
    nextActionHint: nextActionHintFor(agentId, input.searchResult, input.previousSteps),
  };

  // fact_checker：用检索层缺口预判是否需要二次反证（完成后可再结合 output 复核）
  if (agentId === "fact_checker") {
    trace.shouldSecondPassCounterSearch = computeShouldSecondPassCounterSearch({
      searchResult: input.searchResult,
      unresolvedEvidenceGaps: input.searchResult?.unresolvedEvidenceGaps,
    });
  }

  return trace;
}

/**
 * 可选 follow-up：fact_checker 缺口≥2 且检索反证为空时，
 * 给 report_composer 一条「应触发二次反证检索」观察注记。
 * 不发起真实二次检索，只写进输入供报告层显式处理。
 */
export function buildSecondaryCounterSearchNote(input: {
  previousSteps?: ReactObserveStep[];
  searchResult?: Search360Response | null;
}): string | null {
  const fact = findStep(input.previousSteps, "fact_checker");
  if (
    computeShouldSecondPassCounterSearch({
      searchResult: input.searchResult,
      unresolvedEvidenceGaps: fact?.output?.unresolvedEvidenceGaps,
    })
  ) {
    return "应触发二次反证检索";
  }
  return null;
}

/**
 * report_composer 注入：前序 fact_checker 存在且反证材料为空时给出 UI/报告提示。
 * 优先用 fact 输出缺口≥2；若 fact 已跑但 counterEvidence 明确为空数组，也给出提示。
 */
export function buildSecondPassCounterSearchHint(input: {
  previousSteps?: ReactObserveStep[];
  searchResult?: Search360Response | null;
}): string | null {
  if (countSources(input.searchResult?.contradictingEvidence) > 0) {
    return null;
  }

  const fact = findStep(input.previousSteps, "fact_checker");
  if (!fact) return null;

  if (
    computeShouldSecondPassCounterSearch({
      searchResult: input.searchResult,
      unresolvedEvidenceGaps: fact.output?.unresolvedEvidenceGaps,
    })
  ) {
    return SECOND_PASS_COUNTER_SEARCH_HINT;
  }

  // 前序 fact 已完成且输出里 counterEvidence 为空数组 → 也提示
  const counter = fact.output?.counterEvidence;
  if (Array.isArray(counter) && counter.length === 0) {
    return SECOND_PASS_COUNTER_SEARCH_HINT;
  }

  return null;
}
