import type { CandidateMaterial, GradedEvidence } from "../lib/schemas";
import { AuditDetails } from "./AuditDetails";

interface EvidencePermissionCardProps {
  selectedSubclaimId: string;
  grades: GradedEvidence[];
  candidates: CandidateMaterial[];
}

function titleFor(candidates: CandidateMaterial[], id: string) {
  return candidates.find((candidate) => candidate.id === id)?.title ?? id;
}

function summaryFor(candidates: CandidateMaterial[], id: string) {
  return candidates.find((candidate) => candidate.id === id)?.summary ?? "";
}

export function EvidencePermissionCard({ selectedSubclaimId, grades, candidates }: EvidencePermissionCardProps) {
  const selectedGrades = grades.filter((grade) => grade.subclaimId === selectedSubclaimId);
  const isCausalPath = selectedSubclaimId === "C4";

  return (
    <section className="product-card">
      <div className="card-label">第三步：看证据被允许怎么用</div>
      <div className="permission-heading">
        <h2>这条证据能说什么？</h2>
        {isCausalPath ? <span className="causal-warning">因果证据不足</span> : null}
      </div>
      <div className="permission-list">
        {selectedGrades.map((grade) => (
          <article className="permission-card" key={`${grade.candidateId}-${grade.subclaimId}`}>
            <div className="permission-topline">
              <span>{grade.usageLevel}</span>
              <em>{grade.matchedEvidenceNeed}</em>
            </div>
            <h3>{titleFor(candidates, grade.candidateId)}</h3>
            <p>{summaryFor(candidates, grade.candidateId)}</p>
            <div className="say-grid">
              <div className="can-say">
                <strong>可以说</strong>
                <ul>
                  {grade.inferenceAllowed.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
              <div className="cannot-say">
                <strong>不能说</strong>
                <ul>
                  {grade.inferenceBlocked.slice(0, 3).map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <AuditDetails grade={grade} />
          </article>
        ))}
      </div>
    </section>
  );
}
