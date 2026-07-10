import type { HandoffStep } from "./agentExpansion";

export type ClaimType =
  | "概念"
  | "事件事实"
  | "数量事实"
  | "文本归属事实"
  | "比较"
  | "机制/事实"
  | "因果"
  | "预测"
  | "价值"
  | "策略"
  | "反证";

export type ScoreLevel = "高" | "中" | "低";

export type UsageLevel = "主证据" | "辅助证据" | "背景材料" | "仅作线索" | "不可用" | "反证";

export type EvidenceRole = "支持" | "反驳" | "限定" | "背景" | "线索" | "不可用";

export type SearchSourceType = "官方" | "学术" | "媒体" | "自媒体" | "论坛" | "聚合搜索" | "未知";

export type SearchEvidenceDirection = "support" | "contradict" | "neutral";

export type SubclaimStatus =
  | "支持"
  | "部分支持"
  | "反驳"
  | "限定支持"
  | "证据不足"
  | "不可核查"
  | "原命题需要改写";

export type RumorType = "健康" | "社会" | "科技" | "财经" | "政治" | "娱乐";

export interface ClaimDiagnosis {
  mixedJudgments: ClaimType[];
  ambiguousTerms: string[];
  risk: string;
  whyNotDirectFactCheck: string;
  rumorIndicators?: string[];
}

export interface Subclaim {
  id: string;
  text: string;
  type: ClaimType;
  roleInArgument: string;
}

export interface EvidenceRoute {
  subclaimId: string;
  neededEvidence: string[];
  notAcceptable: string[];
  minimumOutputRule: string;
}

export interface SearchPlan {
  subclaimId: string;
  searchPlan: string[];
  querySets: Record<string, string[]>;
  counterQueries: string[];
  mustNotInfer: string[];
  evidenceGaps: string[];
}

export interface CandidateMaterial {
  id: string;
  title: string;
  sourceType: "学术论文" | "招聘数据" | "企业案例" | "行业报告" | "新闻报道" | "评论文章";
  targetSubclaimIds: string[];
  matchedNeed: string;
  summary: string;
  traceability: ScoreLevel;
  contextFit: ScoreLevel;
  independence: ScoreLevel;
  limitations: string[];
  // 审查 P2-8 修复：新增可选 publishedAt（毫秒时间戳），
  // evidenceQuality.ts 据此计算 freshnessScore；缺失时回退到 50（scoreFreshnessFromTimestamp 默认）。
  // demo 数据可选择性填充，未来 Search360Source→CandidateMaterial 转换器应自动写入。
  publishedAt?: number;
}

export interface GradedEvidence {
  candidateId: string;
  subclaimId: string;
  matchedEvidenceNeed: string;
  evidenceRole: EvidenceRole;
  usageLevel: UsageLevel;
  scores: {
    relevance: ScoreLevel;
    traceability: ScoreLevel;
    methodFit: ScoreLevel;
    contextFit: ScoreLevel;
    independence: ScoreLevel;
  };
  inferenceAllowed: string[];
  inferenceBlocked: string[];
  limitations: string[];
  evidenceGap: string[];
  graderDecision: string;
  sourceQuality?: SourceQualityAssessment;
  logicAudit?: LogicLinkAudit;
  biasFindings?: BiasAuditFinding[];
}

export interface SubclaimReportStatus {
  subclaimId: string;
  subclaim: string;
  status: SubclaimStatus;
  usableEvidence: string[];
  cannotInfer: string[];
}

export interface FinalReport {
  originalClaim: string;
  overallStatus: string;
  allowedConclusion: string;
  claimDiagnosis: ClaimDiagnosis;
  subclaimStatuses: SubclaimReportStatus[];
  evidenceChain: string[];
  doNotInfer: string[];
  rewrittenClaim: {
    cautious: string;
    publicFacing: string;
    researchMemo: string;
  };
  nextEvidenceNeeded: string[];
  evidenceQualitySummary?: EvidenceQualitySummary;
  logicRiskItems?: BiasAuditFinding[];
  contradictionSummary?: string;
  // v2-iteration 2026-07-04: optional license/lineage/trace overlays
  inferenceLicense?: import("./schemas").InferenceLicense;
  sourceLineage?: import("./schemas").SourceLineageGroup[];
  reasoningTrace?: import("./schemas").ReasoningStep[];
}

// v2-iteration 2026-07-04: PR-1 inference license aggregation output
export interface InferenceLicenseItem {
  text: string;
  supportingSubclaims?: string[];
  strongestEvidence?: string;
}

export interface InferenceLicense {
  allowed: InferenceLicenseItem[];
  blocked: InferenceLicenseItem[];
  confidence: "high" | "medium" | "low";
  coverage: { withAllowed: number; totalSubclaims: number };
  source?: "graded_evidence" | "stub";
}

// v2-iteration 2026-07-04: PR-2 source lineage folding output
export interface SourceLineageGroup {
  canonicalUrl: string;
  canonicalOutlet?: string;
  canonicalAuthor?: string;
  memberUrls: string[];
  independenceCorrected: "high" | "medium" | "low";
  detectionMethod: "llm_keyword" | "url_hostname" | "domain_exact" | "fallback";
}

// v2-iteration 2026-07-04: PR-3 reasoning trace step output
export interface ReasoningStep {
  stepId: string;
  agent: string;
  action: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "completed" | "failed";
  error?: { code: string; message: string };
  children?: ReasoningStep[];
  meta?: Record<string, unknown>;
}

export interface DemoCase {
  originalClaim: string;
  rumorType?: RumorType;
  useContext: string;
  diagnosis: ClaimDiagnosis;
  subclaims: Subclaim[];
  routes: EvidenceRoute[];
  searchPlans: SearchPlan[];
  candidates: CandidateMaterial[];
}

export type VerificationResult = "true" | "false" | "partial" | "unknown";

// ── M1: Agent Memory / 知识库 ────────────────────────────────

export interface KnowledgeBaseEntry {
  id: string;
  claim: string;
  claimEmbedding?: number[];
  rumorType: RumorType | string;
  diagnosis: ClaimDiagnosis;
  finalReport: FinalReport | Record<string, unknown>;
  handoffSteps: HandoffStep[];
  credibilityScore: number;
  verificationResult?: VerificationResult;
  timestamp: number;
  tags: string[];
}

export interface EvidenceLibraryEntry {
  id: string;
  title: string;
  source: string;
  sourceUrl?: string;
  summary: string;
  role: EvidenceRole;
  relatedClaimIds: string[];
  credibility: ScoreLevel;
  timestamp: number;
}

export interface SearchStrategyMemory {
  id: string;
  rumorType: string;
  effectiveQueries: string[];
  ineffectiveQueries: string[];
  sourceDomains: string[];
  timestamp: number;
  useCount: number;
}

export interface KnowledgeBaseStats {
  totalCases: number;
  totalEvidence: number;
  typeDistribution: Record<string, number>;
}

// ── CurioCat-style evidence / logic audit ────────────────────

export interface SourceQualityAssessment {
  sourceType: CandidateMaterial["sourceType"] | "未知";
  credibilityScore: number;
  freshnessScore: number;
  diversityKey: string;
  tier: number;
  reason: string;
}

export interface EvidenceQualitySummary {
  averageCredibility: number;
  averageFreshness: number;
  diversityScore: number;
  supportCount: number;
  contradictCount: number;
  weakEvidenceCount: number;
  highTierSourceCount: number;
}

export interface LogicLinkAudit {
  passed: boolean;
  adjustedScore: number;
  penalties: string[];
  blockedInference: string[];
}

export type BiasSeverity = "low" | "medium" | "high";

export interface BiasAuditFinding {
  id: string;
  label: string;
  severity: BiasSeverity;
  explanation: string;
  affectedSubclaimId?: string;
  mitigation: string;
}

// ── M2: 360 搜索 ─────────────────────────────────────────────

export interface Search360Request {
  query: string;
  claim?: string;
  direction?: SearchEvidenceDirection;
  model?: string;
  refProm?: "aiso-sr" | "aiso-pro" | "aiso-max" | "aiso-news" | string;
}

export interface Search360Source {
  id?: string;
  title: string;
  url: string;
  snippet: string;
  credibility?: ScoreLevel;
  sourceType?: SearchSourceType;
  credibilityScore?: number;
  sourceTier?: number;
  freshnessScore?: number;
  domain?: string;
  evidenceRole?: EvidenceRole;
  publishedAt?: string;
  publishedTimestamp?: number;
  /**
   * 后端 sourceCondenser 浓缩出的 奕枢风格 摘要（30-200 字）。
   * 不在 schema 必填字段，失败/缺失时为 undefined,UI fallback 到 snippet。
   */
  condensedSnippet?: string;
}

export interface Search360Response {
  answer: string;
  sources: Search360Source[];
  supportQuery?: string;
  contradictQuery?: string;
  supportingEvidence?: Search360Source[];
  contradictingEvidence?: Search360Source[];
  unresolvedEvidenceGaps?: string[];
  relatedQuestions: string[];
  model?: string;
  traceText?: string;
  _source?: "360-ai-search" | "anysearch-search" | "metaso-search" | "tavily-search" | "exa-search" | "parallel-search" | "demo-fallback" | "tool-error";
}

// ── Agent evidence bundle ─────────────────────────────────────

export interface AgentEvidenceBundle {
  agentId: string;
  claimIds: string[];
  supportEvidenceIds: string[];
  contradictEvidenceIds: string[];
  confidenceDelta: number;
  unresolvedQuestions: string[];
  sourceQualityScore?: number;
  logicRiskCount?: number;
}

// ── M3: 结果闭环动作 ─────────────────────────────────────────

export type ClosureAction =
  | "generate_rebuttal_card"
  | "archive_doubtful"
  | "share_verification"
  | "export_report";

export interface RebuttalCard {
  title: string;
  verdict: string;
  color: string;
  keyPoints: string[];
  sourceRef: string;
  qrCodeData?: string;
}

// ── M6: FIRE 置信度驱动 ─────────────────────────────────────

export type ConfidenceDimensionId =
  | "source_reliability"
  | "evidence_completeness"
  | "consistency"
  | "recency"
  | "authority";

export interface ConfidenceAssessment {
  dimension: ConfidenceDimensionId;
  label: string;
  score: number;
  threshold: number;
  passed: boolean;
  reason: string;
}

export interface IterationDecision {
  shouldContinue: boolean;
  nextAction: "search_more" | "verify_source" | "cross_check" | "conclude";
  reason: string;
  targetConfidence: number;
}

// ── M7: Benchmark ────────────────────────────────────────────

export interface BenchmarkMetrics {
  totalCases: number;
  accuracyRate: number;
  avgLatencyMs: number;
  coverageByType: Record<string, { total: number; correct: number }>;
  topSources: string[];
}

// ── M8: Cross-Search Consensus（多搜索引擎交叉验证）────────────────

export interface AtomicProposition {
  id: string;
  text: string;
  type: "事实陈述" | "因果推断" | "数值断言" | "归因断言";
  verifiability: "可直接验证" | "需间接推断" | "主观判断";
}

export interface ClaimDecompositionResult {
  originalClaim: string;
  atomicPropositions: AtomicProposition[];
  decompositionReasoning: string;
}

export interface SearchTask {
  provider: "360_search" | "any_search" | "metaso_search" | "tavily_search" | "exa_search";
  query: string;
  status: "pending" | "running" | "completed" | "failed";
  result?: SearchProviderResult;
}

export interface SearchProviderResult {
  provider: string;
  query: string;
  sources: SearchResultSource[];
  answer?: string;
  latencyMs: number;
}

export interface SearchResultSource {
  id: string;
  title: string;
  url: string;
  snippet: string;
  domain: string;
  publishedAt?: string;
  sourceType: SearchSourceType;
  credibilityScore?: number;
  sourceTier?: number;
  freshnessScore?: number;
  evidenceRole?: EvidenceRole;
}

export interface MultiSearchJob {
  jobId: string;
  propositionId: string;
  propositionText: string;
  searchTasks: SearchTask[];
}

export type ConsensusStatus = "可进入推理" | "存疑" | "需人工复核";

export interface EvidenceIndependenceAssessment {
  totalSources: number;
  independentSources: number;
  duplicateSources: number;
  independenceScore: number;
  reasoning: string;
}

export interface SourceTierDistribution {
  government: number;
  academic: number;
  media: number;
  selfMedia: number;
  forum: number;
  unknown: number;
  highestTierFound: "government" | "academic" | "media" | "selfMedia" | "forum" | "unknown";
}

export interface CounterEvidenceCoverage {
  counterSearchPerformed: boolean;
  counterEvidenceFound: boolean;
  counterEvidenceCount: number;
  counterEvidenceSources: string[];
  verdict: "反证已覆盖" | "暂未发现反证" | "反证检索未执行";
}

export interface ProviderConsensusResult {
  provider: string;
  status?: SearchTask["status"];
  sourceCount: number;
  relevantSources: number;
  supportsProposition: boolean | null;
  contradictsProposition: boolean | null;
  topSourceUrl: string;
}

export interface IndependentSource {
  id: string;
  title: string;
  url: string;
  domain: string;
  sourceType: SearchSourceType;
  isOriginalSource: boolean;
  originalSourceUrl?: string;
  supports: boolean;
  contradicts: boolean;
  providerOrigins: string[];
}

export interface MinimumCriteriaCheck {
  criteria1_minProviders: boolean;
  criteria2_hasHighTierOrOriginal: boolean;
  criteria3_counterSearchDone: boolean;
  criteria4_duplicatesCountedOnce: boolean;
  allMet: boolean;
}

export interface PropositionConsensusResult {
  propositionId: string;
  propositionText: string;
  status: ConsensusStatus;
  statusReason: string;
  evidenceIndependence: EvidenceIndependenceAssessment;
  sourceTierDistribution: SourceTierDistribution;
  counterEvidenceCoverage: CounterEvidenceCoverage;
  providerResults: ProviderConsensusResult[];
  independentSources: IndependentSource[];
  meetsMinimumCriteria: MinimumCriteriaCheck;
}

export interface ConsensusStats {
  totalPropositions: number;
  readyForReasoning: number;
  doubtful: number;
  needsManualReview: number;
  totalIndependentSources: number;
  totalDuplicateSources: number;
  counterEvidenceSearchesPerformed: number;
}

export interface EvidenceConsensusReport {
  consensusId: string;
  timestamp: number;
  propositionResults: PropositionConsensusResult[];
  overallStats: ConsensusStats;
  sourceLineage?: SourceLineageGroup[];
}
