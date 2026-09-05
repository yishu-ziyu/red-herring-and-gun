/**
 * ClaimSection — 一个命题的证据空间（Issue #52 第四节画布结构）。
 * 命题文本 / 当前状态 / 支持-反驳-待核对-相关材料 / 尚缺 / 争议 / 边界。
 * 争议只来自 Snapshot.conflicts（真实证据层双方并存），unknown reason 如实未知。
 */
import { useState } from "react";
import type {
  InvestigationClaim,
  InvestigationConflict,
  InvestigationEvidenceLink,
  InvestigationSource,
} from "@rhg/core/investigation";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import {
  CHECKABILITY_HINT,
  JUDGMENT_LABEL,
  JUDGMENT_TONE,
  PROGRESS_LABEL,
  conflictSidesLabel,
  groupEvidence,
} from "./snapshotUi";
import { EvidenceItem } from "./EvidenceItem";

type ClaimSectionProps = {
  claim: InvestigationClaim;
  index: number;
  sources: InvestigationSource[];
  conflicts: InvestigationConflict[];
  defaultExpanded: boolean;
  onSelectSource: (link: InvestigationEvidenceLink, source: InvestigationSource, claimId: string) => void;
};

export function ClaimSection({ claim, index, sources, conflicts, defaultExpanded, onSelectSource }: ClaimSectionProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const groups = groupEvidence(claim.evidence);
  const claimConflicts = conflicts.filter((c) => c.claimId === claim.id);
  const judgment = claim.judgment;
  const showStatusChip = claim.progress === "searching" || claim.progress === "interrupted" || judgment !== null;
  const sourceFor = (link: InvestigationEvidenceLink) => sources.find((s) => s.id === link.sourceId);

  return (
    <article className={`gp-claim is-${claim.progress}`} data-gp-claim-id={claim.id}>
      <button
        type="button"
        className="gp-claim-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="gp-claim-num" aria-hidden="true">{index + 1}</span>
        <span className="gp-claim-body">
          <strong className="gp-claim-text">{claim.text}</strong>
          {claim.checkability !== "checkable" ? (
            <em className="gp-claim-checkability">{CHECKABILITY_HINT[claim.checkability]}</em>
          ) : null}
        </span>
        <span className="gp-claim-side">
          {judgment ? (
            <span className={`gp-chip gp-chip--${JUDGMENT_TONE[judgment]}`} data-gp-judgment={judgment}>
              {JUDGMENT_LABEL[judgment]}
            </span>
          ) : showStatusChip ? (
            <span className={`gp-chip gp-chip--${claim.progress === "searching" ? "live" : "muted"}`}>
              {PROGRESS_LABEL[claim.progress]}
            </span>
          ) : null}
          <span className="gp-claim-toggle" aria-hidden="true">{expanded ? "收起" : "展开"}</span>
        </span>
      </button>

      {expanded ? (
        <div className="gp-claim-detail">
          {groups.length > 0 ? (
            <div className="gp-evidence-space">
              {groups.map((group) => (
                <section key={group.role} className={`gp-evidence-group is-${group.role}`} data-gp-role={group.role}>
                  <h4 className="gp-evidence-group-label">
                    {group.label}
                    <span>{group.links.length}</span>
                  </h4>
                  <div className="gp-evidence-list">
                    {group.links.map((link, i) => (
                      <EvidenceItem
                        key={`${link.sourceId}-${i}`}
                        link={link}
                        source={sourceFor(link)}
                        onSelect={(l, s) => onSelectSource(l, s, claim.id)}
                      />
                    ))}
                  </div>
                  {group.role === "support" && group.links.some((l) => l.finding) ? (
                    <p className="gp-finding">{group.links.find((l) => l.finding)?.finding}</p>
                  ) : null}
                </section>
              ))}
            </div>
          ) : (
            <p className="gp-claim-empty" role="status">
              {claim.progress === "pending" ? "这一条还没开始查。" : "还没有可展示的材料。"}
            </p>
          )}

          {claimConflicts.map((conflict) => (
            <section key={conflict.id} className="gp-conflict" data-gp-conflict-id={conflict.id}>
              <h4 className="gp-conflict-label">{copy.conflictLabel}</h4>
              <p className="gp-conflict-summary">{conflict.summary}</p>
              <p className="gp-conflict-sides">
                <button
                  type="button"
                  className="gp-conflict-side"
                  onClick={() => {
                    const first = conflict.sides[0]?.sourceIds[0];
                    const source = first ? sources.find((s) => s.id === first) : undefined;
                    if (source) onSelectSource({ sourceId: first!, role: "context-only" }, source, claim.id);
                  }}
                >
                  {conflictSidesLabel(conflict.sides)}
                </button>
              </p>
              {conflict.reasonStatus === "known" && conflict.reason ? (
                <p className="gp-conflict-reason">
                  <strong>{copy.conflictReasonKnown}：</strong>
                  {conflict.reason}
                </p>
              ) : (
                <p className="gp-conflict-reason is-unknown">{copy.conflictReasonUnknown}</p>
              )}
            </section>
          ))}

          {claim.gaps.length > 0 ? (
            <section className="gp-gaps" aria-label={copy.gapLabel}>
              <h4 className="gp-gaps-label">
                {copy.gapLabel}
                <span>{claim.gaps.length}</span>
              </h4>
              {claim.gaps.length > 0 && <p className="gp-gaps-hint">{copy.gapHint}</p>}
              <ul>
                {claim.gaps.map((gap) => (
                  <li key={gap.id} data-gp-gap-status={gap.status}>
                    <strong>{gap.description}</strong>
                    {gap.consequence ? <span>{gap.consequence}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {claim.boundary ? (
            <p className="gp-boundary">
              <strong>{copy.boundaryLabel}</strong>
              {claim.boundary}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
