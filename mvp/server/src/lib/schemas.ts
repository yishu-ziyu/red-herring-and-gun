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

// ── M2: 360 搜索 ─────────────────────────────────────────────

export interface Search360Request {
  query: string;
  model?: string;
  refProm?: "aiso-sr" | "aiso-pro" | "aiso-max" | "aiso-news" | string;
}

export interface Search360Source {
  title: string;
  url: string;
  snippet: string;
  credibility?: ScoreLevel;
}

export interface Search360Response {
  answer: string;
  sources: Search360Source[];
  relatedQuestions: string[];
  model?: string;
  traceText?: string;
  _source?: "360-ai-search" | "demo-fallback";
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
