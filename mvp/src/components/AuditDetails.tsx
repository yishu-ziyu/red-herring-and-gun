import type { GradedEvidence } from "../lib/schemas";

interface AuditDetailsProps {
  grade: GradedEvidence;
}

export function AuditDetails({ grade }: AuditDetailsProps) {
  return (
    <details className="audit-details">
      <summary>查看审计细节</summary>
      <div className="audit-grid">
        <span>相关性：{grade.scores.relevance}</span>
        <span>可追溯：{grade.scores.traceability}</span>
        <span>方法适配：{grade.scores.methodFit}</span>
        <span>语境适配：{grade.scores.contextFit}</span>
        <span>独立性：{grade.scores.independence}</span>
      </div>
      <p>证据缺口：{grade.evidenceGap.join("；")}</p>
      <p>限制：{grade.limitations.join("；")}</p>
    </details>
  );
}
