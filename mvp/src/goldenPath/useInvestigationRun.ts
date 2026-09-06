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
  rebuildInvestigationFromReport,
  validateInvestigationSnapshot,
  type InvestigationSnapshotV1,
} from "@rhg/core/investigation";
import { requestOrchestrateStream, type OrchestrateStreamEvent } from "../lib/agentExpansion";
import { caseIntakePrimaryText, type CaseIntake } from "../lib/caseIntake";
import { createKnowledgeBase } from "../lib/knowledgeBase";
import { buildLocalMemoryRecall } from "../lib/localMemoryRecall";
import type { ModelChoiceMap } from "../lib/agentExpansion";

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

export type RunState = {
  /** null = 尚未收到任何快照（拆题还没回来）。 */
  snapshot: InvestigationSnapshotV1 | null;
  connection: ConnectionPhase;
  errorMessage: string;
  /** complete 事件的 finalReport（imageOrigin side-channel 与父层落库用）。 */
  finalReport: Record<string, unknown> | null;
};

const INITIAL_STATE: RunState = {
  snapshot: null,
  connection: "connecting",
  errorMessage: "",
  finalReport: null,
};

/**
 * 纯 reducer：一条 SSE 事件 → 下一份产品 state。
 * 只认 investigation_snapshot / complete / error；legacy 事件原样忽略（E2 负向测试的对象）。
 * claim 供 complete 报告缺快照时的确定性重建使用。
 */
export function applyRunEvent(prev: RunState, event: OrchestrateStreamEvent, claim?: string): RunState {
  if (event.type === "investigation_snapshot" && event.investigation) {
    try {
      const snapshot = validateInvestigationSnapshot(event.investigation);
      return { ...prev, snapshot, connection: "live", errorMessage: "" };
    } catch {
      // 契约外快照不进产品 state：宁可停留上一份，也不渲染未校验数据。
      return prev;
    }
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
    return { ...prev, snapshot, finalReport: report, connection: "ended" };
  }
  if (event.type === "error") {
    return {
      ...prev,
      connection: "failed",
      errorMessage: typeof event.message === "string" ? event.message : "这次调查没有完成，请重试。",
    };
  }
  return prev;
}

export type StartOptions = {
  modelChoice?: ModelChoiceMap;
  accountEmail?: string | null;
  /** DEV 固定装置：不走网络，按脚本回放快照（仅 import.meta.env.DEV）。 */
  fixture?: (emit: (event: OrchestrateStreamEvent) => void) => () => void;
};

export function useInvestigationRun() {
  const [state, setState] = useState<RunState>(INITIAL_STATE);
  const runIdRef = useRef(0);

  const applyEvent = useCallback((event: OrchestrateStreamEvent, claim?: string) => {
    setState((prev) => applyRunEvent(prev, event, claim));
  }, []);

  const start = useCallback(
    (intake: CaseIntake, options: StartOptions = {}) => {
      const runId = ++runIdRef.current;
      const claim = caseIntakePrimaryText(intake);
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
        for await (const event of requestOrchestrateStream(intake, memoryRecall, options.modelChoice)) {
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

  return { state, start, reset };
}
