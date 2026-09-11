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
} from "../lib/investigation";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import {
  CHECKABILITY_HINT,
  JUDGMENT_LABEL,
  JUDGMENT_TONE,
  PROGRESS_LABEL,
  conflictSidesLabel,
} from "./snapshotUi";
import { EvidenceBoard } from "./EvidenceBoard";

type ClaimSectionProps = {
  claim: InvestigationClaim;
  index: number;
  sources: InvestigationSource[];
  conflicts: InvestigationConflict[];
  defaultExpanded: boolean;
  onSelectSource: (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement,
  ) => void;
  onHeaderHover?: (claimId: string | null) => void;
  onHeaderFocus?: (claimId: string | null) => void;
  onExpandedTrace?: (claimId: string | null) => void;
  asResult?: boolean;
  asWork?: boolean;
};

function claimPoint(claim: InvestigationClaim): string {
  const fromFinding = claim.evidence.map((link) => link.finding?.trim() ?? "").find((text) => text.length > 0);
  return fromFinding ?? "";
}

function usesExpandedTrace(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches === true;
}

export function ClaimSection({
  claim,
  index,
  sources,
  conflicts,
  defaultExpanded,
  onSelectSource,
  onHeaderHover,
  onHeaderFocus,
  onExpandedTrace,
  asResult = false,
  asWork = false,
}: ClaimSectionProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const claimConflicts = conflicts.filter((c) => c.claimId === claim.id);
  const judgment = claim.judgment;
  const showStatusChip = claim.progress === "searching" || claim.progress === "interrupted" || judgment !== null;
  const point = asResult ? claimPoint(claim) : "";
  const num = String(index + 1).padStart(2, "0");

  return (
    <article className={`gp-claim is-${claim.progress}`} data-gp-claim-id={claim.id}>
      <button
        type="button"
        className="gp-claim-head"
        aria-expanded={expanded}
        onMouseEnter={() => onHeaderHover?.(claim.id)}
        onMouseLeave={() => onHeaderHover?.(null)}
        onFocus={() => onHeaderFocus?.(claim.id)}
        onBlur={() => onHeaderFocus?.(null)}
        onClick={() => {
          setExpanded((open) => {
            const next = !open;
            if (usesExpandedTrace()) onExpandedTrace?.(next ? claim.id : null);
            return next;
          });
        }}
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
          {point ? <p className="gp-point">{point}</p> : null}

          {claim.evidence.length > 0 ? (
            <div className="gp-evidence-space">
              <EvidenceBoard
                claim={claim}
                sources={sources}
                asResult={asResult}
                asWork={asWork}
                onSelect={(l, s, trigger) => onSelectSource(l, s, claim.id, trigger)}
              />
            </div>
          ) : (
            <p className="gp-claim-empty" role="status">
              {claim.progress === "pending" ? "这一条还没开始查。" : "还没有可展示的材料。"}
            </p>
          )}

          {asWork ? null : claimConflicts.map((conflict) => (
            <section key={conflict.id} className="gp-conflict" data-gp-conflict-id={conflict.id}>
              {asResult ? (
                <p className="gp-note">
                  {conflict.reasonStatus === "known" && conflict.reason
                    ? conflict.reason
                    : copy.conflictReasonUnknown}
                </p>
              ) : (
                <>
                  <div className="gp-conflict-head">
                    <span className="gp-conflict-tag" aria-hidden="true">争点</span>
                    <h4 className="gp-conflict-label">{copy.conflictLabel}</h4>
                  </div>
                  <p className="gp-conflict-summary">{conflict.summary}</p>
                  <p className="gp-conflict-sides">
                    <button
                      type="button"
                      className="gp-conflict-side"
                      onClick={(event) => {
                        const first = conflict.sides[0]?.sourceIds[0];
                        const source = first ? sources.find((s) => s.id === first) : undefined;
                        if (source) onSelectSource({ sourceId: first!, role: "context-only" }, source, claim.id, event.currentTarget);
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
                </>
              )}
            </section>
          ))}

          {asWork ? null : claim.gaps.length > 0 ? (
            <aside className="gp-gaps" aria-label={copy.gapLabel}>
              {asResult ? (
                claim.gaps.map((gap) => (
                  <p key={gap.id} className="gp-note" data-gp-gap-status={gap.status}>
                    {gap.description}
                  </p>
                ))
              ) : (
                <>
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
                </>
              )}
            </aside>
          ) : null}

          {asWork ? null : claim.boundary ? (
            <p className="gp-boundary">
              {asResult ? claim.boundary : (
                <>
                  <strong>{copy.boundaryLabel}</strong>
                  {claim.boundary}
                </>
              )}
            </p>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
