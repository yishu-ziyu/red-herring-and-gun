import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";

// Emil-design-eng easing tokens (mission-critical: all motion uses custom curves)
const EASE_OUT = [0.16, 1, 0.3, 1] as const; // snappy enter
const EASE_IN = [0.7, 0, 0.84, 0] as const; // crisp exit
const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const; // on-screen movement
import {
  requestOrchestrateStream,
  updateMemoryCandidateStatus,
  type ConsensusDebateUpdate,
  type ExecutionDagPlan,
  type HandoffStep,
  type OrchestrateStreamEvent,
  type SpeculativeRelayUpdate,
} from "../../../lib/agentExpansion";
import { adaptOrchestrateStreamToShell, humanizeVerdictType } from "../../../lib/missionShell";
import { formatPursuitDetail } from "../../../lib/evidencePursuitUi";
import { isChecksExhaustedMessage } from "../../../lib/checkQuota";
import { ApodexRunView } from "./mission/ApodexRunView";
import { mapShellToApodexRun, type ApodexRunModel } from "./mission/apodexRunMap";
import { composeFollowUpClaim, previousAnswerText } from "../../../lib/composeFollowUpClaim";
import type { ModelChoiceMap } from "../ModelPicker";
import { calculateClaimSimilarity, createKnowledgeBase, type KnowledgeBase } from "../../../lib/knowledgeBase";
import { semanticClaimSimilarity } from "../../../lib/semanticRecall";
import type {
  AtomicProposition,
  ClaimDiagnosis,
  ClaimDecompositionResult,
  EvidenceConsensusReport,
  KnowledgeBaseEntry,
  MultiSearchJob,
  VerificationResult,
} from "../../../lib/schemas";
import { useReasoning } from "../../../store/reasoningStore";
import { ConsensusProgressPanel } from "../ConsensusProgressPanel";
import { EvidenceDetailDrawer } from "../EvidenceDetailDrawer";
import { EvidenceChain } from "../EvidenceChain";
import { buildSearchJobs, executeSearchJobs } from "../../../lib/evidenceSearchRouter";
import { evaluateConsensus } from "../../../lib/evidenceConsensus";
import type { ChunkType, StreamingChunk, StreamingReasoningSession } from "../../../lib/streamingTypes";
import { AgentStatusDot } from "../mission/AgentStatusDot";
import type { CaseIntake } from "../../../lib/caseIntake";
import type { MemoryCandidate, MemoryCandidateStatus } from "../../../lib/agentRuntime/memoryCandidateTypes";
import { getAgentContract, getAgentRegistry } from "../../../lib/agentConfigs";
import { AGENT_SKILLS } from "../../../lib/agentRuntime/agentSkills";

interface MissionControlViewProps {
  claim: string;
  intake?: CaseIntake | null;
  onCancel: () => void;
  /** 同一条材料再跑一遍（中断态主按钮）。 */
  onRetry?: () => void;
  previewMode?: boolean;
  /** 4-Agent 模型选择（home 透传）。undefined 表示走默认 fallback chain。 */
  modelChoice?: ModelChoiceMap;
  /** 最终报告就绪时回调；父层可切 ResultView。有回调时本视图保持极简，不自渲染完整报告页。 */
  onComplete?: (finalReport: Record<string, unknown>) => void;
  /** 打开已保存的判断，跳过流水线。 */
  initialFinalReport?: Record<string, unknown> | null;
}

type RunStatus = "idle" | "running" | "completed" | "failed";
type StreamItemStatus = "queued" | "running" | "completed" | "failed" | "final";

interface MissionStreamItem {
  id: string;
  agentName: string;
  title: string;
  detail: string;
  status: StreamItemStatus;
  timestamp: number;
  query?: string;
  model?: string;
  toolId?: string;
  result?: Record<string, unknown>;
  debate?: ConsensusDebateUpdate;
  techDetail?: string;
}

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

interface ThinkingTreeNode {
  id: string;
  title: string;
  description: string;
  status: CasePathStatus;
  priority: "高" | "中" | "低";
  tools: string[];
}

type CasePathStatus = "pending" | "running" | "completed" | "failed";
type CasePathId = "docket" | "atoms" | "trace" | "cross_search" | "reasoning" | "evidence_chain" | "closure";

interface CasePathStep {
  id: CasePathId;
  label: string;
  description: string;
  status: CasePathStatus;
  producer: string;
}

interface ControllerProcessEvent {
  id: string;
  title: string;
  detail: string;
  agentName: string;
  status: StreamItemStatus;
  focus: WorkbenchFocus;
  kind: ControllerEventKind;
  query?: string;
  model?: string;
  toolId?: string;
  result?: Record<string, unknown>;
  debate?: ConsensusDebateUpdate;
  techDetail?: string;
}

type ControllerTranscriptItemType = "narration" | "operation" | "agent_cluster";

interface ControllerTranscriptItem {
  id: string;
  type: ControllerTranscriptItemType;
  title: string;
  detail: string;
  status: StreamItemStatus;
  focus: WorkbenchFocus;
  kind: ControllerEventKind;
  event: ControllerProcessEvent;
  rows?: ControllerProcessEvent[];
}

type ControllerEventKind = "thought" | "tool" | "agent" | "planner" | "debate" | "report" | "error";

type WorkbenchFocus =
  | "dispatch"
  | "decomposition"
  | "search"
  | "evidence"
  | "reasoning"
  | "report"
  | "memory";

const WORKBENCH_FOCUS_LABEL: Record<WorkbenchFocus, string> = {
  dispatch: "调度",
  decomposition: "拆题",
  search: "搜索",
  evidence: "证据",
  reasoning: "推演",
  report: "报告",
  memory: "记忆",
};

const CONTROLLER_EVENT_KIND_LABEL: Record<ControllerEventKind, string> = {
  thought: "主控思考",
  tool: "检索动作",
  agent: "核查步骤",
  planner: "核查规划",
  debate: "冲突调解",
  report: "写结论",
  error: "阻塞",
};

// 错误信息泄漏修复：主线只展示这条友好文案，原始诊断收进"技术细节"折叠区。
export const ERROR_FRIENDLY_MESSAGE = "底层模型服务未能完成调用，请稍后重试或检查模型配置";

export interface ErrorEventLike {
  error?: string;
  message?: string;
  code?: string;
  detail?: string;
  providerErrors?: string[];
}

// 把事件里的原始诊断整理成"技术细节"正文：优先后端结构化 detail，其次 providerErrors，否则回退原始字符串。
export function errorTechDetail(event: ErrorEventLike): string {
  if (typeof event.detail === "string" && event.detail) {
    return event.detail;
  }
  if (Array.isArray(event.providerErrors) && event.providerErrors.length > 0) {
    return ["各候选模型调用明细：", ...event.providerErrors].join("\n");
  }
  return event.error ?? event.message ?? "Orchestrate 流式调用失败";
}

// 收敛任意 error 事件为 { 用户可读 message, 折叠区 techDetail }。
// message 恒为友好文案，绝不包含 request_id / quota / provider 名 / 原始 JSON；
// 原始诊断只进入 techDetail 或 providerErrors。四个 error 入口共用，便于单测钉死。
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

const AGENT_ORDER = [
  "rumor_detector",
  "fact_checker",
  "source_validator",
  "report_composer",
] as const;

type AgentId = (typeof AGENT_ORDER)[number];

const AGENT_BADGE_META: Record<AgentId, { code: string; label: string; role: string; avatar: string }> = {
  rumor_detector: { code: "01", label: "拆", role: "拆题", avatar: "/agents/rumor-detector.png" },
  fact_checker: { code: "02", label: "核", role: "事实核查", avatar: "/agents/fact-checker.png" },
  source_validator: { code: "03", label: "源", role: "溯源", avatar: "/agents/source-validator.png" },
  report_composer: { code: "04", label: "结", role: "写结论", avatar: "/agents/report-composer.png" },
};

const AGENT_QUEUE_COPY: Record<AgentId, { focus: WorkbenchFocus; delivery: string; waiting: string }> = {
  rumor_detector: {
    focus: "decomposition",
    delivery: "拆开原句，标出可核查的判断",
    waiting: "等待拆题",
  },
  fact_checker: {
    focus: "search",
    delivery: "支持/反驳证据交叉核查",
    waiting: "等待事实核查",
  },
  source_validator: {
    focus: "evidence",
    delivery: "来源层级与转载链审计",
    waiting: "等待信源审计",
  },
  report_composer: {
    focus: "report",
    delivery: "结论边界与最终报告",
    waiting: "等待写结论",
  },
};

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

const AGENT_PROCESS_COPY: Record<string, { running: string[]; completed: string[] }> = {
  rumor_detector: {
    running: [
      "扫描原句里的高风险词、绝对化表达和情绪触发点。",
      "判断它是不是混合了事实、因果、预测或价值判断。",
      "把需要核查的断言拆给后续智能体，而不是直接给结论。",
    ],
    completed: [
      "已完成谣言特征定位。",
      "已把原句改写成后续可验证的问题队列。",
      "下一步进入支持/反驳双向核查。",
    ],
  },
  fact_checker: {
    running: [
      "同时生成支持查询和反驳查询。",
      "寻找权威材料、反例、争议点和无法证实的空白。",
      "把候选材料先放进证据池，暂不允许它直接推出结论。",
    ],
    completed: [
      "已完成支持/反驳材料的第一轮归集。",
      "已记录仍缺失的证据问题。",
      "下一步交给信源校验做来源分层。",
    ],
  },
  source_validator: {
    running: [
      "检查来源层级、发布时间、机构属性和转述链条。",
      "区分官方来源、专业解释、媒体转述和低可信线索。",
      "给每条材料标注支持、反驳、限定、背景或不可用角色。",
    ],
    completed: [
      "已完成信源可信度分层。",
      "已把低可信或只支持局部的材料降权。",
      "下一步检查哪些推断仍然不能成立。",
    ],
  },
  report_composer: {
    running: [
      "读取前面智能体留下的证据边界。",
      "核对哪些能信、哪些不能信。",
      "把最终表达压到证据真正允许的强度。",
    ],
    completed: [
      "已完成结论许可审计。",
      "已把强断言降级为更谨慎的表达。",
      "最终摘要只作为收束，不替代上面的推理过程。",
    ],
  },
};

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

function TypewriterText({
  text,
  className,
  speed = 22,
}: {
  text: string;
  className?: string;
  speed?: number;
}) {
  const [visibleText, setVisibleText] = useState("");

  useEffect(() => {
    const nextText = text ?? "";
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (!nextText || prefersReducedMotion) {
      setVisibleText(nextText);
      return;
    }

    let index = 0;
    const chunkSize = Math.max(1, Math.ceil(nextText.length / 180));
    setVisibleText("");

    const timer = window.setInterval(() => {
      index = Math.min(nextText.length, index + chunkSize);
      setVisibleText(nextText.slice(0, index));
      if (index >= nextText.length) {
        window.clearInterval(timer);
      }
    }, speed);

    return () => window.clearInterval(timer);
  }, [text, speed]);

  const isComplete = visibleText.length >= (text ?? "").length;
  return (
    <span className={className ? `${className} typewriter-text` : "typewriter-text"} data-complete={isComplete}>
      {visibleText}
      {text && !isComplete ? <span className="typewriter-caret" aria-hidden="true" /> : null}
    </span>
  );
}

function findAgentStep(steps: HandoffStep[], agent: string) {
  return steps.find((step) => normalizeAgent(step.agent) === agent);
}

function isStepCompleted(steps: HandoffStep[], agent: string) {
  return findAgentStep(steps, agent)?.status === "completed";
}

function isStepRunning(steps: HandoffStep[], agent: string) {
  return findAgentStep(steps, agent)?.status === "running";
}

function isStepFailed(steps: HandoffStep[], agent: string) {
  return findAgentStep(steps, agent)?.status === "failed";
}

function statusFromSignals(completed: boolean, running: boolean, failed = false): CasePathStatus {
  if (failed) return "failed";
  if (completed) return "completed";
  if (running) return "running";
  return "pending";
}

function caseStatusLabel(status: CasePathStatus | StreamItemStatus) {
  switch (status) {
    case "running":
      return "进行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "final":
      return "收束";
    case "queued":
      return "排队";
    case "pending":
    default:
      return "等待";
  }
}

function focusForPathStep(stepId: CasePathId): WorkbenchFocus {
  switch (stepId) {
    case "atoms":
      return "decomposition";
    case "cross_search":
      return "search";
    case "trace":
    case "evidence_chain":
      return "evidence";
    case "reasoning":
      return "reasoning";
    case "closure":
      return "report";
    case "docket":
    default:
      return "dispatch";
  }
}

function statusFromStreamStatus(status: StreamItemStatus): CasePathStatus {
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  if (status === "completed" || status === "final") return "completed";
  return "pending";
}

function casePathIdsForStreamItem(item: MissionStreamItem): CasePathId[] {
  const content = `${item.agentName} ${item.title} ${item.detail}`;
  const normalized = normalizeAgent(content);
  const normalizedAgent = normalizeAgent(item.agentName);

  if (
    item.status === "final" ||
    /写结论|ReportComposer|报告收束|最终报告|最终判断|最终核查|核查收束|闭环|归档|辟谣卡|recommendation|composer/.test(content)
  ) {
    return ["closure"];
  }

  if (/建立核查任务|案件编号|立案任务|办案台|中控启动|planner|执行图|动态规划/.test(content)) {
    return ["docket"];
  }

  if (normalizedAgent.includes("rumor") || /拆题/.test(item.agentName)) {
    return item.status === "running" || /开始|调用/.test(content) ? ["docket"] : ["atoms"];
  }

  if (/原子命题|拆题|可核查问题|风险词|绝对化|分诊/.test(content)) {
    return ["atoms"];
  }

  if (
    normalizedAgent.includes("source") ||
    /信源|来源分层|来源审计|溯源|转载链|缺失来源/.test(content)
  ) {
    return ["trace"];
  }

  if (
    normalizedAgent.includes("search") ||
    /搜索|检索|工具调用|360|anysearch|metaso|tavily|exa|支持\/反驳|双向核查/.test(normalized) ||
    /搜索|检索|工具调用|支持\/反驳|双向核查/.test(content)
  ) {
    return ["cross_search"];
  }

  if (
    normalizedAgent.includes("fact") ||
    /事实核查|支持侧|反驳侧|反证|剂量阈值|储存风险|证据边界|不可推断|可推断|推理|推演|许可|调解/.test(content)
  ) {
    return /不可推断|可推断|推理|推演|许可|调解|证据边界/.test(content) ? ["reasoning"] : ["cross_search"];
  }

  if (/证据链|证据包|矩阵|共识/.test(content)) {
    return ["evidence_chain"];
  }

  return ["docket"];
}

function casePathSignalsFromStream(streamItems: MissionStreamItem[], runStatus: RunStatus) {
  const signals = new Map<CasePathId, CasePathStatus>();
  const orderedItems = [...streamItems].sort((a, b) => a.timestamp - b.timestamp);

  orderedItems.forEach((item) => {
    const status = statusFromStreamStatus(item.status);
    casePathIdsForStreamItem(item).forEach((id) => {
      signals.set(id, status);
    });
  });

  if (streamItems.length === 0 && runStatus === "running") {
    signals.set("docket", "running");
  }

  if (streamItems.length === 0 && runStatus === "completed") {
    signals.set("closure", "completed");
  }

  return signals;
}

function focusForControllerEvent(item: Pick<MissionStreamItem, "agentName" | "title" | "detail" | "status" | "toolId" | "result">): WorkbenchFocus {
  if (item.status === "final") return "report";

  const content = `${item.agentName} ${item.title} ${item.detail}`;
  const normalized = normalizeAgent(content);

  if (isReportReviewerTool(item.agentName, item.toolId, item.result) || /报告审稿|report.?reviewer|proposer-reviewer/i.test(content)) {
    return "report";
  }
  if (/报告|收束|结论|final|composer/.test(content) || normalized.includes("report")) return "report";
  if (/记忆|历史案件|知识库|memory/.test(content) || normalized.includes("memory")) return "memory";
  if (/信源|来源|溯源|证据链|矩阵|共识|source|consensus|evidence/.test(content)) return "evidence";
  if (/搜索|检索|工具|360|anysearch|metaso|tavily|exa|search/.test(normalized) || /搜索|检索|工具/.test(content)) {
    return "search";
  }
  if (/立案|拆题|原子命题|分诊|rumor|claim/.test(content) || normalized.includes("rumor")) return "decomposition";
  if (/推演|许可|边界|反证评分|调解/.test(content)) return "reasoning";
  return "dispatch";
}

function controllerEventKind(item: Pick<MissionStreamItem, "agentName" | "title" | "detail" | "status" | "toolId" | "result">): ControllerEventKind {
  const agentName = displayAgentName(item.agentName);
  const content = `${agentName} ${item.title} ${item.detail}`;
  const normalized = normalizeAgent(content);
  const normalizedAgent = normalizeAgent(agentName).replace(/[\s_-]+/g, "");

  if (item.status === "failed") return "error";
  if (/planner|动态规划|执行图|规划器/.test(normalized) || /规划|执行图/.test(content)) return "planner";
  if (/consensus|debate|冲突|调解/.test(normalized) || /冲突|调解|共识/.test(content)) return "debate";
  if (item.status === "final" || normalizedAgent.includes("写结论") || /最终判断|最终报告|报告收束|证据边界已收束/.test(content)) {
    return "report";
  }
  if (AGENT_ORDER.some((agent) => normalized.includes(agent.replace("_", ""))) || /分诊员|核查员|审计员|收束员/.test(agentName)) {
    return "agent";
  }
  if (
    isReportReviewerTool(item.agentName, item.toolId, item.result) ||
    /报告审稿|report.?reviewer|proposer-reviewer/i.test(content) ||
    /工具|调用|search|360|anysearch|metaso|tavily|exa|parallel/.test(normalized) ||
    /工具|搜索|检索|审稿/.test(content)
  ) {
    return "tool";
  }
  return "thought";
}

function buildControllerProcessEvents({
  streamItems,
  runStatus,
}: {
  streamItems: MissionStreamItem[];
  runStatus: RunStatus;
}): ControllerProcessEvent[] {
  if (streamItems.length > 0) {
    return streamItems.map((item) => ({
      id: item.id,
      title: displayAgentText(item.title),
      detail: displayAgentText(item.detail),
      agentName: displayAgentName(item.agentName),
      status: item.status,
      focus: focusForControllerEvent(item),
      kind: controllerEventKind(item),
      query: item.query,
      model: item.model,
      toolId: item.toolId,
      result: item.result,
      debate: item.debate,
      techDetail: item.techDetail,
    }));
  }

  if (runStatus === "failed") {
    return [
      {
        id: "controller-failed",
        title: "执行中断",
        detail: "等待真实错误信息返回。",
        agentName: "系统",
        status: "failed",
        focus: "dispatch",
        kind: "error",
      },
    ];
  }

  if (runStatus === "completed") {
    return [
      {
        id: "controller-completed",
        title: "核查收束",
        detail: "写结论已把结论压到证据允许的强度。",
        agentName: "写结论",
        status: "final",
        focus: "report",
        kind: "report",
      },
    ];
  }

  return [
    {
      id: "controller-waiting",
      title: runStatus === "running" ? "开始核查" : "等待核查",
      detail: runStatus === "running" ? "等待第一条真实运行事件。" : "启动后按真实事件逐步展开路径。",
      agentName: "系统",
      status: runStatus === "running" ? "running" : "queued",
      focus: "dispatch",
      kind: "thought",
    },
  ];
}

function controllerEventAgentId(event: ControllerProcessEvent): AgentId | "" {
  const content = normalizeAgent(`${event.agentName} ${event.title} ${event.detail}`).replace(/[\s_-]+/g, "");
  if (content.includes("rumordetector") || /拆题/.test(event.agentName)) return "rumor_detector";
  if (content.includes("factchecker") || /事实核查/.test(event.agentName)) return "fact_checker";
  if (content.includes("sourcevalidator") || /溯源/.test(event.agentName)) return "source_validator";
  if (content.includes("reportcomposer") || /写结论/.test(event.agentName)) return "report_composer";
  return "";
}

function operationVerbForEvent(event: ControllerProcessEvent) {
  const content = normalizeAgent(`${event.title} ${event.detail} ${event.toolId ?? ""}`);
  if (event.kind === "debate") return "校准";
  if (event.kind === "report") return "生成";
  if (event.kind === "error") return "阻塞";
  if (isReportReviewerTool(event.agentName, event.toolId, event.result) || /报告审稿|审稿/.test(event.title)) {
    return "审稿";
  }
  if (content.includes("memorywrite") || /写入|归档|记忆/.test(event.title)) return "写入";
  if (content.includes("memorysearch") || /历史|记忆/.test(event.title)) return "读取";
  if (content.includes("vision") || /图片|截图/.test(event.title)) return "读取";
  if (content.includes("search") || /搜索|检索|支持\/反驳/.test(event.title)) return "搜索";
  if (/执行图|规划/.test(event.title)) return "规划";
  return "运行";
}

function operationIconForEvent(event: ControllerProcessEvent) {
  const content = normalizeAgent(`${event.title} ${event.detail} ${event.toolId ?? ""}`);
  if (isReportReviewerTool(event.agentName, event.toolId, event.result) || /报告审稿|审稿/.test(event.title)) {
    return event.result?.passed === false ? "/tool-icons/wrench.svg" : "/tool-icons/check.svg";
  }
  if (/返回|完成|命中|结果|通过/.test(event.title) || content.includes("result")) return "/tool-icons/check.svg";
  if (content.includes("search") || /搜索|检索|查询/.test(`${event.title} ${event.detail}`)) return "/tool-icons/search.svg";
  return "/tool-icons/wrench.svg";
}

/** 流式披露三阶段（与 Kimi 集群原型对齐；随事件推进出现，不在 t=0 一次铺满） */
const STREAM_PHASES = [
  {
    id: 0,
    code: "01",
    title: "命题拆解",
    blurb: "将原陈述拆为可独立核验的命题，避免对复合表述作笼统判定。",
  },
  {
    id: 1,
    code: "02",
    title: "公开材料对照",
    blurb: "按命题分轨核验公开来源，并对来源作可靠性分层。",
  },
  {
    id: 2,
    code: "03",
    title: "结论",
    blurb: "对照公开材料后给出能不能信，以及依据。",
  },
] as const;

function streamPhaseIndexForEvent(event: ControllerProcessEvent): number {
  if (event.kind === "report" || event.focus === "report" || event.status === "final") return 2;
  if (event.kind === "debate") return 1;
  if (event.kind === "error") return Math.max(0, streamPhaseIndexForFocus(event.focus));

  const agentId = controllerEventAgentId(event);
  if (agentId === "report_composer") return 2;
  if (agentId === "rumor_detector") return 0;
  if (agentId === "fact_checker" || agentId === "source_validator") return 1;

  if (event.kind === "tool") {
    const blob = normalizeAgent(`${event.agentName} ${event.title} ${event.detail} ${event.toolId ?? ""}`);
    if (isReportReviewerTool(event.agentName, event.toolId, event.result) || blob.includes("reportreviewer") || /报告审稿/.test(blob)) {
      return 2;
    }
    if (blob.includes("memory")) return 0;
    return 1;
  }

  return streamPhaseIndexForFocus(event.focus);
}

function streamPhaseIndexForFocus(focus: WorkbenchFocus): number {
  switch (focus) {
    case "report":
      return 2;
    case "search":
    case "evidence":
    case "reasoning":
      return 1;
    case "decomposition":
    case "memory":
    case "dispatch":
    default:
      return 0;
  }
}

function looksLikeFullClaimEcho(text: string, claim: string): boolean {
  const body = text.replace(/\s+/g, " ").trim();
  const seed = claim.replace(/\s+/g, " ").trim();
  if (!body || !seed) return false;
  if (body === seed) return true;
  if (seed.length >= 16 && body.includes(seed.slice(0, Math.min(48, seed.length)))) return true;
  if (/接收查询[：:]/.test(body) && seed.length >= 12 && body.includes(seed.slice(0, 20))) return true;
  if (/先把输入转成可核查任务[：:]/.test(body)) return true;
  if (/先读取本地案件库/.test(body) && seed.length >= 12 && body.includes(seed.slice(0, 20))) return true;
  return false;
}

function humanStreamTitle(event: ControllerProcessEvent): string {
  const raw = displayAgentText(event.title).replace(/^\s*(检索|返回|失败|搜索|运行|写入|读取)\s*[|｜]\s*/i, "").trim();
  const blob = normalizeAgent(`${event.agentName} ${event.title} ${event.detail} ${event.toolId ?? ""}`);

  if (isReportReviewerTool(event.agentName, event.toolId, event.result) || /报告审稿|report.?reviewer|proposer-reviewer/i.test(blob)) {
    return formatReportReviewerStreamTitle(event.result, event.status);
  }

  if (blob.includes("memorysearch") || /历史案件参考/.test(`${event.agentName}${raw}`)) {
    if (event.status === "failed" || /失败/.test(event.title)) return "历史案件参考 · 未命中可用记录";
    if (event.status === "completed" || /返回|命中|完成/.test(event.title)) return "历史案件参考 · 已返回";
    return "历史案件参考";
  }

  if (event.kind === "tool") {
    if (blob.includes("memorywrite")) {
      return event.status === "completed" ? "案件记忆归档 · 已写入" : "案件记忆归档";
    }
    if (event.status === "failed" || /失败/.test(event.title)) return "公开材料检索 · 未成功";
    if (event.status === "completed" || /返回|完成|命中/.test(event.title)) return "公开材料检索 · 已返回";
    return "公开材料检索";
  }

  if (event.kind === "report") return raw || "结论";
  if (event.kind === "debate") return raw || "两边证据对不上";
  if (event.kind === "planner") return raw || "制定核查路径";
  if (event.kind === "error") return raw || "核查受阻";
  return raw || event.title;
}

function humanStreamDetail(event: ControllerProcessEvent, claim: string): string {
  if (isReportReviewerTool(event.agentName, event.toolId, event.result) || /报告审稿/.test(`${event.agentName}${event.title}`)) {
    return formatReportReviewerStreamDetail(event.result, event.status);
  }

  const detail = displayAgentText(event.detail).replace(/\s+/g, " ").trim();
  if (!detail) {
    if (event.kind === "tool") return "动作已记录，可在右侧查看明细。";
    return "";
  }

  if (looksLikeFullClaimEcho(detail, claim)) {
    if (event.kind === "tool") {
      const blob = normalizeAgent(`${event.agentName} ${event.title}`);
      if (blob.includes("memory")) return "对照历史类似案件，不作本案直接证据。";
      return "按命题检索公开网页与通告。";
    }
    if (event.kind === "thought" || event.kind === "planner") {
      return "已建立可追踪核查任务，随后按命题推进。";
    }
  }

  // 工具行：query 过长时不当作正文
  if (event.kind === "tool" && event.query?.trim()) {
    const q = event.query.trim();
    if (q.length > 40 || looksLikeFullClaimEcho(q, claim)) {
      if (/命中|返回|来源|支持|反驳|候选/.test(detail) && !looksLikeFullClaimEcho(detail, claim)) {
        return detail.length > 96 ? `${detail.slice(0, 93)}…` : detail;
      }
      const blob = normalizeAgent(`${event.agentName} ${event.title}`);
      if (blob.includes("memory")) return "对照历史类似案件，不作本案直接证据。";
      return "按命题检索公开网页与通告。";
    }
  }

  return detail.length > 96 ? `${detail.slice(0, 93)}…` : detail;
}

function streamPhaseStatusLabel(
  phaseId: number,
  stageIdx: number,
  items: ControllerTranscriptItem[],
  runStatus: RunStatus,
  finalReport: Record<string, unknown> | null
): { status: "pending" | "running" | "completed"; label: string } {
  if (finalReport && phaseId <= 2 && stageIdx >= 2 && phaseId < 2) {
    return { status: "completed", label: "已完成" };
  }
  if (finalReport && phaseId === 2) {
    return { status: "completed", label: "已完成" };
  }

  const hasRunning = items.some((item) => item.status === "running" || item.status === "queued");
  const hasFailed = items.some((item) => item.status === "failed");
  const allDone =
    items.length > 0 &&
    items.every((item) => item.status === "completed" || item.status === "final");

  if (hasRunning) return { status: "running", label: "进行中" };
  if (hasFailed && !allDone) return { status: "running", label: "需关注" };
  if (allDone || stageIdx > phaseId) return { status: "completed", label: "已完成" };
  if (stageIdx === phaseId && runStatus === "running") return { status: "running", label: "进行中" };
  if (items.length === 0) return { status: "pending", label: "未开始" };
  return { status: "pending", label: "未开始" };
}

function streamStatusRank(status: StreamItemStatus): number {
  if (status === "running") return 4;
  if (status === "queued") return 3;
  if (status === "failed") return 2;
  if (status === "completed" || status === "final") return 1;
  return 0;
}

/** 同族事件合并键：历史案件 start/return、同角色 agent 多次状态 */
function streamCollapseKey(event: ControllerProcessEvent): string {
  const blob = normalizeAgent(`${event.agentName} ${event.title} ${event.detail} ${event.toolId ?? ""}`);
  if (event.kind === "agent") {
    const agentId = controllerEventAgentId(event);
    return agentId ? `agent:${agentId}` : `agent:${event.id}`;
  }
  if (isReportReviewerTool(event.agentName, event.toolId, event.result) || /报告审稿|report.?reviewer|proposer-reviewer/i.test(blob)) {
    return "fam:report-reviewer";
  }
  if (blob.includes("memorysearch") || /历史案件参考/.test(`${event.title}${event.agentName}`)) {
    return "fam:memory-search";
  }
  if (blob.includes("memorywrite") || /本地卷宗|案件记忆|保存本案|Agent Memory Write/i.test(`${event.title}${event.agentName}`)) {
    return "fam:memory-write";
  }
  if (
    event.kind === "tool" &&
    !isReportReviewerTool(event.agentName, event.toolId, event.result) &&
    (/公开材料检索|搜索提前接力|parallel search|anysearch|metaso|tavily|\bexa\b|360/i.test(blob) ||
      blob.includes("search"))
  ) {
    return "fam:web-search";
  }
  return `id:${event.id}`;
}

function preferStreamEvent(prev: ControllerProcessEvent, next: ControllerProcessEvent): ControllerProcessEvent {
  const rankNext = streamStatusRank(next.status);
  const rankPrev = streamStatusRank(prev.status);
  if (rankNext > rankPrev) return next;
  if (rankNext < rankPrev) {
    // 完成态覆盖排队，但 running 优先于 completed（进行中更新）
    if (rankPrev === 4) return prev;
  }
  // 同 rank：保留信息更长的 detail / 更新的 title
  if ((next.detail || "").length >= (prev.detail || "").length) {
    return {
      ...next,
      // 若 next 是完成、prev 是 running，用 next
      status: streamStatusRank(next.status) >= streamStatusRank(prev.status) ? next.status : prev.status,
    };
  }
  return {
    ...prev,
    status: streamStatusRank(next.status) > streamStatusRank(prev.status) ? next.status : prev.status,
    detail: prev.detail || next.detail,
    result: next.result ?? prev.result,
  };
}

/**
 * 流式时间线：跨间隔合并同角色 / 同工具族，避免「两个拆题」与历史案件刷屏。
 * 非 agent 行按首次出现顺序；协作集群在首次出现任一 agent 的位置插入一张。
 */
function buildControllerTranscript(controllerEvents: ControllerProcessEvent[]): ControllerTranscriptItem[] {
  const collapsed = new Map<string, ControllerProcessEvent>();
  const order: string[] = [];

  for (const event of controllerEvents) {
    const key = streamCollapseKey(event);
    const prev = collapsed.get(key);
    if (!prev) {
      collapsed.set(key, event);
      order.push(key);
      continue;
    }
    collapsed.set(key, preferStreamEvent(prev, event));
  }

  const transcript: ControllerTranscriptItem[] = [];
  const agentRows: ControllerProcessEvent[] = [];
  let agentClusterPlaced = false;

  const flushAgentCluster = () => {
    if (agentRows.length === 0 || agentClusterPlaced) return;
    agentClusterPlaced = true;
    const rows = [...agentRows];
    transcript.push({
      id: `agent-cluster-${rows.map((row) => controllerEventAgentId(row) || row.id).join("-")}`,
      type: "agent_cluster",
      title: rows.length > 1 ? "协作核查" : humanStreamTitle(rows[0]),
      detail: rows.length > 1 ? `${rows.length} 个角色` : humanStreamDetail(rows[0], ""),
      status: rows.some((row) => row.status === "running" || row.status === "queued")
        ? "running"
        : rows.some((row) => row.status === "failed")
          ? "failed"
          : rows.every((row) => row.status === "completed" || row.status === "final")
            ? "completed"
            : rows[0].status,
      focus: rows[rows.length - 1].focus,
      kind: "agent",
      event: rows[rows.length - 1],
      rows,
    });
  };

  for (const key of order) {
    const event = collapsed.get(key);
    if (!event) continue;

    if (key.startsWith("agent:")) {
      agentRows.push(event);
      // 占位：第一次碰到 agent 时先不 flush，等扫完所有 key 再写一张集群
      continue;
    }

    // 在第一个非 agent 之前若已有 agent，先落集群（保持时间线位置靠前）
    if (agentRows.length > 0 && !agentClusterPlaced) {
      flushAgentCluster();
    }

    if (event.kind === "tool" || key.startsWith("fam:")) {
      const asTool = event.kind === "tool" || key.startsWith("fam:web-search") || key.startsWith("fam:memory");
      transcript.push({
        id: `operation-${event.id}`,
        type: asTool || event.kind === "tool" ? "operation" : "narration",
        title: humanStreamTitle(event),
        detail: event.detail,
        status: event.status,
        focus: event.focus,
        kind: event.kind === "tool" ? "tool" : event.kind,
        event,
      });
      // force operation type for collapsed families that might be thought-kind
      const last = transcript[transcript.length - 1];
      if (key.startsWith("fam:memory") || key.startsWith("fam:web-search")) {
        last.type = "operation";
        last.kind = "tool";
      }
      continue;
    }

    transcript.push({
      id: `narration-${event.id}`,
      type: "narration",
      title: humanStreamTitle(event),
      detail: event.detail,
      status: event.status,
      focus: event.focus,
      kind: event.kind,
      event,
    });
  }

  // 若流以 agent 结尾或只有 agent
  if (agentRows.length > 0 && !agentClusterPlaced) {
    flushAgentCluster();
  } else if (agentRows.length > 0 && agentClusterPlaced) {
    // 更新已放置集群的 rows 为最终 agentRows（order 扫完后 agentRows 已齐）
    const idx = transcript.findIndex((item) => item.type === "agent_cluster");
    if (idx >= 0) {
      const rows = [...agentRows];
      transcript[idx] = {
        ...transcript[idx],
        id: `agent-cluster-${rows.map((row) => controllerEventAgentId(row) || row.id).join("-")}`,
        title: rows.length > 1 ? "协作核查" : humanStreamTitle(rows[0]),
        detail: rows.length > 1 ? `${rows.length} 个角色` : humanStreamDetail(rows[0], ""),
        status: rows.some((row) => row.status === "running" || row.status === "queued")
          ? "running"
          : rows.some((row) => row.status === "failed")
            ? "failed"
            : rows.every((row) => row.status === "completed" || row.status === "final")
              ? "completed"
              : rows[0].status,
        focus: rows[rows.length - 1].focus,
        event: rows[rows.length - 1],
        rows,
      };
    }
  }

  return transcript;
}

function stepForControllerEvent(event: ControllerProcessEvent | null, steps: HandoffStep[]) {
  if (!event) return null;
  const agentId = controllerEventAgentId(event);
  if (agentId) return findAgentStep(steps, agentId) ?? null;
  return null;
}

function latestControllerEventForAgent(controllerEvents: ControllerProcessEvent[], agent: AgentId) {
  return [...controllerEvents].reverse().find((event) => controllerEventAgentId(event) === agent) ?? null;
}

function readingWindowTitle(event: ControllerProcessEvent, step: HandoffStep | null) {
  if (step) {
    const agentId = normalizeAgent(step.agent) as AgentId;
    const meta = AGENT_BADGE_META[agentId];
    return meta ? meta.role : displayAgentName(step.agentName);
  }
  if (event.kind === "tool") return event.title;
  if (event.kind === "report") return "写结论";
  if (event.kind === "debate") return "冲突调解";
  if (event.kind === "error") return "阻塞";
  return "系统";
}

function debateProgressLabel(debate: ConsensusDebateUpdate | undefined) {
  if (!debate) return "等待冲突调解结果";
  if (debate.status === "resolved") return `已裁决 ${debate.conflictCount} 个冲突`;
  const roundCount = debate.rounds.length;
  return roundCount > 0 ? `正在对第 ${roundCount} 轮证据` : "正在列出两边的冲突";
}

function debateReadableTitle(debate: ConsensusDebateUpdate | undefined) {
  if (!debate) return "冲突调解";
  if (debate.status === "resolved") return "裁决";
  return debate.rounds.length > 0 ? "正在对证据" : "两边证据对不上";
}

// Structured output item — one labeled block per output key, preserving array shape.
type StructuredOutputItem =
  | { key: string; label: string; kind: "list"; items: string[] }
  | { key: string; label: string; kind: "text"; text: string };

const STRUCTURED_OUTPUT_MAX_ITEMS = 4; // 每个数组 label 最多展示几条
const STRUCTURED_OUTPUT_MAX_LENGTH = 280; // 单条文本截断阈值

function splitAnalysisIntoSegments(analysis: string): { label: string; body: string }[] {
  // 启发式:把 analysis 文本里 "1) 2) 3) ..." 这样的有编号子点拆成独立段,
  // 其它句子按 "。" 切,然后按首句特征打 label,便于结构化展示。
  const trimmed = analysis.trim();
  if (!trimmed) return [];

  // 检测 "1) xxx; 2) yyy; 3) zzz" 模式
  const numberedRe = /(\d+)\)\s*([^;]+?)(?=(?:\d+\)|$))/g;
  const numbered: { label: string; body: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = numberedRe.exec(trimmed)) !== null) {
    const body = m[2].trim().replace(/[。;；\s]+$/, "");
    if (body) numbered.push({ label: `${m[1]})`, body });
  }
  if (numbered.length >= 2) {
    // 去掉开头被吞掉的前置段(编号之前的内容),单独作为 "综述"
    const firstNumberIdx = trimmed.search(/\d+\)/);
    if (firstNumberIdx > 0) {
      const prelude = trimmed.slice(0, firstNumberIdx).trim();
      if (prelude) numbered.unshift({ label: "综述", body: prelude });
    }
    return numbered;
  }

  // 无编号:按 "。" 拆成 2-3 段
  const sentences = trimmed.split(/(?<=[。！？])/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 2) return [{ label: "综述", body: trimmed }];

  // 前 2 句作为综述,剩余作为"延伸"
  const first = sentences.slice(0, 2).join("");
  const rest = sentences.slice(2).join("");
  const out = [{ label: "综述", body: first }];
  if (rest) out.push({ label: "延伸", body: rest });
  return out;
}

function compactStepOutput(step: HandoffStep): StructuredOutputItem[] {
  const entries: StructuredOutputItem[] = [];

  for (const [key, value] of Object.entries(step.output ?? {})) {
    const label = outputEntryLabel(key);
    if (!label) continue;

    if (typeof value === "string" && value.trim()) {
      const formatted = formatOutputValue(key, value.trim());
      if (key === "analysis" && formatted.length > STRUCTURED_OUTPUT_MAX_LENGTH) {
        // 长 analysis 拆成 综述 + 子段,而不是一坨文本
        const segments = splitAnalysisIntoSegments(formatted);
        for (const seg of segments) {
          entries.push({ key, label: `${label} · ${seg.label}`, kind: "text", text: seg.body });
        }
      } else {
        entries.push({ key, label, kind: "text", text: formatted });
      }
      continue;
    }

    if (typeof value === "number" || typeof value === "boolean") {
      entries.push({ key, label, kind: "text", text: formatOutputValue(key, value) });
      continue;
    }

    if (Array.isArray(value)) {
      const items = value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, STRUCTURED_OUTPUT_MAX_ITEMS)
        .map((item) => item.trim());
      if (items.length > 0) entries.push({ key, label, kind: "list", items });
    }
  }

  return entries.slice(0, step.agent === "report_composer" ? 5 : 6);
}

function outputEntryLabel(key: string) {
  switch (key) {
    case "conclusion":
      return "结论";
    case "summaryForPublic":
      return "给用户看的摘要";
    case "recommendation":
      return "处理建议";
    case "credibilityScore":
      return "原信息可信度";
    case "credibilityLabel":
      return "风险标签";
    case "verdictType":
      return "目前判断";
    case "whyHardToVerify":
      return "证据边界";
    case "supportingEvidence":
      return "支持它的线索";
    case "counterEvidence":
    case "contradictingEvidence":
      return "反驳它的线索";
    case "unresolvedEvidenceGaps":
    case "unresolvedQuestions":
      return "还不能确认的地方";
    case "verifiedSources":
      return "能采用的来源";
    case "questionableSources":
      return "暂不采用的来源";
    case "missingSources":
      return "还缺的来源";
    case "analysis":
      return "分析";
    case "risk":
      return "风险判断";
    case "keyRisk":
      return "关键风险";
    case "diagnosis":
      return "拆题结果";
    case "rumorIndicators":
      return "原话里的风险信号";
    case "detectedPatterns":
      return "可疑表达模式";
    case "claimAtoms":
      return "拆出的原子命题";
    case "rumorTypes":
      return "谣言类型";
    case "severity":
      return "严重程度";
    case "neededEvidence":
      return "还需要哪些证据";
    case "handoffTargets":
      return "交给下游核查";
    case "factCheckResult":
      return "事实核查结论";
    case "confidence":
      return "置信度";
    case "sourceReliability":
      return "信源可靠性";
    case "keyFindings":
      return "查到的关键事实";
    case "verificationNotes":
      return "审计备注";
    case "evidenceChain":
      return "证据链";
    case "logicRisks":
      return "逻辑风险";
    default:
      return "";
  }
}

function formatOutputValue(key: string, value: string | number | boolean) {
  if (key === "verdictType" && typeof value === "string") {
    return displayVerdictType(value, null) || value;
  }
  if (key === "verdictType" && typeof value === "boolean") {
    return value ? "可信" : "不实";
  }
  if (key === "credibilityScore" && typeof value === "number") {
    return `${value}/100（越高越可信）`;
  }
  if (typeof value === "boolean") return value ? "是" : "否";
  return String(value);
}

function evidenceBoundaryItems(step: HandoffStep | null) {
  const bundle = step?.evidenceBundle;
  if (!bundle) return [];

  const evidenceCount = bundle.supportEvidenceIds.length + bundle.contradictEvidenceIds.length;
  const logicRiskCount = bundle.logicRiskCount ?? 0;
  return [
    evidenceCount > 0 ? `候选证据：支持 ${bundle.supportEvidenceIds.length} 条，反驳 ${bundle.contradictEvidenceIds.length} 条。` : "",
    logicRiskCount > 0 ? `不能直接外推：${logicRiskCount} 个推理风险。` : "",
    bundle.unresolvedQuestions.length > 0 ? `还缺：${bundle.unresolvedQuestions.slice(0, 3).join("；")}` : "",
  ].filter(Boolean);
}

interface ReadingSourceItem {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  /**
   * 后端 奕枢风格 浓缩过的精炼摘要（30-150 字）。
   * 优先在 UI 展示；缺失时 fallback 到 snippet（原始抓取内容）。
   */
  condensedSnippet?: string;
  credibility: string;
  credibilityScore?: number;
  sourceType: string;
  evidenceRole: string;
  publishedAt: string;
}

function mapRawSourceItem(
  source: Record<string, unknown>,
  index: number,
  defaultRole = ""
): ReadingSourceItem {
  const url = String(source.url ?? source.link ?? source.href ?? "");
  const domain = String(source.domain ?? source.hostname ?? source.site ?? safeDomainFromUrl(url) ?? "");
  const score = Number(source.credibilityScore ?? source.score);
  return {
    id: String(source.id ?? `S${index + 1}`),
    title: String(source.title ?? source.name ?? source.site_name ?? `来源 ${index + 1}`),
    url,
    domain,
    snippet: String(source.snippet ?? source.summary ?? source.content ?? source.desc ?? ""),
    // 后端 sourceCondenser 浓缩出的 奕枢风格 摘要,失败/缺失时为 undefined
    condensedSnippet: typeof source.condensedSnippet === "string" ? source.condensedSnippet : undefined,
    credibility: String(source.credibility ?? ""),
    credibilityScore: Number.isFinite(score) ? score : undefined,
    sourceType: String(source.sourceType ?? source.type ?? ""),
    evidenceRole: String(source.evidenceRole ?? source.role ?? defaultRole),
    publishedAt: String(source.publishedAt ?? source.published_at ?? source.date ?? ""),
  };
}

function sourceItemsFromResult(result: Record<string, unknown> | null | undefined): ReadingSourceItem[] {
  if (!result) return [];

  const buckets: Array<{ items: unknown; defaultRole: string }> = [
    { items: result.sources, defaultRole: "" },
    { items: result.supportingEvidence, defaultRole: "支持" },
    { items: result.contradictingEvidence, defaultRole: "反驳" },
  ];

  const seen = new Set<string>();
  const out: ReadingSourceItem[] = [];

  for (const bucket of buckets) {
    const rawSources = Array.isArray(bucket.items) ? bucket.items : [];
    for (const raw of rawSources) {
      if (!raw || typeof raw !== "object") continue;
      const source = raw as Record<string, unknown>;
      const item = mapRawSourceItem(source, out.length, bucket.defaultRole);
      const key = item.url || `${item.domain}|${item.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }

  return out;
}

function evidenceRoleLabel(role: string) {
  const value = role.trim().toLowerCase();
  if (!value) return "材料";
  if (value.includes("support") || value.includes("支持")) return "支持";
  if (value.includes("contradict") || value.includes("反驳") || value.includes("counter")) return "反驳";
  if (value.includes("limit") || value.includes("限定") || value.includes("限制")) return "限定";
  if (value.includes("context") || value.includes("背景")) return "背景";
  if (value.includes("lead") || value.includes("线索")) return "线索";
  return role.trim().slice(0, 8);
}

function searchQueriesFromEvent(event: ControllerProcessEvent, step: HandoffStep | null): string[] {
  const queries: string[] = [];
  if (event.query?.trim()) queries.push(event.query.trim());

  const search360 = searchResultFromStep(step);
  if (typeof search360?.supportQuery === "string" && search360.supportQuery.trim()) {
    queries.push(`支持侧：${search360.supportQuery.trim()}`);
  }
  if (typeof search360?.contradictQuery === "string" && search360.contradictQuery.trim()) {
    queries.push(`反驳侧：${search360.contradictQuery.trim()}`);
  }
  if (typeof event.result?.supportQuery === "string" && String(event.result.supportQuery).trim()) {
    queries.push(`支持侧：${String(event.result.supportQuery).trim()}`);
  }
  if (typeof event.result?.contradictQuery === "string" && String(event.result.contradictQuery).trim()) {
    queries.push(`反驳侧：${String(event.result.contradictQuery).trim()}`);
  }
  if (typeof step?.output.query === "string" && step.output.query.trim()) {
    queries.push(step.output.query.trim());
  }

  return Array.from(new Set(queries)).slice(0, 4);
}

function activityThinkingLines(event: ControllerProcessEvent, step: HandoffStep | null): string[] {
  const lines: string[] = [];
  const agentId = step ? normalizeAgent(step.agent) : controllerEventAgentId(event);
  const processCopy = agentId ? AGENT_PROCESS_COPY[agentId] : undefined;
  const phase = step?.status === "completed" || event.status === "completed" || event.status === "final" ? "completed" : "running";

  if (processCopy) {
    lines.push(...processCopy[phase]);
  } else if (event.kind === "tool") {
    lines.push(toolReadingPurpose(event));
  } else if (event.kind === "planner" || event.kind === "thought") {
    lines.push(controllerReadingPurpose(event));
  } else if (event.kind === "debate") {
    lines.push(controllerReadingPurpose(event));
  } else if (event.kind === "error") {
    lines.push(controllerReadingPurpose(event));
  }

  if (typeof step?.output.analysis === "string" && step.output.analysis.trim()) {
    lines.push(step.output.analysis.trim().slice(0, 360));
  }
  if (typeof step?.output.verificationNotes === "string" && step.output.verificationNotes.trim()) {
    lines.push(step.output.verificationNotes.trim().slice(0, 280));
  }
  if (typeof event.result?.traceText === "string" && event.result.traceText.trim()) {
    lines.push(event.result.traceText.trim().slice(0, 280));
  }

  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean))).slice(0, 6);
}

function activityHandoffLines({
  event,
  step,
  relatedQuestions,
  boundaryItems,
  auditItems,
}: {
  event: ControllerProcessEvent;
  step: HandoffStep | null;
  relatedQuestions: string[];
  boundaryItems: string[];
  auditItems: Array<{ label: string; text: string }>;
}): string[] {
  const lines: string[] = [];

  if (step) {
    const handoffTargets = readStringArray(step.output.handoffTargets);
    if (handoffTargets.length > 0) {
      lines.push(`交给下游：${handoffTargets.slice(0, 4).join("；")}`);
    }
    const neededEvidence = readStringArray(step.output.neededEvidence);
    if (neededEvidence.length > 0) {
      lines.push(`还需要的证据：${neededEvidence.slice(0, 4).join("；")}`);
    }
    const unresolved = readStringArray(step.output.unresolvedQuestions).concat(
      readStringArray(step.output.unresolvedEvidenceGaps)
    );
    if (unresolved.length > 0) {
      lines.push(`待确认：${unresolved.slice(0, 4).join("；")}`);
    }
  }

  const missing = auditItems.filter((item) => item.label === "还缺").map((item) => item.text);
  if (missing.length > 0) {
    lines.push(`缺失来源：${missing.slice(0, 3).join("；")}`);
  }

  for (const question of relatedQuestions.slice(0, 4)) {
    lines.push(`继续追查：${question}`);
  }
  for (const item of boundaryItems.slice(0, 3)) {
    lines.push(item);
  }

  if (lines.length === 0 && event.kind === "agent" && (event.status === "running" || event.status === "queued")) {
    lines.push("本步尚未留下交接物；完成后会公示交给下游什么、还缺什么。");
  }

  return Array.from(new Set(lines.map((line) => line.trim()).filter(Boolean))).slice(0, 8);
}

function relatedActivityEvents(event: ControllerProcessEvent, controllerEvents: ControllerProcessEvent[]) {
  const index = controllerEvents.findIndex((item) => item.id === event.id);
  if (index < 0) return [event];

  const agentId = controllerEventAgentId(event);
  const windowStart = Math.max(0, index - 6);
  const related: ControllerProcessEvent[] = [];

  for (let i = windowStart; i <= index; i += 1) {
    const candidate = controllerEvents[i];
    if (candidate.id === event.id) {
      related.push(candidate);
      continue;
    }
    if (agentId && controllerEventAgentId(candidate) === agentId) {
      related.push(candidate);
      continue;
    }
    if (i >= index - 3 && (candidate.kind === "tool" || candidate.kind === "thought" || candidate.kind === "planner")) {
      related.push(candidate);
    }
  }

  return related.slice(-6);
}

function ActivityText({
  text,
  animate,
  speed = 14,
}: {
  text: string;
  animate: boolean;
  speed?: number;
}) {
  if (!text) return null;
  if (animate) return <TypewriterText text={text} speed={speed} />;
  return <span>{text}</span>;
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

function searchResultFromStep(step: HandoffStep | null) {
  const input = step?.input as Record<string, unknown> | undefined;
  const search360 = input?.search360;
  return search360 && typeof search360 === "object" ? (search360 as Record<string, unknown>) : null;
}

function readingSourcesForEvent(event: ControllerProcessEvent, step: HandoffStep | null) {
  const resultSources = sourceItemsFromResult(event.result);
  if (resultSources.length > 0) return resultSources;
  const fromSearch = sourceItemsFromResult(searchResultFromStep(step));
  if (fromSearch.length > 0) return fromSearch;
  if (step?.output && typeof step.output === "object") {
    return sourceItemsFromResult(step.output as Record<string, unknown>);
  }
  return [];
}

function sourceAuditItems(step: HandoffStep | null) {
  if (!step || normalizeAgent(step.agent) !== "source_validator") return [];
  const verified = readStringArray(step.output.verifiedSources).map((item) => ({ label: "采用", text: item }));
  const questionable = readStringArray(step.output.questionableSources).map((item) => ({ label: "暂不采用", text: item }));
  const missing = readStringArray(step.output.missingSources).map((item) => ({ label: "还缺", text: item }));
  return [...verified, ...questionable, ...missing].slice(0, 7);
}

function relatedQuestionsFromResult(result: Record<string, unknown> | null | undefined) {
  return readStringArray(result?.relatedQuestions).slice(0, 4);
}

function compactProcessItems(step: HandoffStep, phase: "running" | "completed") {
  return outputItemsForStep(step, phase)
    .map((item) => displayAgentText(item).replace(/^已完成：/, "").trim())
    .filter(Boolean)
    .slice(0, 2);
}

function visibleAgentOutputItems(step: HandoffStep) {
  const semanticItems = compactStepOutput(step);
  if (semanticItems.length > 0) return semanticItems;
  return compactProcessItems(step, step.status === "completed" ? "completed" : "running");
}

function agentOutputHeading(step: HandoffStep) {
  switch (normalizeAgent(step.agent)) {
    case "rumor_detector":
      return "拆出了什么";
    case "fact_checker":
      return "事实核查查到了什么";
    case "source_validator":
      return "信源审计保留了什么";
    case "report_composer":
      return "结论";
    default:
      return `${displayAgentName(step.agentName)} 的结果`;
  }
}

function controllerProcessingSteps({
  event,
  step,
  sources,
  auditItems,
  relatedQuestions,
}: {
  event: ControllerProcessEvent;
  step: HandoffStep | null;
  sources: ReadingSourceItem[];
  auditItems: Array<{ label: string; text: string }>;
  relatedQuestions: string[];
}) {
  if (event.kind === "tool") {
    if (sources.length > 0) {
      const sourceLines = sources.slice(0, 4).map((source) => {
        const name = source.title || source.domain || "未命名来源";
        const snippet = source.snippet ? `：${source.snippet}` : "";
        return `${name}${snippet}`.slice(0, 140);
      });
      return [
        `返回 ${sources.length} 条来源：${sourceLines.join("；")}`,
        relatedQuestions.length > 0
          ? `下一步要追的检索问题：${relatedQuestions.slice(0, 3).join("；")}`
          : "",
      ].filter(Boolean);
    }
    return [
      event.query ? `查询：${event.query}` : "",
      event.model ? `通道：${event.model}` : "",
      event.result && typeof event.result.traceText === "string" ? event.result.traceText : "",
    ].filter(Boolean);
  }

  if (!step) return [];

  switch (normalizeAgent(step.agent)) {
    case "rumor_detector": {
      const indicators = readStringArray(step.output.rumorIndicators);
      const patterns = readStringArray(step.output.detectedPatterns);
      const analysis = typeof step.output.analysis === "string" ? step.output.analysis.trim() : "";
      return [
        indicators.length > 0 ? `原话里的风险信号：${indicators.slice(0, 4).join("；")}` : "",
        patterns.length > 0 ? `可疑表达模式：${patterns.slice(0, 3).join("；")}` : "",
        analysis ? `拆解结果：${analysis}` : "",
      ].filter(Boolean);
    }
    case "fact_checker": {
      const findings = readStringArray(step.output.keyFindings);
      const counters = readStringArray(step.output.counterEvidence);
      const sourceRefs = readStringArray(step.output.sources);
      return [
        findings.length > 0 ? `查到的事实：${findings.slice(0, 3).join("；")}` : "",
        counters.length > 0 ? `相反材料：${counters.slice(0, 3).join("；")}` : "",
        sourceRefs.length > 0 ? `引用来源：${sourceRefs.slice(0, 3).join("；")}` : "",
      ].filter(Boolean);
    }
    case "source_validator": {
      return [
        auditItems.length > 0 ? `来源处理：${auditItems.slice(0, 5).map((item) => `${item.label} ${item.text}`).join("；")}` : "",
        typeof step.output.verificationNotes === "string" ? `审计备注：${step.output.verificationNotes}` : "",
      ].filter(Boolean);
    }
    case "report_composer": {
      const chain = evidenceChainItems(step.output);
      const conclusion = typeof step.output.conclusion === "string" ? step.output.conclusion.trim() : "";
      const recommendation = typeof step.output.recommendation === "string" ? step.output.recommendation.trim() : "";
      return [
        conclusion ? `结论：${conclusion}` : "",
        chain.length > 0 ? `证据链：${chain.slice(0, 3).map((item) => `${item.layer} - ${item.finding}`).join("；")}` : "",
        recommendation ? `建议：${recommendation}` : "",
      ].filter(Boolean);
    }
    default:
      return [];
  }
}

function toolReadingPurpose(event: ControllerProcessEvent) {
  if (
    isReportReviewerTool(event.agentName, event.toolId, event.result) ||
    /报告审稿/.test(`${event.title}${event.agentName}`)
  ) {
    return "对报告做确定性审稿：挡住空壳结论、过短证据链与过早宣布完成。";
  }
  const content = normalizeAgent(`${event.title} ${event.detail}`);
  if (content.includes("memory")) return "先读历史案件和可复用线索，避免从零开始，也避免把旧结论直接当成本案证据。";
  if (content.includes("vision") || /图片|截图/.test(event.title)) return "把图片材料转成可检索文本，再交给后续拆题和信源审计。";
  if (content.includes("search") || /搜索|检索|支持\/反驳/.test(event.title)) return "把同一命题拆成支持侧和反驳侧同时查，后面只让有来源边界的材料进入判断。";
  if (/写入|记忆|归档/.test(event.title)) return "把本案中可复用的结论边界、来源和未解问题写回记忆库。";
  return "这是一次工具动作，右侧只展示这次动作的查询、返回和用途。";
}

function controllerReadingPurpose(event: ControllerProcessEvent) {
  if (event.kind === "planner") return "先决定核查路径：哪些命题需要事实核查，哪些要做来源审计，哪些必须等证据边界收束。";
  if (event.kind === "debate") return "这里处理支持与反驳材料之间的冲突，目标不是制造结论，而是收紧哪些能信、哪些不能信。";
  if (event.kind === "report") return "报告只列出已采用证据、仍缺来源和不能外推的判断。";
  if (event.kind === "error") return "流程在这里中断，后续结论不能继续展示成已完成。";
  return "把输入转成下一步动作。左侧继续流动，右侧跟随显示当前这一步为什么存在。";
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function searchTaskStats(searchJobs: MultiSearchJob[]) {
  return searchJobs.reduce(
    (stats, job) => {
      job.searchTasks.forEach((task) => {
        stats.total += 1;
        if (task.status === "pending") stats.pending += 1;
        if (task.status === "running") stats.running += 1;
        if (task.status === "completed") stats.completed += 1;
        if (task.status === "failed") stats.failed += 1;
        if (task.result?.sources) {
          stats.sources += task.result.sources.length;
        }
      });
      return stats;
    },
    { total: 0, pending: 0, running: 0, completed: 0, failed: 0, sources: 0 }
  );
}

function isNonAuthenticStep(step: HandoffStep) {
  const source = typeof step.output._source === "string" ? step.output._source : "";
  return step.model.includes("demo-fallback") || source === "demo-fallback";
}

function isDeterministicReportFallback(step: HandoffStep) {
  return step.model.includes("fallback:deterministic-report");
}

function deterministicFallbackReason(step: HandoffStep) {
  const reason = typeof step.output.fallbackReason === "string" ? step.output.fallbackReason.trim() : "";
  return reason ? sanitizePublicReportText(reason) : "最终写作模型未返回稳定结构，系统已用确定性报告兜底，避免长时间挂起。";
}

function formatLatency(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatElapsed(ms: number) {
  if (ms < 60000) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return `${minutes} 分 ${seconds} 秒`;
}

function runStatusText(runStatus: RunStatus, elapsedMs: number, finalReport: Record<string, unknown> | null) {
  if (runStatus === "completed") return finalReport ? "核查完成" : "流程完成";
  if (runStatus === "failed") return "核查中断";
  // Plain process labels (not anthropomorphic); escalate specificity with time / phase.
  if (runStatus === "running" && elapsedMs >= 90000) return "整理结论与边界";
  if (runStatus === "running" && elapsedMs >= 45000) return "对照公开材料";
  if (runStatus === "running" && elapsedMs >= 15000) return "检索公开来源";
  if (runStatus === "running") return "确认核查问题";
  return "准备核查";
}

/** 检索/对照长时间无新步骤时的人话说明（约 1 分钟起）。 */
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

function humanStageIndex(stage: string): number {
  if (stage.includes("理解")) return 0;
  if (stage.includes("对照")) return 1;
  if (stage.includes("整理") || stage.includes("完成") || stage.includes("中断")) return 2;
  return 0;
}

/** 从步骤与事件中抽出可扫读的关键发现（等待预告 + 结果） */
function extractLiveKeyFindings(params: {
  steps: HandoffStep[];
  controllerEvents: ControllerProcessEvent[];
  finalReport: Record<string, unknown> | null;
  max?: number;
}): string[] {
  const max = params.max ?? 5;
  const out: string[] = [];
  const push = (raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (text.length < 12) return;
    // 过滤工具/模型噪音
    if (/minimax|360gpt|Parallel Search|Memory Search|工具调用/i.test(text)) return;
    if (out.some((x) => x === text || x.includes(text.slice(0, 40)) || text.includes(x.slice(0, 40)))) return;
    out.push(text.length > 160 ? `${text.slice(0, 157)}…` : text);
  };

  if (params.finalReport) {
    if (isInterruptedFinalReport(params.finalReport)) {
      return out.slice(0, max);
    }
    // 完整结论留给结果首屏；这里只抬升依据与线索，避免同屏双份结论
    for (const item of evidenceChainItems(params.finalReport).slice(0, 3)) {
      if (isPaddedEvidenceItem(item)) continue;
      if (item.finding) push(item.finding);
      if (item.evidence) push(item.evidence);
    }
    const recommendation = reportText(params.finalReport, "recommendation");
    if (recommendation) push(recommendation);
  }

  for (const step of params.steps) {
    const output = step.output || {};
    const findings = Array.isArray(output.keyFindings) ? output.keyFindings : [];
    for (const f of findings) {
      if (typeof f === "string") push(f);
    }
    const kf = typeof output.analysis === "string" ? output.analysis : "";
    if (step.agent.includes("fact") && kf) push(kf.slice(0, 160));
  }

  // 冲突调解 / 报告收束标题往往带人话结论
  for (const event of params.controllerEvents) {
    if (event.kind === "debate" || event.kind === "report") {
      if (event.title && !/开始|派发|合成|计算 FIRE/i.test(event.title)) {
        const combined = `${event.title}${event.detail ? `：${event.detail}` : ""}`;
        if (/不实|属实|假|真|拼接|辟谣|无法核实|夸大|未能|未发现|确认/i.test(combined)) {
          push(combined);
        }
      }
      if (event.detail && /不实|拼接|辟谣|否认|无法核实|属实/i.test(event.detail)) {
        push(event.detail);
      }
    }
  }

  return out.slice(0, max);
}

function currentModelLine(steps: HandoffStep[], currentStep: HandoffStep | null) {
  const step = currentStep ?? [...steps].reverse().find((item) => item.model);
  if (!step?.model) return "链路准备中";
  // 默认不暴露 provider:model 字符串给主路径
  return step.agentName || "核查进行中";
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

function buildPreviewHandoffSteps(claim: string): HandoffStep[] {
  const now = Date.now();

  return [
    {
      agent: "rumor_detector",
      agentName: "拆题",
      agentIcon: "🚨",
      systemPrompt: "识别高风险谣言表达并拆成可核查任务。",
      input: { claim },
      output: {
        diagnosis: "mixed_misleading",
        keyRisk: "把储存风险夸大成绝对毒性",
      },
      model: "analysis-preview",
      latencyMs: 9200,
      timestamp: now - 24000,
      status: "completed",
      evidenceBundle: {
        agentId: "rumor_detector",
        claimIds: ["claim-root"],
        supportEvidenceIds: [],
        contradictEvidenceIds: [],
        confidenceDelta: -8,
        unresolvedQuestions: ["亚硝酸盐剂量边界", "不同储存条件差异"],
        logicRiskCount: 2,
      },
    },
    {
      agent: "fact_checker",
      agentName: "事实核查",
      agentIcon: "🔎",
      systemPrompt: "执行支持/反驳双向核查，并记录证据缺口。",
      input: { claim, focus: "隔夜菜是否等于毒药" },
      output: {
        supportingEvidence: ["隔夜菜储存不当时亚硝酸盐可能升高"],
        counterEvidence: ["常规冷藏、短时间储存通常不等于急性毒性"],
        unresolvedEvidenceGaps: ["缺少用户实际菜品、温度、时长信息"],
      },
      model: "analysis-preview",
      latencyMs: 13800,
      timestamp: now - 14000,
      status: "running",
      evidenceBundle: {
        agentId: "fact_checker",
        claimIds: ["claim-root", "toxicity-claim"],
        supportEvidenceIds: ["support-storage-risk"],
        contradictEvidenceIds: ["counter-dose-boundary"],
        confidenceDelta: 12,
        unresolvedQuestions: ["是否有权威剂量阈值材料", "是否存在具体病例引用"],
        sourceQualityScore: 68,
      },
    },
    {
      agent: "source_validator",
      agentName: "溯源",
      agentIcon: "📚",
      systemPrompt: "审计来源等级、转载链与证据可用边界。",
      input: { upstreamAgent: "fact_checker" },
      output: {},
      model: "analysis-preview",
      latencyMs: 0,
      timestamp: now - 6000,
      status: "pending",
    },
    {
      agent: "report_composer",
      agentName: "写结论",
      agentIcon: "📝",
      systemPrompt: "只在证据边界清楚后收束表达。",
      input: { upstreamAgent: "source_validator" },
      output: {},
      model: "analysis-preview",
      latencyMs: 0,
      timestamp: now - 3000,
      status: "pending",
    },
  ];
}

function buildPreviewStreamItems(): MissionStreamItem[] {
  const now = Date.now();
  const items: Array<Omit<MissionStreamItem, "timestamp">> = [
    {
      id: "preview-1",
      agentName: "系统",
      title: "收到核查对象",
      detail: "先把“隔夜菜会致癌”转成可核查任务，不直接给真假结论。",
      status: "completed",
    },
    {
      id: "preview-2",
      agentName: "规划",
      title: "制定核查路径",
      detail: "拆题后走支持/反驳双向搜索，再做信源分层和证据边界收束。",
      status: "completed",
    },
    {
      id: "preview-3",
      agentName: "拆题",
      title: "原子命题已拆出",
      detail: "“会致癌”“等于毒药”属于高强度断言，需要先拆成剂量、储存、因果三条线。",
      status: "completed",
    },
    {
      id: "preview-4",
      agentName: "360 AI Search",
      title: "并行检索支持/反驳",
      detail: "支持侧查储存风险，反驳侧查剂量阈值与常规冷藏条件。",
      status: "running",
    },
    {
      id: "preview-5",
      agentName: "事实核查",
      title: "派发事实核查",
      detail: "事实核查会消费搜索证据池，区分支持证据、反证和待补缺口。",
      status: "queued",
    },
  ];

  return items.map((item, index) => ({
    ...item,
    timestamp: now - (items.length - index) * 4200,
  }));
}

function buildPreviewExecutionPlan(claim: string): ExecutionDagPlan {
  return {
    id: "preview-dag",
    claimType: /(导致|致癌|造成|因为|影响)/.test(claim) ? "causal" : "mixed",
    rationale: "先判定这是高风险断言，再按证据需求动态插入反证、信源审计和冲突调解节点。",
    nodes: [
      {
        id: "planner",
        label: "规划",
        layer: "planner",
        status: "completed",
        description: "判断案件形态并生成执行图。",
      },
      {
        id: "rumor_detector",
        label: "拆题",
        agent: "rumor_detector",
        layer: "analysis",
        status: "completed",
        description: "拆出绝对化表达和原子命题。",
      },
      {
        id: "fact_checker",
        label: "事实核查",
        agent: "fact_checker",
        layer: "search",
        status: "running",
        description: "并行寻找支持证据与反证。",
      },
      {
        id: "source_validator",
        label: "溯源",
        agent: "source_validator",
        layer: "audit",
        status: "planned",
        description: "审计来源层级和转载链。",
      },
      {
        id: "consensus_debate",
        label: "冲突调解室",
        layer: "debate",
        status: "planned",
        description: "冲突时插入短轮调解。",
      },
      {
        id: "report_composer",
        label: "写结论",
        agent: "report_composer",
        layer: "report",
        status: "planned",
        description: "按证据许可收束表达。",
      },
    ],
    edges: [
      { from: "planner", to: "rumor_detector" },
      { from: "rumor_detector", to: "fact_checker" },
      { from: "rumor_detector", to: "source_validator" },
      { from: "fact_checker", to: "consensus_debate" },
      { from: "source_validator", to: "consensus_debate" },
      { from: "consensus_debate", to: "report_composer" },
    ],
    criticalPath: ["planner", "rumor_detector", "fact_checker", "source_validator", "consensus_debate", "report_composer"],
  };
}

function buildPreviewSpeculativeRelays(): SpeculativeRelayUpdate[] {
  return [
    {
      id: "preview-relay-1",
      title: "拆题未结束，搜索先接力",
      upstream: "拆题",
      downstream: "360 AI Search",
      trigger: "识别到“会致癌”“等于毒药”后，提前生成剂量阈值与冷藏条件查询。",
      status: "running",
      savedReason: "搜索不等待完整报告，先消费已出现的可行动线索。",
      confidence: "high",
    },
    {
      id: "preview-relay-2",
      title: "证据池并行分发",
      upstream: "360 AI Search",
      downstream: "事实核查 + 溯源",
      trigger: "同一批来源同时进入事实核查和信源审计。",
      status: "queued",
      savedReason: "事实强度和来源可信度分开判断，最后再对齐。",
      confidence: "medium",
    },
  ];
}

function buildPreviewDebates(): ConsensusDebateUpdate[] {
  return [
    {
      id: "preview-debate-1",
      status: "running",
      title: "智能体冲突调解室",
      conflictCount: 2,
      rounds: [
        {
          challenger: "溯源",
          respondent: "事实核查",
          challenge: "部分科普材料只说明储存风险，不能证明“等于毒药”。",
          response: "事实核查已把这类材料降为限定证据，并保留剂量阈值缺口。",
        },
      ],
      finalConsensus: "结论必须从“等于毒药”降级为“储存不当可能增加风险”。",
      confidenceAdjustment: -8,
    },
  ];
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

function buildDecompositionFromRumorStep(claim: string, step: HandoffStep): ClaimDecompositionResult | null {
  const rawAtoms = Array.isArray(step.output.claimAtoms) ? step.output.claimAtoms : [];
  const atomTexts = rawAtoms
    .map((atom) => {
      if (typeof atom === "string") return atom.trim();
      if (atom && typeof atom === "object" && "text" in atom && typeof atom.text === "string") {
        return atom.text.trim();
      }
      if (atom && typeof atom === "object" && "claim" in atom && typeof atom.claim === "string") {
        return atom.claim.trim();
      }
      return "";
    })
    .filter(Boolean);

  if (atomTexts.length === 0) return null;

  const atomicPropositions: AtomicProposition[] = atomTexts.slice(0, 4).map((text, index) => ({
    id: `prop-${String.fromCharCode(97 + index)}`,
    text,
    type: inferAtomicType(text),
    verifiability: "可直接验证",
  }));

  return {
    originalClaim: claim,
    atomicPropositions,
    decompositionReasoning: `${displayAgentName(step.agentName)} 拆出原子命题，后续核查只围绕这些可验证问题展开。`,
  };
}

function inferAtomicType(text: string): AtomicProposition["type"] {
  if (/[0-9%]/.test(text)) return "数值断言";
  if (/(导致|因为|由于|死于|归因|造成)/.test(text)) return "因果推断";
  if (/(称|表示|来源|爆料|传出)/.test(text)) return "归因断言";
  return "事实陈述";
}

function reportText(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return typeof value === "string" ? sanitizePublicReportText(value) : "";
}

function reportNumber(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function reportStringArray(report: Record<string, unknown> | null, key: string) {
  const value = report?.[key];
  return Array.isArray(value)
    ? sanitizePublicReportArray(value.filter((item): item is string => typeof item === "string" && item.trim().length > 0))
    : [];
}

function evidenceChainItems(report: Record<string, unknown> | null) {
  const raw = report?.evidenceChain;
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is {
    layer: string;
    finding: string;
    evidence: string;
    boundary: string;
    sourceRefs: string[];
  } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.layer === "string" &&
      typeof value.finding === "string" &&
      typeof value.evidence === "string" &&
      typeof value.boundary === "string" &&
      Array.isArray(value.sourceRefs)
    );
  }).map((item) => ({
    ...item,
    finding: sanitizePublicReportText(item.finding),
    evidence: sanitizePublicReportText(item.evidence),
    boundary: sanitizePublicReportText(item.boundary),
    sourceRefs: item.sourceRefs.filter((source): source is string => typeof source === "string" && source.trim().length > 0),
  }));
}

function scoreBreakdownDimensions(report: Record<string, unknown> | null) {
  const raw = report?._scoreBreakdown;
  if (!raw || typeof raw !== "object") return [];
  const breakdown = raw as Record<string, unknown>;
  const items = [
    { key: "factCheckSignal", label: "事实核查信号" },
    { key: "searchSignal", label: "搜索证据信号" },
    { key: "sourceSignal", label: "信源可靠信号" },
  ];

  return items.flatMap((item) => {
    const value = breakdown[item.key];
    return typeof value === "number" && Number.isFinite(value)
      ? [{ label: item.label, score: value }]
      : [];
  });
}

function closureActionItems(report: Record<string, unknown> | null) {
  const raw = report?.closureActions;
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is {
    type: string;
    label: string;
    content: string;
    status: string;
  } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.type === "string" &&
      typeof value.label === "string" &&
      typeof value.content === "string" &&
      typeof value.status === "string"
    );
  }).map((action) => ({
    ...action,
    content: sanitizePublicReportText(action.content),
  }));
}

function confidenceDimensions(report: Record<string, unknown> | null) {
  const raw = report?.confidenceDimensions;
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is {
    label: string;
    score: number;
    threshold: number;
    passed: boolean;
    reason: string;
  } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.label === "string" &&
      typeof value.score === "number" &&
      typeof value.threshold === "number" &&
      typeof value.passed === "boolean" &&
      typeof value.reason === "string"
    );
  }).map((dimension) => ({
    ...dimension,
    reason: sanitizePublicReportText(dimension.reason),
  }));
}

function logicRiskItems(report: Record<string, unknown> | null) {
  const raw = report?.logicRiskItems;
  if (!Array.isArray(raw)) return [];

  return raw.filter((item): item is {
    label: string;
    severity: string;
    explanation: string;
    mitigation: string;
  } => {
    if (!item || typeof item !== "object") return false;
    const value = item as Record<string, unknown>;
    return (
      typeof value.label === "string" &&
      typeof value.severity === "string" &&
      typeof value.explanation === "string" &&
      typeof value.mitigation === "string"
    );
  });
}

function displayVerdictType(verdictType: string, score: number | null) {
  if (score !== null && score <= 20) return "不能信";

  return humanizeVerdictType(verdictType);
}

/** Composer 没写出结论：中断，不是「还查不清」。 */
export function isInterruptedFinalReport(report: Record<string, unknown> | null | undefined): boolean {
  return Boolean(report && report._source === "error-boundary");
}

function isPaddedEvidenceItem(item: { finding: string; evidence: string }) {
  return /审核器补全|审稿补全/.test(`${item.finding}${item.evidence}`);
}

function verdictTone(verdictType: string): "true" | "false" | "unverified" | "mixed" {
  const key = verdictType.trim().toLowerCase();
  if (key === "true") return "true";
  if (key === "false" || key === "rumor") return "false";
  if (key === "mixed_misleading" || key === "mixed" || key === "partial") return "mixed";
  return "unverified";
}

function citationLinksFromReport(report: Record<string, unknown> | null): Array<{ title: string; url: string }> {
  if (!report) return [];
  const out: Array<{ title: string; url: string }> = [];
  const seen = new Set<string>();
  const push = (title: string, url: string) => {
    const href = url.trim();
    if (!href || seen.has(href)) return;
    seen.add(href);
    out.push({ title: (title.trim() || hostLabel(href)), url: href });
  };

  if (Array.isArray(report.citationSources)) {
    for (const raw of report.citationSources) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const url = typeof row.url === "string" ? row.url : "";
      const title = typeof row.title === "string" ? row.title : "";
      if (url) push(title, url);
    }
  }

  for (const item of evidenceChainItems(report)) {
    if (isPaddedEvidenceItem(item)) continue;
    for (const ref of item.sourceRefs) {
      const parsed = parseSourceReference(ref);
      if (parsed.href) push(parsed.label, parsed.href);
    }
  }

  return out.slice(0, 3);
}

function OpenSourceLinks({ sources }: { sources: Array<{ title: string; url: string }> }) {
  if (sources.length === 0) return null;
  return (
    <div className="mission-source-links" aria-label="已找到的来源">
      {sources.map((source) => (
        <a
          key={source.url}
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {source.title}
        </a>
      ))}
    </div>
  );
}

function displayCredibilityLabel(label: string, verdictType: string, score: number | null) {
  if (score !== null && score <= 20) return "谣言";
  if (verdictType === "false" && (!label || label === "疑似谣言")) return "谣言";
  return label.replace("疑似谣言", "谣言");
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

function scoreExplanation(score: number, verdictLabel: string, label: string) {
  if (score <= 20) {
    return `原信息可信度为 ${score}/100，越低越不实。系统把核心断言、来源一致性、反证覆盖和逻辑风险合并评估后，将结果标为“${label || verdictLabel || "谣言"}”。`;
  }
  if (score <= 40) {
    return `原信息可信度为 ${score}/100，越高越可信、越低越不实；当前主要问题是证据不足、来源冲突或关键推理链不完整。`;
  }
  if (score <= 70) {
    return `原信息可信度为 ${score}/100，说明部分事实有支撑，但仍存在限定条件或未解决证据缺口。`;
  }
  return `原信息可信度为 ${score}/100，多数关键证据、来源质量和逻辑链条达到可信阈值。`;
}

function SourceReferenceList({ sources }: { sources: string[] }) {
  const visibleSources = sources.slice(0, 8);
  return (
    <details className="mission-source-refs">
      <summary>来源 {sources.length} 条</summary>
      <div>
        {visibleSources.map((source, index) => {
          const parsed = parseSourceReference(source);
          return parsed.href ? (
            <a
              key={`${source}-${index}`}
              href={parsed.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {parsed.label}
            </a>
          ) : (
            <span key={`${source}-${index}`}>{parsed.label}</span>
          );
        })}
      </div>
    </details>
  );
}

function parseSourceReference(source: string) {
  const trimmed = source.trim();
  const urlMatch = trimmed.match(/https?:\/\/[^\s）)]+/) ?? trimmed.match(/www\.[^\s）)]+/);
  if (!urlMatch) return { label: trimmed, href: "" };

  const rawUrl = urlMatch[0];
  const href = rawUrl.startsWith("http") ? rawUrl : `https://${rawUrl}`;
  const label = trimmed.replace(rawUrl, "").replace(/[（()：:丨|]+$/g, "").trim() || hostLabel(href);
  return { label, href };
}

function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function processItemsForAgent(agent?: string | null, phase: "running" | "completed" = "running") {
  const key = normalizeAgent(agent);
  return AGENT_PROCESS_COPY[key]?.[phase] ?? [
    phase === "running" ? "正在读取上一步留下的上下文。" : "已完成当前思考步骤。",
    phase === "running" ? "正在决定下一步要交给哪个智能体。" : "已记下过程。",
  ];
}

function processSummaryForStep(step: HandoffStep, phase: "running" | "completed") {
  const traceItems = phase === "running" ? step.agentContract?.uiTrace.running : step.agentContract?.uiTrace.complete;
  const items = traceItems && traceItems.length > 0 ? traceItems : processItemsForAgent(step.agent, phase);
  const bundle = step.evidenceBundle;
  const evidenceCount = bundle
    ? bundle.supportEvidenceIds.length + bundle.contradictEvidenceIds.length
    : 0;
  const unresolvedCount = bundle?.unresolvedQuestions.length ?? 0;
  const suffix =
    phase === "completed" && (evidenceCount > 0 || unresolvedCount > 0)
      ? ` 本轮留下 ${evidenceCount} 条证据线索、${unresolvedCount} 个待确认问题。`
      : "";
  return `${items.join(" ")}${suffix}`;
}

function agentStartTitle(step: HandoffStep) {
  switch (normalizeAgent(step.agent)) {
    case "rumor_detector":
      return "开始拆题";
    case "fact_checker":
      return "派发事实核查";
    case "source_validator":
      return "派发信源审计";
    case "report_composer":
      return "开始写结论";
    default:
      return "派发核查步骤";
  }
}

function agentCompleteTitle(step: HandoffStep) {
  switch (normalizeAgent(step.agent)) {
    case "rumor_detector":
      return "原子命题已拆出";
    case "fact_checker":
      return "事实证据已回收";
    case "source_validator":
      return "信源边界已审计";
    case "report_composer":
      return "证据边界已收束";
    default:
      return "核查步骤已交付";
  }
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

function skillDisplayTitle(skillId: string): string {
  const hit = AGENT_SKILLS.find((skill) => skill.id === skillId);
  if (hit?.title) return hit.title;
  return skillId.replace(/^skill\./, "").replace(/-/g, " ");
}

function loadedSkillsFromStep(step: HandoffStep | null): string[] {
  if (!step) return [];
  const fromInput = step.input?.loadedSkills;
  if (Array.isArray(fromInput)) {
    return fromInput.filter((id): id is string => typeof id === "string" && id.trim().length > 0);
  }
  return [];
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

function toolStartTitle(toolName?: string | null, toolId?: string | null) {
  if (isReportReviewerTool(toolName, toolId)) return "报告审稿";
  if (isEvidencePursuitToolName(toolName, toolId)) return "追索证据";
  const key = compactToolKey(`${toolName ?? ""} ${toolId ?? ""}`);
  if (key.includes("memorysearch")) return "查阅历史案件参考";
  if (key.includes("memorywrite")) return "归档可复用线索";
  if (key.includes("stepfun") || key.includes("vision")) return "解析图片材料";
  if (key.includes("parallel") || isSearchToolName(toolName, toolId)) return "检索公开材料";
  return `运行 · ${toolDisplayName(toolName, toolId)}`;
}

function toolResultTitle(
  toolName?: string | null,
  result?: Record<string, unknown> | null,
  toolId?: string | null
) {
  if (isReportReviewerTool(toolName, toolId, result)) {
    return formatReportReviewerStreamTitle(result, "completed");
  }
  if (isEvidencePursuitToolName(toolName, toolId, result)) return "追索证据";
  const key = compactToolKey(`${toolName ?? ""} ${toolId ?? ""}`);
  if (key.includes("memorysearch")) return "历史案件参考已返回";
  if (key.includes("memorywrite")) return "可复用线索已归档";
  if (key.includes("stepfun") || key.includes("vision")) return "图片材料已解析";
  if (key.includes("parallel") || isSearchToolName(toolName, toolId)) return "公开材料已返回";
  return `${toolDisplayName(toolName, toolId)} · 已返回`;
}

function isSearchToolName(toolName?: string | null, toolId?: string | null) {
  const key = compactToolKey(`${toolName ?? ""} ${toolId ?? ""}`);
  if (key.includes("memory") || key.includes("reportreviewer") || key.includes("proposerreviewer") || /evidenceloop|evidencepursuit|证据追索|追索证据/.test(key)) {
    return false;
  }
  return /360|anysearch|metaso|tavily|exa|parallel|search/.test(key);
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

function resultString(result: Record<string, unknown> | undefined, key: string) {
  const value = result?.[key];
  return typeof value === "string" ? value : "";
}

function resultArrayCount(result: Record<string, unknown> | undefined, key: string) {
  const value = result?.[key];
  return Array.isArray(value) ? value.length : null;
}

function toolStartDetail(event: OrchestrateStreamEvent, _fallbackClaim: string) {
  if (isReportReviewerTool(event.toolName, event.toolId, event.result)) {
    return formatReportReviewerStreamDetail(null, "running");
  }
  if (isEvidencePursuitToolName(event.toolName, event.toolId, event.result)) {
    const result = event.result ?? {};
    const missing = Array.isArray(result.missingEvidence)
      ? result.missingEvidence.filter((x): x is string => typeof x === "string")
      : [];
    return formatPursuitDetail({
      goal: typeof result.goal === "string" ? result.goal : "追索证据",
      query: event.query,
      missingAfter: missing,
    });
  }
  const key = compactToolKey(`${event.toolName ?? ""} ${event.toolId ?? ""}`);
  if (key.includes("memorysearch")) {
    return "对照历史类似案件，不作本案直接证据。";
  }
  if (key.includes("memorywrite")) {
    return "把可复用线索写入案件记忆，供后续参考。";
  }
  if (key.includes("stepfun") || key.includes("vision")) {
    return "提取截图与图片中的可核验信息。";
  }
  if (key.includes("parallel") || isSearchToolName(event.toolName, event.toolId)) {
    const query = event.query?.trim() ?? "";
    // 短查询可作摘要；完整 claim 不当作每一行正文
    if (query && query.length <= 36) return `围绕「${query}」检索公开网页与通告。`;
    return "按命题检索公开网页、通告与可靠转载。";
  }
  return `${toolDisplayName(event.toolName, event.toolId)} 已接入调度。`;
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

function outputItemsForStep(step: HandoffStep, phase: "running" | "completed") {
  const traceItems = phase === "running" ? step.agentContract?.uiTrace.running : step.agentContract?.uiTrace.complete;
  const items = traceItems && traceItems.length > 0 ? traceItems : processItemsForAgent(step.agent, phase);
  if (phase === "running") {
    return items;
  }
  return items.map((item) => `已完成：${item}`);
}

function selectCurrentStep(steps: HandoffStep[]) {
  return (
    steps.find((step) => step.status === "running") ??
    [...steps].reverse().find((step) => step.status === "completed" || step.status === "failed") ??
    null
  );
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

function ReadingSourceList({ sources }: { sources: ReadingSourceItem[] }) {
  if (sources.length === 0) return null;
  return (
    <div className="controller-source-list">
      {sources.slice(0, 8).map((source, index) => (
        <article key={`${source.id}-${source.url || index}`} className="controller-source-card">
          <div className="controller-source-card-head">
            <span>{source.id || `S${index + 1}`}</span>
            <strong>{source.evidenceRole || "线索"}</strong>
            {source.credibility || source.credibilityScore !== undefined ? (
              <em>{[source.credibility, source.credibilityScore !== undefined ? `${source.credibilityScore}/100` : ""].filter(Boolean).join(" · ")}</em>
            ) : null}
          </div>
          {source.url ? (
            <a href={source.url} target="_blank" rel="noreferrer">
              {source.title}
            </a>
          ) : (
            <b>{source.title}</b>
          )}
          <p>
            <TypewriterText
              text={source.condensedSnippet || source.snippet || "该来源返回了标题或链接，但没有可展示摘要。"}
              speed={14}
            />
          </p>
          <footer>
            {source.domain ? <span>{source.domain}</span> : null}
            {source.sourceType ? <span>{source.sourceType}</span> : null}
            {source.publishedAt ? <span>{source.publishedAt}</span> : null}
          </footer>
        </article>
      ))}
    </div>
  );
}

function SourceAuditList({ items }: { items: Array<{ label: string; text: string }> }) {
  if (items.length === 0) return null;
  return (
    <div className="controller-source-audit-list">
      {items.map((item, index) => (
        <article key={`${item.label}-${item.text}-${index}`} className={`controller-source-audit controller-source-audit--${item.label === "采用" ? "accepted" : item.label === "暂不采用" ? "rejected" : "missing"}`}>
          <strong>{item.label}</strong>
          <p>
            <TypewriterText text={item.text} speed={18} />
          </p>
        </article>
      ))}
    </div>
  );
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
function StructuredAgentOutput({ items }: { items: StructuredOutputItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="controller-structured-output">
      {items.map((item, index) => (
        <motion.section
          key={`${item.key}-${item.label}-${index}`}
          className="controller-structured-block"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2, delay: index * 0.05, ease: EASE_OUT }}
        >
          <h4>{item.label}</h4>
          {item.kind === "list" ? (
            <ul className="controller-structured-dashlist">
              {item.items.map((sub, subIdx) => (
                <li key={`${item.key}-${index}-${subIdx}`}>
                  <TypewriterText text={displayAgentText(sub)} speed={14} />
                </li>
              ))}
            </ul>
          ) : (
            <p>
              <TypewriterText text={displayAgentText(item.text)} speed={14} />
            </p>
          )}
        </motion.section>
      ))}
    </div>
  );
}

function MissionFinalReportPanel({
  claim,
  finalReport,
  onRetry,
}: {
  claim: string;
  finalReport: Record<string, unknown> | null;
  onRetry?: () => void;
}) {
  if (!finalReport) return null;

  const interrupted = isInterruptedFinalReport(finalReport);
  const sources = citationLinksFromReport(finalReport);
  const evidenceChain = evidenceChainItems(finalReport).filter((item) => !isPaddedEvidenceItem(item));
  const whyHardToVerify = interrupted ? [] : reportStringArray(finalReport, "whyHardToVerify");
  const causalBoundary = interrupted ? "" : reportText(finalReport, "causalBoundary");

  if (interrupted) {
    return (
      <section className="mission-final-report mission-final-report--interrupted" aria-label="最终核查判断">
        <p className="mission-final-verdict-word" data-verdict="interrupted">这次没查完</p>
        <p className="mission-final-lede">
          {sources.length > 0
            ? "结论还没写出来。已经找到的来源可以点开看。"
            : "结论还没写出来。可以再查一次。"}
        </p>
        {onRetry ? (
          <button type="button" className="mission-retry-btn" onClick={onRetry}>
            再查一次
          </button>
        ) : null}
        <div className="mission-final-claim">
          <span>核查对象</span>
          <p>{claim}</p>
        </div>
        {sources.length > 0 ? <OpenSourceLinks sources={sources} /> : null}
      </section>
    );
  }

  const conclusion = reportText(finalReport, "conclusion");
  const recommendation = reportText(finalReport, "recommendation");
  const summaryForPublic = reportText(finalReport, "summaryForPublic");
  const verdictType = reportText(finalReport, "verdictType");
  const closureActions = closureActionItems(finalReport);
  const rawScore = reportNumber(finalReport, "credibilityScore");
  const rawLabel = reportText(finalReport, "credibilityLabel");
  const score = normalizeCredibilityScore(rawScore, verdictType, rawLabel);
  const confidenceScore = judgmentConfidenceScore(rawScore, verdictType, rawLabel);
  const dimensions = confidenceDimensions(finalReport);
  const scoreBreakdown = scoreBreakdownDimensions(finalReport);
  const scoreRows = dimensions.length > 0
    ? dimensions.slice(0, 4).map((dimension) => ({
        label: dimension.label,
        value: `${dimension.score}/${dimension.threshold}`,
        detail: dimension.reason,
      }))
    : scoreBreakdown.map((dimension) => ({
        label: dimension.label,
        value: dimension.score.toFixed(2),
        detail: "",
      }));
  const risks = logicRiskItems(finalReport);
  const verdictLabel = humanizeVerdictType(verdictType);
  const label = displayCredibilityLabel(rawLabel, verdictType, score);

  return (
    <section className="mission-final-report" aria-label="最终核查判断">
      <p className="mission-final-verdict-word" data-verdict={verdictTone(verdictType)}>
        {verdictLabel}
      </p>
      {conclusion ? <p className="mission-final-lede">{conclusion}</p> : null}
      {recommendation ? <p className="mission-final-advice">{recommendation}</p> : null}

      <div className="mission-final-claim">
        <span>核查对象</span>
        <p>{claim}</p>
      </div>

      {sources.length > 0 ? <OpenSourceLinks sources={sources} /> : null}

      {evidenceChain.length > 0 ? (
        <div className="mission-evidence-chain" aria-label="问题点">
          <span>问题点</span>
          {evidenceChain.slice(0, 3).map((item, index) => (
            <article key={`${item.layer}-${index}`}>
              <strong>{item.finding || item.layer}</strong>
              {item.evidence ? <p>{item.evidence}</p> : null}
              {item.boundary ? <small>不能推出：{item.boundary}</small> : null}
              {item.sourceRefs.length > 0 ? (
                <SourceReferenceList sources={item.sourceRefs} />
              ) : null}
            </article>
          ))}
        </div>
      ) : null}

      {whyHardToVerify.length > 0 ? (
        <div className="mission-investigation-section" aria-label="为什么难甄别">
          <span>还不确定什么</span>
          <ul>
            {whyHardToVerify.map((item, index) => (
              <li key={`${item}-${index}`}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {causalBoundary ? (
        <div className="mission-causal-boundary" aria-label="不能外推到哪里">
          <span>不能外推到哪里</span>
          <p>{causalBoundary}</p>
        </div>
      ) : null}

      <details className="mission-final-more">
        <summary>更多细节（评分与审计）</summary>
        {score !== null ? (
          <div className="mission-score-explanation" aria-label="评分">
            <span>评分</span>
            <p>{scoreExplanation(score, verdictLabel, label)}</p>
            {confidenceScore !== null ? <p>判断置信度 {confidenceScore}/100</p> : null}
            {scoreRows.length > 0 ? (
              <ul>
                {scoreRows.map((dimension) => (
                  <li key={dimension.label}>
                    <strong>{dimension.label}</strong>
                    <span>{dimension.value}</span>
                    {dimension.detail ? <em>{dimension.detail}</em> : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        {summaryForPublic ? (
          <div className="mission-closure-grid" aria-label="公众摘要">
            <article>
              <span>公众摘要</span>
              <p>{summaryForPublic}</p>
            </article>
          </div>
        ) : null}
        {dimensions.length > 0 ? (
          <div className="mission-confidence-list" aria-label="置信度维度">
            {dimensions.map((dimension) => (
              <article key={dimension.label} className={dimension.passed ? "passed" : "failed"}>
                <div>
                  <strong>{dimension.label}</strong>
                  <span>
                    {dimension.score}/{dimension.threshold}
                  </span>
                </div>
                <p>{dimension.reason}</p>
              </article>
            ))}
          </div>
        ) : null}
        {risks.length > 0 ? (
          <div className="mission-risk-list" aria-label="逻辑风险审计">
            {risks.map((risk) => (
              <article key={`${risk.label}-${risk.severity}`}>
                <strong>{risk.label}</strong>
                <p>{risk.explanation}</p>
                <small>{risk.mitigation}</small>
              </article>
            ))}
          </div>
        ) : null}
        {closureActions.length > 0 ? (
            <div className="mission-action-list" aria-label="接下来">
            <span>接下来</span>
            {closureActions.map((action) => (
              <article
                key={`${action.type}-${action.label}`}
                className={`mission-action-list-item mission-action-list-item--${action.status}`}
              >
                <div>
                  <strong>{action.label}</strong>
                  <em>{action.status}</em>
                </div>
                <p>{action.content}</p>
              </article>
            ))}
          </div>
        ) : null}
      </details>
    </section>
  );
}

function buildCasePathSteps({
  steps,
  claimDecomposition,
  searchJobs,
  consensusReport,
  finalReport,
  evidenceItemCount,
}: {
  steps: HandoffStep[];
  claimDecomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  finalReport: Record<string, unknown> | null;
  evidenceItemCount: number;
}): CasePathStep[] {
  const searchStats = searchTaskStats(searchJobs);
  const searchRunning = searchStats.running > 0 || searchStats.pending > 0;
  return [
    {
      id: "docket",
      label: "拆题",
      description: "拆题识别类型、风险信号和证据需求。",
      producer: "拆题",
      status: statusFromSignals(
        isStepCompleted(steps, "rumor_detector"),
        isStepRunning(steps, "rumor_detector"),
        isStepFailed(steps, "rumor_detector")
      ),
    },
    {
      id: "atoms",
      label: "拆题",
      description: "只使用拆题返回的真实原子命题，不走模板拆题。",
      producer: "拆题 · 原子命题",
      status: statusFromSignals(Boolean(claimDecomposition), isStepRunning(steps, "rumor_detector")),
    },
    {
      id: "trace",
      label: "溯源",
      description: "溯源审计原始来源、转载链和缺失来源。",
      producer: "溯源",
      status: statusFromSignals(
        isStepCompleted(steps, "source_validator"),
        isStepRunning(steps, "source_validator"),
        isStepFailed(steps, "source_validator")
      ),
    },
    {
      id: "cross_search",
      label: "交叉验证",
      description: "360 / AnySearch / Metaso / Tavily / Exa 并行检索同一命题。",
      producer: "搜索工具组",
      status: statusFromSignals(Boolean(consensusReport), searchJobs.length > 0 && searchRunning),
    },
    {
      id: "reasoning",
      label: "逻辑推演",
      description: "事实核查和写结论标明可推断、不可推断和证据缺口。",
      producer: "事实核查 + 写结论",
      status: statusFromSignals(
        isStepCompleted(steps, "fact_checker") || Boolean(finalReport),
        isStepRunning(steps, "fact_checker") || isStepRunning(steps, "report_composer"),
        isStepFailed(steps, "fact_checker") || isStepFailed(steps, "report_composer")
      ),
    },
    {
      id: "evidence_chain",
      label: "证据链",
      description: "把智能体证据包和搜索来源组织成可点击证据板。",
      producer: "证据包",
      status: statusFromSignals(evidenceItemCount > 0 || searchStats.sources > 0, searchJobs.length > 0 && !consensusReport),
    },
    {
      id: "closure",
      label: "接下来",
      description: "只有写结论形成可展示结论后才展示摘要、建议和归档状态。",
      producer: "写结论",
      status: statusFromSignals(Boolean(finalReport), isStepRunning(steps, "report_composer")),
    },
  ];
}

function currentRevealedCasePathStep(pathSteps: CasePathStep[], visiblePathSteps: CasePathStep[]) {
  const scope = visiblePathSteps.length > 0 ? visiblePathSteps : pathSteps;
  return (
    scope.find((step) => step.status === "running") ??
    [...scope].reverse().find((step) => step.status === "failed") ??
    [...scope].reverse().find((step) => step.status === "completed") ??
    scope.find((step) => step.status === "pending") ??
    pathSteps[0]
  );
}

function revealedCasePathSteps(
  pathSteps: CasePathStep[],
  streamItems: MissionStreamItem[],
  runStatus: RunStatus
) {
  const signals = casePathSignalsFromStream(streamItems, runStatus);
  const discoveryOrder = new Map(Array.from(signals.keys()).map((id, index) => [id, index]));

  return pathSteps
    .filter((step) => signals.has(step.id))
    .sort((a, b) => (discoveryOrder.get(a.id) ?? 999) - (discoveryOrder.get(b.id) ?? 999))
    .map((step) => ({
      ...step,
      status: signals.get(step.id) ?? step.status,
    }));
}

function scoreProofItems({
  steps,
  searchJobs,
  finalReport,
  memoryCandidates,
  evidenceItemCount,
}: {
  steps: HandoffStep[];
  searchJobs: MultiSearchJob[];
  finalReport: Record<string, unknown> | null;
  memoryCandidates: MemoryCandidate[];
  evidenceItemCount: number;
}) {
  const stats = searchTaskStats(searchJobs);
  const factStep = findAgentStep(steps, "fact_checker");
  const sourceStep = findAgentStep(steps, "source_validator");
  const supportingEvidence = readStringArray(factStep?.output.supportingEvidence);
  const counterEvidence = readStringArray(factStep?.output.counterEvidence);
  const gaps = readStringArray(factStep?.output.unresolvedEvidenceGaps);
  const verifiedSources = readStringArray(sourceStep?.output.verifiedSources);
  const archivedCount = memoryCandidates.filter((candidate) => candidate.status === "accepted").length;
  const score = normalizeCredibilityScore(
    reportNumber(finalReport, "credibilityScore"),
    reportText(finalReport, "verdictType"),
    reportText(finalReport, "credibilityLabel")
  );

  return [
    {
      label: "准确性",
      value: score !== null ? `原信息可信度 ${score}/100` : `${supportingEvidence.length} 支持 · ${counterEvidence.length} 反证`,
      detail: gaps.length > 0 ? `${gaps.length} 个证据缺口仍保留` : "等待事实核查返回证据边界",
    },
    {
      label: "场景覆盖",
      value: "多类型谣言",
      detail: "健康、社会、财经、科技等案例可复用同一路径",
    },
    {
      label: "结果",
      value: finalReport ? "有结论" : "待结论",
      detail: "核查摘要、存疑归档、分享导出在结论后出现",
    },
    {
      label: "技术架构",
      value: `${archivedCount}/${memoryCandidates.length || 0} 记忆`,
      detail: `${evidenceItemCount || stats.sources} 条证据线索可进入复用`,
    },
    {
      label: "国产模型",
      value: steps.some((step) => !isNonAuthenticStep(step)) ? "已接入" : "待调用",
      detail: "只展示实际返回结果或明确失败状态",
    },
    {
      label: "360 联动",
      value: stats.total > 0 ? `${stats.completed}/${stats.total} 查询` : "待搜索",
      detail: verifiedSources.length > 0 ? `${verifiedSources.length} 个来源已分层` : "360 AI Search 作为优先检索入口",
    },
  ];
}

function caseStatusHint(status: CasePathStatus) {
  if (status === "completed") return "已完成";
  if (status === "running") return "正在处理";
  if (status === "failed") return "需要处理";
  return "等待上游";
}

function CasePathWorkspace({
  claim,
  steps,
  claimDecomposition,
  runStatus,
  finalReport,
  evidenceItemCount,
  searchJobs,
  consensusReport,
  streamItems,
  outputItems,
  currentStep,
  memoryCandidates,
  executionPlan,
  speculativeRelays,
  debateUpdates,
  onFocusChange,
}: {
  claim: string;
  steps: HandoffStep[];
  claimDecomposition: ClaimDecompositionResult | null;
  runStatus: RunStatus;
  finalReport: Record<string, unknown> | null;
  evidenceItemCount: number;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  streamItems: MissionStreamItem[];
  outputItems: string[];
  currentStep: HandoffStep | null;
  memoryCandidates: MemoryCandidate[];
  executionPlan: ExecutionDagPlan | null;
  speculativeRelays: SpeculativeRelayUpdate[];
  debateUpdates: ConsensusDebateUpdate[];
  onFocusChange: (focus: WorkbenchFocus) => void;
}) {
  const pathSteps = buildCasePathSteps({
    steps,
    claimDecomposition,
    searchJobs,
    consensusReport,
    finalReport,
    evidenceItemCount,
  });
  const visiblePathSteps = revealedCasePathSteps(pathSteps, streamItems, runStatus);
  const activeStep = currentRevealedCasePathStep(pathSteps, visiblePathSteps);
  const scoreItems = scoreProofItems({ steps, searchJobs, finalReport, memoryCandidates, evidenceItemCount });

  return (
    <section className="case-path-workspace" aria-label="核查路径工作台">
      <header className="case-path-window-head">
        <div>
          <span>核查路径</span>
          <strong>{claim}</strong>
        </div>
        <em>{caseStatusHint(activeStep.status)}</em>
      </header>

      <nav className="case-path-timeline" aria-label="核查路径">
        {visiblePathSteps.length > 0 ? (
          visiblePathSteps.map((step, index) => {
            return (
              <button
                key={step.id}
                type="button"
                className={`case-path-node case-path-node--${step.status} ${step.id === activeStep.id ? "case-path-node--active" : ""}`}
                onClick={() => onFocusChange(focusForPathStep(step.id))}
              >
                <span className="case-path-node-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="case-path-node-copy">
                  <strong>{step.label}</strong>
                  <small>{step.description}</small>
                </span>
                <em>{caseStatusLabel(step.status)}</em>
              </button>
            );
          })
        ) : (
          <p className="case-empty-state">等待第一条路径节点。</p>
        )}
      </nav>

      <details className="case-score-fold">
        <summary>
          <span>评分项证据</span>
          <strong>准确性 / 结果 / 知识库 / 360 联动</strong>
        </summary>
        <section className="case-score-grid" aria-label="评分证据">
          {scoreItems.map((item) => (
            <article key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
              <p>{item.detail}</p>
            </article>
          ))}
        </section>
      </details>

      <details className="case-technical-fold">
        <summary>
          <span>展开智能体运行细节</span>
          <strong>执行图 / 接力 / 冲突调解</strong>
        </summary>
        <RuntimeFeedPanel
          streamItems={streamItems}
          outputItems={outputItems}
          currentStep={currentStep}
          runStatus={runStatus}
          executionPlan={executionPlan}
          speculativeRelays={speculativeRelays}
          debateUpdates={debateUpdates}
          calmVisual
        />
      </details>
    </section>
  );
}

function SearchProgressPanel({ searchJobs }: { searchJobs: MultiSearchJob[] }) {
  const stats = searchTaskStats(searchJobs);
  const totalProviders = searchJobs.reduce((sum, job) => sum + job.searchTasks.length, 0);

  return (
    <section className="case-board-section" aria-label="搜索进度">
      <div className="case-section-heading">
        <span>搜索进度</span>
        <strong>多引擎搜索进度</strong>
      </div>
      <div className="search-progress-stats">
        <div className="search-progress-ring">
          <svg viewBox="0 0 36 36">
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="var(--border-subtle)"
              strokeWidth="3"
            />
            <path
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="var(--zt-primary)"
              strokeWidth="3"
              strokeDasharray={`${(stats.completed / Math.max(1, totalProviders)) * 100}, 100`}
              style={{ transition: 'stroke-dasharray 200ms cubic-bezier(0.16, 1, 0.3, 1)' }}
            />
          </svg>
          <div className="search-progress-text">
            <strong>{stats.completed}</strong>
            <span>/{totalProviders}</span>
          </div>
        </div>
        <div className="search-progress-detail">
          <span className="search-progress-running">{stats.running} 运行中</span>
          <span className="search-progress-completed">{stats.completed} 已完成</span>
          <span className="search-progress-failed">{stats.failed} 失败</span>
          <span className="search-progress-sources">{stats.sources} 来源</span>
        </div>
      </div>
    </section>
  );
}

function AtomicQuestionsPanel({
  claimDecomposition,
}: {
  claimDecomposition: ClaimDecompositionResult | null;
}) {
  return (
    <section className="case-board-section" aria-label="原子命题">
      <div className="case-section-heading">
        <span>拆题</span>
        <strong>拆题结果</strong>
      </div>
      {claimDecomposition ? (
        <div className="case-atom-list">
          {claimDecomposition.atomicPropositions.map((proposition, index) => (
            <article key={proposition.id}>
              <span>A{index + 1}</span>
              <p>{proposition.text}</p>
              <small>{proposition.type} · {proposition.verifiability}</small>
            </article>
          ))}
        </div>
      ) : (
        <p className="case-empty-state">等待拆题返回真实原子命题。这里不会用模板拆题替代。</p>
      )}
    </section>
  );
}

function SourceTracePanel({ steps }: { steps: HandoffStep[] }) {
  const sourceStep = findAgentStep(steps, "source_validator");
  const verifiedSources = readStringArray(sourceStep?.output.verifiedSources);
  const questionableSources = readStringArray(sourceStep?.output.questionableSources);
  const missingSources = readStringArray(sourceStep?.output.missingSources);
  const notes = typeof sourceStep?.output.verificationNotes === "string" ? sourceStep.output.verificationNotes : "";

  return (
    <section className="case-board-section" aria-label="溯源记录">
      <div className="case-section-heading">
        <span>溯源</span>
        <strong>溯源记录</strong>
      </div>
      {sourceStep ? (
        <div className="case-source-grid">
          <article>
            <span>已验证</span>
            <strong>{verifiedSources.length}</strong>
            <p>{verifiedSources[0] ?? "还没有可采用来源。"}</p>
          </article>
          <article>
            <span>存疑</span>
            <strong>{questionableSources.length}</strong>
            <p>{questionableSources[0] ?? "还没有存疑来源。"}</p>
          </article>
          <article>
            <span>缺失</span>
            <strong>{missingSources.length}</strong>
            <p>{missingSources[0] ?? "还没有标出缺失来源。"}</p>
          </article>
          {notes ? <p className="case-source-note">{notes}</p> : null}
        </div>
      ) : (
        <p className="case-empty-state">溯源尚未返回；不展示推测来源。</p>
      )}
    </section>
  );
}

function EvidenceBoardPanel({
  steps,
  claimDecomposition,
  searchJobs,
  consensusReport,
  consensusStarted,
  onSelectProposition,
}: {
  steps: HandoffStep[];
  claimDecomposition: ClaimDecompositionResult | null;
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  consensusStarted: boolean;
  onSelectProposition: (propositionId: string) => void;
}) {
  const stats = searchTaskStats(searchJobs);
  const hasEvidenceActivity =
    Boolean(claimDecomposition) ||
    searchJobs.length > 0 ||
    Boolean(consensusReport) ||
    steps.some((step) => Boolean(step.evidenceBundle));

  if (!hasEvidenceActivity) {
    return (
      <section className="case-evidence-board case-evidence-board--empty" aria-label="证据链工作区">
        <div className="case-board-topline">
          <div>
            <strong>证据链工作区</strong>
          </div>
        </div>
        <p className="case-evidence-board-empty-copy">
          等待真实拆题和搜索结果返回后，这里会展开溯源记录、交叉验证矩阵和证据链。
        </p>
      </section>
    );
  }

  return (
    <section className="case-evidence-board" aria-label="证据链工作区">
      <div className="case-board-topline">
        <div>
          <strong>证据链工作区</strong>
        </div>
        <div className="case-stat-row" aria-label="搜索任务状态">
          <span>{stats.completed} 已完成</span>
          <span>{stats.running} 运行中</span>
          <span>{stats.failed} 失败</span>
          <span>{stats.sources} 来源</span>
        </div>
      </div>

      <section className="case-board-section" aria-label="多搜索引擎交叉验证">
        <div className="case-section-heading">
          <span>交叉验证</span>
          <strong>交叉验证矩阵</strong>
        </div>
        <p className="case-board-note">
          多个搜索源对同一原子命题并行检索；失败项只记录失败，不补模拟证据。
        </p>
        <div className="mission-consensus-grid case-consensus-grid">
          <ConsensusProgressPanel
            claimDecomposition={claimDecomposition}
            searchJobs={searchJobs}
            consensusReport={consensusReport}
          />
          {consensusReport ? (
            <EvidenceChain
              consensusReport={consensusReport}
              searchJobs={searchJobs}
              claimDecomposition={claimDecomposition}
              onSelectProposition={onSelectProposition}
            />
          ) : (
            <section className="workspace-panel">
              <div className="panel-heading">
                <span>证据矩阵</span>
                <strong>{consensusStarted ? "等待真实搜索返回" : "等待真实拆题结果"}</strong>
              </div>
            </section>
          )}
        </div>
      </section>
    </section>
  );
}

function ControllerRail({
  controllerEvents,
  activeControllerEventId,
  followLive,
  onSelectControllerEvent,
  onFollowLive,
  claim,
  stageIdx,
  finalReport,
  runStatus,
  missionShellModel,
  useMissionShell,
  missionShellVariant,
  selectedShellAgentId,
  onSelectShellAgent,
  onSelectShellTool,
  selectedShellRowKey,
  onSelectShellRow,
}: {
  controllerEvents: ControllerProcessEvent[];
  activeControllerEventId: string;
  followLive: boolean;
  onSelectControllerEvent: (event: ControllerProcessEvent) => void;
  onFollowLive: () => void;
  claim: string;
  stageIdx: number;
  finalReport: Record<string, unknown> | null;
  runStatus: RunStatus;
  missionShellModel?: import("../../../lib/missionShell").MissionShellModel | null;
  useMissionShell?: boolean;
  missionShellVariant?: "token" | "antdx";
  selectedShellAgentId?: string;
  onSelectShellAgent?: (agentId: string) => void;
  onSelectShellTool?: (toolKey: string) => void;
  selectedShellRowKey?: string | null;
  onSelectShellRow?: (rowKey: string) => void;
}) {
  const transcriptItems = useMemo(() => buildControllerTranscript(controllerEvents), [controllerEvents]);
  const flowRef = useRef<HTMLDivElement | null>(null);

  const phasedStream = useMemo(() => {
    const buckets: ControllerTranscriptItem[][] = [[], [], []];
    for (const item of transcriptItems) {
      const phase = Math.min(2, Math.max(0, streamPhaseIndexForEvent(item.event)));
      buckets[phase].push(item);
    }

    // 真流式：只露出「已有事件」的阶段；有 finalReport 时补全到 03
    // 绝不提前铺空的下一阶段说明书
    let maxVisible = -1;
    for (let i = 0; i < buckets.length; i += 1) {
      if (buckets[i].length > 0) maxVisible = Math.max(maxVisible, i);
    }
    if (finalReport) maxVisible = 2;
    if (maxVisible < 0) return [];

    return STREAM_PHASES.filter((phase) => phase.id <= maxVisible && (buckets[phase.id].length > 0 || finalReport)).map(
      (phase) => {
        const items = buckets[phase.id];
        // 无事件的尾阶段（仅 finalReport 时可能）：仍显示结论阶段壳
        if (items.length === 0 && !(finalReport && phase.id === 2)) {
          return null;
        }
        const meta = streamPhaseStatusLabel(phase.id, stageIdx, items, runStatus, finalReport);
        return { ...phase, items, ...meta };
      },
    ).filter((phase): phase is NonNullable<typeof phase> => Boolean(phase));
  }, [transcriptItems, stageIdx, runStatus, finalReport]);

  useEffect(() => {
    const root = flowRef.current;
    if (!root || !activeControllerEventId) return;
    const target = root.querySelector<HTMLElement>(`[data-controller-event-id="${activeControllerEventId}"]`);
    if (!target || typeof target.scrollIntoView !== "function") return;
    target.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeControllerEventId, transcriptItems.length]);

  // 实时跟随时滚到流底部（新事件 entrance，不按 index stagger 旧项）
  useEffect(() => {
    if (!followLive || runStatus !== "running") return;
    const root = flowRef.current;
    if (!root) return;
    root.scrollTop = root.scrollHeight;
  }, [transcriptItems.length, followLive, runStatus, phasedStream.length]);

  const renderStreamItem = (item: ControllerTranscriptItem) => {
    if (item.type === "agent_cluster") {
      return (
        <motion.section
          key={item.id}
          className={`controller-agent-cluster controller-agent-cluster--${item.status}`}
          layout
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.24, ease: EASE_OUT }}
        >
          <button
            type="button"
            className="controller-agent-cluster-head"
            onClick={() => onSelectControllerEvent(item.event)}
            aria-pressed={activeControllerEventId === item.event.id}
            data-controller-event-id={item.event.id}
          >
            <span>协作核查</span>
            <em>{item.rows?.length ?? 1} 个角色</em>
          </button>
          <div className="controller-agent-cluster-list">
            {(item.rows ?? [item.event]).map((row) => {
              const agentId = controllerEventAgentId(row);
              const meta = agentId ? AGENT_BADGE_META[agentId] : null;
              const isActive = activeControllerEventId === row.id;
              const dotState =
                row.status === "completed" || row.status === "final"
                  ? "completed"
                  : row.status === "running"
                    ? "running"
                    : row.status === "failed"
                      ? "failed"
                      : "idle";
              const roleLabel = meta?.role ?? displayAgentName(row.agentName);
              const rowDetail = humanStreamDetail(row, claim) || meta?.role || "";

              return (
                <button
                  key={row.id}
                  type="button"
                  className={`controller-agent-row controller-agent-row--${row.status} ${isActive ? "controller-agent-row--active" : ""}`}
                  onClick={() => onSelectControllerEvent(row)}
                  aria-pressed={isActive}
                  data-controller-event-id={row.id}
                >
                  <AgentStatusDot agentId={agentId ?? row.id} state={dotState} />
                  <span className="controller-agent-avatar">
                    {meta?.avatar ? <img src={meta.avatar} alt="" /> : meta?.code ?? meta?.label ?? "A"}
                  </span>
                  <span className="controller-agent-copy">
                    <strong>{roleLabel}</strong>
                    <small>{rowDetail}</small>
                  </span>
                  <em>{caseStatusLabel(row.status)}</em>
                </button>
              );
            })}
          </div>
        </motion.section>
      );
    }

    if (item.type === "operation") {
      const isActive = activeControllerEventId === item.event.id;
      const title = humanStreamTitle(item.event);
      const detail = humanStreamDetail(item.event, claim);
      const isReviewer = isReportReviewerTool(
        item.event.agentName,
        item.event.toolId,
        item.event.result
      );
      const reviewIssues = isReviewer ? reportReviewerIssueList(item.event.result) : [];
      const kindChip = isReviewer ? "报告审稿" : "检索动作";
      const rowClass = isReviewer
        ? `controller-operation-row controller-operation-row--${item.status} controller-operation-row--review controller-stream-row controller-stream-row--tool ${isActive ? "controller-operation-row--active" : ""}`
        : `controller-operation-row controller-operation-row--${item.status} controller-stream-row controller-stream-row--tool ${isActive ? "controller-operation-row--active" : ""}`;

      return (
        <motion.button
          key={item.id}
          type="button"
          className={rowClass}
          data-status={item.status}
          data-kind="tool"
          data-tool={isReviewer ? "report_reviewer" : undefined}
          data-controller-event-id={item.event.id}
          onClick={() => onSelectControllerEvent(item.event)}
          aria-pressed={isActive}
          layout
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.22, ease: EASE_OUT }}
        >
          <span className={`controller-operation-icon controller-operation-icon--${item.status}`} aria-hidden="true">
            <img src={operationIconForEvent(item.event)} alt="" />
          </span>
          <span className="controller-operation-copy">
            <span className="controller-kind-chip">{kindChip}</span>
            <strong>{title}</strong>
            {detail ? <small>{detail}</small> : null}
            {reviewIssues.length > 0 ? (
              <ul className="controller-review-issue-list" aria-label="审稿意见">
                {reviewIssues.map((issue, index) => (
                  <li key={`issue-${index}`} data-severity={issue.severity}>
                    {issue.message}
                  </li>
                ))}
              </ul>
            ) : null}
          </span>
          <span className="controller-operation-chevron">›</span>
        </motion.button>
      );
    }

    const isActive = activeControllerEventId === item.event.id;
    const title = humanStreamTitle(item.event);
    const detail = humanStreamDetail(item.event, claim);
    const kindHook =
      item.kind === "report"
        ? "report"
        : item.kind === "thought" || item.kind === "planner"
          ? "thought"
          : item.kind;

    return (
      <motion.button
        key={item.id}
        type="button"
        className={`controller-narration controller-narration--${item.status} controller-stream-row controller-stream-row--${kindHook} ${isActive ? "controller-narration--active" : ""}`}
        data-status={item.status}
        data-kind={kindHook}
        data-controller-event-id={item.event.id}
        onClick={() => onSelectControllerEvent(item.event)}
        aria-pressed={isActive}
        layout
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.22, ease: EASE_OUT }}
      >
        <span className={`controller-process-dot controller-process-dot--${item.status}`} />
        <span>
          <span className="controller-kind-chip">{CONTROLLER_EVENT_KIND_LABEL[item.kind]}</span>
          <strong>{title}</strong>
          {detail ? <small>{detail}</small> : null}
        </span>
      </motion.button>
    );
  };

  const hasItems = transcriptItems.length > 0 || phasedStream.length > 0;
  const shellBusy =
    Boolean(useMissionShell && missionShellModel) &&
    ((missionShellModel?.thoughtItems.length ?? 0) > 0 ||
      (missionShellModel?.tools.length ?? 0) > 0 ||
      (missionShellModel?.agents.length ?? 0) > 0 ||
      Boolean(missionShellModel?.errorMessage) ||
      Boolean(missionShellModel?.verdict.present));
  const showAny = useMissionShell ? shellBusy || runStatus === "running" : hasItems;

  return (
    <aside
      className={`case-controller-panel case-controller-panel--stream stream-rail${useMissionShell ? " stream-rail--shell-narrative" : ""}`}
      aria-label="活动过程时间线"
    >
      {/* Product shell: no secondary "核查过程" chrome — claim/stages live in parent top bar */}
      {!useMissionShell ? (
        <div className="controller-transcript-head stream-rail-head">
          <div>
            <span className={`controller-live-dot ${followLive && runStatus === "running" ? "controller-live-dot--live" : "controller-live-dot--paused"}`} />
            <div className="controller-transcript-head-copy">
              <strong>核查过程</strong>
              <span>{hasItems ? "流式展开 · 点选查看明细" : "等待第一条过程事件"}</span>
            </div>
          </div>
          <div className="controller-transcript-head-meta">
            <em>{hasItems ? `${transcriptItems.length} 步` : "LIVE"}</em>
            {!followLive && showAny ? (
              <button type="button" className="controller-follow-live-btn" onClick={onFollowLive}>
                回到最新
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="controller-transcript-flow stream-rail-flow" ref={flowRef}>
        {!useMissionShell && !hasItems ? (
          <motion.p
            className="stream-boot-hint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
          >
            已提交材料。思考、检索与协作角色会按时间顺序出现在这里——不会预先铺满空模块。
          </motion.p>
        ) : null}
        {!useMissionShell && hasItems ? (
          <AnimatePresence initial={false}>
            {phasedStream.map((phase) => (
              <motion.section
                key={`stream-phase-${phase.id}`}
                className={`controller-stream-phase stream-phase stream-phase--${phase.status} controller-stream-phase--${phase.status}`}
                data-phase={phase.code}
                data-status={phase.status}
                layout
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.24, ease: EASE_OUT }}
              >
                <header className="controller-stream-phase-head stream-phase-head">
                  <span className="stream-phase-index">{phase.code}</span>
                  <strong className="controller-section-label stream-phase-title">{phase.title}</strong>
                  <em className={`controller-stream-phase-badge stream-phase-badge stream-phase-badge--${phase.status} controller-stream-phase-badge--${phase.status}`}>
                    {phase.label}
                  </em>
                </header>
                <p className="controller-stream-phase-blurb stream-phase-body">{phase.blurb}</p>

                {phase.items.length > 0 ? (
                  <div className="controller-stream-phase-items">
                    <AnimatePresence initial={false}>
                      {phase.items.map((item) => renderStreamItem(item))}
                    </AnimatePresence>
                  </div>
                ) : null}
              </motion.section>
            ))}
          </AnimatePresence>
        ) : null}
      </div>
    </aside>
  );
}

function ControllerEventDetailPanel({
  claim,
  event,
  steps,
  outputItems,
  controllerEvents,
  finalReport,
  executionPlan,
  runStatus,
  errorMessage,
  followLive,
  onSelectControllerEvent,
}: {
  claim: string;
  event: ControllerProcessEvent | null;
  steps: HandoffStep[];
  outputItems: string[];
  controllerEvents: ControllerProcessEvent[];
  finalReport: Record<string, unknown> | null;
  executionPlan: ExecutionDagPlan | null;
  runStatus: RunStatus;
  errorMessage: string;
  followLive: boolean;
  onSelectControllerEvent: (event: ControllerProcessEvent) => void;
}) {
  if (!event) return null;

  const eventStep = stepForControllerEvent(event, steps);
  const boundaryItems = evidenceBoundaryItems(eventStep);
  const visibleOutputItems = (eventStep
    ? visibleAgentOutputItems(eventStep)
    : outputItems.slice(0, 4).map((text) => {
        // 实时流片段形如 "最终判断: ..." "可信度: ..." — 把冒号前的
        // 短语提出来当 label,避免出现 "实时片段 ×N" 那种空泛堆叠。
        const match = text.match(/^([\u4e00-\u9fa5A-Za-z0-9 ·]{2,16}?)\s*[:：]\s*(.+)$/);
        return match
          ? { key: `stream-${match[1]}`, label: match[1], kind: "text" as const, text: match[2] }
          : { key: "stream", label: "实时片段", kind: "text" as const, text };
      })) as StructuredOutputItem[];
  const visibleAgents = AGENT_ORDER.filter(
    (agent) => findAgentStep(steps, agent) || latestControllerEventForAgent(controllerEvents, agent)
  );
  const activeAgent = controllerEventAgentId(event);
  const activeAgentMeta = activeAgent ? AGENT_BADGE_META[activeAgent] : null;
  const title = readingWindowTitle(event, eventStep);
  const readingSources = readingSourcesForEvent(event, eventStep);
  const auditItems = sourceAuditItems(eventStep);
  const relatedQuestions = relatedQuestionsFromResult(event.result ?? searchResultFromStep(eventStep));
  const debate = event.debate;
  const debateRounds = debate?.rounds ?? [];
  const relatedTrail = relatedActivityEvents(event, controllerEvents);
  const thinkingLines = activityThinkingLines(event, eventStep);
  const searchQueries = searchQueriesFromEvent(event, eventStep);
  const handoffLines = activityHandoffLines({
    event,
    step: eventStep,
    relatedQuestions,
    boundaryItems,
    auditItems,
  });
  const processingSteps = controllerProcessingSteps({
    event,
    step: eventStep,
    sources: readingSources,
    auditItems,
    relatedQuestions,
  });
  const animateTyping =
    followLive && runStatus === "running" && (event.status === "running" || event.status === "queued");
  const modelLine = event.model || eventStep?.model || "";
  const toolChannel =
    event.kind === "tool"
      ? event.agentName
      : typeof event.result?.model === "string"
      ? String(event.result.model)
      : "";

  const leadTitle = humanStreamTitle(event);
  const leadDetail = humanStreamDetail(event, claim) || event.detail;
  const isReviewerEvent = isReportReviewerTool(event.agentName, event.toolId, event.result);
  const reviewIssues = isReviewerEvent ? reportReviewerIssueList(event.result) : [];
  // Only surface skills when present on step input or agent_complete result — no empty panel
  const stepSkills = loadedSkillsFromStep(eventStep);
  const resultSkills = loadedSkillsFromEventResult(event.result);
  const loadedSkills = stepSkills.length > 0 ? stepSkills : resultSkills;
  const hasBodyContent =
    thinkingLines.length > 0 ||
    searchQueries.length > 0 ||
    readingSources.length > 0 ||
    processingSteps.length > 0 ||
    visibleOutputItems.length > 0 ||
    auditItems.length > 0 ||
    handoffLines.length > 0 ||
    Boolean(event.techDetail) ||
    (event.kind === "tool" && Boolean(toolChannel)) ||
    debateRounds.length > 0 ||
    reviewIssues.length > 0 ||
    loadedSkills.length > 0 ||
    Boolean(leadDetail?.trim());

  // 无实质内容时不渲染整块明细壳（避免右栏四大空分区）
  if (!hasBodyContent && (event.status === "running" || event.status === "queued") && followLive) {
    return (
      <motion.section
        key={event.id}
        className="controller-reading-window controller-reading-window--slim controller-activity-window"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2, ease: EASE_OUT }}
        aria-live="polite"
      >
        <header className="controller-reading-head">
          <div className="controller-reading-title">
            <span>
              <strong>{leadTitle}</strong>
              <small>
                <i className={`controller-reading-status controller-reading-status--${event.status}`} />
                {caseStatusLabel(event.status)} · 明细将随输出出现
              </small>
            </span>
          </div>
        </header>
      </motion.section>
    );
  }

  return (
    <motion.section
      key={event.id}
      className={`controller-reading-window controller-reading-window--${event.status} controller-activity-window`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT }}
      aria-live="polite"
    >
      <header className="controller-reading-head">
        <div className="controller-reading-title">
          {activeAgentMeta ? (
            <img className="controller-reading-avatar" src={activeAgentMeta.avatar} alt="" />
          ) : null}
          <span>
            <strong>{title}</strong>
            <small>
              <i className={`controller-reading-status controller-reading-status--${event.status}`} />
              {runStatus === "running" && event.status === "queued" ? "准备中" : caseStatusLabel(event.status)}
              <span className="controller-activity-mode">{followLive ? "实时跟随" : "历史回放"}</span>
            </small>
          </span>
        </div>
        <div className="controller-reading-head-side">
          <span className="controller-kind-chip controller-kind-chip--head">{CONTROLLER_EVENT_KIND_LABEL[event.kind]}</span>
          <em>{activeAgentMeta?.role ?? event.agentName}</em>
        </div>
      </header>

      <div className="controller-reading-body controller-activity-body">
        <p className="controller-reading-lead">
          <strong>{leadTitle}</strong>
          {leadDetail ? <ActivityText text={leadDetail} animate={animateTyping} /> : null}
        </p>

        {reviewIssues.length > 0 ? (
          <details
            className="controller-review-issues"
            open={reviewIssues.some((issue) => issue.severity === "error")}
          >
            <summary>审稿意见 · {reviewIssues.length}</summary>
            <ul className="controller-review-issue-list controller-review-issue-list--detail">
              {reviewIssues.map((issue, index) => (
                <li key={`review-issue-${index}`} data-severity={issue.severity}>
                  {issue.message}
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {loadedSkills.length > 0 ? (
          <section className="controller-skill-row" aria-label="本步 Skills">
            <span className="controller-skill-label">本步 Skills</span>
            <div className="controller-skill-chips">
              {loadedSkills.map((skillId) => (
                <span key={skillId} className="controller-skill-chip">
                  {skillDisplayTitle(skillId)}
                </span>
              ))}
            </div>
          </section>
        ) : null}

        {event.techDetail ? (
          <details className="controller-reading-tech-detail">
            <summary>技术细节</summary>
            <pre>{event.techDetail}</pre>
          </details>
        ) : null}

        <div className="controller-activity-stack" aria-label="本步活动明细">
          {/* 真流式：只渲染有内容的分区，禁止四大空壳占满右栏 */}
          {thinkingLines.length > 0 ? (
            <section className="controller-activity-section" aria-label="思考">
              <header className="controller-activity-section-head">
                <strong>思考摘录</strong>
              </header>
              <ul className="controller-activity-list">
                {thinkingLines.map((line, index) => (
                  <li key={`think-${index}`}>
                    <ActivityText text={line} animate={animateTyping && index === 0} speed={16} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {searchQueries.length > 0 || (event.kind === "tool" && toolChannel) ? (
            <section className="controller-activity-section" aria-label="搜索与工具">
              <header className="controller-activity-section-head">
                <strong>检索与动作</strong>
              </header>
              <div className="controller-activity-tool-grid">
                {searchQueries.map((query) => (
                  <article key={query} className="controller-activity-tool-card">
                    <span>检索意图</span>
                    <p>
                      <ActivityText text={query} animate={animateTyping} speed={18} />
                    </p>
                  </article>
                ))}
                {event.kind === "tool" ? (
                  <article className="controller-activity-tool-card controller-activity-tool-card--wide">
                    <span>用途</span>
                    <p>
                      <ActivityText text={toolReadingPurpose(event)} animate={animateTyping} speed={14} />
                    </p>
                  </article>
                ) : null}
              </div>
              {modelLine ? (
                <details className="controller-reading-tech-detail">
                  <summary>技术细节（模型）</summary>
                  <pre>{modelLine}</pre>
                </details>
              ) : null}
            </section>
          ) : null}

          {readingSources.length > 0 ? (
            <section className="controller-activity-section" aria-label="材料来源">
              <header className="controller-activity-section-head">
                <strong>材料来源 · {readingSources.length}</strong>
              </header>
              <div className="controller-activity-source-list">
                {readingSources.slice(0, 12).map((source) => {
                  const role = evidenceRoleLabel(source.evidenceRole);
                  const body = source.condensedSnippet || source.snippet;
                  return (
                    <article key={source.id} className="controller-activity-source-card">
                      <div className="controller-activity-source-topline">
                        <em className={`controller-activity-role controller-activity-role--${role}`}>{role}</em>
                        <span>{source.domain || "未知域名"}</span>
                        {source.credibilityScore != null ? <small>可信 {source.credibilityScore}</small> : null}
                      </div>
                      <strong>
                        {source.url ? (
                          <a href={source.url} target="_blank" rel="noreferrer">
                            {source.title}
                          </a>
                        ) : (
                          source.title
                        )}
                      </strong>
                      {body ? <p>{body.slice(0, 180)}</p> : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}

          {processingSteps.length > 0 || visibleOutputItems.length > 0 || auditItems.length > 0 || handoffLines.length > 0 ? (
          <section className="controller-activity-section" aria-label="结果与交接">
            <header className="controller-activity-section-head">
              <strong>本步结果</strong>
            </header>
            {processingSteps.length > 0 ? (
              <ol className="controller-activity-findings">
                {processingSteps.map((item, index) => (
                  <li key={`finding-${index}`}>
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <p>
                      <ActivityText text={item} animate={animateTyping && index === 0} speed={14} />
                    </p>
                  </li>
                ))}
              </ol>
            ) : null}
            {eventStep && visibleOutputItems.length > 0 ? (
              <div className="controller-activity-structured">
                <h4>{agentOutputHeading(eventStep)}</h4>
                <StructuredAgentOutput items={visibleOutputItems} />
              </div>
            ) : !eventStep && visibleOutputItems.length > 0 ? (
              <div className="controller-activity-structured">
                <h4>同步输出</h4>
                <StructuredAgentOutput items={visibleOutputItems} />
              </div>
            ) : null}
            {auditItems.length > 0 ? <SourceAuditList items={auditItems} /> : null}
            {handoffLines.length > 0 ? (
              <ul className="controller-activity-list controller-activity-list--handoff">
                {handoffLines.map((line, index) => (
                  <li key={`handoff-${index}`}>
                    <ActivityText text={line} animate={false} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
          ) : null}
        </div>

        {relatedTrail.length > 1 ? (
          <section className="controller-reading-section controller-live-trail" aria-label="本步关联动作">
            <h3>本步关联动作</h3>
            <div className="controller-live-trail-list">
              {relatedTrail.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`controller-live-trail-item controller-live-trail-item--${item.status} ${
                    item.id === event.id ? "controller-live-trail-item--current" : ""
                  }`}
                  onClick={() => onSelectControllerEvent(item)}
                >
                  <span>{CONTROLLER_EVENT_KIND_LABEL[item.kind]}</span>
                  <strong>{item.title}</strong>
                  <p>{item.detail}</p>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        {event.kind === "debate" ? (
          <section className="controller-reading-section controller-reading-debate" aria-live="polite">
            <h3>{debateReadableTitle(debate)}</h3>
            <p>
              <ActivityText text={debateProgressLabel(debate)} animate={animateTyping} speed={14} />
            </p>
            {debateRounds.length > 0 ? (
              <div className="controller-debate-rounds">
                <AnimatePresence initial={false}>
                  {debateRounds.map((round, index) => (
                    <motion.article
                      key={`${round.challenger}-${round.respondent}-${index}`}
                      className="controller-debate-round"
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.22, delay: index * 0.04, ease: EASE_OUT }}
                    >
                      <span>第 {index + 1} 轮</span>
                      <div>
                        <strong>{round.challenger} 质疑</strong>
                        <p>
                          <ActivityText text={round.challenge} animate={animateTyping} speed={13} />
                        </p>
                      </div>
                      <div>
                        <strong>{round.respondent} 回应</strong>
                        <p>
                          <ActivityText text={round.response} animate={animateTyping} speed={13} />
                        </p>
                      </div>
                    </motion.article>
                  ))}
                </AnimatePresence>
              </div>
            ) : (
              <p>
                <ActivityText
                  text="事实核查与溯源已完成并行输出，正在提取冲突点。"
                  animate={animateTyping}
                  speed={14}
                />
              </p>
            )}
            {debate?.status === "resolved" ? (
              <div className="controller-debate-consensus">
                <span>最终裁决</span>
                <p>
                  <ActivityText text={debate.finalConsensus} animate={animateTyping} speed={13} />
                </p>
                <em>置信度调整 {debate.confidenceAdjustment}</em>
              </div>
            ) : null}
          </section>
        ) : null}

        {event.kind === "planner" || event.kind === "thought" ? (
          <section className="controller-reading-section controller-reading-section--plain">
            <h3>核查对象</h3>
            <p>
              <ActivityText text={claim} animate={animateTyping} speed={14} />
            </p>
          </section>
        ) : null}

        {executionPlan && event.kind === "planner" ? (
          <section className="controller-reading-section">
            <h3>执行路径</h3>
            <p>
              <ActivityText text={executionPlan.rationale} animate={animateTyping} speed={14} />
            </p>
            <div className="controller-reading-path">
              {executionPlan.criticalPath.slice(0, 6).map((nodeId) => {
                const node = executionPlan.nodes.find((item) => item.id === nodeId);
                return node ? <span key={node.id}>{executionNodeLabel(node.id, node.label)}</span> : null;
              })}
            </div>
          </section>
        ) : null}

        {event.kind === "report" && finalReport ? (
          <MissionFinalReportPanel claim={claim} finalReport={finalReport} />
        ) : null}

        {errorMessage && !finalReport ? (
          <section className="controller-reading-section controller-reading-section--error">
            <h3>阻塞原因</h3>
            <p>
              <ActivityText text={errorMessage} animate={animateTyping} speed={14} />
            </p>
          </section>
        ) : null}
      </div>

      {visibleAgents.length > 0 ? (
        <div className="controller-reading-tabs" aria-label="Agent 工作切换">
          {visibleAgents.map((agent) => {
            const meta = AGENT_BADGE_META[agent];
            const step = findAgentStep(steps, agent);
            const targetEvent = latestControllerEventForAgent(controllerEvents, agent);
            const isActive = activeAgent === agent;

            return (
              <button
                key={agent}
                type="button"
                className={isActive ? "controller-reading-tab controller-reading-tab--active" : "controller-reading-tab"}
                onClick={() => targetEvent && onSelectControllerEvent(targetEvent)}
                disabled={!targetEvent}
                aria-pressed={isActive}
              >
                <span>{meta.avatar ? <img src={meta.avatar} alt="" /> : meta.label}</span>
                <strong>{meta.role}</strong>
                <em>{caseStatusLabel((step?.status as StreamItemStatus | undefined) ?? "queued")}</em>
              </button>
            );
          })}
        </div>
      ) : null}
    </motion.section>
  );
}

function RuntimeFeedPanel({
  streamItems,
  outputItems,
  currentStep,
  runStatus,
  executionPlan,
  speculativeRelays,
  debateUpdates,
  calmVisual = false,
}: {
  streamItems: MissionStreamItem[];
  outputItems: string[];
  currentStep: HandoffStep | null;
  runStatus: RunStatus;
  executionPlan: ExecutionDagPlan | null;
  speculativeRelays: SpeculativeRelayUpdate[];
  debateUpdates: ConsensusDebateUpdate[];
  calmVisual?: boolean;
}) {
  const visibleStream = streamItems.slice(-4);
  const visibleOutputs = outputItems.slice(-3);
  const currentAgent = displayAgentName(currentStep?.agentName ?? "Mission Control");
  const thinkingTree = useMemo(
    () => buildThinkingTree(streamItems, outputItems, currentStep, runStatus),
    [streamItems, outputItems, currentStep, runStatus]
  );

  return (
    <section className={`runtime-feed-panel ${calmVisual ? "runtime-feed-panel--calm" : ""}`} aria-label="实时调度流">
      <div className="runtime-feed-head">
        <div>
          <span>{WORKBENCH_FOCUS_LABEL.dispatch}</span>
          <strong>{currentAgent}</strong>
        </div>
      </div>

      <details className="runtime-feed-details">
        <summary>
          <span>查看运行细节</span>
          <strong>{thinkingTree.length || visibleStream.length} 个事件</strong>
        </summary>

        <ExecutionDagPanel plan={executionPlan} currentAgent={currentStep?.agent ?? ""} />
        <SpeculativeRelayPanel relays={speculativeRelays} />
        <ConflictMediationPanel debates={debateUpdates} />
        <AgentThinkingTreePanel nodes={thinkingTree} />

        {visibleOutputs.length > 0 ? (
          <div className={`runtime-output-list ${calmVisual ? "runtime-output-list--calm" : ""}`} aria-label="当前智能体输出">
            {visibleOutputs.map((item, index) => (
              <p key={`${item}-${index}`}>{displayAgentText(item)}</p>
            ))}
          </div>
        ) : null}

        <div className="runtime-event-list">
          {visibleStream.length > 0 ? (
            visibleStream.map((item) => (
              <article
                key={item.id}
                className={`runtime-event runtime-event--${item.status} ${calmVisual ? "runtime-event--calm" : ""}`}
              >
                <div>
                  <strong>{displayAgentText(item.title)}</strong>
                  <small>{displayAgentName(item.agentName)}</small>
                </div>
                <p>{displayAgentText(item.detail)}</p>
              </article>
            ))
          ) : (
            <p className="case-empty-state">等待真实智能体事件。这里不会播放预制流程。</p>
          )}
        </div>
      </details>
    </section>
  );
}

function executionLayerLabel(layer: string) {
  switch (layer) {
    case "planner":
      return "规划";
    case "analysis":
      return "拆解";
    case "search":
      return "检索";
    case "audit":
      return "审计";
    case "debate":
      return "调解";
    case "report":
      return "收束";
    default:
      return layer;
  }
}

function executionNodeLabel(nodeId: string, fallback: string) {
  switch (nodeId) {
    case "planner":
      return "路径规划";
    case "rumor_detector":
      return "拆题";
    case "fact_checker":
      return "交叉验证";
    case "source_validator":
      return "信源审计";
    case "alternative_explanation_searcher":
      return "替代解释";
    case "counter_evidence_grader":
      return "反证评分";
    case "consensus_debate":
      return "冲突调解";
    case "report_composer":
      return "写结论";
    default:
      return fallback;
  }
}

function ExecutionDagPanel({
  plan,
  currentAgent,
}: {
  plan: ExecutionDagPlan | null;
  currentAgent: string;
}) {
  if (!plan) return null;

  return (
    <section className="execution-dag-panel" aria-label="动态执行图">
      <div className="execution-dag-head">
        <div>
          <span>核查路径</span>
          <strong>本案节点图</strong>
        </div>
        <em>{claimTypeLabel(plan.claimType)}</em>
      </div>
      <p>{plan.rationale}</p>
      <div className="execution-dag-track">
        {plan.criticalPath.map((nodeId, index) => {
          const node = plan.nodes.find((item) => item.id === nodeId);
          if (!node) return null;
          const active = node.agent && normalizeAgent(node.agent) === normalizeAgent(currentAgent);

          return (
            <div key={node.id} className="execution-dag-hop">
              {index > 0 ? <span className="execution-dag-arrow">→</span> : null}
              <article className={`execution-dag-node execution-dag-node--${node.layer} ${active ? "execution-dag-node--active" : ""}`}>
                <span>{executionLayerLabel(node.layer)}</span>
                <strong>{executionNodeLabel(node.id, node.label)}</strong>
                <small>{node.description}</small>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SpeculativeRelayPanel({ relays }: { relays: SpeculativeRelayUpdate[] }) {
  if (relays.length === 0) return null;

  return (
    <details className="speculative-relay-panel">
      <summary>
        <span>执行优化</span>
        <strong>推测执行接力</strong>
        <em>{relays.length}</em>
      </summary>
      <div className="speculative-relay-list">
        {relays.slice(-3).map((relay) => (
          <article key={relay.id} className={`speculative-relay-item speculative-relay-item--${relay.status}`}>
            <div>
              <strong>{relay.title}</strong>
              <span>{relay.upstream} → {relay.downstream}</span>
            </div>
            <p>{relay.trigger}</p>
            <small>{relay.savedReason}</small>
          </article>
        ))}
      </div>
    </details>
  );
}

function ConflictMediationPanel({ debates }: { debates: ConsensusDebateUpdate[] }) {
  const latest = debates.filter((debate) => debate.status !== "not_needed").slice(-1)[0];
  if (!latest) return null;

  return (
    <details className="conflict-mediation-panel">
      <summary>
        <span>协作校准</span>
        <strong>{latest.title}</strong>
        <em>{latest.conflictCount} 个冲突</em>
      </summary>
      <div className="conflict-mediation-body">
        {latest.rounds.map((round, index) => (
          <article key={`${round.challenger}-${index}`}>
            <span>{round.challenger} 质疑 {round.respondent}</span>
            <p>{round.challenge}</p>
            <strong>{round.response}</strong>
          </article>
        ))}
        <div className="conflict-consensus">
          <span>共识</span>
          <p>{latest.finalConsensus}</p>
          <em>置信度调整 {latest.confidenceAdjustment}</em>
        </div>
      </div>
    </details>
  );
}

function claimTypeLabel(type: ExecutionDagPlan["claimType"]) {
  switch (type) {
    case "causal":
      return "因果推断";
    case "concept":
      return "概念说法";
    case "event":
      return "事件说法";
    case "mixed":
    default:
      return "混合说法";
  }
}

function AgentThinkingTreePanel({ nodes }: { nodes: ThinkingTreeNode[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedId((current) => (current && nodes.some((node) => node.id === current) ? current : null));
  }, [nodes]);

  if (nodes.length === 0) {
    return null;
  }

  return (
    <div className="agent-thinking-tree" aria-label="智能体思考过程">
      <div className="agent-thinking-tree-head">
        <span>思考过程</span>
        <strong>智能体思考过程</strong>
      </div>
      <ul>
        {nodes.map((node, index) => {
          const expanded = expandedId === node.id;

          return (
            <motion.li
              key={node.id}
              className={`thinking-tree-node thinking-tree-node--${node.status}`}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, delay: Math.min(index * 0.035, 0.18), ease: EASE_OUT }}
            >
              <button
                type="button"
                className="thinking-tree-row"
                onClick={() => setExpandedId((current) => (current === node.id ? null : node.id))}
                aria-expanded={expanded}
              >
                <span className="thinking-tree-status" aria-hidden="true">
                  {thinkingStatusMark(node.status)}
                </span>
                <span className="thinking-tree-copy">
                  <strong>{displayAgentText(node.title)}</strong>
                  <small>{displayAgentText(node.description)}</small>
                </span>
                <em>{node.priority}</em>
              </button>
              <AnimatePresence initial={false}>
                {expanded ? (
                  <motion.div
                    className="thinking-tree-detail"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22, ease: [0.2, 0.65, 0.3, 0.9] }}
                  >
                    <p>{displayAgentText(node.description)}</p>
                    {node.tools.length > 0 ? (
                      <div className="thinking-tree-tools">
                        <span>调用能力</span>
                        {node.tools.map((tool) => (
                          <strong key={tool}>{tool}</strong>
                        ))}
                      </div>
                    ) : null}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

function buildThinkingTree(
  streamItems: MissionStreamItem[],
  outputItems: string[],
  currentStep: HandoffStep | null,
  runStatus: RunStatus
): ThinkingTreeNode[] {
  const streamNodes = streamItems.slice(-6).map((item, index): ThinkingTreeNode => ({
    id: item.id,
    title: item.title,
    description: item.detail,
    status: item.status === "failed" ? "failed" : item.status === "running" ? "running" : item.status === "queued" ? "pending" : "completed",
    priority: index < 2 ? "高" : "中",
    tools: inferThinkingTools(item.agentName),
  }));

  if (streamNodes.length > 0) {
    return streamNodes;
  }

  if (currentStep) {
    return outputItems.slice(0, 4).map((item, index) => ({
      id: `${currentStep.agent}-${index}`,
      title: index === 0 ? currentStep.agentName : `思考节点 ${index + 1}`,
      description: item,
      status: runStatus === "failed" ? "failed" : runStatus === "completed" ? "completed" : "running",
      priority: index === 0 ? "高" : "中",
      tools: inferThinkingTools(currentStep.agentName),
    }));
  }

  return [];
}

function inferThinkingTools(agentName: string) {
  const normalized = agentName.toLowerCase();
  if (normalized.includes("fact") || agentName.includes("核查")) return ["360 AI Search", "反证查询"];
  if (normalized.includes("source") || agentName.includes("溯源")) return ["来源分层", "转载链审计"];
  if (normalized.includes("report") || agentName.includes("收束")) return ["结论许可", "知识库候选"];
  if (normalized.includes("tool") || agentName.includes("search")) return ["搜索工具", "证据抽取"];
  return ["调度", "任务分派"];
}

function thinkingStatusMark(status: CasePathStatus) {
  if (status === "completed") return "✓";
  if (status === "running") return "◌";
  if (status === "failed") return "!";
  return "○";
}

function ProofMaturityStrip({
  steps,
  searchJobs,
  consensusReport,
  finalReport,
  evidenceItemCount,
}: {
  steps: HandoffStep[];
  searchJobs: MultiSearchJob[];
  consensusReport: EvidenceConsensusReport | null;
  finalReport: Record<string, unknown> | null;
  evidenceItemCount: number;
}) {
  const stats = searchTaskStats(searchJobs);
  const sourceStep = findAgentStep(steps, "source_validator");
  const factStep = findAgentStep(steps, "fact_checker");
  const verifiedSources = readStringArray(sourceStep?.output.verifiedSources);
  const missingSources = readStringArray(sourceStep?.output.missingSources);
  const supportingEvidence = readStringArray(factStep?.output.supportingEvidence);
  const counterEvidence = readStringArray(factStep?.output.counterEvidence);
  const gaps = readStringArray(factStep?.output.unresolvedEvidenceGaps);

  return (
    <section className="proof-maturity-strip" aria-label="证据成熟度">
      <article>
        <span>溯源</span>
        <strong>{verifiedSources.length} 已核 · {missingSources.length} 缺失</strong>
      </article>
      <article>
        <span>交叉验证</span>
        <strong>{stats.completed}/{Math.max(1, stats.total)} 引擎 · {stats.sources} 来源</strong>
      </article>
      <article>
        <span>推演边界</span>
        <strong>{supportingEvidence.length} 支持 · {counterEvidence.length} 反证 · {gaps.length} 缺口</strong>
      </article>
      <article>
        <span>证据链</span>
        <strong>{evidenceItemCount} 引用 · {consensusReport ? "矩阵完成" : finalReport ? "报告完成" : "生成中"}</strong>
      </article>
    </section>
  );
}

function agentDockStatus(agent: AgentId, steps: HandoffStep[], currentAgent: string | null): CasePathStatus {
  const step = findAgentStep(steps, agent);
  if (step?.status === "failed") return "failed";
  if (step?.status === "completed") return "completed";
  if (step?.status === "running" || currentAgent === agent) return "running";
  return "pending";
}

function agentEvidenceCount(step?: HandoffStep) {
  const bundle = step?.evidenceBundle;
  if (!bundle) return 0;
  return bundle.supportEvidenceIds.length + bundle.contradictEvidenceIds.length;
}

function agentQueueLine(agent: AgentId, step: HandoffStep | undefined, streamItems: MissionStreamItem[]) {
  const copy = AGENT_QUEUE_COPY[agent];
  if (!step) return copy.waiting;

  const normalizedAgentName = normalizeAgent(step.agentName);
  const latestItem = [...streamItems]
    .reverse()
    .find((item) => normalizeAgent(item.agentName) === normalizedAgentName || normalizeAgent(item.agentName).includes(agent.split("_")[0]));

  if (step.status === "running" && latestItem?.detail) return latestItem.detail;
  if (step.status === "completed") return processSummaryForStep(step, "completed");
  if (step.status === "failed") return processSummaryForStep(step, "completed");
  return copy.delivery;
}

function AgentTeamStatusPanel({
  steps,
  currentAgent,
  selectedAgentId,
  activeFocus,
  streamItems,
  onSelect,
}: {
  steps: HandoffStep[];
  currentAgent: string | null;
  selectedAgentId: string;
  activeFocus: WorkbenchFocus;
  streamItems: MissionStreamItem[];
  onSelect: (agent: AgentId, focus: WorkbenchFocus) => void;
}) {
  const runningCount = AGENT_ORDER.filter((agent) => agentDockStatus(agent, steps, currentAgent) === "running").length;
  const completedCount = AGENT_ORDER.filter((agent) => agentDockStatus(agent, steps, currentAgent) === "completed").length;

  return (
    <section className="agent-team-panel" aria-label="核查步骤状态">
      <header className="agent-team-panel-head">
        <div>
          <span>核查步骤</span>
          <strong>当前进度</strong>
        </div>
        <em>{runningCount > 0 ? `${runningCount} 进行中` : `${completedCount}/${AGENT_ORDER.length} 完成`}</em>
      </header>

      <nav className="agent-team-list" aria-label="核查步骤">
        {AGENT_ORDER.map((agent) => {
          const step = findAgentStep(steps, agent);
          const meta = AGENT_BADGE_META[agent];
          const queueCopy = AGENT_QUEUE_COPY[agent];
          const status = agentDockStatus(agent, steps, currentAgent);
          const isSelected = selectedAgentId === agent || activeFocus === queueCopy.focus;
          const actionLine = agentQueueLine(agent, step, streamItems);

          return (
            <button
              key={agent}
              type="button"
              className={`agent-team-row agent-team-row--${status} ${isSelected ? "agent-team-row--selected" : ""}`}
              onClick={() => onSelect(agent, queueCopy.focus)}
              aria-pressed={isSelected}
            >
              <span className="agent-team-avatar" aria-hidden="true">
                {meta.avatar ? <img src={meta.avatar} alt="" /> : meta.label.slice(0, 1)}
              </span>
              <span className="agent-team-copy">
                <strong>{meta.role}</strong>
                <small>{displayAgentText(actionLine)}</small>
              </span>
              <span className="agent-team-meta">
                <strong>{meta.label}</strong>
                <span className={`agent-team-progress agent-team-progress--${status}`} aria-label={caseStatusLabel(status)} />
              </span>
            </button>
          );
        })}
      </nav>
    </section>
  );
}

function AgentDetailPane({
  selectedAgentId,
  steps,
  streamItems,
  onClose,
}: {
  selectedAgentId: string;
  steps: HandoffStep[];
  streamItems: MissionStreamItem[];
  onClose: () => void;
}) {
  if (!selectedAgentId) return null;

  const agent = selectedAgentId as AgentId;
  const step = findAgentStep(steps, agent);
  const meta = AGENT_BADGE_META[agent] ?? { code: "--", label: selectedAgentId, role: selectedAgentId, avatar: "" };
  const contract = step?.agentContract ?? getAgentContract(agent);
  const queueCopy = AGENT_QUEUE_COPY[agent];
  const agentName = normalizeAgent(step?.agentName ?? meta.role);
  const relatedItems = streamItems
    .filter((item) => normalizeAgent(item.agentName) === agentName || normalizeAgent(item.agentName).includes(agent.split("_")[0]))
    .slice(-8);

  return (
    <aside className="agent-detail-pane" aria-label={`${meta.role} 工作状态`}>
      <div className="agent-detail-head">
        <div>
          <span>{meta.label}</span>
          <strong>{meta.role}</strong>
          <p>{queueCopy?.delivery ?? meta.label}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭详情">
          关闭
        </button>
      </div>

      {contract ? (
        <section className="agent-detail-section">
          <span>当前职责</span>
          <p>{contract.mission}</p>
          <details className="agent-detail-tech-fold">
            <summary>工具与记忆</summary>
            <div className="agent-detail-grid">
              <div>
                <strong>工具</strong>
                <p>{contract.tools.map((tool) => tool.name).join(" / ") || "未声明"}</p>
              </div>
              <div>
                <strong>记忆写入</strong>
                <p>{contract.memory.writes.join(" / ") || "未声明"}</p>
              </div>
            </div>
          </details>
        </section>
      ) : null}

      <section className="agent-detail-section">
        <span>工作状态</span>
        {step ? (
          <div className="agent-detail-grid">
            <div>
              <strong>状态</strong>
              <p>{caseStatusLabel(step.status)}</p>
            </div>
            <div>
              <strong>用时</strong>
              <p>{formatLatency(step.latencyMs)}</p>
            </div>
            <div>
              <strong>证据包</strong>
              <p>{agentEvidenceCount(step)} 条</p>
            </div>
            <div>
              <strong>交付</strong>
              <p>{displayAgentText(processSummaryForStep(step, step.status === "completed" ? "completed" : "running"))}</p>
            </div>
          </div>
        ) : (
          <p>该智能体尚未开始。运行后才会展示实际核查结果。</p>
        )}
      </section>

      <section className="agent-detail-section">
        <span>过程记录</span>
        <div className="agent-detail-log">
          {relatedItems.length > 0 ? (
            relatedItems.map((item) => (
              <article key={item.id}>
                <strong>{displayAgentText(item.title)}</strong>
                <p>{displayAgentText(item.detail)}</p>
              </article>
            ))
          ) : (
            <p>暂无该智能体的流式记录。</p>
          )}
        </div>
      </section>
    </aside>
  );
}

export function MissionControlView({
  claim,
  intake,
  onCancel,
  onRetry,
  previewMode = false,
  modelChoice,
  onComplete,
  initialFinalReport = null,
}: MissionControlViewProps) {
  const { state, dispatch } = useReasoning();
  const knowledgeBase = useMemo(() => createKnowledgeBase(), []);
  const [steps, setSteps] = useState<HandoffStep[]>([]);
  const [currentStep, setCurrentStep] = useState<HandoffStep | null>(null);
  const [outputItems, setOutputItems] = useState<string[]>([]);
  const [streamItems, setStreamItems] = useState<MissionStreamItem[]>([]);
  const [finalReport, setFinalReport] = useState<Record<string, unknown> | null>(initialFinalReport);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [stallMs, setStallMs] = useState(0);
  const lastActivityAtRef = useRef<number>(Date.now());
  const [runStatus, setRunStatus] = useState<RunStatus>(initialFinalReport ? "completed" : "idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [selectedPropositionId, setSelectedPropositionId] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedShellRowKey, setSelectedShellRowKey] = useState<string | null>(null);
  const [workbenchFocus, setWorkbenchFocus] = useState<WorkbenchFocus>("dispatch");
  const [activeControllerEventId, setActiveControllerEventId] = useState("");
  const [followLive, setFollowLive] = useState(true);
  const [consensusStarted, setConsensusStarted] = useState(false);
  const [memoryCandidates, setMemoryCandidates] = useState<MemoryCandidate[]>([]);
  const [executionPlan, setExecutionPlan] = useState<ExecutionDagPlan | null>(null);
  const [speculativeRelays, setSpeculativeRelays] = useState<SpeculativeRelayUpdate[]>([]);
  const [debateUpdates, setDebateUpdates] = useState<ConsensusDebateUpdate[]>([]);
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
    }, 250);

    return () => window.clearInterval(timer);
  }, [runStatus, startedAt]);

  useEffect(() => {
    const trimmedClaim = claim.trim();
    if (!trimmedClaim) return;

    dispatch({ type: "RESET_CONSENSUS" });
    setSelectedPropositionId("");
    setSelectedAgentId("");
    setSelectedShellRowKey(null);
    setActiveControllerEventId("");
    setFollowLive(true);
    setConsensusStarted(false);
    setMemoryCandidates([]);
    setExecutionPlan(null);
    setSpeculativeRelays([]);
    setDebateUpdates([]);
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

  const runConsensusPipeline = useCallback(
    async (decomposition: ClaimDecompositionResult) => {
      dispatch({ type: "SET_CLAIM_DECOMPOSITION", payload: decomposition });

      const jobs = buildSearchJobs(
        decomposition.atomicPropositions.map((proposition) => proposition.text),
        { enableCounterSearch: true }
      );
      dispatch({ type: "SET_SEARCH_JOBS", payload: jobs });

      const completedJobs = await executeSearchJobs(jobs, { enableCounterSearch: true });
      dispatch({ type: "SET_SEARCH_JOBS", payload: completedJobs });
      const consensusReport = await evaluateConsensus(completedJobs);
      dispatch({ type: "SET_CONSENSUS_REPORT", payload: consensusReport });
    },
    [dispatch]
  );

  useEffect(() => {
    if (!claim.trim()) return;
    if (previewMode) return;
    if (initialFinalReport && streamKey === 0) return;

    let cancelled = false;
    let streamEnded = false;
    let accumulatedSteps: HandoffStep[] = [];
    setMemoryCandidates([]);

    const pushStreamItem = (item: Omit<MissionStreamItem, "id" | "timestamp">) => {
      setStreamItems((prev) => [
        ...prev,
        {
          ...item,
          agentName: displayAgentName(item.agentName),
          title: displayAgentText(item.title),
          detail: displayAgentText(item.detail),
          id: `${Date.now()}-${prev.length}`,
          timestamp: Date.now(),
        },
      ]);
    };

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
        setCurrentStep(null);
        setStreamItems([]);
        setSseEvents([]);
        // Shell selection is run-scoped; clear so prior case filter/tool inspector does not stick.
        setSelectedAgentId("");
        setSelectedShellRowKey(null);
        setExecutionPlan(null);
        setSpeculativeRelays([]);
        setDebateUpdates([]);
        setFinalReport(null);
        setOutputItems([
          "收到用户输入，先建立可追踪案件卷宗。",
          "下一步把原句拆成可核查命题，再决定搜索和信源审计路径。",
          "左侧只追加真实运行事件；右侧显示当前事件拿到的来源、链接和审计结论。",
        ]);
        pushStreamItem({
          agentName: "系统",
          title: "收到核查对象",
          detail: "已建立可追踪核查任务，随后按命题推进。",
          status: "queued",
        });
        setStartedAt(Date.now());
        lastActivityAtRef.current = Date.now();
        setElapsedMs(0);
        setStallMs(0);
        setRunStatus("running");
        setErrorMessage("");

        try {
          let localMemoryRecall: LocalMemoryRecall | null = null;
          pushStreamItem({
            agentName: "历史案件参考",
            title: "查阅历史案件参考",
            detail: "对照历史类似案件，不作本案直接证据。",
            status: "running",
            query: claim,
            model: "local knowledge base",
          });
          try {
            const memoryRecall = await buildLocalMemoryRecall(knowledgeBase, claim);
            localMemoryRecall = memoryRecall;
            if (cancelled) return;
            pushStreamItem({
              agentName: "历史案件参考",
              title: "历史案件参考已返回",
              detail: `命中历史案件 ${memoryRecall.hitCount} 条，证据库线索 ${memoryRecall.evidenceCount} 条，已确认记忆 ${memoryRecall.acceptedCandidateCount} 条。`,
              status: "completed",
              query: claim,
              model: "local knowledge base",
              result: memoryRecall,
            });
          } catch (error) {
            if (cancelled) return;
            pushStreamItem({
              agentName: "历史案件参考",
              title: "历史案件参考 · 未命中可用记录",
              detail: error instanceof Error ? error.message : "本地记忆读取失败，本次继续走实时核查。",
              status: "failed",
              query: claim,
              model: "local knowledge base",
            });
          }

          const streamPayload = streamKey > 0 ? streamJobRef.current : (intake ?? claim);
          for await (const event of requestOrchestrateStream(streamPayload, localMemoryRecall ?? undefined, modelChoice)) {
            if (cancelled) return;
            lastActivityAtRef.current = Date.now();
            setStallMs(0);
            setSseEvents((prev) => [...prev, event]);

            switch (event.type) {
              case "planner_update": {
                if (event.plan) {
                  setExecutionPlan(event.plan);
                  pushStreamItem({
                    agentName: "Planner",
                    title: "制定核查路径",
                    detail: event.plan.rationale,
                    status: "completed",
                  });
                }
                break;
              }
              case "speculative_update": {
                const relay = event.relay;
                if (relay) {
                  setSpeculativeRelays((prev) => [...prev.filter((item) => item.id !== relay.id), relay]);
                  pushStreamItem({
                    agentName: relay.downstream,
                    title: relay.title,
                    detail: `${relay.trigger} ${relay.savedReason}`,
                    status: relay.status === "completed" ? "completed" : "running",
                  });
                }
                break;
              }
              case "consensus_debate_round":
              case "consensus_debate_final": {
                const debate = event.debate;
                if (debate) {
                  setDebateUpdates((prev) => [...prev.filter((item) => item.id !== debate.id), debate]);
                  if (debate.status !== "not_needed") {
                    const latestRound = debate.rounds[debate.rounds.length - 1];
                    if (event.type === "consensus_debate_round" && latestRound) {
                      pushStreamItem({
                        agentName: latestRound.challenger,
                        title: "冲突质疑",
                        detail: latestRound.challenge,
                        status: "running",
                        debate,
                      });
                      pushStreamItem({
                        agentName: latestRound.respondent,
                        title: "冲突回应",
                        detail: latestRound.response,
                        status: "running",
                        debate,
                      });
                    } else {
                      pushStreamItem({
                        agentName: "调解",
                        title: debate.status === "resolved" ? "完成冲突裁决" : debate.title,
                        detail: debate.finalConsensus,
                        status: debate.status === "resolved" ? "completed" : "running",
                        debate,
                      });
                    }
                  }
                }
                break;
              }
              case "agent_start": {
                const step = buildStep(event, "running");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
                setOutputItems(outputItemsForStep(step, "running"));
                dispatch({
                  type: "UPDATE_STREAMING_STAGE",
                  payload: { stageId: step.agent, status: "running" },
                });
                appendRuntimeChunk(step.agent, "action", `${step.agentName} 开始处理这一步核查。`);
                outputItemsForStep(step, "running").slice(0, 2).forEach((item) => {
                  appendRuntimeChunk(step.agent, "action", item);
                });
                pushStreamItem({
                  agentName: step.agentName,
                  title: agentStartTitle(step),
                  detail: processSummaryForStep(step, "running"),
                  status: "running",
                });
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "agent_complete": {
                const step = buildStep(event, "completed");
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);

                if (isNonAuthenticStep(step)) {
                  const fallbackReason = typeof step.output.fallbackReason === "string" ? sanitizePublicReportText(step.output.fallbackReason) : "收到 demo-fallback 输出";
                  const message = `${step.agentName} 没有拿到可展示的核查结果，已停止展示结论。原因：${fallbackReason}`;
                  setOutputItems([message, "不会把降级结果包装成真实核查。"]);
                  setErrorMessage(message);
                  setStartedAt(null);
                  setRunStatus("failed");
                  appendRuntimeChunk(step.agent, "tool_call", message);
                  dispatch({
                    type: "UPDATE_STREAMING_STAGE",
                    payload: { stageId: step.agent, status: "error" },
                  });
                  pushStreamItem({
                    agentName: step.agentName,
                    title: "缺少可核查结果，停止收束",
                    detail: message,
                    status: "failed",
                  });
                  dispatch({ type: "APPEND_HANDOFF_STEP", payload: { ...step, status: "failed" } });
                  dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
                  streamEnded = true;
                  return;
                }

                setOutputItems(outputItemsForStep(step, "completed"));
                appendRuntimeChunk(step.agent, step.model.includes("demo-fallback") ? "thought" : "result", summarizeStepOutput(step));
                appendRuntimeChunk(step.agent, "result", `模型链路：${step.model}，耗时 ${formatLatency(step.latencyMs)}。`);
                if (isDeterministicReportFallback(step)) {
                  appendRuntimeChunk(step.agent, "thought", deterministicFallbackReason(step));
                }
                dispatch({
                  type: "UPDATE_STREAMING_STAGE",
                  payload: { stageId: step.agent, status: "completed" },
                });
                if (step.agent === "rumor_detector" && !step.model.includes("demo-fallback")) {
                  const decomposition = buildDecompositionFromRumorStep(claim, step);
                  if (decomposition) {
                    setConsensusStarted(true);
                    void runConsensusPipeline(decomposition).catch((error) => {
                      console.warn("Cross-search consensus pipeline failed:", error);
                    });
                  }
                }
                pushStreamItem({
                  agentName: step.agentName,
                  title: agentCompleteTitle(step),
                  detail: processSummaryForStep(step, "completed"),
                  status: "completed",
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
                pushStreamItem({
                  agentName: event.toolName ?? "Tool",
                  title: toolStartTitle(event.toolName, event.toolId),
                  detail: toolStartDetail(event, claim),
                  status: "running",
                  query: event.query ?? claim,
                  model: event.model,
                  toolId: event.toolId,
                });
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
                pushStreamItem({
                  agentName: event.toolName ?? "Tool",
                  title: toolResultTitle(event.toolName, event.result, event.toolId),
                  detail: toolResultDetail(event),
                  status: "completed",
                  query: event.query ?? claim,
                  model: event.model,
                  toolId: event.toolId,
                  result: event.result,
                });
                break;
              }
              case "tool_error": {
                const { message, techDetail } = resolveErrorPresentation(event);
                appendRuntimeChunk(
                  "fact_checker",
                  "tool_call",
                  `${toolDisplayName(event.toolName)} 调用失败：${message}。不生成模拟证据。`
                );
                pushStreamItem({
                  agentName: event.toolName ?? "Tool",
                  title: `失败 | ${toolDisplayName(event.toolName)}`,
                  detail: message,
                  status: "failed",
                  query: event.query ?? claim,
                  model: event.model,
                  toolId: event.toolId,
                  result: event.result,
                  techDetail,
                });
                break;
              }
              case "agent_error": {
                const step = buildStep(event, "failed");
                const { message, techDetail } = resolveErrorPresentation(event);
                const recoverable =
                  event.recoverable === true ||
                  getAgentRegistry().canContinueAfterFailure(step.agent);
                accumulatedSteps = upsertStep(accumulatedSteps, step);
                setSteps((prev) => upsertStep(prev, step));
                setCurrentStep(step);
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
                pushStreamItem({
                  agentName: step.agentName,
                  title: recoverable ? "这一步没写成判断，继续用已检索材料" : "调用失败，停止生成结论",
                  detail: recoverable
                    ? "模型服务这一步没完成。仍会尽量用已查到的公开材料往下走。"
                    : message,
                  status: recoverable ? "completed" : "failed",
                  techDetail,
                });
                dispatch({ type: "APPEND_HANDOFF_STEP", payload: step });
                break;
              }
              case "complete": {
                const finalSteps =
                  event.steps && event.steps.length > 0 ? event.steps : accumulatedSteps;
                const finalReport = event.finalReport;
                const proposedMemoryCandidates = event.memoryCandidates ?? [];
                const nonAuthenticStep = finalSteps.find(isNonAuthenticStep);
                if (nonAuthenticStep) {
                  const message = `${nonAuthenticStep.agentName} 含有非真实降级输出，已拒绝生成最终判断。`;
                  setStartedAt(null);
                  setRunStatus("failed");
                  setErrorMessage(message);
                  setFinalReport(null);
                  setOutputItems([message, "请检查模型服务或 API Key 后重新发起真实核查。"]);
                  pushStreamItem({
                    agentName: "系统",
                    title: "拒绝展示非真实结论",
                    detail: message,
                    status: "failed",
                  });
                  dispatch({ type: "COMPLETE_HANDOFF_STREAM", payload: { error: message } });
                  streamEnded = true;
                  return;
                }
                const totalLatency = event.totalLatencyMs ?? finalSteps.reduce(
                  (sum, step) => sum + step.latencyMs,
                  0
                );
                const finalCurrentStep = selectCurrentStep(finalSteps);

                // 先上屏结果，再做本地持久化，避免保存失败/抛错时用户看不到结论
                setSteps(finalSteps);
                setCurrentStep(finalCurrentStep);
                setFinalReport(finalReport ?? null);
                setErrorMessage("");
                setMemoryCandidates(proposedMemoryCandidates);
                if (isInterruptedFinalReport(finalReport ?? null)) {
                  setOutputItems(["这次没查完，结论还没写出来。"]);
                  pushStreamItem({
                    agentName: "写结论",
                    title: "核查中断",
                    detail: "结论还没写出来。",
                    status: "final",
                  });
                } else {
                  const conclusion = reportText(finalReport ?? null, "conclusion");
                  const label = reportText(finalReport ?? null, "credibilityLabel");
                  const recommendation = reportText(finalReport ?? null, "recommendation");
                  const score = normalizeCredibilityScore(
                    typeof finalReport?.credibilityScore === "number" ? finalReport.credibilityScore : null,
                    reportText(finalReport ?? null, "verdictType"),
                    label
                  );
                  const confidenceScore = judgmentConfidenceScore(
                    typeof finalReport?.credibilityScore === "number" ? finalReport.credibilityScore : null,
                    reportText(finalReport ?? null, "verdictType"),
                    label
                  );
                  setOutputItems([
                    conclusion ? `最终判断：${conclusion}` : "有结论了，但还没有适合展示的结论文本。",
                    label || score !== null
                      ? `可信度：${label || "未标注"}${score !== null ? ` · 原信息 ${score}/100` : ""}${confidenceScore !== null ? ` · 判断置信度 ${confidenceScore}/100` : ""}`
                      : "",
                    recommendation ? `处理建议：${recommendation}` : "",
                  ].filter(Boolean));
                  pushStreamItem({
                    agentName: "写结论",
                    title: "最终判断已生成",
                    detail: reportText(finalReport ?? null, "conclusion") || "有结论了，但还没有适合展示的结论文本。",
                    status: "final",
                  });
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
                  pushStreamItem({
                    agentName: "本地卷宗",
                    title: "本案已保存",
                    detail: `已写入本地案件库；候选记忆 ${proposedMemoryCandidates.length} 条，确认后才参与新案召回。`,
                    status: "completed",
                    query: claim,
                    model: "local knowledge base",
                    result: {
                      proposedCandidateCount: proposedMemoryCandidates.length,
                      sourceUrlCount: extractSourceUrlsFromCase(entry).length,
                      unresolvedQuestionCount: countFinalUnresolvedQuestions(finalReport),
                      traceText: "保存最终报告、过程输出、来源链接和未解问题；旧案只作线索，不直接替代新案证据。",
                    },
                  });
                } catch {
                  // 本地持久化失败不影响结果首屏
                }
                break;
              }
              case "error": {
                const { message, techDetail } = resolveErrorPresentation(event);
                setStartedAt(null);
                setRunStatus("failed");
                setErrorMessage(message);
                pushStreamItem({
                  agentName: "系统",
                  title: "流式调用失败",
                  detail: message,
                  status: "failed",
                  techDetail,
                });
                dispatch({
                  type: "COMPLETE_HANDOFF_STREAM",
                  payload: { error: message },
                });
                streamEnded = true;
                break;
              }
            }
          }
        } catch (error) {
          if (cancelled) return;
          const techDetail = error instanceof Error ? error.message : "Orchestrate 流式调用失败";
          setStartedAt(null);
          setRunStatus("failed");
          setErrorMessage(ERROR_FRIENDLY_MESSAGE);
          pushStreamItem({
            agentName: "系统",
            title: "执行中断",
            detail: ERROR_FRIENDLY_MESSAGE,
            status: "failed",
            techDetail,
          });
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
  }, [claim, dispatch, initialFinalReport, intake, knowledgeBase, modelChoice, previewMode, runConsensusPipeline, state.diagnosis, streamKey]);

  useEffect(() => {
    if (!previewMode || !claim.trim()) return;

    const previewSteps = buildPreviewHandoffSteps(claim);
    const previewCurrentStep = previewSteps[1] ?? previewSteps[0] ?? null;
    const previewStream = buildPreviewStreamItems();

    dispatch({ type: "START_HANDOFF_STREAM", payload: { claim } });
    setSteps(previewSteps);
    setCurrentStep(previewCurrentStep);
    setStreamItems(previewStream);
    setExecutionPlan(buildPreviewExecutionPlan(claim));
    setSpeculativeRelays(buildPreviewSpeculativeRelays());
    setDebateUpdates(buildPreviewDebates());
    setFinalReport(null);
    setStartedAt(Date.now() - 23800);
    setElapsedMs(23800);
    setRunStatus("running");
    setErrorMessage("");
    setWorkbenchFocus("dispatch");
    setOutputItems([
      "识别原句里的绝对化表达：会致癌、等于吃毒药。",
      "任务已分派给事实核查与溯源。",
    ]);
  }, [claim, dispatch, previewMode]);

  const controllerEvents = useMemo(
    () => buildControllerProcessEvents({ streamItems, runStatus }),
    [streamItems, runStatus]
  );
  const latestControllerEvent = controllerEvents[controllerEvents.length - 1] ?? null;
  const evidenceBundleCount = useMemo(
    () => steps.filter((step) => step.evidenceBundle).length,
    [steps]
  );
  const evidenceItemCount = useMemo(
    () =>
      steps.reduce((sum, step) => {
        const bundle = step.evidenceBundle;
        if (!bundle) return sum;
        return sum + bundle.supportEvidenceIds.length + bundle.contradictEvidenceIds.length;
      }, 0),
    [steps]
  );
  const fallbackNotice = useMemo(() => runFallbackNotice(steps), [steps]);
  const humanStage = useMemo(
    () =>
      humanStageLabel({
        runStatus,
        finalReport,
        steps,
        displayPhase: finalReport
          ? "verdict"
          : state.consensusReport
            ? "evidence"
            : state.claimDecomposition
              ? "search"
              : "agents",
      }),
    [runStatus, finalReport, steps, state.consensusReport, state.claimDecomposition]
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

  const handleMemoryCandidateStatus = useCallback(async (id: string, status: MemoryCandidateStatus) => {
    setMemoryCandidates((prev) =>
      prev.map((candidate) =>
        candidate.id === id ? { ...candidate, status, statusUpdatedAt: Date.now() } : candidate
      )
    );
    try {
      const updated = await updateMemoryCandidateStatus(id, status);
      setMemoryCandidates((prev) => prev.map((candidate) => (candidate.id === id ? updated : candidate)));
      void knowledgeBase.saveMemoryCandidate(updated);
    } catch (error) {
      const message = error instanceof Error ? error.message : "记忆候选状态更新失败";
      setErrorMessage(message);
      setMemoryCandidates((prev) =>
        prev.map((candidate) =>
          candidate.id === id ? { ...candidate, status: "proposed", statusReason: message } : candidate
        )
      );
    }
  }, [knowledgeBase]);

  useEffect(() => {
    if (runStatus === "running") {
      setWorkbenchFocus("dispatch");
    }
  }, [runStatus]);

  useEffect(() => {
    if (!latestControllerEvent || !followLive) return;
    setActiveControllerEventId(latestControllerEvent.id);
  }, [latestControllerEvent, followLive]);

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

  const hasStreamEvents = controllerEvents.length > 0 || sseEvents.length > 0;
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
          onStop={onCancel}
          stopLabel={
            isInterruptedFinalReport(finalReport)
              ? "换一条"
              : runStatus === "running"
                ? "停止"
                : "再查一条"
          }
          stallNotice={runStatus === "running" ? stallNotice : undefined}
          fallbackNotice={fallbackNotice}
          priorTurns={priorTurns}
          onFollowUp={previewMode ? undefined : handleFollowUp}
        />
        {errorMessage && !finalReport ? (
          <p className="mission-run-status-notice" role="alert">
            {errorMessage}
          </p>
        ) : null}
      </div>

      {state.consensusReport && runStatus !== "running" ? (
        <EvidenceDetailDrawer
          isOpen={Boolean(selectedPropositionId)}
          onClose={() => setSelectedPropositionId("")}
          propositionId={selectedPropositionId}
          consensusReport={state.consensusReport}
          searchJobs={state.searchJobs}
        />
      ) : null}
    </main>
  );
}
