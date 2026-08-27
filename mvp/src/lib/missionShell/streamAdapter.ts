/**
 * MissionStreamAdapter — OrchestrateStreamEvent[] → MissionShellModel
 *
 * Pure. No React. No Ant Design import.
 * Backend SSE contract stays unchanged.
 */

import type { OrchestrateStreamEvent } from "../agentExpansion";
import {
  humanizeClaimType,
  humanizeConfidenceLevel,
  humanizeFactCheckResult,
  shareAdviceFromVerdict,
} from "./labels";
import type {
  MissionShellModel,
  ShellAgentChip,
  ShellNodeStatus,
  ShellThoughtItem,
  ShellToolItem,
  ShellUnderstanding,
  ShellVerdictCard,
  ShellVerdictSource,
} from "./types";
import { humanizeProcessSummary, humanizeProcessTitle } from "./visibleProcessRows";
import { formatPursuitDetail, isEvidencePursuitTool } from "../evidencePursuitUi";

const AGENT_LABEL: Record<string, string> = {
  rumor_detector: "拆题",
  fact_checker: "事实核查",
  source_validator: "溯源",
  report_composer: "写结论",
  investigator: "核查",
  alternative_explanation_searcher: "替代解释",
  counter_evidence_grader: "反证评分",
};

function agentLabel(id?: string, name?: string): string {
  if (id && AGENT_LABEL[id]) return AGENT_LABEL[id];
  if (name && name.trim()) return name.trim();
  return id || "核查角色";
}

function isPursuit(event: Pick<OrchestrateStreamEvent, "toolId" | "toolName" | "result">): boolean {
  return isEvidencePursuitTool({
    toolId: event.toolId,
    toolName: event.toolName,
    result: event.result,
  });
}

function isReviewer(toolId?: string, toolName?: string): boolean {
  const key = `${toolId ?? ""} ${toolName ?? ""}`.toLowerCase().replace(/[\s_-]+/g, "");
  return key.includes("reportreviewer") || key.includes("proposerreviewer") || /报告审稿/.test(`${toolName ?? ""}`);
}

/** UI copy for second-pass counter-evidence search hint */
const SECOND_PASS_COUNTER_SEARCH_TITLE = "建议二次反证检索";

function textHasSecondPassHint(...parts: Array<string | undefined | null>): boolean {
  return parts.some((p) => typeof p === "string" && p.includes("二次反证"));
}

function isSecondPassCounterSearch(
  event: Pick<OrchestrateStreamEvent, "toolId" | "toolName" | "query" | "result" | "message" | "relay">
): boolean {
  const key = `${event.toolId ?? ""} ${event.toolName ?? ""} ${event.query ?? ""}`
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (key.includes("secondpasscountersearch")) return true;
  if (event.result?.shouldSecondPassCounterSearch === true) return true;
  if (textHasSecondPassHint(event.message, event.toolName, event.toolId, event.query)) return true;
  if (
    textHasSecondPassHint(
      event.relay?.title,
      event.relay?.trigger,
      event.relay?.savedReason,
      event.relay?.id
    )
  ) {
    return true;
  }
  const hint = event.result?.hint;
  if (typeof hint === "string" && hint.includes("二次反证")) return true;
  return false;
}

function humanRelayTitle(relay?: OrchestrateStreamEvent["relay"]): string {
  if (!relay) return "路径调整";
  if (
    isSecondPassCounterSearch({
      relay,
      toolId: relay.id,
      toolName: relay.title,
      message: relay.trigger || relay.savedReason,
    })
  ) {
    return SECOND_PASS_COUNTER_SEARCH_TITLE;
  }
  return (relay.title && relay.title.trim()) || "路径调整";
}

function mapStatus(
  kind: "running" | "done" | "fail" | "pending"
): ShellNodeStatus {
  if (kind === "running") return "loading";
  if (kind === "fail") return "error";
  if (kind === "done") return "success";
  return "pending";
}

function humanToolTitle(toolId?: string, toolName?: string, event?: OrchestrateStreamEvent): string {
  if (event && isSecondPassCounterSearch(event)) return SECOND_PASS_COUNTER_SEARCH_TITLE;
  if (isSecondPassCounterSearch({ toolId, toolName })) return SECOND_PASS_COUNTER_SEARCH_TITLE;
  if (isReviewer(toolId, toolName)) return "报告审稿";
  if (event && isPursuit(event)) return "追索证据";
  if (isEvidencePursuitTool({ toolId, toolName })) return "追索证据";
  const key = `${toolId ?? ""} ${toolName ?? ""}`.toLowerCase().replace(/[\s_-]+/g, "");
  if (key.includes("memorysearch")) return "查阅历史案件";
  if (key.includes("memorywrite")) return "归档案件记忆";
  if (key.includes("vision") || key.includes("stepfun")) return "解析图片材料";
  if (key.includes("todowrite") || key.includes("addtask") || key.includes("updatetask")) return "任务板";
  if (/fetch|visit|打开页面/.test(key)) return "打开页面";
  if (/search|360|anysearch|metaso|tavily|exa|parallel/.test(key)) return "检索公开材料";
  return (toolName || toolId || "核查工具").trim();
}

function phaseFromEvents(events: OrchestrateStreamEvent[]): string {
  // Terminal stream error wins over last non-error phase (e.g. tool_error mid-run).
  const hasStreamError = events.some((e) => e.type === "error");
  if (hasStreamError) return "过程中断";

  const last = [...events].reverse().find((e) => e.type !== "error");
  if (!last) return "等待开始";
  switch (last.type) {
    case "planner_update":
      return "理解命题";
    case "tool_start":
    case "tool_result":
    case "tool_error":
      if (isReviewer(last.toolId, last.toolName)) return "报告审稿";
      if (isPursuit(last)) return "追索证据";
      if (last.type === "tool_error") return "工具异常";
      return "对照材料";
    case "agent_start":
    case "agent_complete":
    case "agent_error":
      if (last.type === "agent_error") return "角色异常";
      if (last.agent === "report_composer") return "整理结论";
      if (last.agent === "rumor_detector") return "理解命题";
      return "对照材料";
    case "complete":
      return "结论已出";
    case "consensus_debate_round":
    case "consensus_debate_final":
      return "冲突调解";
    case "speculative_update":
      return "路径调整";
    default:
      return "核查进行中";
  }
}

function toolDetailFromEvent(event: OrchestrateStreamEvent): string | undefined {
  if (event.type === "tool_error") {
    return event.message || event.error || "工具调用失败";
  }
  if (isPursuit(event)) {
    const result = event.result ?? {};
    const missingAfter = Array.isArray(result.missingAfter)
      ? result.missingAfter.filter((x): x is string => typeof x === "string")
      : Array.isArray(result.missingEvidence)
        ? result.missingEvidence.filter((x): x is string => typeof x === "string")
        : [];
    return formatPursuitDetail({
      goal: typeof result.goal === "string" ? result.goal : undefined,
      query: event.query,
      resultKind: typeof result.resultKind === "string" ? result.resultKind : undefined,
      missingAfter,
      reasonText: typeof result.reasonText === "string" ? result.reasonText : undefined,
    });
  }
  if (isReviewer(event.toolId, event.toolName) && event.result) {
    const passed = event.result.passed === true;
    const score = typeof event.result.score === "number" ? event.result.score : null;
    const issues = Array.isArray(event.result.issues) ? event.result.issues : [];
    const head = passed
      ? `审稿通过${score !== null ? ` · ${score}` : ""}`
      : `需补证${score !== null ? ` · ${score}` : ""}`;
    const msgs = issues
      .slice(0, 3)
      .map((i) => (i && typeof i === "object" && "message" in i ? String((i as { message: unknown }).message) : ""))
      .filter(Boolean);
    return msgs.length ? `${head}。${msgs.join("；")}` : head;
  }
  if (event.result) {
    const hit = event.result.hitCount;
    if (typeof hit === "number") return `命中历史 ${hit} 条`;
    const sources = event.result.sources;
    if (Array.isArray(sources)) return `返回来源 ${sources.length} 条`;
    const sourceCount = event.result.sourceCount;
    if (typeof sourceCount === "number") return `返回来源 ${sourceCount} 条`;
  }
  if (event.query) return event.query.length > 48 ? `${event.query.slice(0, 48)}…` : event.query;
  return undefined;
}

/** Search / Visit / Task board close the current thinking span (Apodex process). */
function isProcessBoundaryTool(event: OrchestrateStreamEvent): boolean {
  if (isReviewer(event.toolId, event.toolName)) return false;
  if (isSecondPassCounterSearch(event)) return false;
  if (isPursuit(event)) return false;
  const compact = `${event.toolId ?? ""} ${event.toolName ?? ""}`.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact.includes("memorysearch") || compact.includes("memorywrite")) return false;
  if (compact.includes("vision") || compact.includes("stepfun")) return false;
  if (compact.includes("submitverdict")) return false;
  if (compact.includes("todowrite") || compact.includes("addtask") || compact.includes("updatetask")) return true;
  if (/fetch|visit|打开页面/.test(compact)) return true;
  if (/search|360|anysearch|metaso|tavily|exa|parallel/.test(compact)) return true;
  return false;
}

function agentThoughtKey(id: string, span: number): string {
  return span === 0 ? `agent:${id}` : `agent:${id}:${span}`;
}

function joinedToolQuery(prev?: string, next?: string): string | undefined {
  const a = (prev ?? "").trim();
  const b = (next ?? "").trim();
  if (!b) return a || undefined;
  if (!a || a === b || a.includes(b)) return a || b;
  if (b.includes(a)) return b;
  return `${a} · ${b}`;
}

/**
 * Reduce a full or partial SSE event list into shell model.
 * Later events overwrite earlier keys (agent/tool identity collapse).
 * Live default: narrative token shell. Opt out `?shell=legacy`. antdx: `?shell=antdx`.
 */

function extractKeyFindings(report?: Record<string, unknown> | null): string[] {
  if (!report) return [];
  const out: string[] = [];
  const push = (s?: string) => {
    const t = (s ?? "").trim();
    if (t && !out.includes(t) && out.length < 5) out.push(t);
  };
  if (Array.isArray(report.keyFindings)) {
    for (const item of report.keyFindings) {
      if (typeof item === "string") push(item);
      else if (item && typeof item === "object" && typeof (item as { text?: string }).text === "string") {
        push((item as { text: string }).text);
      }
    }
  }
  if (Array.isArray(report.evidenceChain)) {
    for (const row of report.evidenceChain.slice(0, 4)) {
      if (row && typeof row === "object") {
        const finding = (row as { finding?: unknown }).finding;
        if (typeof finding === "string") push(finding);
      }
    }
  }
  return out;
}

function extractTopSources(report?: Record<string, unknown> | null): ShellVerdictSource[] {
  if (!report) return [];
  const out: ShellVerdictSource[] = [];
  const seen = new Set<string>();
  const push = (title?: string, url?: string) => {
    const t = (title ?? url ?? "").trim();
    if (!t) return;
    const key = (url || t).toLowerCase();
    if (seen.has(key) || out.length >= 3) return;
    seen.add(key);
    out.push({ title: t.slice(0, 120), url: url?.trim() || undefined });
  };
  if (Array.isArray(report.citationSources)) {
    for (const src of report.citationSources) {
      if (typeof src === "string") push(src, src.startsWith("http") ? src : undefined);
      else if (src && typeof src === "object") {
        const o = src as { title?: string; url?: string; name?: string };
        push(o.title || o.name || o.url, o.url);
      }
    }
  }
  if (Array.isArray(report.evidenceChain)) {
    for (const row of report.evidenceChain) {
      if (!row || typeof row !== "object") continue;
      const refs = (row as { sourceRefs?: unknown }).sourceRefs;
      if (!Array.isArray(refs)) continue;
      for (const ref of refs) {
        if (typeof ref === "string") push(ref, ref.startsWith("http") ? ref : undefined);
        else if (ref && typeof ref === "object") {
          const o = ref as { title?: string; url?: string; name?: string; href?: string };
          push(o.title || o.name || o.url || o.href, o.url || o.href);
        }
      }
    }
  }
  if (Array.isArray(report.sources)) {
    for (const src of report.sources) {
      if (typeof src === "string") push(src, src.startsWith("http") ? src : undefined);
      else if (src && typeof src === "object") {
        const o = src as { title?: string; url?: string; name?: string };
        push(o.title || o.name || o.url, o.url);
      }
    }
  }
  return out;
}

function buildVerdictFromComplete(event: OrchestrateStreamEvent): ShellVerdictCard {
  const report = (event.finalReport ?? {}) as Record<string, unknown>;
  const interrupted = report._source === "error-boundary";
  const verdictType = asString(report.verdictType);
  const conclusion = asString(report.conclusion);
  const recommendation = asString(report.recommendation);
  return {
    present: true,
    interrupted,
    verdictType,
    conclusion,
    credibilityScore:
      typeof report.credibilityScore === "number" ? report.credibilityScore : undefined,
    shareAdvice: interrupted ? undefined : shareAdviceFromVerdict(recommendation, verdictType),
    keyFindings: interrupted ? [] : extractKeyFindings(report),
    topSources: extractTopSources(report),
    reviewPassed: event.reportReview?.passed,
    reviewScore: event.reportReview?.score,
    reviewIssues: event.reportReview?.issues,
  };
}

export function adaptOrchestrateStreamToShell(
  events: OrchestrateStreamEvent[],
  opts?: { claim?: string }
): MissionShellModel {
  const claim =
    opts?.claim ||
    [...events].reverse().find((e) => typeof e.claim === "string" && e.claim)?.claim ||
    "";

  const thoughtByKey = new Map<string, ShellThoughtItem>();
  const toolByKey = new Map<string, ShellToolItem>();
  const agentById = new Map<string, ShellAgentChip>();
  let live = true;
  let errorMessage: string | undefined;
  let understanding: ShellUnderstanding | undefined;
  let claimType: string | undefined;
  let verdict: ShellVerdictCard = { present: false };

  const orderThought: string[] = [];
  const orderTool: string[] = [];
  const orderAgent: string[] = [];
  const thoughtSpanByAgent = new Map<string, number>();

  const currentAgentThoughtKey = (id: string) =>
    agentThoughtKey(id, thoughtSpanByAgent.get(id) ?? 0);

  const closeThoughtSpan = (id: string, ts?: number) => {
    const key = currentAgentThoughtKey(id);
    const existing = thoughtByKey.get(key);
    if (existing?.kind === "agent" && existing.status === "loading") {
      const elapsed =
        existing.reasoningStartedAt != null && ts != null
          ? Math.max(0, ts - existing.reasoningStartedAt)
          : existing.reasoningElapsedMs;
      thoughtByKey.set(key, {
        ...existing,
        status: "success",
        reasoningElapsedMs: elapsed,
      });
    }
    thoughtSpanByAgent.set(id, (thoughtSpanByAgent.get(id) ?? 0) + 1);
  };

  const closeSpansForVisibleTool = (event: OrchestrateStreamEvent) => {
    if (!isProcessBoundaryTool(event)) return;
    if (event.agent) {
      closeThoughtSpan(event.agent, event.timestamp);
      return;
    }
    const ids = new Set<string>();
    for (const item of thoughtByKey.values()) {
      if (item.kind === "agent" && item.status === "loading" && item.agentId) {
        ids.add(item.agentId);
      }
    }
    for (const id of ids) closeThoughtSpan(id, event.timestamp);
  };

  const touchThought = (key: string, item: ShellThoughtItem) => {
    if (!thoughtByKey.has(key)) orderThought.push(key);
    thoughtByKey.set(key, { ...thoughtByKey.get(key), ...item, key });
  };
  const touchTool = (key: string, item: ShellToolItem) => {
    if (!toolByKey.has(key)) orderTool.push(key);
    toolByKey.set(key, { ...toolByKey.get(key), ...item, key });
  };
  const touchAgent = (id: string, chip: ShellAgentChip) => {
    if (!agentById.has(id)) orderAgent.push(id);
    agentById.set(id, { ...agentById.get(id), ...chip, agentId: id });
  };

  for (const event of events) {
    const ts = event.timestamp;

    switch (event.type) {
      case "planner_update": {
        if (typeof event.plan?.claimType === "string" && event.plan.claimType.trim()) {
          claimType = event.plan.claimType.trim();
        }
        const typeZh = humanizeClaimType(claimType);
        const rationale = humanizeProcessSummary(event.plan?.rationale);
        touchThought("planner", {
          key: "planner",
          title: humanizeProcessTitle("理解命题与路径"),
          description: rationale || (typeZh ? `这是${typeZh}。` : undefined),
          status: mapStatus("done"),
          kind: "planner",
          timestamp: ts,
          detail: event.plan ? { plan: event.plan } : undefined,
        });
        break;
      }
      case "speculative_update": {
        const id = event.relay?.id || `relay-${orderThought.length}`;
        touchThought(id, {
          key: id,
          title: humanizeProcessTitle(humanRelayTitle(event.relay)),
          description: humanizeProcessSummary(event.relay?.trigger || event.relay?.savedReason),
          status: mapStatus(event.relay?.status === "running" ? "running" : "done"),
          kind: "relay",
          timestamp: ts,
          detail: event.relay ? { relay: event.relay } : undefined,
        });
        break;
      }
      case "consensus_debate_round":
      case "consensus_debate_final": {
        const id = event.debate?.id || "debate";
        const running = event.type === "consensus_debate_round" || event.debate?.status === "running";
        touchThought(id, {
          key: id,
          title: event.debate?.title || "冲突调解",
          description: event.debate?.finalConsensus || debateRoundHint(event),
          status: mapStatus(running ? "running" : "done"),
          kind: "debate",
          timestamp: ts,
          detail: event.debate ? { debate: event.debate } : undefined,
        });
        break;
      }
      case "agent_start": {
        const id = event.agent || "agent";
        if (!thoughtSpanByAgent.has(id)) thoughtSpanByAgent.set(id, 0);
        const key = currentAgentThoughtKey(id);
        const startedAt = ts ?? Date.now();
        touchThought(key, {
          key,
          title: agentLabel(id, event.agentName),
          description: "进行中",
          status: mapStatus("running"),
          kind: "agent",
          agentId: id,
          timestamp: ts,
          // Wall-clock from agent_start — "Thought for Ns" must match model work, not SSE pacing.
          reasoningStartedAt: startedAt,
        });
        touchAgent(id, {
          agentId: id,
          name: agentLabel(id, event.agentName),
          status: mapStatus("running"),
          icon: event.agentIcon,
        });
        break;
      }
      case "agent_complete": {
        const id = event.agent || "agent";
        const latency =
          typeof event.latencyMs === "number" && Number.isFinite(event.latencyMs)
            ? Math.max(0, event.latencyMs)
            : undefined;
        const existingSpans = [...thoughtByKey.entries()].filter(
          ([, item]) => item.kind === "agent" && item.agentId === id
        );
        const spanEntries: Array<[string, ShellThoughtItem | undefined]> =
          existingSpans.length > 0 ? existingSpans : [[`agent:${id}`, thoughtByKey.get(`agent:${id}`)]];
        for (const [key, existing] of spanEntries) {
          const startedAt = existing?.reasoningStartedAt;
          const elapsedFromStart =
            startedAt != null && ts != null ? Math.max(0, ts - startedAt) : existing?.reasoningElapsedMs;
          const isPrimary = key === `agent:${id}`;
          const alreadyClosed = existing?.status === "success" || existing?.status === "error";
          touchThought(key, {
            key,
            title: agentLabel(id, event.agentName),
            description: isPrimary
              ? summarizeAgentOutput(event.output) ?? existing?.description
              : existing?.description,
            status: mapStatus("done"),
            kind: "agent",
            agentId: id,
            timestamp: ts,
            detail: isPrimary && event.output ? { output: event.output } : existing?.detail,
            reasoningStartedAt: startedAt,
            reasoningElapsedMs: alreadyClosed
              ? existing?.reasoningElapsedMs
              : isPrimary
                ? latency ?? elapsedFromStart ?? existing?.reasoningElapsedMs
                : elapsedFromStart ?? existing?.reasoningElapsedMs,
          });
        }
        touchAgent(id, {
          agentId: id,
          name: agentLabel(id, event.agentName),
          status: mapStatus("done"),
          icon: event.agentIcon,
          summary: summarizeAgentOutput(event.output),
        });
        // 一级可见：系统如何理解原句。rumor_detector 拆出的原子命题升至理解卡。
        if (id === "rumor_detector" && event.output) {
          const atoms = extractClaimAtoms(event.output);
          if (atoms.length > 0) {
            understanding = { claim, atoms };
          }
        }
        break;
      }
      case "agent_thought": {
        const id = event.agent || "agent";
        const key = currentAgentThoughtKey(id);
        const content = (event.content ?? "").trim();
        if (!content) break;
        const tsNow = event.timestamp ?? Date.now();
        const existing = thoughtByKey.get(key);
        const prevReasoning = existing?.reasoning ?? [];
        const seq = typeof event.seq === "number" ? event.seq : prevReasoning.length;
        let reasoning: string[];
        if (event.partial) {
          if (seq === prevReasoning.length) reasoning = [...prevReasoning, content];
          else if (seq === prevReasoning.length - 1) reasoning = [...prevReasoning.slice(0, seq), content];
          else break;
        } else {
          // 防重：seq 已存在（或乱序回退）时不重复追加
          if (typeof event.seq === "number" && event.seq < prevReasoning.length) break;
          reasoning = [...prevReasoning, content];
        }
        // Prefer agent_start timestamp so elapsed tracks real model work.
        const startedAt = existing?.reasoningStartedAt ?? tsNow;
        touchThought(key, {
          key,
          title: agentLabel(id, event.agentName),
          description: existing?.description || "进行中",
          status: "loading",
          kind: "agent",
          agentId: id,
          timestamp: tsNow,
          reasoning,
          reasoningStartedAt: startedAt,
          reasoningElapsedMs: Math.max(0, tsNow - startedAt),
        });
        touchAgent(id, {
          agentId: id,
          name: agentLabel(id, event.agentName),
          status: "loading",
          icon: event.agentIcon,
        });
        break;
      }
      case "agent_error": {
        const id = event.agent || "agent";
        const recoverable = event.recoverable === true;
        const msg = recoverable
          ? "这一步没能写成判断，会用已检索到的材料继续。"
          : event.message || event.error || "调用失败";
        const existingSpans = [...thoughtByKey.entries()].filter(
          ([, item]) => item.kind === "agent" && item.agentId === id
        );
        const keys = existingSpans.length > 0 ? existingSpans.map(([k]) => k) : [`agent:${id}`];
        for (const key of keys) {
          const existing = thoughtByKey.get(key);
          if (existing && existing.status !== "loading" && key !== `agent:${id}`) continue;
          touchThought(key, {
            key,
            title: agentLabel(id, event.agentName),
            description: msg,
            status: recoverable ? mapStatus("done") : mapStatus("fail"),
            kind: "agent",
            agentId: id,
            timestamp: ts,
          });
        }
        touchAgent(id, {
          agentId: id,
          name: agentLabel(id, event.agentName),
          status: recoverable ? mapStatus("done") : mapStatus("fail"),
          summary: msg,
        });
        break;
      }
      case "tool_start": {
        closeSpansForVisibleTool(event);
        const key = toolKey(event);
        const title = humanToolTitle(event.toolId, event.toolName, event);
        const prev = toolByKey.get(key);
        const query =
          key === "tool:web_search" ? joinedToolQuery(prev?.query, event.query) : event.query;
        const patched = query === event.query ? event : { ...event, query };
        const detail = toolDetailFromEvent(patched);
        touchTool(key, {
          key,
          toolId: event.toolId,
          toolName: event.toolName || title,
          title,
          detail,
          status: mapStatus("running"),
          query,
          timestamp: ts,
        });
        touchThought(key, {
          key,
          title,
          description: detail,
          status: mapStatus("running"),
          kind: isReviewer(event.toolId, event.toolName) ? "review" : "tool",
          toolId: event.toolId,
          timestamp: ts,
        });
        break;
      }
      case "tool_result": {
        const key = toolKey(event);
        const title = humanToolTitle(event.toolId, event.toolName, event);
        const prev = toolByKey.get(key);
        const query =
          key === "tool:web_search" ? joinedToolQuery(prev?.query, event.query) : event.query;
        const patched = query === event.query ? event : { ...event, query };
        const detail = toolDetailFromEvent(patched);
        touchTool(key, {
          key,
          toolId: event.toolId,
          toolName: event.toolName || title,
          title,
          detail,
          status: mapStatus("done"),
          query,
          result: event.result,
          timestamp: ts,
        });
        touchThought(key, {
          key,
          title,
          description: detail,
          status: mapStatus("done"),
          kind: isReviewer(event.toolId, event.toolName) ? "review" : "tool",
          toolId: event.toolId,
          timestamp: ts,
          detail: event.result ? { result: event.result } : undefined,
        });
        break;
      }
      case "tool_error": {
        const key = toolKey(event);
        const title = humanToolTitle(event.toolId, event.toolName, event);
        const detail = toolDetailFromEvent(event);
        touchTool(key, {
          key,
          toolId: event.toolId,
          toolName: event.toolName || title,
          title,
          detail,
          status: mapStatus("fail"),
          query: event.query,
          timestamp: ts,
        });
        touchThought(key, {
          key,
          title,
          description: detail,
          status: mapStatus("fail"),
          kind: isReviewer(event.toolId, event.toolName) ? "review" : "tool",
          toolId: event.toolId,
          timestamp: ts,
        });
        break;
      }
      case "complete": {
        live = false;
        verdict = buildVerdictFromComplete(event);
        touchThought("report:final", {
          key: "report:final",
          title: "结论与证据边界",
          description: verdict.conclusion || "报告已生成",
          status: mapStatus("done"),
          kind: "report",
          timestamp: ts,
          detail: {
            finalReport: event.finalReport,
            reportReview: event.reportReview,
          },
        });
        break;
      }
      case "error": {
        live = false;
        errorMessage = event.message || event.error || "核查失败";
        touchThought("error", {
          key: "error",
          title: "核查中断",
          description: errorMessage,
          status: mapStatus("fail"),
          kind: "report",
          timestamp: ts,
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    claim,
    phaseLabel: phaseFromEvents(events),
    claimType,
    thoughtItems: orderThought.map((k) => thoughtByKey.get(k)!).filter(Boolean),
    tools: orderTool.map((k) => toolByKey.get(k)!).filter(Boolean),
    agents: orderAgent.map((k) => agentById.get(k)!).filter(Boolean),
    understanding,
    verdict,
    live,
    errorMessage,
  };
}

function toolKey(event: OrchestrateStreamEvent): string {
  if (isReviewer(event.toolId, event.toolName)) return "tool:report_reviewer";
  if (isSecondPassCounterSearch(event)) return "tool:second_pass_counter_search";
  if (isPursuit(event)) {
    const reason = typeof event.result?.reason === "string" ? event.result.reason : "";
    if (reason) return `tool:evidence_pursuit:stop:${reason}`;
    const round = typeof event.result?.round === "number" ? event.result.round : "x";
    const q = (event.query ?? "").slice(0, 48);
    return `tool:evidence_pursuit:${round}:${q}`;
  }
  const id = event.toolId || event.toolName || "tool";
  // Collapse memory/search families to one live row
  const compact = id.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact.includes("memorysearch")) return "tool:memory_search";
  if (compact.includes("memorywrite")) return "tool:memory_write";
  if (compact.includes("todowrite") || compact.includes("addtask") || compact.includes("updatetask")) {
    return "tool:todo_write";
  }
  if (/fetch|visit|打开页面/.test(compact)) {
    const url =
      (typeof event.result?.url === "string" && event.result.url) ||
      (typeof event.query === "string" && /^https?:\/\//i.test(event.query) ? event.query : "");
    return url ? `tool:web_fetch:${url}` : "tool:web_fetch";
  }
  if (/search|360|anysearch|metaso|tavily|exa|parallel/.test(compact)) return "tool:web_search";
  if (compact.includes("vision") || compact.includes("stepfun")) return "tool:vision";
  return `tool:${id}`;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * 从 rumor_detector 的 output 提取「系统如何理解原句」的原子命题清单。
 * 优先用 claimAtomTypes（带可核查性与类型），缺失时退回 claimAtoms 字符串。
 */
function extractClaimAtoms(output: Record<string, unknown>): ShellUnderstanding["atoms"] {
  const types = Array.isArray(output.claimAtomTypes)
    ? (output.claimAtomTypes as Array<{
        text?: unknown;
        verifiable?: unknown;
        type?: unknown;
      }>)
    : [];
  const hasTypes =
    types.length > 0 &&
    types.some((t) => typeof t?.text === "string" && t.text.trim());

  if (hasTypes) {
    return types
      .filter((t) => typeof t?.text === "string" && t.text.trim())
      .map((t) => ({
        text: String(t.text).trim(),
        verifiable: t.verifiable === true,
        type: typeof t.type === "string" ? t.type : "fact",
      }));
  }

  const atoms = (Array.isArray(output.claimAtoms) ? output.claimAtoms : []) as unknown[];
  return atoms
    .filter((a): a is string => typeof a === "string" && Boolean(a.trim()))
    .map((a) => ({
      text: a.trim(),
      verifiable: true,
      type: "fact",
    }));
}

function summarizeAgentOutput(output?: Record<string, unknown>): string | undefined {
  if (!output) return undefined;
  if (typeof output.analysis === "string") return output.analysis.slice(0, 120);
  if (typeof output.conclusion === "string") return output.conclusion.slice(0, 120);
  if (typeof output.factCheckResult === "string") {
    return `事实判定：${humanizeFactCheckResult(output.factCheckResult)}`;
  }
  if (typeof output.sourceReliability === "string") {
    return `信源：${humanizeConfidenceLevel(output.sourceReliability)}`;
  }
  if (Array.isArray(output.claimAtoms)) return `原子命题 ${output.claimAtoms.length} 条`;
  return undefined;
}

function debateRoundHint(event: OrchestrateStreamEvent): string | undefined {
  const rounds = event.debate?.rounds;
  if (Array.isArray(rounds) && rounds.length > 0) return `第 ${rounds.length} 轮对证据`;
  return undefined;
}
