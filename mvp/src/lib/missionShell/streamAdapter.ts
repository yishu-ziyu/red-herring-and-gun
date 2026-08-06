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
} from "./labels";
import type {
  MissionShellModel,
  ShellAgentChip,
  ShellNodeStatus,
  ShellThoughtItem,
  ShellToolItem,
  ShellVerdictCard,
} from "./types";
import { humanizeProcessSummary, humanizeProcessTitle } from "./visibleProcessRows";

const AGENT_LABEL: Record<string, string> = {
  rumor_detector: "立案分诊",
  fact_checker: "事实核查",
  source_validator: "信源审计",
  report_composer: "报告收束",
  alternative_explanation_searcher: "替代解释",
  counter_evidence_grader: "反证评分",
};

function agentLabel(id?: string, name?: string): string {
  if (id && AGENT_LABEL[id]) return AGENT_LABEL[id];
  if (name && name.trim()) return name.trim();
  return id || "核查角色";
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
  const key = `${toolId ?? ""} ${toolName ?? ""}`.toLowerCase().replace(/[\s_-]+/g, "");
  if (key.includes("memorysearch")) return "查阅历史案件";
  if (key.includes("memorywrite")) return "归档案件记忆";
  if (key.includes("vision") || key.includes("stepfun")) return "解析图片材料";
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

/**
 * Reduce a full or partial SSE event list into shell model.
 * Later events overwrite earlier keys (agent/tool identity collapse).
 * Trial entry: `?shell=1` (token shell) / `?shell=antdx` (Ant Design X ThoughtChain).
 */
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
  let verdict: ShellVerdictCard = { present: false };

  const orderThought: string[] = [];
  const orderTool: string[] = [];
  const orderAgent: string[] = [];

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
        touchThought("planner", {
          key: "planner",
          title: humanizeProcessTitle("理解命题与路径"),
          description:
            humanizeProcessSummary(
              event.plan?.rationale ||
                humanizeClaimType(event.plan?.claimType) ||
                "规划核查路径"
            ) || "规划核查路径",
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
        touchThought(`agent:${id}`, {
          key: `agent:${id}`,
          title: agentLabel(id, event.agentName),
          description: "进行中",
          status: mapStatus("running"),
          kind: "agent",
          agentId: id,
          timestamp: ts,
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
        touchThought(`agent:${id}`, {
          key: `agent:${id}`,
          title: agentLabel(id, event.agentName),
          description: summarizeAgentOutput(event.output),
          status: mapStatus("done"),
          kind: "agent",
          agentId: id,
          timestamp: ts,
          detail: event.output ? { output: event.output } : undefined,
        });
        touchAgent(id, {
          agentId: id,
          name: agentLabel(id, event.agentName),
          status: mapStatus("done"),
          icon: event.agentIcon,
          summary: summarizeAgentOutput(event.output),
        });
        break;
      }
      case "agent_error": {
        const id = event.agent || "agent";
        const msg = event.message || event.error || "调用失败";
        touchThought(`agent:${id}`, {
          key: `agent:${id}`,
          title: agentLabel(id, event.agentName),
          description: msg,
          status: mapStatus("fail"),
          kind: "agent",
          agentId: id,
          timestamp: ts,
        });
        touchAgent(id, {
          agentId: id,
          name: agentLabel(id, event.agentName),
          status: mapStatus("fail"),
          summary: msg,
        });
        break;
      }
      case "tool_start": {
        const key = toolKey(event);
        const title = humanToolTitle(event.toolId, event.toolName, event);
        touchTool(key, {
          key,
          toolId: event.toolId,
          toolName: event.toolName || title,
          title,
          detail: toolDetailFromEvent(event),
          status: mapStatus("running"),
          query: event.query,
          timestamp: ts,
        });
        touchThought(key, {
          key,
          title,
          description: toolDetailFromEvent(event),
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
        const detail = toolDetailFromEvent(event);
        touchTool(key, {
          key,
          toolId: event.toolId,
          toolName: event.toolName || title,
          title,
          detail,
          status: mapStatus("done"),
          query: event.query,
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
        verdict = {
          present: true,
          verdictType: asString(event.finalReport?.verdictType),
          conclusion: asString(event.finalReport?.conclusion),
          credibilityScore:
            typeof event.finalReport?.credibilityScore === "number"
              ? event.finalReport.credibilityScore
              : undefined,
          reviewPassed: event.reportReview?.passed,
          reviewScore: event.reportReview?.score,
          reviewIssues: event.reportReview?.issues,
        };
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
    thoughtItems: orderThought.map((k) => thoughtByKey.get(k)!).filter(Boolean),
    tools: orderTool.map((k) => toolByKey.get(k)!).filter(Boolean),
    agents: orderAgent.map((k) => agentById.get(k)!).filter(Boolean),
    verdict,
    live,
    errorMessage,
  };
}

function toolKey(event: OrchestrateStreamEvent): string {
  if (isReviewer(event.toolId, event.toolName)) return "tool:report_reviewer";
  if (isSecondPassCounterSearch(event)) return "tool:second_pass_counter_search";
  const id = event.toolId || event.toolName || "tool";
  // Collapse memory/search families to one live row
  const compact = id.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact.includes("memorysearch")) return "tool:memory_search";
  if (compact.includes("memorywrite")) return "tool:memory_write";
  if (/search|360|anysearch|metaso|tavily|exa|parallel/.test(compact)) return "tool:web_search";
  if (compact.includes("vision") || compact.includes("stepfun")) return "tool:vision";
  return `tool:${id}`;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
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
  if (Array.isArray(rounds) && rounds.length > 0) return `第 ${rounds.length} 轮质询`;
  return undefined;
}
