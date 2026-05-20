import type { FinalReport } from "../lib/schemas";

interface RewriteResultProps {
  report: FinalReport;
}

export function RewriteResult({ report }: RewriteResultProps) {
  return (
    <section className="product-card rewrite-card">
      <div className="card-label">第四步：拿走更严谨的表达</div>
      <div className="rewrite-compare">
        <div className="too-strong">
          <span>原句太强</span>
          <p>{report.originalClaim}</p>
        </div>
        <div className="allowed-version">
          <span>目前能说到</span>
          <p>{report.rewrittenClaim.cautious}</p>
        </div>
      </div>
      <div className="rewrite-versions">
        <article>
          <strong>谨慎版</strong>
          <p>{report.rewrittenClaim.cautious}</p>
        </article>
        <article>
          <strong>通俗版</strong>
          <p>{report.rewrittenClaim.publicFacing}</p>
        </article>
        <article>
          <strong>研究备忘录版</strong>
          <p>{report.rewrittenClaim.researchMemo}</p>
        </article>
      </div>
      <div className="next-evidence">
        <h3>如果要继续查，下一步补这些</h3>
        <ol>
          {report.nextEvidenceNeeded.slice(0, 4).map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ol>
      </div>
    </section>
  );
}
