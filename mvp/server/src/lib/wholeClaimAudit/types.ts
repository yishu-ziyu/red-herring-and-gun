/**
 * Whole-Claim Audit — Issue #78 第一版。
 *
 * 职责：让完整 originalClaim 在拆题之后仍然作为「需要被证明 / 被质疑的对象」持续存在。
 * 不是新 UI、不是用户可见 Agent、不给最终答案；artifact 只进实现层（rumorStep.output），
 * 不进 InvestigationSnapshot schema、不进 Evidence。
 *
 * 边界（硬编码不变量 / invariants）：
 * - checkability 修订只能作用在真实 kept claimAtom 上，不得创建新「用户 Claim」；
 * - audit 文本（question / reason / missingJustification / suggestedQuery）永远不是
 *   InvestigationSource / EvidenceLink，只有真实工具取得的来源才能成为 Evidence；
 * - 结论不得比 Claim / Evidence 层更「知道答案」（见 conclusionGate）。
 */

/** 裸模型调用口径（同 selfProof / crossExam / evidenceLoop rewriter）。 */
export type WholeClaimAuditModelCall = (input: {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
}) => Promise<{ output: unknown; model: string }>;

/** 审计问题：targetClaimAtom 必须指向真实 kept claimAtom，否则确定性代码丢弃该指向。 */
export interface WholeClaimAuditQuestion {
  question: string;
  reason: string;
  targetClaimAtom?: string;
  suggestedQuery?: string;
}

/** Phase 1 输出：调查规划（不是 verdict）。 */
export interface WholeClaimAuditPlan {
  /** 原始主张真正想推出什么（整句层面的问题，不是单命题改写）。 */
  overallQuestion: string;
  /**
   * 可核查性修订：模型语义判断「这条 normative/value 是否存在明确外部可核查标准」。
   * 确定性代码只应用 false→true 的提升，且必须命中真实 kept atom；type 一律不改写。
   */
  checkabilityRevisions: Array<{
    claimAtom: string;
    verifiable: boolean;
    reason: string;
  }>;
  /** 要让原始主张成立还缺的依据 / 条件 / 标准（内部调查问题，不是用户说过的话）。 */
  missingJustifications: string[];
  auditQuestions: WholeClaimAuditQuestion[];
}

/** Phase 2 输出：整句证据评估（不是 verdict；不给 supported/refuted 标签）。 */
export interface WholeClaimAuditEvaluation {
  /** 原始主张现在成立到哪里（限定在证据撑到的层级）。 */
  supportedWhere: string;
  /** 最大的推理 / 依据缺口。 */
  biggestGap: string;
  /** 只在「现有证据不足以把各命题连成原句整体结论」时非空；单命题查证充分时留空。 */
  missingJustifications: string[];
  nextQuestions: WholeClaimAuditQuestion[];
}

/** audit-driven 额外补查的确定性结算（哪些问题真的取得了新来源）。 */
export interface WholeClaimAuditExtraPass {
  ran: boolean;
  questionsSearched: number;
  newSourcesByAtomKey: Record<string, number>;
  /** 补查后仍未取得新来源的问题（或从未能映射到真实 atom 的问题）。 */
  unresolvedQuestions: string[];
}

export interface WholeClaimAuditRun {
  plan: WholeClaimAuditPlan | null;
  evaluation: WholeClaimAuditEvaluation | null;
  extraPass: WholeClaimAuditExtraPass | null;
  model: string;
}
