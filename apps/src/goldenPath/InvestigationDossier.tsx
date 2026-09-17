import type {
  InvestigationEvidenceLink,
  InvestigationSnapshotV1,
  InvestigationSource,
  PublicActivity,
} from "../lib/investigation";
import { attachmentsForSource } from "./snapshotUi";
import { ActivityFeed } from "./ActivityFeed";

type InvestigationDossierProps = {
  snapshot: InvestigationSnapshotV1;
  activities?: PublicActivity[];
  onSelectSource?: (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement,
  ) => void;
  onSelectConflict?: (claimId: string, trigger: HTMLElement) => void;
};

export function InvestigationDossier({
  snapshot,
  activities = [],
  onSelectSource,
  onSelectConflict,
}: InvestigationDossierProps) {
  const gaps = snapshot.claims.flatMap((claim) => claim.gaps);
  const hasExperience = activities.length > 0;

  return (
    <section className="gp-dossier" aria-label="调查案卷" data-gp-dossier>
      <div className="gp-dossier-bar">
        <div className="gp-dossier-title">
          <span className="gp-dossier-dot"></span>
          <strong>调查案卷</strong>
        </div>
      </div>

      <div className="gp-dossier-body" data-gp-dossier-expanded>
        <section className="gp-dossier-col" data-gp-dossier-section="sources">
          <h4 className="gp-dossier-section-title">收集到的来源</h4>
          {snapshot.sources.length === 0 ? (
            <p className="gp-dossier-card-desc">还没有收集到的来源。</p>
          ) : (
            <ul className="gp-dossier-list">
              {snapshot.sources.map((source) => {
                const attachments = attachmentsForSource(source.id, snapshot.claims);
                const seen = new Set<string>();
                const associated = attachments.filter((row) => {
                  if (seen.has(row.claim.id)) return false;
                  seen.add(row.claim.id);
                  return true;
                });
                const primary = attachments[0];
                const title = source.title || source.url || source.id;
                return (
                  <li key={source.id} className="gp-dossier-item" data-gp-dossier-source={source.id}>
                    {primary && onSelectSource ? (
                      <button
                        type="button"
                        className="gp-dossier-item-btn"
                        onClick={(event) => onSelectSource(primary.link, source, primary.claim.id, event.currentTarget)}
                      >
                        {title}
                      </button>
                    ) : (
                      <span>{title}</span>
                    )}
                    {associated.length > 0 ? (
                      <p className="gp-source-claims" data-gp-source-claims>
                        关联命题：{associated.map((row) => row.claim.text).join("；")}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="gp-dossier-col" data-gp-dossier-section="conflicts">
          <h4 className="gp-dossier-section-title">分歧</h4>
          {snapshot.conflicts.length === 0 ? (
            <p className="gp-dossier-card-desc">没有记录到的分歧。</p>
          ) : (
            <ul className="gp-dossier-list">
              {snapshot.conflicts.map((conflict) => (
                <li key={conflict.id} className="gp-dossier-item">
                  {onSelectConflict ? (
                    <button
                      type="button"
                      className="gp-dossier-item-btn"
                      onClick={(event) => onSelectConflict(conflict.claimId, event.currentTarget)}
                    >
                      {conflict.summary}
                    </button>
                  ) : (
                    <span>{conflict.summary}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="gp-dossier-col" data-gp-dossier-section="gaps">
          <h4 className="gp-dossier-section-title">缺口</h4>
          {gaps.length === 0 ? (
            <p className="gp-dossier-card-desc">没有记录到的缺口。</p>
          ) : (
            <ul className="gp-dossier-list">
              {gaps.map((gap) => (
                <li key={gap.id} className="gp-dossier-item">
                  {gap.description}
                </li>
              ))}
            </ul>
          )}
        </section>

        {hasExperience ? (
          <section className="gp-dossier-col" data-gp-dossier-section="experience">
            <h4 className="gp-dossier-section-title">调查经历</h4>
            <ActivityFeed
              activities={activities}
              snapshot={snapshot}
              onSelectSource={onSelectSource ?? (() => {})}
              onSelectConflict={onSelectConflict}
            />
          </section>
        ) : null}
      </div>
    </section>
  );
}
