import type { MemoryCandidate, MemoryCandidateStatus } from "../../lib/agentRuntime/memoryCandidateTypes";

interface MemoryCandidatePanelProps {
  candidates: MemoryCandidate[];
  onStatusChange: (id: string, status: MemoryCandidateStatus) => void;
}

const KIND_LABEL: Record<MemoryCandidate["kind"], string> = {
  case_pattern: "案例模式",
  evidence_item: "证据条目",
  search_strategy: "搜索策略",
  source_reputation: "来源信誉",
  recursive_path: "递归路径",
  reasoning_pattern: "推理模式",
  failure_record: "失败记录",
};

export function MemoryCandidatePanel({ candidates, onStatusChange }: MemoryCandidatePanelProps) {
  if (candidates.length === 0) return null;

  return (
    <section className="memory-candidate-panel" aria-label="Agent 记忆候选">
      <div className="memory-candidate-panel__header">
        <div>
          <span>知识库候选</span>
          <strong>{candidates.filter((candidate) => candidate.status === "proposed").length}</strong>
        </div>
        <p>Agent 只提出可复用经验；确认后才进入后续案件召回。</p>
      </div>
      <div className="memory-candidate-list">
        {candidates.map((candidate) => (
          <article className={`memory-candidate-card memory-candidate-card--${candidate.status}`} key={candidate.id}>
            <div className="memory-candidate-card__meta">
              <span>{KIND_LABEL[candidate.kind]}</span>
              <span>{candidate.confidence}/100</span>
            </div>
            <h3>{candidate.title}</h3>
            <p>{candidate.summary}</p>
            <div className="memory-candidate-card__actions">
              {candidate.status === "proposed" ? (
                <>
                  <button type="button" onClick={() => onStatusChange(candidate.id, "accepted")}>
                    写入知识库
                  </button>
                  <button type="button" onClick={() => onStatusChange(candidate.id, "rejected")}>
                    忽略
                  </button>
                </>
              ) : (
                <span>{candidate.status === "accepted" ? "已确认复用" : "已忽略"}</span>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
