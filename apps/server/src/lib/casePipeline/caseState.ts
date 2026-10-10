/**
 * 一次调查的进行态。各阶段只通过这里读写，字段名就是事实名，一个事实只有一个家。
 *
 * PipelineContext 在调查开始时建好：输入、步骤记录、预算、快照。
 * CaseState 在核查返回时建好（拆题与检索的结果 + 当前生效的核查与来源审计），之后的阶段都读它。
 */
import type { AtomSearchBundle } from "../atomSearch.js";
import type { FollowUpReusePlan } from "../followUpReuse.js";
import type { Budget } from "./budget.js";
import type { CasePipelineHooks, CasePipelineInput, PipelineStep } from "./runCasePipeline.js";
import type { SnapshotTimeline } from "./snapshotTimeline.js";
import type { SourceAudit } from "./sourceAudit.js";

export type PipelineContext = {
  input: CasePipelineInput;
  claim: string;
  hooks?: CasePipelineHooks;
  /** 各阶段按时间顺序追加的步骤记录；报告、复核都读它。 */
  steps: PipelineStep[];
  budget: Budget;
  snapshots: SnapshotTimeline;
  /** 协作式取消：各阶段边界检查一次。 */
  throwIfAborted: () => void;
  /** 同一案追问且上一轮有可点开证据时的复用计划；否则为 null。 */
  reusePlan: FollowUpReusePlan | null;
};

export type CaseState = {
  rumorStep: PipelineStep;
  /** 逐命题检索包。 */
  atomSearchBundle: AtomSearchBundle;
  search360Result: unknown;
  /** 当前生效的核查结果。 */
  factStep: PipelineStep;
  /** 当前生效的来源关系审计。 */
  sourceStep: PipelineStep;
  sourceAudit: SourceAudit;
};
