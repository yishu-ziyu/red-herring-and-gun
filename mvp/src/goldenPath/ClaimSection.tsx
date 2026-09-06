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
  const num = String(index + 1).padStart(2, "0");

  return (
    <article className={`gp-claim is-${claim.progress}`} data-gp-claim-id={claim.id}>
      <button
        type="button"
        className="gp-claim-head"
        aria-expanded={expanded}
        onClick={() => setExpanded((open) => !open)}
      >
        <span className="gp-claim-num" aria-hidden="true">{num}</span>
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
          <span className="gp-claim-toggle" aria-hidden="true">
            {expanded ? "收起" : "展开"}
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" className={`gp-toggle-arrow ${expanded ? "is-open" : ""}`}>
              <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </span>
      </button>

      {expanded ? (
        <div className="gp-claim-detail">
          {groups.length > 0 ? (
            <div className="gp-evidence-space">
              {groups.map((group) => (
                <section key={group.role} className={`gp-evidence-group is-${group.role}`} data-gp-role={group.role}>
                  <div className="gp-evidence-group-head">
                    <span className={`gp-role-glyph is-${group.role}`} aria-hidden="true">
                      {roleGlyph(group.role)}
                    </span>
                    <h4 className="gp-evidence-group-label">{group.label}</h4>
                    <span className="gp-evidence-group-count">· {group.links.length}</span>
                  </div>
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
              <div className="gp-conflict-head">
                <span className="gp-conflict-tag" aria-hidden="true">争点</span>
                <h4 className="gp-conflict-label">{copy.conflictLabel}</h4>
              </div>
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
              <div className="gp-conflict-reason-wrap">
                <strong className="gp-conflict-reason-lead">{copy.conflictReasonKnown}：</strong>
                {conflict.reasonStatus === "known" && conflict.reason ? (
                  <span className="gp-conflict-reason">{conflict.reason}</span>
                ) : (
                  <span className="gp-conflict-reason is-unknown">{copy.conflictReasonUnknown}</span>
                )}
              </div>
            </section>
          ))}

          {claim.gaps.length > 0 ? (
            <aside className="gp-gaps" aria-label={copy.gapLabel}>
              <div className="gp-gaps-head">
                <h4 className="gp-gaps-label">{copy.gapLabel}</h4>
                <span className="gp-gaps-count">· {claim.gaps.length}</span>
              </div>
              {claim.gaps.length > 0 && <p className="gp-gaps-hint">{copy.gapHint}</p>}
              <ul className="gp-gaps-list">
                {claim.gaps.map((gap) => (
                  <li key={gap.id} data-gp-gap-status={gap.status} className="gp-gap-item">
                    <strong className="gp-gap-desc">{gap.description}</strong>
                    {gap.consequence ? <span className="gp-gap-consequence">{gap.consequence}</span> : null}
                  </li>
                ))}
              </ul>
            </aside>
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

function roleGlyph(role: InvestigationEvidenceLink["role"]): string {
  switch (role) {
    case "support":
      return "●";
    case "contradict":
      return "●";
    case "context-only":
      return "○";
    case "unassessed":
      return "◌";
    default:
      return "●";
  }
}
