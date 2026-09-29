/**
 * 调查快照的里程碑（Issue #51，SSE investigation_snapshot）：每次发一份完整的 InvestigationSnapshotV1，前端只取最新版。
 *
 *   received（收到）→ decomposed（拆题一出来就上屏；没拆出条才停在 received·checking）→ investigating（检索开始 / 返回）
 *   → judging（核查绑定 / 补查 / 质询 / 整句审计）→ complete（报告 + 复核 + 探活之后）。中断帧由 handlers 补发。
 *
 * 快照顺序本身是产品行为：首份 judging 快照必须已经过来源审计（behavior-spec 4.8）。
 * 每个里程碑只带这一刻变了的字段，与之前的里程碑合并后整份重建；构建失败不阻断管线。
 */
import { claimAtomKey } from "../claimAtom/index.js";
import {
  buildInvestigationSnapshot,
  type InvestigationBuildInput,
  type InvestigationSnapshotV1,
} from "../investigation/index.js";
import type { CasePipelineHooks } from "./runCasePipeline.js";

type Phase = InvestigationBuildInput["phase"];
type Patch = Partial<InvestigationBuildInput> & { phase: Phase };
type Fields = Omit<Partial<InvestigationBuildInput>, "phase">;

export type SnapshotTimeline = {
  received: () => void;
  /** 拆题模型回来了但没拆出命题：停在「正在核对这句话」。 */
  receivedChecking: () => void;
  decomposed: (fields: Fields) => void;
  investigating: (fields: Fields) => void;
  judging: (fields: Fields) => void;
  /** 完成快照：作为 finalReport.investigation 存下来；没有订阅者或构建失败时为 null。 */
  complete: (fields: Fields) => InvestigationSnapshotV1 | null;
  /** 检索规划选定了本轮纳入 / 未覆盖的范围：之后每一份快照都带上。 */
  setScopePlan: (plan: InvestigationBuildInput["scopePlan"]) => void;
};

export function createSnapshotTimeline(args: {
  claim: string;
  /** 订阅者在每次发快照时现读（与管线其余钩子一致）。 */
  hooks?: Pick<CasePipelineHooks, "onInvestigationSnapshot">;
  throwIfAborted: () => void;
}): SnapshotTimeline {
  const { claim, hooks, throwIfAborted } = args;
  let base: InvestigationBuildInput | undefined;
  let scopePlan: InvestigationBuildInput["scopePlan"];
  const emit = (patch: Patch): InvestigationSnapshotV1 | null => {
    throwIfAborted();
    if (!hooks?.onInvestigationSnapshot) return null;
    try {
      base = { ...(base ?? {}), ...patch, ...(scopePlan ? { scopePlan } : {}), originalClaim: patch.originalClaim ?? claim } as InvestigationBuildInput;
      const snapshot = buildInvestigationSnapshot(base, { claimAtomKeyFn: claimAtomKey });
      hooks.onInvestigationSnapshot(snapshot);
      return snapshot;
    } catch (error) {
      console.warn(`[casePipeline] investigation snapshot 构建失败: ${String(error)}`);
      return null;
    }
  };
  return {
    received: () => {
      emit({ phase: "received" });
    },
    receivedChecking: () => {
      emit({ phase: "received", preClaimWork: "checking" });
    },
    decomposed: (fields) => {
      emit({ phase: "decomposed", ...fields });
    },
    investigating: (fields) => {
      emit({ phase: "investigating", ...fields });
    },
    judging: (fields) => {
      emit({ phase: "judging", ...fields });
    },
    complete: (fields) => emit({ phase: "complete", ...fields }),
    setScopePlan: (plan) => {
      scopePlan = plan;
    },
  };
}
