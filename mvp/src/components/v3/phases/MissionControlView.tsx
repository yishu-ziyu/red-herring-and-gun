import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  requestOrchestrateStream,
  type HandoffStep,
  type OrchestrateStreamEvent,
} from "../../../lib/agentExpansion";
import { adaptOrchestrateStreamToShell } from "../../../lib/missionShell";
import { formatPursuitDetail } from "../../../lib/evidencePursuitUi";
import { ApodexRunView } from "./mission/ApodexRunView";
import { ReportFooter } from "../ReportFooter";
import { isChecksExhaustedMessage } from "../../../lib/checkQuota";
import { mapShellToApodexRun, type ApodexRunModel } from "./mission/apodexRunMap";
import { composeFollowUpClaim, previousAnswerText } from "../../../lib/composeFollowUpClaim";
import type { ModelChoiceMap } from "../../../lib/agentExpansion";
import { calculateClaimSimilarity, createKnowledgeBase, type KnowledgeBase } from "../../../lib/knowledgeBase";
import { semanticClaimSimilarity } from "../../../lib/semanticRecall";
import type {
  ClaimDiagnosis,
  KnowledgeBaseEntry,
  VerificationResult,
} from "../../../lib/schemas";
import { useReasoning } from "../../../store/reasoningStore";
import type { ChunkType, StreamingChunk, StreamingReasoningSession } from "../../../lib/streamingTypes";
import type { CaseIntake } from "../../../lib/caseIntake";
import { getAgentRegistry } from "../../../lib/agentConfigs";

interface MissionControlViewProps {
  claim: string;
  intake?: CaseIntake | null;
  onCancel: () => void;
  /** 同一条材料再跑一遍（保留父层接口兼容；当前运行壳由 onStop 负责返回输入态）。 */
  onRetry?: () => void;
  /** 4-Agent 模型选择（home 透传）。undefined 表示走默认 fallback chain。 */
  modelChoice?: ModelChoiceMap;
  /** 最终报告就绪时回调；父层可切 ResultView。有回调时本视图保持极简，不自渲染完整报告页。 */
  onComplete?: (finalReport: Record<string, unknown>) => void;
  /** 打开已保存的判断，跳过流水线。 */
  initialFinalReport?: Record<string, unknown> | null;
}

type RunStatus = "idle" | "running" | "completed" | "failed";
type StreamItemStatus = "queued" | "running" | "completed" | "failed" | "final";

interface LocalMemoryRecall extends Record<string, unknown> {
  hitCount: number;
  acceptedCandidateCount: number;
  evidenceCount: number;
  hits: Array<{
    id: string;
    claim: string;
    score: number;
    verdict?: string;
    tags: string[];
    sourceUrls: string[];
  }>;
  acceptedCandidates: Array<{
    id: string;
    kind: string;
    title: string;
    summary: string;
    confidence: number;
    matchedTerms: string[];
  }>;
  sources: Array<{
    id: string;
    title: string;
    url?: string;
    domain?: string;
    snippet: string;
    sourceType: string;
    evidenceRole: string;
  }>;
  relatedQuestions: string[];
  traceText: string;
}

// 公开界面只说明结果与下一步，不把 provider、额度、密钥或本机命令交给用户处理。
export const ERROR_FRIENDLY_MESSAGE = "这次核查没能完成，请稍后重试。";

export interface ErrorEventLike {
  error?: string;
  message?: string;
  code?: string;
  detail?: string;
  providerErrors?: string[];
}

export function errorTechDetail(_event: ErrorEventLike): string {
  return "";
}

// 收敛任意 error 事件为公开文案；诊断不进入浏览器展示层。
export function resolveErrorPresentation(event: ErrorEventLike): {
  message: string;
  techDetail: string;
} {
  const copy = event.message ?? "";
  if (event.code === "checks_exhausted" && isChecksExhaustedMessage(copy)) {
    return { message: copy, techDetail: "" };
  }
  return { message: ERROR_FRIENDLY_MESSAGE, techDetail: errorTechDetail(event) };
}

const RUNTIME_STREAM_STAGES = [
  {
    id: "rumor_detector",
    name: "rumor_detector",
    nameZh: "拆题",
    description: "拆解原始说法，识别谣言类型和后续证据需求。",
    agentName: "拆题",
    agentIcon: "🚨",
  },
  {
    id: "fact_checker",
    name: "fact_checker",
    nameZh: "事实交叉核查",
    description: "结合多搜索引擎线索，比较支持与反驳证据。",
    agentName: "事实核查",
    agentIcon: "🔎",
  },
  {
    id: "source_validator",
    name: "source_validator",
    nameZh: "信源与溯源",
    description: "审计来源层级、转载链和未解决证据缺口。",
    agentName: "溯源",
    agentIcon: "📚",
  },
  {
    id: "report_composer",
    name: "report_composer",
    nameZh: "写结论",
    description: "根据证据边界写出能信还是不能信。",
    agentName: "写结论",
    agentIcon: "📝",
  },
];




const PUBLIC_REPORT_FALLBACK_REASON = "最终写作服务暂时不可用，系统已改用保守兜底报告。";
const INFRASTRUCTURE_ERROR_PATTERNS = [
  /ReportComposer/i,
  /providers? failed/i,
  /API error/i,
  /quota\s+(?:exceeded|limit|exhausted)|(?:exceeded|insufficient)\s+quota/i,
  /credits?\s+(?:limit|exhausted|exceeded)|insufficient\s+credits?/i,
  /timeout|time out/i,
  /Error:|Exception/i,
  /\b(?:4\d\d|5\d\d)\b.*https?:\/\/\S+\/(?:v\d+|api)\b/i,
  /https?:\/\/\S+\/(?:v\d+|api)\b.*\b(?:4\d\d|5\d\d)\b/i,
  /调用失败|调用异常|超时/i,
  /invalid api key/i,
  /insufficient balance/i,
];

function sanitizePublicReportText(value: string) {
  const text = value.trim();
  if (!text) return "";
  return INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(text)) ? PUBLIC_REPORT_FALLBACK_REASON : text;
}

function sanitizePublicReportArray(values: string[]) {
  return values.map((value) => sanitizePublicReportText(value));
}

function normalizeAgent(agent?: string | null) {
  return (agent ?? "").trim().toLowerCase();
}

function displayAgentName(agent?: string | null) {
  const raw = (agent ?? "").trim();
  const compact = normalizeAgent(raw).replace(/[\s_-]+/g, "");

  switch (compact) {
    case "rumordetector":
    case "rumordetectoragent":
      return "拆题";
    case "factchecker":
    case "factcheckeragent":
      return "事实核查";
    case "sourcevalidator":
    case "sourcevalidatoragent":
      return "溯源";
    case "reportcomposer":
    case "reportcomposeragent":
      return "写结论";
    case "planner":
      return "规划";
    case "consensus":
    case "consensusdebate":
      return "冲突调解室";
    case "missioncontrol":
      return "系统";
    case "agentmemorysearch":
    case "memorysearch":
      return "历史案件参考";
    case "agentmemorywrite":
    case "memorywrite":
      return "案件记忆归档";
    case "reportreviewer":
    case "reportreviewer(proposerreviewer)":
      return "报告审稿";
    case "tool":
      return "工具";
    case "unknown":
      return "未知智能体";
    default:
      return raw || "系统";
  }
}

function displayAgentText(text?: string | null) {
  if (!text) return "";
  return text
    .replace(/FactChecker \+ SourceValidator/g, "事实核查 + 溯源")
    .replace(/FactChecker \+ ReportComposer/g, "事实核查 + 写结论")
    .replace(/RumorDetector\.claimAtoms/g, "拆题 · 原子命题")
    .replace(/Search Tool Registry/g, "搜索工具注册表")
    .replace(/Evidence Bundle/g, "证据包")
    .replace(/ConsensusDebate/g, "冲突调解室")
    .replace(/Mission Control/g, "系统")
    .replace(/RumorDetector/g, "拆题")
    .replace(/FactChecker/g, "事实核查")
    .replace(/SourceValidator/g, "溯源")
    .replace(/ReportComposer/g, "写结论")
    .replace(/Planner/g, "规划")
    .replace(/Consensus/g, "冲突调解室")
    .replace(/Agent Memory Search/gi, "历史案件参考")
    .replace(/Agent Memory Write/gi, "案件记忆归档")
    .replace(/Memory Search/gi, "历史案件参考")
    .replace(/Memory Write/gi, "案件记忆归档")
    .replace(/Report Reviewer\s*\(proposer-reviewer\)/gi, "报告审稿")
    .replace(/Report Reviewer/gi, "报告审稿")
    .replace(/proposer-reviewer/gi, "报告审稿")
    .replace(/360\s*\/\s*AnySearch\s*\/\s*Metaso\s*\/\s*Tavily\s*\/\s*Exa/gi, "公开材料检索")
    .replace(/Parallel Search/gi, "公开材料检索")
    .replace(/360 AI Search/gi, "公开材料检索")
    .replace(/AnySearch/gi, "公开材料检索")
    .replace(/Metaso/gi, "公开材料检索")
    .replace(/Tavily/gi, "公开材料检索")
    .replace(/\bExa\b/gi, "公开材料检索")
    .replace(/Agent/g, "智能体");
}

function safeDomainFromUrl(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

async function buildLocalMemoryRecall(knowledgeBase: KnowledgeBase, claim: string): Promise<LocalMemoryRecall> {
  const [cases, evidenceEntries, acceptedCandidates] = await Promise.all([
    knowledgeBase.findSimilarCases(claim, 4),
    knowledgeBase.findEvidence(claim, { limit: 5 }),
    knowledgeBase.listMemoryCandidates({ status: "accepted" }),
  ]);
  const scoredCandidates = acceptedCandidates
    .map((candidate) => {
      const candidateText = `${candidate.title} ${candidate.summary} ${candidate.tags.join(" ")} ${candidate.provenance.claim}`;
      const matchedTerms = matchedLocalMemoryTerms(claim, candidateText);
      // G2 语义召回：词面命中数为主，语义相似度兜底（同义说法零词面交集时仍可召回）
      const semanticScore = semanticClaimSimilarity(claim, candidate.provenance.claim);
      const score = Math.max(matchedTerms.length, semanticScore / 25);
      return { candidate, matchedTerms, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.candidate.confidence - a.candidate.confidence)
    .slice(0, 4);

  const caseSources = cases.flatMap((entry) =>
    extractSourceUrlsFromCase(entry).slice(0, 2).map((url, index) => ({
      id: `${entry.id}-memory-source-${index}`,
      title: `历史案件来源：${entry.claim.slice(0, 36)}${entry.claim.length > 36 ? "..." : ""}`,
      url,
      domain: safeDomainFromUrl(url),
      snippet: `来自相似案件，原信息相似度 ${calculateClaimSimilarity(claim, entry.claim)}/100。旧案只作为检索线索，不直接进入本案结论。`,
      sourceType: "历史案件",
      evidenceRole: "线索",
    }))
  );

  const evidenceSources = evidenceEntries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    url: entry.sourceUrl,
    domain: safeDomainFromUrl(entry.sourceUrl ?? entry.source),
    snippet: entry.summary || entry.source,
    sourceType: `本地证据库/${entry.credibility}`,
    evidenceRole: entry.role,
  }));

  const hits = cases.map((entry) => ({
    id: entry.id,
    claim: entry.claim,
    score: calculateClaimSimilarity(claim, entry.claim),
    verdict: finalReportText(entry.finalReport, "credibilityLabel") || finalReportText(entry.finalReport, "verdictType"),
    tags: entry.tags.slice(0, 5),
    sourceUrls: extractSourceUrlsFromCase(entry).slice(0, 5),
  }));

  const relatedQuestions = [
    ...hits.slice(0, 2).map((hit) => `复核历史案件「${hit.claim.slice(0, 24)}」是否仍适用于本案`),
    ...evidenceEntries.slice(0, 2).map((entry) => `追查证据「${entry.title.slice(0, 24)}」的原始来源`),
  ];

  return {
    hitCount: hits.length,
    acceptedCandidateCount: scoredCandidates.length,
    evidenceCount: evidenceEntries.length,
    hits,
    acceptedCandidates: scoredCandidates.map(({ candidate, matchedTerms }) => ({
      id: candidate.id,
      kind: candidate.kind,
      title: candidate.title,
      summary: candidate.summary,
      confidence: candidate.confidence,
      matchedTerms,
    })),
    sources: [...evidenceSources, ...caseSources].slice(0, 8),
    relatedQuestions,
    traceText: `读取本地案件库 ${hits.length} 条、证据库 ${evidenceEntries.length} 条、已确认记忆 ${scoredCandidates.length} 条；这些内容只用于复用检索路径和信源经验，不直接替代本案证据。`,
  };
}

function finalReportText(report: unknown, key: string) {
  if (!report || typeof report !== "object") return "";
  const value = (report as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

function countFinalUnresolvedQuestions(report: unknown) {
  if (!report || typeof report !== "object") return 0;
  const record = report as Record<string, unknown>;
  const keys = ["unresolvedQuestions", "unresolvedEvidenceGaps", "nextEvidenceNeeded", "whyHardToVerify"];
  return keys.reduce((count, key) => {
    const value = record[key];
    if (Array.isArray(value)) return count + value.length;
    if (typeof value === "string" && value.trim()) return count + 1;
    return count;
  }, 0);
}

function extractSourceUrlsFromCase(entry: KnowledgeBaseEntry) {
  const urls = new Set<string>();
  entry.handoffSteps.forEach((step) => {
    collectUrls(step.output).forEach((url) => urls.add(url));
    collectUrls(step.evidenceBundle).forEach((url) => urls.add(url));
  });
  collectUrls(entry.finalReport).forEach((url) => urls.add(url));
  return Array.from(urls);
}

function collectUrls(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.match(/https?:\/\/[^\s)\]}>，。；;]+/g) ?? [];
  if (Array.isArray(value)) return value.flatMap((item) => collectUrls(item));
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).flatMap((item) => collectUrls(item));
  return [];
}

function matchedLocalMemoryTerms(query: string, target: string) {
  const queryTerms = tokenizeLocalMemoryText(query);
  const targetTerms = new Set(tokenizeLocalMemoryText(target));
  return queryTerms.filter((term) => targetTerms.has(term)).slice(0, 12);
}

function tokenizeLocalMemoryText(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^\p{Script=Han}\p{Letter}\p{Number}]+/gu, "")
    .trim();
  const terms = new Set<string>(normalized.match(/[a-z0-9]{2,}/g) ?? []);
  for (let index = 0; index < normalized.length - 1; index += 1) {
    const pair = normalized.slice(index, index + 2);
    if (/^[\p{Script=Han}]{2}$/u.test(pair)) terms.add(pair);
  }
  return Array.from(terms);
}

function isNonAuthenticStep(step: HandoffStep) {
  const source = typeof step.output?._source === "string" ? step.output._source : "";
  return String(step.model ?? "").includes("demo-fallback") || source === "demo-fallback";
}

function isDeterministicReportFallback(step: HandoffStep) {
  return String(step.model ?? "").includes("fallback:deterministic-report");
}

function deterministicFallbackReason(step: HandoffStep) {
  const reason =
    typeof step.output?.fallbackReason === "string" ? step.output.fallbackReason.trim() : "";
  return reason ? sanitizePublicReportText(reason) : "最终写作模型未返回稳定结构，系统已用确定性报告兜底，避免长时间挂起。";
}

function formatLatency(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function processStallNotice(params: {
  runStatus: RunStatus;
  msSinceLastEvent: number;
  humanStage: string;
}): string {
  if (params.runStatus !== "running") return "";
  if (params.msSinceLastEvent >= 90000) {
    return "这一步没有新进展，可以取消后重试。";
  }
  if (params.msSinceLastEvent >= 60000) {
    if (/对照|检索|来源/.test(params.humanStage)) {
      return "还在查公开来源，可能比较慢。";
    }
    return "还在核查，这一步可能比较慢。";
  }
  return "";
}

/** 人话三态：理解 → 对照公开报道 → 整理结论（一级锚点） */
function humanStageLabel(params: {
  runStatus: RunStatus;
  finalReport: Record<string, unknown> | null;
  steps: HandoffStep[];
  displayPhase: "agents" | "search" | "evidence" | "verdict";
}): string {
  if (isInterruptedFinalReport(params.finalReport)) return "核查中断";
  if (params.finalReport) return "核查完成";
  if (params.runStatus === "failed") return "核查中断";
  if (params.displayPhase === "verdict") return "整理结论";
  const hasSearch = params.steps.some((s) =>
    /fact_checker|source_validator|search/i.test(s.agent)
  );
  const hasRumor = params.steps.some((s) => /rumor/i.test(s.agent));
  if (params.displayPhase === "evidence" || hasSearch) return "对照公开报道";
  if (params.displayPhase === "search" || hasRumor) return "理解你在说什么";
  if (params.runStatus === "running") return "理解你在说什么";
  return "准备开始";
}

function runFallbackNotice(steps: HandoffStep[]) {
  const fallbackStep = steps.find(isDeterministicReportFallback);
  if (!fallbackStep) return "";
  return `写结论使用确定性兜底：${deterministicFallbackReason(fallbackStep)}`;
}

function upsertStep(steps: HandoffStep[], nextStep: HandoffStep) {
  const nextAgent = normalizeAgent(nextStep.agent);
  const existingIndex = steps.findIndex((step) => normalizeAgent(step.agent) === nextAgent);
  if (existingIndex < 0) return [...steps, nextStep];
  return steps.map((step, index) => (index === existingIndex ? nextStep : step));
}

function buildStep(event: OrchestrateStreamEvent, status: HandoffStep["status"]): HandoffStep {
  const input: Record<string, unknown> = {};
  // Book honesty: agent_complete may carry loadedSkills / agentStatusBar on result
  const skills = loadedSkillsFromEventResult(event.result);
  if (skills.length > 0) input.loadedSkills = skills;
  const statusBar =
    event.result && typeof event.result.agentStatusBar === "string"
      ? event.result.agentStatusBar.trim()
      : "";
  if (statusBar) input.agentStatusBar = statusBar;
  return {
    agent: normalizeAgent(event.agent) || "unknown",
    agentName: displayAgentName(event.agentName ?? event.agent ?? "Unknown"),
    agentIcon: event.agentIcon ?? "◆",
    agentContract: event.agentContract,
    systemPrompt: "",
    input,
    output: event.output ?? {},
    evidenceBundle: event.evidenceBundle,
    model: event.model ?? "pending",
    latencyMs: event.latencyMs ?? 0,
    timestamp: event.timestamp ?? Date.now(),
    status,
    error: event.error,
  };
}

function buildRuntimeStreamingSession(claim: string): StreamingReasoningSession {
  return {
    sessionId: `runtime-session-${Date.now()}`,
    claim,
    stages: RUNTIME_STREAM_STAGES.map((stage) => ({
      ...stage,
      status: "pending",
      chunks: [],
    })),
    overallStatus: "idle",
    currentStageId: null,
    source: "runtime",
    sourceLabel: "真实智能体 SSE",
  };
}

function buildRuntimeChunk(stageId: string, type: ChunkType, content: string): StreamingChunk {
  return {
    id: `${stageId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    content,
    timestamp: Date.now(),
  };
}

function summarizeStepOutput(step: HandoffStep) {
  const fallbackReason = typeof step.output.fallbackReason === "string" ? sanitizePublicReportText(step.output.fallbackReason) : "";
  if (fallbackReason) {
    return `这一轮没有拿到可展示的核查结果。原因：${fallbackReason}`;
  }

  const summary =
    typeof step.output.analysis === "string"
      ? step.output.analysis
      : typeof step.output.summary === "string"
        ? step.output.summary
        : typeof step.output.finalSummary === "string"
          ? step.output.finalSummary
          : "";

  return summary ? displayAgentText(summary) : "这一轮核查已有结果。";
}

function reportText(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return typeof value === "string" ? sanitizePublicReportText(value) : "";
}

/** Composer 没写出结论：中断，不是「还查不清」。 */
export function isInterruptedFinalReport(report: Record<string, unknown> | null | undefined): boolean {
  return Boolean(report && report._source === "error-boundary");
}

function isLowCredibilityVerdict(verdictType: string, label: string) {
  if (verdictType === "false") return true;
  return /不实|谣言|虚假|错误|高度可疑/.test(label);
}

function normalizeCredibilityScore(score: number | null, verdictType: string, label: string) {
  if (score === null) return null;
  const bounded = Math.max(0, Math.min(100, score));
  if (isLowCredibilityVerdict(verdictType, label) && bounded > 50) {
    return 100 - bounded;
  }
  return bounded;
}

function judgmentConfidenceScore(score: number | null, verdictType: string, label: string) {
  const normalizedScore = normalizeCredibilityScore(score, verdictType, label);
  if (normalizedScore === null) return null;
  return isLowCredibilityVerdict(verdictType, label) ? 100 - normalizedScore : normalizedScore;
}


/** Compact tool key: lower + strip spaces/underscores/hyphens for matching. */
function compactToolKey(value?: string | null) {
  return normalizeAgent(value).replace(/[\s_-]+/g, "");
}

/**
 * Detect report_reviewer SSE tool by name/id or result shape
 * (passed + score + issues from reviewAndRepairReport).
 */
export function isReportReviewerTool(
  toolName?: string | null,
  toolId?: string | null,
  result?: Record<string, unknown> | null
): boolean {
  const key = compactToolKey(`${toolName ?? ""} ${toolId ?? ""}`);
  if (
    key.includes("reportreviewer") ||
    key.includes("proposerreviewer") ||
    /报告审稿/.test(`${toolName ?? ""}${toolId ?? ""}`)
  ) {
    return true;
  }
  if (
    result &&
    typeof result.passed === "boolean" &&
    typeof result.score === "number" &&
    Array.isArray(result.issues)
  ) {
    return true;
  }
  return false;
}

export function formatReportReviewerStreamTitle(
  result?: Record<string, unknown> | null,
  status?: StreamItemStatus | string | null
): string {
  if (status === "running" || status === "queued") {
    return "报告审稿";
  }
  if (status === "failed") return "报告审稿 · 未完成";
  if (result == null) return "报告审稿";
  const passed = typeof result.passed === "boolean" ? result.passed : null;
  const score =
    typeof result.score === "number" && Number.isFinite(result.score) ? Math.round(result.score) : null;
  const verdict = passed === true ? "通过" : passed === false ? "需补证" : "已返回";
  if (score !== null) return `报告审稿 · ${verdict} · ${score}`;
  return `报告审稿 · ${verdict}`;
}

/** Max 3 human-readable issues for stream chip / detail collapse. */
export function reportReviewerIssueList(
  result?: Record<string, unknown> | null
): Array<{ severity: string; message: string }> {
  const raw = result?.issues;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ severity: string; message: string }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const message = typeof rec.message === "string" ? rec.message.trim() : "";
    if (!message) continue;
    out.push({
      severity: typeof rec.severity === "string" ? rec.severity : "warn",
      message,
    });
    if (out.length >= 3) break;
  }
  return out;
}

function loadedSkillsFromEventResult(result?: Record<string, unknown> | null): string[] {
  if (!result) return [];
  const skills = result.loadedSkills;
  if (!Array.isArray(skills)) return [];
  return skills.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
}

export function formatReportReviewerStreamDetail(
  result?: Record<string, unknown> | null,
  status?: StreamItemStatus | string | null
): string {
  if (status === "running" || status === "queued" || result == null) {
    return "对结论做契约校验：证据链、边界表述与可发布强度。";
  }
  const issues = reportReviewerIssueList(result);
  if (issues.length > 0) {
    return issues.map((issue) => issue.message).join("；");
  }
  if (result.passed === true) return "契约校验通过，结论可进入展示。";
  if (result.passed === false) return "需补齐证据链或收紧边界表述。";
  return "审稿结果已返回。";
}

function isEvidencePursuitToolName(toolName?: string | null, toolId?: string | null, result?: Record<string, unknown> | null) {
  if (result && result.kind === "evidence_pursuit") return true;
  const key = compactToolKey(`${toolName ?? ""} ${toolId ?? ""}`);
  return /evidenceloop|evidencepursuit|证据追索|追索证据/.test(key);
}

function toolDisplayName(toolName?: string | null, source?: string | null) {
  const normalized = compactToolKey(`${toolName ?? ""} ${source ?? ""}`);
  if (normalized.includes("reportreviewer") || normalized.includes("proposerreviewer")) return "报告审稿";
  if (normalized.includes("memorysearch")) return "历史案件参考";
  if (normalized.includes("memorywrite")) return "案件记忆归档";
  if (
    normalized.includes("parallel") ||
    normalized.includes("anysearch") ||
    normalized.includes("metaso") ||
    normalized.includes("tavily") ||
    normalized.includes("exa") ||
    normalized.includes("360")
  ) {
    return "公开材料检索";
  }
  if (normalized.includes("vision") || normalized.includes("stepfun")) return "图片材料解析";
  if (/evidenceloop|evidencepursuit|证据追索|追索证据/.test(normalized)) return "追索证据";
  const raw = toolName?.trim() || "";
  if (!raw) return "核查工具";
  // 兜底：仍过滤供应商墙英文名
  return displayAgentText(raw) || "核查工具";
}

function resultNumber(result: Record<string, unknown> | undefined, key: string) {
  const value = result?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resultArrayCount(result: Record<string, unknown> | undefined, key: string) {
  const value = result?.[key];
  return Array.isArray(value) ? value.length : null;
}

function toolResultDetail(event: OrchestrateStreamEvent) {
  const result = event.result;
  if (isReportReviewerTool(event.toolName, event.toolId, result)) {
    return formatReportReviewerStreamDetail(result, "completed");
  }
  if (isEvidencePursuitToolName(event.toolName, event.toolId, result)) {
    const missing = Array.isArray(result?.missingAfter)
      ? result.missingAfter.filter((x): x is string => typeof x === "string")
      : [];
    return formatPursuitDetail({
      goal: typeof result?.goal === "string" ? result.goal : undefined,
      query: event.query,
      resultKind: typeof result?.resultKind === "string" ? result.resultKind : undefined,
      missingAfter: missing,
      reasonText: typeof result?.reasonText === "string" ? result.reasonText : undefined,
    });
  }
  const hitCount = resultNumber(result, "hitCount");
  const acceptedCandidateCount = resultNumber(result, "acceptedCandidateCount");
  if (hitCount !== null || acceptedCandidateCount !== null) {
    return `命中历史案件 ${hitCount ?? 0} 条，可参考候选 ${acceptedCandidateCount ?? 0} 条。`;
  }

  const proposedCandidateCount = resultNumber(result, "proposedCandidateCount");
  if (proposedCandidateCount !== null) {
    const sourceUrlCount = resultNumber(result, "sourceUrlCount");
    const unresolvedQuestionCount = resultNumber(result, "unresolvedQuestionCount");
    return `提出可复用记忆 ${proposedCandidateCount} 条，归档来源 ${sourceUrlCount ?? 0} 条，未解问题 ${unresolvedQuestionCount ?? 0} 个。`;
  }

  const supportCount = resultNumber(result, "supportCount") ?? resultArrayCount(result, "supportingEvidence");
  const contradictCount = resultNumber(result, "contradictCount") ?? resultArrayCount(result, "contradictingEvidence");
  const sourceCount = resultNumber(result, "sourceCount") ?? resultArrayCount(result, "sources");
  if (sourceCount !== null || supportCount !== null || contradictCount !== null) {
    return `返回来源 ${sourceCount ?? 0} 条，支持 ${supportCount ?? 0} 条，反驳 ${contradictCount ?? 0} 条。`;
  }

  const answerPreview = typeof result?.answerPreview === "string" ? result.answerPreview.trim() : "";
  if (answerPreview) {
    return answerPreview.length > 96 ? `${answerPreview.slice(0, 93)}…` : answerPreview;
  }

  return "结果已返回，可在右侧明细查看。";
}

function inferDiagnosis(steps: HandoffStep[], fallback: ClaimDiagnosis | null): ClaimDiagnosis {
  if (fallback) return fallback;

  const rumorStep = steps.find((step) => step.agent === "rumor_detector");
  const indicators = Array.isArray(rumorStep?.output.rumorIndicators)
    ? rumorStep.output.rumorIndicators.filter((item): item is string => typeof item === "string")
    : [];

  return {
    mixedJudgments: ["事件事实"],
    ambiguousTerms: indicators,
    risk: typeof rumorStep?.output.analysis === "string"
      ? rumorStep.output.analysis
      : "需要结合权威来源继续核查。",
    whyNotDirectFactCheck: "该结论来自多智能体自动核查流程，仍需保留证据边界。",
    rumorIndicators: indicators,
  };
}

function inferVerificationResult(score: number): VerificationResult {
  if (score >= 70) return "true";
  if (score >= 40) return "partial";
  if (score <= 25) return "false";
  return "unknown";
}

/**
 * 把 step.output 里的结构化条目渲染成"小标题 + dash 列表 / 段落"形态。
 * 排版上参考 Kami:每个 label 是 serif 500 小标题,正下方是 dash 列表或段落。
 * 用 staggered fade-in 让多个子段依次出现,而不是一次性堆出来。
 */
export function MissionControlView({
  claim,
  intake,
  onCancel,
  onRetry,
  modelChoice,
  onComplete,
  initialFinalReport = null,
}: MissionControlViewProps) {
  const { state, dispatch } = useReasoning();
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);
  const [steps, setSteps] = useState<HandoffStep[]>([]);
  const [finalReport, setFinalReport] = useState<Record<string, unknown> | null>(initialFinalReport);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stallMs, setStallMs] = useState(0);
  const lastActivityAtRef = useRef<number>(Date.now());
  const [runStatus, setRunStatus] = useState<RunStatus>(initialFinalReport ? "completed" : "idle");
  const [errorMessage, setErrorMessage] = useState("");
  /** SSE raw events for process shell narrative */
  const [sseEvents, setSseEvents] = useState<OrchestrateStreamEvent[]>([]);
  const [priorTurns, setPriorTurns] = useState<ApodexRunModel[]>([]);
  const [displayClaim, setDisplayClaim] = useState(claim);
  const [streamKey, setStreamKey] = useState(0);
  const streamJobRef = useRef<string | CaseIntake>(intake ?? claim);
  const missionShellModel = useMemo(
    () => adaptOrchestrateStreamToShell(sseEvents, { claim: displayClaim }),
    [sseEvents, displayClaim]
  );
  const apodexRun = useMemo(() => mapShellToApodexRun(missionShellModel), [missionShellModel]);
  /** Avoid double-firing onComplete if parent re-renders with same report */
  const onCompleteFiredRef = useRef(false);

  useEffect(() => {
    if (runStatus !== "running" || startedAt === null) return;

    const timer = window.setInterval(() => {
      const now = Date.now();
      setElapsedMs(now - startedAt);
      setStallMs(now - lastActivityAtRef.current);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [runStatus, startedAt]);

  useEffect(() => {
    const trimmedClaim = claim.trim();
    if (!trimmedClaim) return;

    setSseEvents([]);
    setPriorTurns([]);
    setDisplayClaim(claim);
    setStreamKey(0);
    streamJobRef.current = intake ?? claim;
    onCompleteFiredRef.current = false;
  }, [claim, dispatch, intake]);

  /** finalReport ready → notify parent (parent no longer switches phase; we stay mounted) */
  useEffect(() => {
    if (!finalReport || !onComplete || onCompleteFiredRef.current) return;
    onCompleteFiredRef.current = true;
    onComplete(finalReport);
  }, [finalReport, onComplete]);

  useEffect(() => {
    if (!claim.trim()) return;
    if (initialFinalReport && streamKey === 0) return;

    let cancelled = false;
    let streamEnded = false;
    let accumulatedSteps: HandoffStep[] = [];

    const appendRuntimeChunk = (stageId: string, type: ChunkType, content: string) => {
      dispatch({
        type: "APPEND_STREAMING_CHUNK",
        payload: {
          stageId,
          chunk: buildRuntimeChunk(stageId, type, content),
        },
      });
    };

    const startTimer = window.setTimeout(() => {
      async function runStream() {
        dispatch({ type: "START_HANDOFF_STREAM", payload: { claim } });
        dispatch({ type: "START_STREAMING_SESSION", payload: buildRuntimeStreamingSession(claim) });
        setSteps([]);
        setSseEvents([]);
        setFinalReport(null);
        setStartedAt(Date.now());
        lastActivityAtRef.current = Date.now();
        setElapsedMs(0);
        setStallMs(0);
        setRunStatus("running");
        setErrorMessage("");

        try {
          let localMemoryRecall: LocalMemoryRecall | null = null;
          try {
            const memoryRecall = await buildLocalMemoryRecall(knowledgeBase, claim);
            localMemoryRecall = memoryRecall;
            if (cancelled) return;
          } catch (error) {
            // F2：召回降级不阻断核查，但必须留现场（否则历史记忆静默失效无从排查）
            console.error("[mission] 本地记忆召回失败，本次核查不带历史", error);
            if (cancelled) return;
          }

          const streamPayload = streamKey > 0 ? streamJobRef.current : (intake ?? claim);
          for await (const event of requestOrchestrateStream(streamPayload, localMemoryRecall ?? undefined, modelChoice)) {
            if (cancelled) return;
            lastActivityAtRef.current = Date.now();
            setStallMs(0);
            setSseEvents((prev) => [...prev, event]);

            switch (event.type) {
              case "planner_update":
              case "speculative_update":
              case "consensus_debate_round":
              case "consensus_debate_final":
                break;
              case "agent_start": {
                const step = buildStep(event, "running");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                dispatch({
                  type: "UPDATE_STREAMING_STAGE",
                  payload: { stageId: step.agent, status: "running" },
                });
                appendRuntimeChunk(step.agent, "action", `${step.agentName} 开始处理这一步核查。`);
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "agent_complete": {
                const step = buildStep(event, "completed");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));

                if (isNonAuthenticStep(step)) {
                  const fallbackReason = typeof step.output.fallbackReason === "string" ? sanitizePublicReportText(step.output.fallbackReason) : "收到 demo-fallback 输出";
                  const message = `${step.agentName} 没有拿到可展示的核查结果，已停止展示结论。原因：${fallbackReason}`;
                  setErrorMessage(message);
                  setStartedAt(null);
                  setRunStatus("failed");
                  appendRuntimeChunk(step.agent, "tool_call", message);
                  dispatch({
                    type: "UPDATE_STREAMING_STAGE",
                    payload: { stageId: step.agent, status: "error" },
                  });
                  dispatch({ type: "APPEND_HANDOFF_STEP", payload: { ...step, status: "failed" } });
                  dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
                  streamEnded = true;
                  return;
                }

                appendRuntimeChunk(step.agent, step.model.includes("demo-fallback") ? "thought" : "result", summarizeStepOutput(step));
                appendRuntimeChunk(step.agent, "result", `这一步完成，耗时 ${formatLatency(step.latencyMs)}。`);
                if (isDeterministicReportFallback(step)) {
                  appendRuntimeChunk(step.agent, "thought", deterministicFallbackReason(step));
                }
                dispatch({
                  type: "UPDATE_STREAMING_STAGE",
                  payload: { stageId: step.agent, status: "completed" },
                });
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "tool_start": {
                const isReviewerStart = isReportReviewerTool(
                  event.toolName,
                  event.toolId,
                  undefined
                );
                appendRuntimeChunk(
                  isReviewerStart ? "report_composer" : "fact_checker",
                  "tool_call",
                  isReviewerStart
                    ? "开始报告审稿（确定性契约检查）。"
                    : `${toolDisplayName(event.toolName)} 开始查询：${event.query ?? claim}`
                );
                break;
              }
              case "tool_result": {
                const isReviewer = isReportReviewerTool(
                  event.toolName,
                  event.toolId,
                  event.result
                );
                const sourceCount =
                  resultNumber(event.result, "sourceCount") ??
                  resultArrayCount(event.result, "sources") ??
                  0;
                if (isReviewer) {
                  appendRuntimeChunk(
                    "report_composer",
                    "result",
                    toolResultDetail(event)
                  );
                } else {
                  appendRuntimeChunk(
                    "fact_checker",
                    "result",
                    `${toolDisplayName(event.toolName, event.model)} 返回来源 ${sourceCount} 条。`
                  );
                }
                break;
              }
              case "tool_error": {
                const { message } = resolveErrorPresentation(event);
                appendRuntimeChunk(
                  "fact_checker",
                  "tool_call",
                  `${toolDisplayName(event.toolName)} 调用失败：${message}。不生成模拟证据。`
                );
                break;
              }
              case "agent_error": {
                const step = buildStep(event, "failed");
                const { message } = resolveErrorPresentation(event);
                const recoverable =
                  event.recoverable === true ||
                  getAgentRegistry().canContinueAfterFailure(step.agent);
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                if (!recoverable) {
                  setErrorMessage(message);
                }
                appendRuntimeChunk(
                  step.agent,
                  "thought",
                  recoverable
                    ? "这一步没能写成判断，会用已检索到的材料继续。"
                    : `这一步核查异常：${message}。`
                );
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "complete": {
                // 服务端 complete 携带的是原始 PipelineStep：model / status 等字段可缺省，
                // 先归一到 HandoffStep 默认值再消费，避免个别步骤缺字段把成功核查判成失败。
                const rawFinalSteps =
                  event.steps && event.steps.length > 0 ? event.steps : accumulatedSteps;
                const finalSteps = rawFinalSteps.map((step) => ({
                  ...step,
                  agent: normalizeAgent(step.agent) || "unknown",
                  agentName: displayAgentName(step.agentName ?? step.agent ?? "Unknown"),
                  agentIcon: step.agentIcon ?? "◆",
                  output: step.output ?? {},
                  model: step.model ?? "multi-agent",
                  latencyMs: typeof step.latencyMs === "number" ? step.latencyMs : 0,
                  timestamp: typeof step.timestamp === "number" ? step.timestamp : Date.now(),
                  status: (step.status as HandoffStep["status"]) ?? "completed",
                }));
                const finalReport = event.finalReport;
                const proposedMemoryCandidates = event.memoryCandidates ?? [];
                const nonAuthenticStep = finalSteps.find(isNonAuthenticStep);
                if (nonAuthenticStep) {
                  const message = `${nonAuthenticStep.agentName} 含有非真实降级输出，已拒绝生成最终判断。`;
                  setStartedAt(null);
                  setRunStatus("failed");
                  setErrorMessage(message);
                  setFinalReport(null);
                  dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
                  streamEnded = true;
                  return;
                }
                const totalLatency = event.totalLatencyMs ?? finalSteps.reduce(
                  (sum, step) => sum + step.latencyMs,
                  0
                );

                // 先上屏结果，再做本地持久化，避免保存失败/抛错时用户看不到结论
                setSteps(finalSteps);
                setFinalReport(finalReport ?? null);
                setErrorMessage("");
                if (!isInterruptedFinalReport(finalReport ?? null)) {
                  const conclusion = reportText(finalReport ?? null, "conclusion");
                  const label = reportText(finalReport ?? null, "credibilityLabel");
                }
                setStartedAt(null);
                setElapsedMs((current) => totalLatency || current);
                setRunStatus("completed");

                finalSteps.forEach((step) => {
                  dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                });
                dispatch({
                  type: "SET_HANDOFF_FINAL_REPORT",
                  payload: {
                    finalReport,
                    totalLatencyMs: totalLatency,
                    model: finalSteps.map((step) => step.model).filter(Boolean).join(", ") || "multi-agent",
                  },
                });
                dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: {} });
                streamEnded = true;
                dispatch({ type: "END_STREAMING_SESSION" });

                try {
                  const rawCredibilityScore =
                    typeof finalReport?.credibilityScore === "number" ? finalReport.credibilityScore : null;
                  const credibilityLabel =
                    typeof finalReport?.credibilityLabel === "string" ? finalReport.credibilityLabel : "";
                  const verdictType =
                    typeof finalReport?.verdictType === "string" ? finalReport.verdictType : "";
                  const credibilityScore = normalizeCredibilityScore(
                    rawCredibilityScore,
                    verdictType,
                    credibilityLabel
                  ) ?? 50;
                  const entry: KnowledgeBaseEntry = {
                    id: `case-${claim.replace(/\s+/g, "-").slice(0, 48)}-deep`,
                    claim,
                    rumorType: state.diagnosis?.risk?.includes("政治")
                      ? "政治"
                      : state.diagnosis?.risk?.includes("娱乐")
                        ? "娱乐"
                        : "深度核查",
                    diagnosis: inferDiagnosis(finalSteps, state.diagnosis),
                    finalReport: finalReport ?? {},
                    handoffSteps: finalSteps,
                    credibilityScore,
                    verificationResult: inferVerificationResult(credibilityScore),
                    timestamp: Date.now(),
                    tags: [
                      "deep",
                      ...(state.diagnosis?.rumorIndicators ?? []),
                      typeof finalReport?.credibilityLabel === "string" ? finalReport.credibilityLabel : "",
                    ],
                  };
                  void knowledgeBase.saveCase(entry);
                  proposedMemoryCandidates.forEach((candidate) => {
                    void knowledgeBase.saveMemoryCandidate(candidate);
                  });
                } catch (error) {
                  // 本地持久化失败不影响结果首屏，但要留现场（F2）
                  console.error("[mission] 案例写入本地知识库失败", error);
                }
                break;
              }
              case "error": {
                const { message } = resolveErrorPresentation(event);
                setStartedAt(null);
                setRunStatus("failed");
                setErrorMessage(message);
                dispatch({
                  type: "COMPLETE_HANDOFF_STREAM",
                  payload: { error: message },
                });
                streamEnded = true;
                break;
              }
            }
          }
          // F1：流正常结束但既没收到 complete 也没收到 error（服务端崩/代理断）→
          // 兜底成可重试的失败态，而不是永远转圈
          if (!streamEnded) {
            const message = "连接中断了，这次核查没有走完。可以重新核查一次。";
            setStartedAt(null);
            setRunStatus("failed");
            setErrorMessage(message);
            dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
            streamEnded = true;
          }
        } catch (error) {
          console.error("[mission] 核查流异常", error); // F2：留下原始错误现场，不再吞错
          if (cancelled) return;
          setStartedAt(null);
          setRunStatus("failed");
          setErrorMessage(ERROR_FRIENDLY_MESSAGE);
          dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: ERROR_FRIENDLY_MESSAGE } });
          streamEnded = true;
        }
      }

      void runStream();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(startTimer);
      // 审查 P1-3 修复：组件卸载时若 stream 未自然结束，需重置 isExpanding，否则无法重启
      if (!streamEnded) {
        dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: {} });
      }
    };
  }, [claim, dispatch, initialFinalReport, intake, knowledgeBase, modelChoice, state.diagnosis, streamKey]);

  const fallbackNotice = useMemo(() => runFallbackNotice(steps), [steps]);
  const humanStage = useMemo(
    () =>
      humanStageLabel({
        runStatus,
        finalReport,
        steps,
        displayPhase: finalReport
          ? "verdict"
          : "agents",
      }),
    [runStatus, finalReport, steps]
  );
  const stallNotice = useMemo(
    () =>
      processStallNotice({
        runStatus,
        msSinceLastEvent: stallMs,
        humanStage,
      }),
    [runStatus, stallMs, humanStage]
  );

  const handleFollowUp = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || runStatus === "running") return;
      const frozen: ApodexRunModel = { ...apodexRun, live: false, claim: displayClaim };
      const history = [...priorTurns, frozen];
      const composed = composeFollowUpClaim({
        originalClaim: claim,
        previousAnswer: previousAnswerText(frozen.report),
        followUp: trimmed,
        priorFollowUps: history.map((turn) => turn.claim).filter((item) => item !== claim),
      });
      streamJobRef.current = intake ? { ...intake, text: composed } : composed;
      setPriorTurns(history);
      setDisplayClaim(trimmed);
      setSseEvents([]);
      setFinalReport(null);
      setErrorMessage("");
      onCompleteFiredRef.current = false;
      setRunStatus("running");
      setStreamKey((n) => n + 1);
    },
    [apodexRun, claim, displayClaim, intake, priorTurns, runStatus]
  );

  const hasStreamEvents = sseEvents.length > 0;
  const retryableFailure = runStatus === "failed" || isInterruptedFinalReport(finalReport);
  return (
    <main
      className={`mission-control-view case-workbench-view case-workbench-view--clean case-dossier-view ${
        hasStreamEvents ? "case-dossier-view--streaming" : "case-dossier-view--boot"
      } case-dossier-view--shell${
        finalReport && onComplete ? " case-workbench-view--settled" : ""
      } mission-thread-view`}
    >
      <div className="mission-thread mission-thread--desk">
        <ApodexRunView
          model={apodexRun}
          elapsedMs={elapsedMs}
          runStatus={runStatus}
          onStop={retryableFailure && onRetry ? onRetry : onCancel}
          stopLabel={
            retryableFailure
              ? "重新核查"
              : runStatus === "running"
                ? "停止"
                : "再查一条"
          }
          stallNotice={runStatus === "running" ? stallNotice : undefined}
          fallbackNotice={fallbackNotice}
          priorTurns={priorTurns}
          onFollowUp={handleFollowUp}
        />
        {errorMessage && !finalReport ? (
          <p className="mission-run-status-notice" role="alert">
            {errorMessage}
          </p>
        ) : null}
        {runStatus === "completed" ? (
          <ReportFooter
            claim={displayClaim}
            verdictType={reportText(finalReport, "verdictType") || "unverified"}
            score={
              finalReport && typeof finalReport.credibilityScore === "number"
                ? finalReport.credibilityScore
                : undefined
            }
          />
        ) : null}
      </div>
    </main>
  );
}
