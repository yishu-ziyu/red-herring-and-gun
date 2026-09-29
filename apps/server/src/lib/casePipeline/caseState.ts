/**
 * 一次调查的进行态。各阶段只通过这里读写，字段名就是事实名，一个事实只有一个家。
 *
 * PipelineContext 在调查开始时建好：输入、步骤记录、预算、快照、整句审计。
 * CaseState 在核查第一次返回时建好（拆题与检索的结果 + 当前生效的核查与来源审计），之后的阶段都改它。
 */
import type { AtomSearchBundle } from "../atomSearch.js";
import type { CrossExamOutcome } from "../crossExam/index.js";
import type { EvidenceLoopOutcome } from "../evidenceLoop/index.js";
import type { FollowUpReusePlan } from "../followUpReuse.js";
import type { ImageOriginResult } from "../imageOrigin/index.js";
import type { WholeClaimAuditModelCall, WholeClaimAuditRun } from "../wholeClaimAudit/index.js";
import type { Budget } from "./budget.js";
import type { CasePipelineHooks, CasePipelineInput, PipelineStep } from "./runCasePipeline.js";
import type { SnapshotTimeline } from "./snapshotTimeline.js";
import type { SourceAudit } from "./sourceAudit.js";

export type PipelineContext = {
  input: CasePipelineInput;
  claim: string;
  hooks?: CasePipelineHooks;
  /** 各阶段按时间顺序追加的步骤记录；报告写作、复核、记忆候选都读它。 */
  steps: PipelineStep[];
  budget: Budget;
  snapshots: SnapshotTimeline;
  /** 协作式取消：各阶段边界检查一次。 */
  throwIfAborted: () => void;
  /** 同一案追问且上一轮有可点开证据时的复用计划；否则为 null。 */
  reusePlan: FollowUpReusePlan | null;
  audit: WholeClaimAuditState;
};

/** Whole-Claim Audit（Issue #78）：整句在拆题后继续作为被审计对象。 */
export type WholeClaimAuditState = {
  /** 未注入时保持 legacy 行为（fail-open）。 */
  callModel?: WholeClaimAuditModelCall;
  run: WholeClaimAuditRun;
  /** 仍未解决的整句缺口：交给收权门限制整句结论强度（§11）。 */
  unresolvedGaps: string[];
};

export type CaseState = {
  rumorStep: PipelineStep;
  /** 逐命题检索包：追索、质询、整句审计补查都往里合并新来源。 */
  atomSearchBundle: AtomSearchBundle;
  search360Result: unknown;
  /** 截图的以图搜图结果；没有截图时为空。 */
  imageOrigin?: ImageOriginResult;
  /** 当前生效的核查结果：重判被接受后换成新的一步。 */
  factStep: PipelineStep;
  /** 当前生效的来源关系审计。 */
  sourceStep: PipelineStep;
  sourceAudit: SourceAudit;
  evidenceLoop?: EvidenceLoopOutcome;
  crossExam?: CrossExamOutcome;
};
