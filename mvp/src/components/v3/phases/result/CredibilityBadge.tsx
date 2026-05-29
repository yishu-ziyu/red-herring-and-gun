interface CredibilityBadgeProps {
  score: number;
  label: string;
}

function clampScore(score: number) {
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function getTone(score: number) {
  if (score >= 80) return "high";
  if (score >= 60) return "good";
  if (score >= 40) return "medium";
  if (score >= 20) return "low";
  return "critical";
}

export function CredibilityBadge({ score, label }: CredibilityBadgeProps) {
  const normalizedScore = clampScore(score);
  const tone = getTone(normalizedScore);

  return (
    <div className={`credibility-badge credibility-badge--${tone}`}>
      <div className="credibility-badge-score">
        <strong>{normalizedScore}</strong>
        <span>/100</span>
      </div>
      <div className="credibility-badge-copy">
        <span>可信度</span>
        <strong>{label}</strong>
      </div>
      <div className="credibility-badge-bar" aria-hidden="true">
        <span style={{ width: `${normalizedScore}%` }} />
      </div>
    </div>
  );
}
