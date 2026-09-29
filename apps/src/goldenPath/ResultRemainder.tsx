import type { InvestigationEvidenceLink, InvestigationSnapshotV1, InvestigationSource, PublicActivity } from "../lib/investigation";
import { ActivityFeed } from "./ActivityFeed";
import { evidenceTitle, resultQuoteRows, ROLE_LABEL } from "./snapshotUi";

type Props = {
  snapshot: InvestigationSnapshotV1;
  activities: PublicActivity[];
  onSelectSource: (link: InvestigationEvidenceLink, source: InvestigationSource, claimId: string, trigger: HTMLElement) => void;
  onSelectConflict: (claimId: string) => void;
};

export function ResultRemainder({ snapshot, activities, onSelectSource, onSelectConflict }: Props) {
  const attachments = snapshot.claims.flatMap((claim) => {
    const shownIndices = new Set(resultQuoteRows(claim, snapshot.sources).map((row) => row.index));
    return claim.evidence.flatMap((link, index) => {
    const source = snapshot.sources.find((item) => item.id === link.sourceId);
    return source && !shownIndices.has(index) ? [{ claim, link, source }] : [];
    });
  });
  const referencedSourceIds = new Set(snapshot.claims.flatMap((claim) => claim.evidence.map((link) => link.sourceId)));
  const remainingSourceIds = new Set(attachments.map(({ source }) => source.id));
  const shownUrls = new Set(snapshot.claims.flatMap((claim) => resultQuoteRows(claim, snapshot.sources).map(({ source }) => source.url.split("#")[0])));
  const seenUrls = new Set<string>();
  const otherSources = snapshot.sources.filter((source) => {
    const url = source.url.split("#")[0];
    if ((!remainingSourceIds.has(source.id) && (referencedSourceIds.has(source.id) || shownUrls.has(url))) || seenUrls.has(url)) return false;
    seenUrls.add(url);
    return true;
  });
  if (otherSources.length === 0 && snapshot.conflicts.length === 0 && activities.length === 0) return null;
  return (
    <details className="gp-result-remainder" data-gp-result-remainder>
      <summary>其余材料{otherSources.length > 0 ? `（${otherSources.length} 篇）` : ""}与调查经历</summary>
      <div className="gp-result-remainder-body">
        {otherSources.length > 0 ? (
          <section aria-label="其余材料">
            <h3>其余材料</h3>
            <ul>
              {otherSources.map((source) => {
                const sameUrlSources = snapshot.sources.filter((item) => item.url.split("#")[0] === source.url.split("#")[0]);
                const attached = attachments.filter(({ source: linkedSource }) => sameUrlSources.some((item) => item.id === linkedSource.id));
                return (
                  <li key={source.id}>
                    {attached.length > 0 ? <span>{evidenceTitle(attached[0]!.link, source)}</span> : source.url ? (
                      <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title || source.url}</a>
                    ) : <span>{source.title || source.id}</span>}
                    {attached.length === 0 && source.excerpt?.trim() ? <p>材料摘录：{source.excerpt.trim()}</p> : null}
                    {attached.map(({ claim, link, source: linkedSource }, index) => (
                      <div key={`${claim.id}-${link.sourceId}-${index}`}>
                        <button type="button" className="gp-result-material-link" data-gp-role={link.role} data-gp-source-id={linkedSource.id} data-gp-evidence-claim={claim.id} onClick={(event) => onSelectSource(link, linkedSource, claim.id, event.currentTarget)}>
                          查看来源：{claim.text} · {ROLE_LABEL[link.role]}
                        </button>
                        {(link.passage?.trim() || (index === 0 ? source.excerpt?.trim() : "")) ? <p>材料摘录：{link.passage?.trim() || source.excerpt?.trim()}</p> : null}
                      </div>
                    ))}
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}
        {snapshot.conflicts.length > 0 ? (
          <section aria-label="调查分歧"><h3>调查分歧</h3><ul>{snapshot.conflicts.map((conflict) => {
            return <li key={conflict.id} data-gp-conflict-id={conflict.id}>
              <button type="button" onClick={() => onSelectConflict(conflict.claimId)}>{conflict.summary}</button>
              <p>{conflict.reasonStatus === "known" && conflict.reason ? conflict.reason : "双方材料并存，分歧的原因目前还不清楚。"}</p>
              {conflict.sides.map((side) => (
                <div key={side.position} data-gp-conflict-side={side.position}>
                  <strong>{side.position === "support" ? "支持" : side.position === "contradict" ? "反驳" : "其他"}</strong>
                  {side.sourceIds.some((sourceId) => !snapshot.sources.some((source) => source.id === sourceId)) ? <span>材料暂缺</span> : null}
                </div>
              ))}
            </li>;
          })}</ul></section>
        ) : null}
        {activities.length > 0 ? (
          <section aria-label="调查经历"><h3>调查经历</h3><ActivityFeed activities={activities} snapshot={snapshot} onSelectSource={onSelectSource} onSelectConflict={onSelectConflict} /></section>
        ) : null}
      </div>
    </details>
  );
}
