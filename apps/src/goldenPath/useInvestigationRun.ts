/**
 * useInvestigationRun — 生产 Golden Path 的唯一 SSE 消费点（Issue #52 第一节硬性架构决定）。
 *
 * 产品 state 只有两样：
 *  1. 最新一份通过 schema 校验的 InvestigationSnapshotV1（来自 investigation_snapshot）；
 *  2. 连接状态与最终 finalReport（complete 事件，仅用于 imageOrigin side-channel 与落库）。
 *
 * raw Agent / tool / search / consensus / planner 事件在此被显式忽略——
 * 删掉它们之后生产 Golden Path 仍必须完整工作（见 goldenPath/run.test.tsx 负向测试）。
 */
import { useCallback, useRef, useState } from "react";
import {
  isPublicActivity,
  rebuildInvestigationFromReport,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
  type PublicActivity,
} from "../lib/investigation";
import { requestOrchestrateStream, type OrchestrateStreamEvent } from "../lib/agentExpansion";
import { cancelInvestigation, resumeInvestigationStream } from "../lib/investigationResume";
import { caseIntakePrimaryText, type CaseIntake } from "../lib/caseIntake";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { buildLocalMemoryRecall } from "../lib/localMemoryRecall";
import type { ModelChoiceMap } from "../lib/agentExpansion";
import type { VisiblePriorRound } from "../lib/priorRoundBrief";

/** legacy 原始事件：只存在于 debug/telemetry；Golden Path 不从中推导任何产品语义。 */
const IGNORED_LEGACY_EVENT_TYPES: ReadonlySet<OrchestrateStreamEvent["type"]> = new Set([
  "search_progress",
  "planner_update",
  "speculative_update",
  "consensus_debate_round",
  "consensus_debate_final",
  "agent_start",
  "agent_complete",
  "agent_error",
  "agent_thought",
  "tool_start",
  "tool_result",
  "tool_error",
]);

export type ConnectionPhase = "connecting" | "live" | "ended" | "failed";

/** 停止只分三态：没在停 / 已请求、等后端 / 后端已确认。不提前说「已停止」。 */
export type StopPhase = "idle" | "stopping" | "stopped";

export type RunState = {
  /** null = 尚未收到任何快照（拆题还没回来）。 */
  snapshot: InvestigationSnapshotV1 | null;
  connection: ConnectionPhase;
  errorMessage: string;
  /** complete 事件的 finalReport（imageOrigin side-channel 与父层落库用）。 */
  finalReport: Record<string, unknown> | null;
  /**
   * 公共活动：按 seq 累计、按 id 去重。只由 investigation_activity 事件写入；
   * 活动层坏了不影响快照与结果（空数组是合法常态）。
   */
  activities: PublicActivity[];
  /** 当前活动的 runId；不同 run 的活动不混在一起。 */
  activityRunId: string | null;
  /** 已接受的最大 seq；小于等于它的重放一律忽略。 */
  lastActivitySeq: number;
  /** 服务端运行身份（run_started 事件）。刷新恢复与取消都要它。 */
  runId: string | null;
  /** 服务端确认的 run 状态（run_state 事件 / 取消响应）。 */
  serverStatus: string | null;
  stop: StopPhase;
  /**
   * 整体超时后管线仍在跑（契约 2026-09-12-mainpath-p0 Change C）：
   * 这时候等结果变成「可选」——用户离开页面或刷新都还能拿回同一份结论。
   * complete（真结果到了）或 error（最终失败）时翻回 false。
   */
  timeoutPending: boolean;
};

const INITIAL_STATE: RunState = {
  snapshot: null,
  connection: "connecting",
  errorMessage: "",
  finalReport: null,
  activities: [],
  activityRunId: null,
  lastActivitySeq: 0,
  runId: null,
  serverStatus: null,
  stop: "idle",
  timeoutPending: false,
};

/**
 * 纯 reducer：一条 SSE 事件 → 下一份产品 state。
 * 只认 investigation_snapshot / complete / error / timeout_pending；legacy 事件原样忽略（E2 负向测试的对象）。
 * claim 供 complete 报告缺快照时的确定性重建使用。
 */
export function applyRunEvent(prev: RunState, event: OrchestrateStreamEvent, claim?: string): RunState {
  if (event.type === "run_started") {
    return { ...prev, runId: typeof event.runId === "string" ? event.runId : prev.runId };
  }
  if (event.type === "run_state") {
    const status = typeof event.status === "string" ? event.status : prev.serverStatus;
    const stopped = status === "cancelled" || status === "cancelling";
    return {
      ...prev,
      serverStatus: status,
      stop: stopped ? (status === "cancelling" ? "stopping" : "stopped") : prev.stop,
    };
  }
  if (event.type === "investigation_activity") {
    // 终态不能被晚到活动倒退：complete/error 之后一律不再收活动。
    if (prev.connection === "ended" || prev.connection === "failed") return prev;
    const activity = event.activity;
    if (!activity || !isPublicActivity(activity)) return prev;
    const sameRun = prev.activityRunId === activity.runId;
    // 重放与重复只按 id 去重；乱序到达按 seq 插到正确位置，不丢帧。
    if (sameRun && prev.activities.some((item) => item.id === activity.id)) return prev;
    const merged = sameRun ? [...prev.activities, activity] : [activity];
    merged.sort((a, b) => a.seq - b.seq);
    return {
      ...prev,
      activities: merged,
      activityRunId: activity.runId,
      lastActivitySeq: sameRun ? Math.max(prev.lastActivitySeq, activity.seq) : activity.seq,
    };
  }
  if (event.type === "investigation_snapshot" && event.investigation) {
    try {
      const snapshot = validateInvestigationSnapshot(event.investigation);
      return { ...prev, snapshot, connection: "live", errorMessage: "" };
    } catch {
      // 契约外快照不进产品 state：宁可停留上一份，也不渲染未校验数据。
      return prev;
    }
  }
  if (event.type === "timeout_pending") {
    // 超时只改「等结果要不要必须」这一件事：连接还是活的，快照照来，别的一概不动。
    return { ...prev, timeoutPending: true };
  }
  if (event.type === "complete") {
    const report = (event.finalReport ?? null) as Record<string, unknown> | null;
    let snapshot = prev.snapshot;
    // complete 的 finalReport 自带完成态快照（#51）；比流中最后一份更权威。
    const embedded = report && typeof report === "object" ? (report as Record<string, unknown>).investigation : undefined;
    if (embedded) {
      try {
        snapshot = validateInvestigationSnapshot(embedded);
      } catch {
        /* 保留最后一份流内快照 */
      }
    } else if (report && !snapshot) {
      // 报告没带快照（如旧 mock/降级服务端）：从报告确定性重建，不发明事实。
      try {
        snapshot = rebuildInvestigationFromReport({ report, claim: claim ?? (typeof report.claim === "string" ? report.claim : "") });
      } catch {
        /* 保留 null */
      }
    }
    return { ...prev, snapshot, finalReport: report, connection: "ended", timeoutPending: false };
  }
  if (event.type === "error") {
    return {
      ...prev,
      connection: "failed",
      errorMessage: typeof event.message === "string" ? event.message : "这次调查没有完成，请重试。",
      // 超时后管线最终失败 → 交给现有中断文案与重查入口，超时提示不再并列显示。
      timeoutPending: false,
    };
  }
  return prev;
}

export type StartOptions = {
  modelChoice?: ModelChoiceMap;
  accountEmail?: string | null;
  /** DEV 固定装置：不走网络，按脚本回放快照（仅 import.meta.env.DEV）。 */
  fixture?: (emit: (event: OrchestrateStreamEvent) => void) => () => void;
  /**
   * 追问：登录带刚完成案件的 caseId；访客无 caseId 时带上一轮可见材料。
   * 不带时请求体与现状完全一致（首轮、重试、legacy 都不带）。
   */
  priorCaseId?: string;
  priorRound?: VisiblePriorRound | null;
};

function newClientRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  } catch {
    /* 老环境回退 */
  }
  return `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useInvestigationRun() {
  const [state, setState] = useState<RunState>(INITIAL_STATE);
  const runIdRef = useRef(0);
  // 双击保护：同一份材料在短时间内重复提交只算一次（服务端幂等，这里是它的补充）。
  const lastSubmitRef = useRef<{ key: string; clientRequestId: string; at: number } | null>(null);

  const applyEvent = useCallback((event: OrchestrateStreamEvent, claim?: string) => {
    setState((prev) => applyRunEvent(prev, event, claim));
  }, []);

  const start = useCallback(
    (intake: CaseIntake, options: StartOptions = {}) => {
      const runId = ++runIdRef.current;
      const claim = caseIntakePrimaryText(intake);
      const submitKey = `${claim}\u0000${intake.links.length}\u0000${intake.images.length}`;
      const previous = lastSubmitRef.current;
      // 同一份材料 + 5 秒内重复提交 → 复用同一个 clientRequestId，服务端只建一条 run。
      const clientRequestId =
        previous && previous.key === submitKey && Date.now() - previous.at < 5_000
          ? previous.clientRequestId
          : newClientRequestId();
      lastSubmitRef.current = { key: submitKey, clientRequestId, at: Date.now() };
      setState({ ...INITIAL_STATE, connection: "connecting" });

      if (options.fixture && import.meta.env.DEV) {
        // DEV 固定装置：真实组件树 + 脚本化快照（截图与走查用，不进生产路径）。
        const stop = options.fixture((event) => {
          if (runIdRef.current === runId) applyEvent(event, claim);
        });
        return { cancel: () => { runIdRef.current += 1; stop(); } };
      }

      void (async () => {
        let memoryRecall: Record<string, unknown> | undefined;
        try {
          memoryRecall = (await buildLocalMemoryRecall(
            createKnowledgeBase(options.accountEmail ?? null),
            typeof intake === "string" ? intake : intake.text
          )) as unknown as Record<string, unknown>;
        } catch {
          // 召回降级不阻断调查
        }
        for await (const event of requestOrchestrateStream(
          intake,
          memoryRecall,
          options.modelChoice,
          clientRequestId,
          { priorCaseId: options.priorCaseId, priorRound: options.priorRound }
        )) {
          if (runIdRef.current !== runId) return;
          if (IGNORED_LEGACY_EVENT_TYPES.has(event.type)) continue;
          applyEvent(event, claim);
        }
        // 流自然结束但没等到 complete（服务端异常收尾）：保留已获快照，标失败。
        setState((prev) =>
          prev.connection === "live" || prev.connection === "connecting"
            ? { ...prev, connection: prev.finalReport ? "ended" : "failed" }
            : prev
        );
      })();
      return { cancel: () => { runIdRef.current += 1; } };
    },
    [applyEvent]
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  /** 取消：先本地记「正在停」，再等服务端确认；服务端确认不了就不说「已停止」。 */
  const cancel = useCallback(async () => {
    const runId = state.runId;
    if (!runId) return { ok: false as const };
    setState((prev) => ({ ...prev, stop: "stopping" }));
    const result = await cancelInvestigation(runId);
    setState((prev) => ({
      ...prev,
      serverStatus: result.status ?? prev.serverStatus,
      stop: result.ok ? (result.status === "cancelled" ? "stopped" : "stopping") : prev.stop,
      ...(result.ok ? {} : { errorMessage: "停止请求没有送达，调查可能还在继续。" }),
    }));
    return result;
  }, [state.runId]);

  /**
   * 接回一条已有 run（刷新/返回）。不新建 run、不扣额。
   * 返回的 cancel 只关本地连接。
   */
  const resume = useCallback(
    (runId: string, after: number, claim: string) => {
      const local = ++runIdRef.current;
      setState({ ...INITIAL_STATE, runId, connection: "connecting" });
      const handle = resumeInvestigationStream(
        runId,
        after,
        (event) => {
          if (runIdRef.current !== local) return;
          applyEvent(event, claim);
        },
        (reason) => {
          if (runIdRef.current !== local) return;
          setState((prev) => {
            if (prev.connection === "ended" || prev.connection === "failed") return prev;
            // 服务端已确认终态：补发完就关流，不是「还活着」。超时后晚完成的 run 走的正是这条路——
            // 刷新回来能拿到 phase=complete 的快照，界面必须按「已结束」渲染，不能挂着进行中。
            if (
              prev.serverStatus === "completed" ||
              prev.serverStatus === "interrupted" ||
              prev.serverStatus === "cancelled"
            ) {
              return { ...prev, connection: "ended" };
            }
            return { ...prev, connection: reason === "failed" ? "failed" : prev.finalReport ? "ended" : "live" };
          });
        }
      );
      return { cancel: () => { runIdRef.current += 1; handle.close(); } };
    },
    [applyEvent]
  );

  return { state, start, reset, cancel, resume };
}
