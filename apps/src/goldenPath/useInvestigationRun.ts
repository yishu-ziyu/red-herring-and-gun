/**
 * 消费调查流，维护快照、连接状态和最终报告；忽略不供当前界面使用的旧事件。
 */
import { useCallback, useRef, useState } from "react";
import {
  isPublicActivity,
  rebuildInvestigationFromReport,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "../../shared/investigation";
import {
  cancelInvestigation,
  resumeInvestigation,
  startInvestigation,
  type InvestigationStreamEvent,
} from "../lib/investigationClient";
import { caseIntakePrimaryText, type CaseIntake } from "../lib/caseIntake";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { buildLocalMemoryRecall } from "../lib/localMemoryRecall";
import type { VisiblePriorRound } from "../../shared/followUp";

export type ConnectionPhase = "connecting" | "live" | "disconnected" | "ended" | "failed";

/** 停止只分三态：没在停 / 已请求、等后端 / 后端已确认。不提前说「已停止」。 */
export type StopPhase = "idle" | "stopping" | "stopped";

export type RunState = {
  /** null = 尚未收到任何快照（拆题还没回来）。 */
  snapshot: InvestigationSnapshotV1 | null;
  connection: ConnectionPhase;
  errorMessage: string;
  /** complete 事件的 finalReport（父层落库用）。 */
  finalReport: Record<string, unknown> | null;
  /** 当前活动的 runId；不同 run 的活动不混在一起。 */
  activityRunId: string | null;
  /**
   * 已收到的最大活动 seq：刷新接回时从它之后补发。只由 investigation_activity 事件写入；
   * 活动层坏了不影响快照与结果。
   */
  lastActivitySeq: number;
  /** 服务端运行身份（run_started 事件）。刷新恢复与取消都要它。 */
  runId: string | null;
  /** 这次调查开始的时间，已换成本机时钟（毫秒）。进行中页面算已用时间。 */
  startedAt: number | null;
  /** 服务端确认的 run 状态（run_state 事件 / 取消响应）。 */
  serverStatus: string | null;
  stop: StopPhase;
  /**
   * 整体超时后管线仍在跑：这时候等结果变成「可选」——用户离开页面或刷新都还能拿回同一份结论。
   * complete（真结果到了）或 error（最终失败）时翻回 false。
   */
  timeoutPending: boolean;
  /** 服务端的常驻提示（如图片没读出来、已按文字继续）。不影响连接与快照。 */
  notice?: string;
};

const INITIAL_STATE: RunState = {
  snapshot: null,
  connection: "connecting",
  errorMessage: "",
  finalReport: null,
  activityRunId: null,
  lastActivitySeq: 0,
  runId: null,
  startedAt: null,
  serverStatus: null,
  stop: "idle",
  timeoutPending: false,
};

function isTerminalServerStatus(status: string | null): boolean {
  return status === "completed" || status === "interrupted" || status === "cancelled";
}

/**
 * 纯 reducer：一条事件 → 下一份产品 state。不认识的事件原样忽略。
 * claim 供 complete 报告缺快照时的确定性重建使用；now 是收到这条事件的本机时间。
 */
export function applyRunEvent(
  prev: RunState,
  event: InvestigationStreamEvent,
  { claim, now = Date.now() }: { claim?: string; now?: number } = {}
): RunState {
  if (event.type === "run_started") {
    return {
      ...prev,
      runId: typeof event.runId === "string" ? event.runId : prev.runId,
      // 服务端的开始时间换成本机时钟：两边时钟可能差几分钟，按这条事件的发出时间对齐。
      startedAt:
        typeof event.startedAt === "number"
          ? event.startedAt + (typeof event.timestamp === "number" ? now - event.timestamp : 0)
          : prev.startedAt,
    };
  }
  if (event.type === "run_state") {
    const status = typeof event.status === "string" ? event.status : prev.serverStatus;
    if (isTerminalServerStatus(prev.serverStatus) && status !== prev.serverStatus) return prev;
    const stopped = status === "cancelled" || status === "cancelling";
    const terminal = isTerminalServerStatus(status);
    return {
      ...prev,
      serverStatus: status,
      stop: stopped ? (status === "cancelling" ? "stopping" : "stopped") : terminal ? "idle" : prev.stop,
      // 失败已经定了（error 事件先到）：服务端随后补发的终态不能把它改回「已结束」，否则页面会一直等。
      ...(terminal ? { connection: prev.connection === "failed" ? ("failed" as const) : ("ended" as const), timeoutPending: false } : {}),
    };
  }
  if (event.type === "investigation_activity") {
    // 终态不能被晚到活动倒退：complete/error 之后一律不再收活动。
    if (prev.connection === "ended" || prev.connection === "failed") return prev;
    const activity = event.activity;
    if (!activity || !isPublicActivity(activity)) return prev;
    const sameRun = prev.activityRunId === activity.runId;
    // 重放、重复和乱序到达都不会把 seq 往回拨。
    const lastActivitySeq = sameRun ? Math.max(prev.lastActivitySeq, activity.seq) : activity.seq;
    if (sameRun && lastActivitySeq === prev.lastActivitySeq) return prev;
    return { ...prev, activityRunId: activity.runId, lastActivitySeq };
  }
  if (event.type === "investigation_snapshot" && event.investigation) {
    try {
      const snapshot = validateInvestigationSnapshot(event.investigation);
      return { ...prev, snapshot, connection: isTerminalServerStatus(prev.serverStatus) ? prev.connection : "live", errorMessage: "" };
    } catch {
      // 契约外快照不进产品 state：宁可停留上一份，也不渲染未校验数据。
      return prev;
    }
  }
  if (event.type === "notice") {
    return typeof event.message === "string" && event.message ? { ...prev, notice: event.message } : prev;
  }
  if (event.type === "timeout_pending") {
    // 超时只改「等结果要不要必须」这一件事：连接还是活的，快照照来，别的一概不动。
    return { ...prev, timeoutPending: true };
  }
  if (event.type === "complete") {
    const report = (event.finalReport ?? null) as Record<string, unknown> | null;
    let snapshot = prev.snapshot;
    // complete 的 finalReport 自带完成态快照；比流中最后一份更权威。
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
  if (event.type === "transport_error") {
    if (isTerminalServerStatus(prev.serverStatus) || prev.finalReport) return prev;
    return { ...prev, connection: "disconnected", timeoutPending: false, errorMessage: event.message ?? "" };
  }
  if (event.type === "stream_closed") {
    // 流结束不证明调查失败；没有定论就保留运行身份，允许接回同一轮。
    if (prev.connection === "ended" || prev.connection === "failed") return prev;
    // 服务端已确认终态：补发完就关流，不是「还活着」。超时后晚完成的 run 走的正是这条路——
    // 刷新回来能拿到 phase=complete 的快照，界面必须按「已结束」渲染，不能挂着进行中。
    if (isTerminalServerStatus(prev.serverStatus) || prev.finalReport) return { ...prev, connection: "ended" };
    return { ...prev, connection: "disconnected" };
  }
  return prev;
}

export type StartOptions = {
  /**
   * 追问：带上一轮可见材料。
   * 首轮、重试都不带，请求体里也就没有这些字段。
   */
  priorRound?: VisiblePriorRound | null;
  kind?: "recheck";
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

  const consume = useCallback(async (events: AsyncIterable<InvestigationStreamEvent>, generation: number, claim: string) => {
    for await (const event of events) {
      if (runIdRef.current !== generation) return;
      const now = Date.now();
      setState((prev) => applyRunEvent(prev, event, { claim, now }));
    }
  }, []);

  const start = useCallback(
    (intake: CaseIntake, options: StartOptions = {}) => {
      const generation = ++runIdRef.current;
      const claim = caseIntakePrimaryText(intake);
      const submitKey = JSON.stringify({
        claim,
        links: intake.links.map((link) => ({ url: link.url, content: link.scrapedContent })),
        images: intake.images.map((image) => image.dataUrl),
        priorRound: options.priorRound,
        kind: options.kind,
      });
      const previous = lastSubmitRef.current;
      // 同一份材料 + 5 秒内重复提交 → 复用同一个 clientRequestId，服务端只建一条 run。
      const clientRequestId =
        previous && previous.key === submitKey && Date.now() - previous.at < 5_000
          ? previous.clientRequestId
          : newClientRequestId();
      lastSubmitRef.current = { key: submitKey, clientRequestId, at: Date.now() };
      setState({ ...INITIAL_STATE, connection: "connecting" });

      void (async () => {
        let memoryRecall: Record<string, unknown> | undefined;
        try {
          memoryRecall = await buildLocalMemoryRecall(createKnowledgeBase(), intake.text);
        } catch {
          // 召回降级不阻断调查
        }
        await consume(
          startInvestigation(intake, { memoryRecall, clientRequestId, priorRound: options.priorRound, kind: options.kind }),
          generation,
          claim
        );
      })();
    },
    [consume]
  );

  const reset = useCallback(() => {
    runIdRef.current += 1;
    setState(INITIAL_STATE);
  }, []);

  /** 取消：先本地记「正在停」，再等服务端确认；服务端确认不了就不说「已停止」。 */
  const cancel = useCallback(async () => {
    const runId = state.runId;
    const generation = runIdRef.current;
    if (!runId) return;
    setState((prev) => isTerminalServerStatus(prev.serverStatus) ? prev : { ...prev, stop: "stopping" });
    const result = await cancelInvestigation(runId);
    setState((prev) => {
      // SSE can confirm cancellation before this older HTTP acknowledgement arrives.
      // Neither that acknowledgement nor an old run may overwrite the current terminal state.
      if (generation !== runIdRef.current || prev.runId !== runId || isTerminalServerStatus(prev.serverStatus)) return prev;
      return result.ok
        ? applyRunEvent(prev, { type: "run_state", status: result.status ?? "cancelling" })
        : { ...prev, errorMessage: "停止请求没有送达，调查可能还在继续。" };
    });
  }, [state.runId]);

  /** 接回一条已有 run（刷新/返回）。不新建 run、不扣额。 */
  const resume = useCallback(
    (runId: string, after: number, claim: string) => {
      const generation = ++runIdRef.current;
      setState((prev) => prev.runId === runId
        ? { ...prev, connection: "connecting", errorMessage: "", timeoutPending: false }
        : { ...INITIAL_STATE, runId, connection: "connecting" });
      void consume(resumeInvestigation(runId, after), generation, claim);
    },
    [consume]
  );

  return { state, start, reset, cancel, resume };
}
