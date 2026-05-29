import { useMemo } from "react";
import { useReasoning } from "../../../store/reasoningStore";
import { runDemoPipeline } from "../../../lib/pipeline";

export function KnowledgePanel() {
  const { state } = useReasoning();
  const { caseData, gradedEvidence } = runDemoPipeline();

  // 从画布节点中过滤出证据类节点
  const evidenceNodes = useMemo(
    () => state.nodes.filter((n) => n.type === "candidate_evidence" || n.type === "evidence_need"),
    [state.nodes]
  );

  const evidenceNeeds = useMemo(
    () => state.nodes.filter((n) => n.type === "evidence_need"),
    [state.nodes]
  );

  return (
    <section className="workspace-panel" aria-label="Knowledge panel">
      <div className="panel-heading">
        <span>知识库</span>
        <strong>证据与材料</strong>
      </div>

      <div className="panel-content">
        {/* 证据需求概览 */}
        <div className="info-block">
          <h3>证据需求 ({evidenceNeeds.length})</h3>
          {evidenceNeeds.length === 0 ? (
            <p>暂无明确的证据需求节点。</p>
          ) : (
            <ul style={{ paddingLeft: "16px", margin: "8px 0 0" }}>
              {evidenceNeeds.map((node) => (
                <li key={node.id} style={{ marginBottom: "6px", fontSize: "13px" }}>
                  <strong>{node.title}</strong>
                  {node.subtitle ? <span style={{ color: "#86868b" }}> — {node.subtitle}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* 候选材料 */}
        <div className="info-block">
          <h3>候选材料 ({caseData.candidates.length})</h3>
          {caseData.candidates.map((candidate) => {
            const grades = gradedEvidence.filter((g) => g.candidateId === candidate.id);
            const mainGrade = grades[0];

            return (
              <div
                key={candidate.id}
                style={{
                  border: "1px solid rgba(0,0,0,0.08)",
                  borderRadius: "10px",
                  padding: "10px 12px",
                  marginBottom: "10px",
                  background: "rgba(255,255,255,0.6)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" }}>
                  <strong style={{ fontSize: "13px" }}>{candidate.title}</strong>
                  <span
                    className="demo-card-tag"
                    style={{
                      fontSize: "11px",
                      background:
                        candidate.sourceType === "学术论文"
                          ? "#e8f5e9"
                          : candidate.sourceType === "招聘数据"
                          ? "#e3f2fd"
                          : candidate.sourceType === "企业案例"
                          ? "#fff3e0"
                          : "#f5f5f5",
                      color:
                        candidate.sourceType === "学术论文"
                          ? "#2e7d32"
                          : candidate.sourceType === "招聘数据"
                          ? "#1565c0"
                          : candidate.sourceType === "企业案例"
                          ? "#e65100"
                          : "#616161",
                    }}
                  >
                    {candidate.sourceType}
                  </span>
                </div>

                <p style={{ fontSize: "12px", color: "#86868b", margin: "0 0 6px" }}>
                  {candidate.summary}
                </p>

                {mainGrade && (
                  <div style={{ fontSize: "12px", display: "flex", gap: "12px", flexWrap: "wrap" }}>
                    <span>
                      <strong>角色：</strong>
                      {mainGrade.evidenceRole}
                    </span>
                    <span>
                      <strong>级别：</strong>
                      {mainGrade.usageLevel}
                    </span>
                    <span>
                      <strong>相关度：</strong>
                      {mainGrade.scores.relevance}
                    </span>
                  </div>
                )}

                {candidate.limitations.length > 0 && (
                  <p style={{ fontSize: "11px", color: "#ff3b30", margin: "6px 0 0" }}>
                    <strong>限制：</strong>
                    {candidate.limitations.join("；")}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* 画布上的证据节点 */}
        {evidenceNodes.length > 0 && (
          <div className="info-block">
            <h3>画布证据节点 ({evidenceNodes.length})</h3>
            <ul style={{ paddingLeft: "16px", margin: "8px 0 0" }}>
              {evidenceNodes.map((node) => (
                <li key={node.id} style={{ marginBottom: "4px", fontSize: "13px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      marginRight: "6px",
                      background:
                        node.status === "supported"
                          ? "#34c759"
                          : node.status === "blocked"
                          ? "#af52de"
                          : node.status === "risk"
                          ? "#ff3b30"
                          : "#86868b",
                    }}
                  />
                  {node.title}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
