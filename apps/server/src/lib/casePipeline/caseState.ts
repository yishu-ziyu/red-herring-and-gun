/**
 * 一次调查的进行态。各阶段只通过这里读写，字段名就是事实名，一个事实只有一个家。
 *
 * PipelineContext 在调查开始时建好：输入、步骤记录、预算、快照。
 * CaseState 在核查返回时建好（拆题与检索的结果 + 当前生效的核查与来源审计），之后的阶段都读它；
 * 只有来源审计会改它（审计刷新时换 sourceStep、重算 subclaimVerdicts）。
 * steps 是只追加的运行记录，只用来给下一个 agent 拼输入，不是结果的来源。
 */
import type { AtomSearchBundle } from "../atomSearch.js";
import type { Budget } from "./budget.js";
import type { CasePipelineHooks, CasePipelineInput, PipelineStep } from "./runCasePipeline.js";
import type { SnapshotTimeline } from "./snapshotTimeline.js";
import type { SourceAudit } from "./sourceAudit.js";

export type PipelineContext = {
  input: CasePipelineInput;
  claim: string;
  hooks?: CasePipelineHooks;
  /** 各阶段按时间顺序追加的步骤记录。 */
  steps: PipelineStep[];
  budget: Budget;
  snapshots: SnapshotTimeline;
  /** 协作式取消：各阶段边界检查一次。 */
  throwIfAborted: () => void;
};

export type CaseState = {
  rumorStep: PipelineStep;
  /** 逐命题检索包。 */
  atomSearchBundle: AtomSearchBundle;
  /** 核查模型的原始输出，之后不再改写。 */
  factStep: PipelineStep;
  /** 当前生效的来源关系审计。 */
  sourceStep: PipelineStep;
  /** 公开判词：核查判词绑定检索来源、经当前生效的来源审计之后的结果。 */
  subclaimVerdicts: Array<Record<string, unknown>>;
  sourceAudit: SourceAudit;
};
