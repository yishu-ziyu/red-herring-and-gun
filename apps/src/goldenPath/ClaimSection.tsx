/**
 * ClaimSection — 一个命题的证据空间（Issue #52 第四节画布结构）。
 * 命题文本 / 当前状态 / 支持-反驳-待核对-相关材料 / 尚缺 / 争议 / 边界。
 * 争议只来自 Snapshot.conflicts（真实证据层双方并存），unknown reason 如实未知。
 */
import { useState, type CSSProperties } from "react";
import { useEnteringIds } from "./useEnteringIds";
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
  ROLE_LABEL,
} from "./snapshotUi";
import { EvidenceBoard } from "./EvidenceBoard";
import { isPriorRoundLink, knowledgeOriginDay } from "./knowledgeMark";
import { PromptKitSource } from "./PromptKitSource";
import { scrubFaceText, tooSimilarTo } from "./scrubFace";
import type { InvestigationConflictSide } from "../lib/investigation";

/** 快照的 position 允许 other；other 不冒充支持或反驳。 */
function conflictSideLabel(position: InvestigationConflictSide["position"], otherLabel: string): string {
  if (position === "support") return ROLE_LABEL.support;
  if (position === "contradict") return ROLE_LABEL.contradict;
  return otherLabel;
}

type ClaimSectionProps = {
  claim: InvestigationClaim;
  index: number;
  sources: InvestigationSource[];
  conflicts: InvestigationConflict[];
  defaultExpanded: boolean;
  entering?: boolean;
  enterDelayMs?: number;
  enterLive?: boolean;
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
  conclusionText?: string;
};

function claimPoint(claim: InvestigationClaim, conclusionText = ""): string {
  const fromFinding = claim.evidence.map((link) => link.finding?.trim() ?? "").find((text) => text.length > 0) ?? "";
  if (!fromFinding) return "";
  const cleaned = scrubFaceText(fromFinding);
  if (!cleaned) return "";
  if (tooSimilarTo(cleaned, conclusionText)) return "";
  return cleaned;
}

function isMixedOverclaim(claim: InvestigationClaim): boolean {
  return (
    claim.judgment === "mixed" &&
    Boolean(claim.boundary?.trim()) &&
    !claim.evidence.some((link) => link.role === "contradict")
  );
}

function usesExpandedTrace(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(hover: none)").matches === true;
}

/**
 * 知识库标记的样式内联：一是本批 golden-path.css 归收尾分身，二是不借 .gp-chip——
 * 它在调查阶段被 display:none、完成阶段被改写成无边框正文，借来会看不见或不成胶囊。
 */
const knowledgeEntryStyle: CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6 };
const knowledgeMarkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  border: "1px solid var(--gp-hairline)",
  borderRadius: 9999,
  padding: "1px 7px",
  fontSize: 11,
  fontWeight: 600,
  lineHeight: 1.2,
  color: "var(--gp-ink-3)",
  whiteSpace: "nowrap",
};

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
  conclusionText = "",
  entering = false,
  enterDelayMs = 0,
  enterLive = false,
}: ClaimSectionProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showRelated, setShowRelated] = useState(false);
  // 卡片常在 decomposed 拍就挂载（进度 pending、内容为空），内容要到完成拍才补齐。
  // 只在挂载时读一次 defaultExpanded，完成态「有内容的卡展开」就永远不生效；
  // 进入完成态时按父级给的新默认重决议一次——过程里的收/展不跨越阶段保留，
  // 因为完成态卡头被 CSS 收起，收着的卡内容就再没有入口。
  const [resolvedAsResult, setResolvedAsResult] = useState(asResult);
  if (asResult !== resolvedAsResult) {
    setResolvedAsResult(asResult);
    if (asResult) setExpanded(defaultExpanded);
  }
  const claimConflicts = conflicts.filter((c) => c.claimId === claim.id);
  const judgment = claim.judgment;
  const relatedLinks = claim.evidence.filter((link) => link.role === "context-only");
  const hasPrimary = claim.evidence.some((link) => link.role === "support" || link.role === "contradict");
  const hideRelated = !asResult && !showRelated && hasPrimary;
  const visiblePills = hideRelated
    ? claim.evidence.filter((link) => link.role !== "context-only")
    : claim.evidence;
  const showStatusChip = claim.progress === "searching" || claim.progress === "interrupted" || judgment !== null;
  const point = asResult ? claimPoint(claim, conclusionText) : "";
  const overclaim = isMixedOverclaim(claim) ? claim.boundary!.trim() : "";
  const num = String(index + 1).padStart(2, "0");
  const pillIds = claim.evidence.map((link, idx) => `${link.sourceId}:${link.role}:${idx}`);
  const pillEnter = useEnteringIds(pillIds, enterLive);

  return (
    <article
      className={`gp-claim is-${claim.progress}${entering ? " is-enter" : ""}`}
      data-gp-claim-id={claim.id}
      data-gp-related-collapsed={hideRelated ? "1" : undefined}
      style={entering ? ({ ["--gp-enter-delay" as string]: `${enterDelayMs}ms` } as CSSProperties) : undefined}
    >
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

          {overclaim ? (
            <p className="gp-overclaim" data-gp-overclaim>
              <strong>{copy.overclaimLabel}</strong>
              {overclaim}
            </p>
          ) : null}

          {visiblePills.length > 0 ? (
            <div className="gp-sources-pills-row" aria-label="来源材料胶囊">
              {visiblePills.map((link, idx) => {
                const source = sources.find((s) => s.id === link.sourceId);
                if (!source) return null;
                const key = `pill-${claim.id}-${link.sourceId}-${link.role}-${idx}`;
                const knowledgeDay = knowledgeOriginDay(link);
                const priorRound = isPriorRoundLink(link);
                const pillId = `${link.sourceId}:${link.role}:${idx}`;
                const pillProps = {
                  link,
                  source,
                  claimId: claim.id,
                  onSelect: onSelectSource,
                  entering: pillEnter.isEntering(pillId),
                  enterDelayMs: pillEnter.delayMs(pillId),
                };
                if (knowledgeDay === null && !priorRound) {
                  return <PromptKitSource key={key} {...pillProps} />;
                }
                return (
                  <span key={key} style={knowledgeEntryStyle}>
                    <PromptKitSource {...pillProps} />
                    <span
                      className="gp-knowledge-mark"
                      style={knowledgeMarkStyle}
                      data-gp-knowledge-mark={priorRound ? "prior-round" : knowledgeDay}
                      data-gp-prior-round-mark={priorRound || undefined}
                    >
                      {priorRound ? copy.evidencePriorRoundMark : copy.evidenceKnowledgeMark(knowledgeDay ?? "")}
                    </span>
                  </span>
                );
              })}
            </div>
          ) : null}

          {relatedLinks.length > 0 && !asResult ? (
            <button
              type="button"
              className="gp-related-toggle"
              data-gp-related-toggle
              aria-expanded={showRelated}
              onClick={() => setShowRelated((open) => !open)}
            >
              {copy.relatedMaterialsToggle(relatedLinks.length)}
              {showRelated ? " · 收起" : " · 展开"}
            </button>
          ) : null}

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
          ) : relatedLinks.length === 0 ? (
            <p className="gp-claim-empty" role="status">
              {asWork
                ? claim.progress === "pending"
                  ? "还没轮到查找这一条。"
                  : "正在查找这一条的出处。"
                : "还没有可展示的材料。"}
            </p>
          ) : null}

          {claimConflicts.map((conflict) => (
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
                </>
              )}

              <div className="gp-conflict-sides">
                {conflict.sides.map((side) => {
                  // 只取本侧自己的证据行：点击必须落到这一侧的材料，不能合开另一侧。
                  const rows = side.sourceIds.flatMap((id) => {
                    const link =
                      claim.evidence.find((l) => l.sourceId === id && l.role === side.position) ??
                      claim.evidence.find((l) => l.sourceId === id);
                    const source = link ? sources.find((s) => s.id === link.sourceId) : undefined;
                    return link && source ? [{ link, source }] : [];
                  });
                  return (
                    <div
                      key={side.position}
                      className={`gp-conflict-side is-${side.position}`}
                      data-gp-conflict-side={side.position}
                    >
                      <span className="gp-conflict-side-label">{conflictSideLabel(side.position, copy.conflictSideOther)}</span>
                      {rows.length === 0 ? (
                        <span className="gp-conflict-side-missing">{copy.conflictSideMissing}</span>
                      ) : (
                        rows.map(({ link, source }) => (
                          <button
                            key={`${side.position}-${link.sourceId}`}
                            type="button"
                            className="gp-conflict-side-item"
                            onClick={(event) => onSelectSource(link, source, claim.id, event.currentTarget)}
                          >
                            {source.title || source.url || link.sourceId}
                          </button>
                        ))
                      )}
                    </div>
                  );
                })}
              </div>

              {asResult ? null : (
                <div className="gp-conflict-reason-wrap">
                  <strong className="gp-conflict-reason-lead">{copy.conflictReasonKnown}：</strong>
                  {conflict.reasonStatus === "known" && conflict.reason ? (
                    <span className="gp-conflict-reason">{conflict.reason}</span>
                  ) : (
                    <span className="gp-conflict-reason is-unknown">{copy.conflictReasonUnknown}</span>
                  )}
                </div>
              )}
            </section>
          ))}

          {claim.gaps.length > 0 ? (
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

          {asWork || overclaim ? null : claim.boundary ? (
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
