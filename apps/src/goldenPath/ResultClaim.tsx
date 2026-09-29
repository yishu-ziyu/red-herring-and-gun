import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";
import { JUDGMENT_LABEL, JUDGMENT_TONE, ROLE_LABEL, domainOf, evidenceTitle, resultQuoteRows } from "./snapshotUi";

type Props = {
  claim: InvestigationClaim;
  index: number;
  originalClaim: string;
  sources: InvestigationSource[];
  onSelectSource: (link: InvestigationEvidenceLink, source: InvestigationSource, claimId: string, trigger: HTMLElement) => void;
  onHeaderHover?: (claimId: string | null) => void;
  onHeaderFocus?: (claimId: string | null) => void;
};

/** 完成态只把逐字核过的 passage 当作原文；来源摘要留到其余材料。 */
export function ResultClaim({ claim, index, originalClaim, sources, onSelectSource, onHeaderHover, onHeaderFocus }: Props) {
  const verified = resultQuoteRows(claim, sources);
  const span = claim.originalSpan;
  const exactPhrase = span && span.start >= 0 && span.end <= originalClaim.length && span.end > span.start
    ? originalClaim.slice(span.start, span.end)
    : "";
  const openGaps = claim.gaps.filter((gap) => gap.status === "open" && gap.description.trim());
  const overclaim = claim.displayStanding === "说过头了" || claim.displayStanding === "言过其实";

  return (
    <article className="gp-result-claim" id={`gp-claim-${claim.id}`} data-gp-claim-id={claim.id} tabIndex={-1}>
      <div className="gp-result-claim-heading" tabIndex={0} onMouseEnter={() => onHeaderHover?.(claim.id)} onMouseLeave={() => onHeaderHover?.(null)} onFocus={() => onHeaderFocus?.(claim.id)} onBlur={() => onHeaderFocus?.(null)}>
        <h3 className="gp-result-claim-title"><span aria-hidden="true">{index + 1}.</span>{exactPhrase || claim.text}{!exactPhrase ? <em>核查命题</em> : null}</h3>
        {claim.judgment ? (
          <span className={`gp-result-judgment is-${JUDGMENT_TONE[claim.judgment]}`} data-gp-judgment={claim.judgment}>
            {claim.displayStanding || JUDGMENT_LABEL[claim.judgment]}
          </span>
        ) : null}
      </div>
      {verified.map(({ link, index: linkIndex, source, passage }) => {
        const baseUrl = source.url.split(":~:")[0];
        const quoteUrl = `${baseUrl}${baseUrl.includes("#") ? "" : "#"}:~:text=${encodeURIComponent(passage)}`;
        return (
          <div className="gp-result-quote" key={`${claim.id}-${link.sourceId}-${linkIndex}`} data-gp-verified-quote data-gp-source-id={source.id}>
            <span className={`gp-result-quote-role is-${link.role}`}>{ROLE_LABEL[link.role]}</span>
            <blockquote>{passage}</blockquote>
            <div className="gp-result-source-line">
              <span>{domainOf(source.url)} · {evidenceTitle(link, source)}{source.publishedAt?.trim() ? ` · ${source.publishedAt.trim()}` : ""}</span>
              <span className="gp-result-source-actions">
                <button type="button" className="gp-result-material-link" data-gp-role={link.role} data-gp-source-id={source.id} data-gp-evidence-claim={claim.id} onClick={(event) => onSelectSource(link, source, claim.id, event.currentTarget)}>查看来源</button>
                <a href={quoteUrl} target="_blank" rel="noopener noreferrer">看原文 ↗</a>
              </span>
            </div>
          </div>
        );
      })}
      {verified.length === 0 && openGaps.length === 0 ? <p className="gp-result-no-quote">{claim.judgment === "unresolved" ? "目前的材料不足以判断。" : "这份记录没有保存可核对的原文。"}</p> : null}
      {claim.judgment !== "unresolved" && claim.boundary?.trim() ? (
        overclaim ? <p className="gp-result-boundary" data-gp-overclaim><strong>过头之处</strong>{claim.boundary.trim()}</p>
          : <p className="gp-result-boundary"><strong>需要注意</strong>{claim.boundary.trim()}</p>
      ) : null}
      {openGaps.map((gap) => <p key={gap.id} className="gp-result-gap">尚未查清：{gap.description}</p>)}
    </article>
  );
}
