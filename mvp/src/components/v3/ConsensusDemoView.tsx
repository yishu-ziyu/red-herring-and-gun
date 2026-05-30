import { useState, useCallback, useEffect, useRef } from "react";
import { useReasoning } from "../../store/reasoningStore";
import { ConsensusProgressPanel } from "./ConsensusProgressPanel";
import { EvidenceDetailDrawer } from "./EvidenceDetailDrawer";
import { EvidenceMatrix } from "./EvidenceMatrix";
import { StreamingReasoningPanel } from "./StreamingReasoningPanel";
import {
  createStreamingSession,
  startMockStream,
} from "../../lib/streamingMock";
import type { StreamEvent } from "../../lib/streamingTypes";

interface ConsensusDemoViewProps {
  claim: string;
  onCancel: () => void;
}

export function ConsensusDemoView({ claim, onCancel }: ConsensusDemoViewProps) {
  const { state, dispatch } = useReasoning();
  const [selectedPropositionId, setSelectedPropositionId] = useState("");
  const cancelStreamRef = useRef<(() => void) | null>(null);
  const consensusReport = state.consensusReport;

  // 启动流式推理过程
  useEffect(() => {
    // 如果已经有流在运行，取消它
    if (cancelStreamRef.current) {
      cancelStreamRef.current();
      cancelStreamRef.current = null;
    }

    // 创建新会话
    const session = createStreamingSession(claim);
    dispatch({ type: "START_STREAMING_SESSION", payload: session });

    // 启动 Mock 流
    const cancel = startMockStream(
      session,
      (event: StreamEvent) => {
        switch (event.type) {
          case "stage_start":
            dispatch({
              type: "UPDATE_STREAMING_STAGE",
              payload: { stageId: event.stageId, status: "running" },
            });
            break;
          case "content_chunk":
            dispatch({
              type: "APPEND_STREAMING_CHUNK",
              payload: {
                stageId: event.stageId,
                chunk: event.chunk,
              },
            });
            break;
          case "stage_end":
            dispatch({
              type: "UPDATE_STREAMING_STAGE",
              payload: { stageId: event.stageId, status: event.status },
            });
            break;
          case "session_complete":
            dispatch({ type: "END_STREAMING_SESSION" });
            break;
        }
      },
      { accelerate: false }
    );

    cancelStreamRef.current = cancel;

    return () => {
      cancel();
      cancelStreamRef.current = null;
    };
  }, [claim, dispatch]);

  const handleCellClick = useCallback(
    (propositionId: string, _provider: string) => {
      setSelectedPropositionId(propositionId);
    },
    []
  );

  const handleStatusClick = useCallback((propositionId: string) => {
    setSelectedPropositionId(propositionId);
  }, []);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--zt-bg)",
        color: "var(--zt-text)",
        padding: "24px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "20px",
          marginBottom: "20px",
        }}
      >
        <div>
          <span
            style={{
              display: "inline-flex",
              marginBottom: "8px",
              color: "var(--zt-text-muted)",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            Cross Search Consensus Demo
          </span>
          <h1 style={{ margin: 0, fontSize: "24px", lineHeight: 1.2 }}>
            多搜索引擎交叉验证
          </h1>
          <p
            style={{
              margin: "8px 0 0",
              maxWidth: "820px",
              color: "var(--zt-text-secondary)",
              lineHeight: 1.6,
            }}
          >
            {claim}
          </p>
        </div>
        <button className="mission-cancel-button" onClick={onCancel} type="button">
          返回输入
        </button>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(280px, 360px) 1fr", gap: "18px" }}>
        <ConsensusProgressPanel
          claimDecomposition={state.claimDecomposition}
          searchJobs={state.searchJobs}
          consensusReport={consensusReport}
        />

        {consensusReport ? (
          <EvidenceMatrix
            consensusReport={consensusReport}
            searchJobs={state.searchJobs}
            onCellClick={handleCellClick}
            onStatusClick={handleStatusClick}
          />
        ) : (
          <section className="workspace-panel">
            <div className="panel-heading">
              <span>Evidence Matrix</span>
              <strong>等待共识报告</strong>
            </div>
          </section>
        )}
      </div>

      {/* 实时流式推理面板 */}
      <StreamingReasoningPanel session={state.streamingSession} />

      {consensusReport ? (
        <EvidenceDetailDrawer
          isOpen={Boolean(selectedPropositionId)}
          onClose={() => setSelectedPropositionId("")}
          propositionId={selectedPropositionId}
          consensusReport={consensusReport}
          searchJobs={state.searchJobs}
        />
      ) : null}
    </main>
  );
}

export default ConsensusDemoView;
