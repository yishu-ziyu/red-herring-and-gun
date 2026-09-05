/**
 * InvestigationCanvas — 唯一调查画布（Issue #52 第一节「同画布原则」）。
 * investigating → complete 不换壳：原始说法持续在场，命题保持原位；
 * 完成时 ConclusionHero 出现在最上层，下面仍是刚才那套命题与证据。
 * interrupted：保留已获真实数据、无伪结论、可重试。
 */
import { useEffect, useMemo, useState } from "react";
import type {
  InvestigationEvidenceLink,
  InvestigationSnapshotV1,
  InvestigationSource,
} from "@rhg/core/investigation";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { phaseHeadline, readImageOrigin, type ImageOriginView } from "./snapshotUi";
import { ClaimSection } from "./ClaimSection";
import { ConclusionHero } from "./ConclusionHero";
import { SourceDrawer } from "./SourceDrawer";

type InvestigationCanvasProps = {
  snapshot: InvestigationSnapshotV1;
  /** 连接/运行是否仍在进行（决定调查态的进行中语气）。 */
  live: boolean;
  /** 完成态 finalReport（imageOrigin side-channel）。 */
  finalReport?: Record<string, unknown> | null;
  restoredAt?: number;
  onReverify: () => void;
  onBackHome: () => void;
};

type DrawerState = { source: InvestigationSource; relation: string } | null;

export function InvestigationCanvas({
  snapshot,
  live,
  finalReport,
  restoredAt,
  onReverify,
  onBackHome,
}: InvestigationCanvasProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [announce, setAnnounce] = useState("");

  // 状态变化用一句轻量播报解释发生了什么（渐进呈现，不是 Agent 日志）。
  useEffect(() => {
    if (snapshot.phase === "decomposed") setAnnounce(copy.canvasClaimsLabel);
    else if (snapshot.phase === "investigating") setAnnounce("正在逐条追查出处");
    else if (snapshot.phase === "judging") setAnnounce("正在对照证据形成判断");
    else if (snapshot.phase === "complete") setAnnounce("");
  }, [snapshot.phase, copy.canvasClaimsLabel]);

  const imageOrigin = useMemo<ImageOriginView | undefined>(
    () => (snapshot.phase === "complete" || snapshot.phase === "interrupted" ? readImageOrigin(finalReport) : undefined),
    [snapshot.phase, finalReport]
  );

  const conclusion = snapshot.conclusion;
  const complete = snapshot.phase === "complete" && Boolean(conclusion);
  const interrupted = snapshot.phase === "interrupted";
  const openSource = (link: InvestigationEvidenceLink, source: InvestigationSource, claimId: string) => {
    const claim = snapshot.claims.find((c) => c.id === claimId);
    const relation = relationWord(link.role);
    void claim;
    setDrawer({ source, relation });
  };

  return (
    <div className="gp-canvas" data-gp-phase={snapshot.phase}>
      <div className="gp-canvas-inner">
        {complete ? (
          <ConclusionHero
            directAnswer={conclusion!.directAnswer}
            judgment={conclusion!.judgment}
            boundaries={conclusion!.boundaries}
            claimCount={snapshot.claims.length}
            sourceCount={snapshot.sources.length}
            checkedAt={snapshot.checkedAt}
          />
        ) : null}

        {interrupted ? (
          <section className="gp-interrupted" role="alert" data-gp-interrupted>
            <strong>{copy.interruptedTitle}</strong>
            <p>{copy.interruptedBody}</p>
            <div className="gp-interrupted-actions">
              <button type="button" className="gp-primary-btn" onClick={onReverify}>
                {copy.interruptedRetry}
              </button>
              <button type="button" className="gp-ghost-btn" onClick={onBackHome}>
                {copy.backHome}
              </button>
            </div>
          </section>
        ) : null}

        <section className="gp-original" aria-label={copy.canvasOriginalLabel}>
          <p className="gp-original-label">{copy.canvasOriginalLabel}</p>
          <p className="gp-original-text">{markOriginal(snapshot)}</p>
          <div className="gp-original-side">
            {restoredAt ? (
              <em className="gp-original-time">{copy.oldCaseNotice(formatDate(restoredAt))}</em>
            ) : null}
            {!complete && !interrupted && live ? <span className="gp-live-dot" aria-hidden="true" /> : null}
            {complete || interrupted ? (
              <button type="button" className="gp-ghost-btn" onClick={onReverify}>
                {copy.reviewAgain}
              </button>
            ) : (
              <button type="button" className="gp-ghost-btn" onClick={onBackHome}>
                {copy.backHome}
              </button>
            )}
          </div>
        </section>

        {!complete && !interrupted ? (
          <p className="gp-phase-line" role="status">
            {phaseHeadline(snapshot)}
          </p>
        ) : null}

        {snapshot.claims.length > 0 ? (
          <section className="gp-claims" aria-label={copy.canvasEvidenceLabel}>
            {!complete ? <h3 className="gp-section-label">{copy.canvasClaimsLabel}</h3> : <h3 className="gp-section-label">{copy.canvasEvidenceLabel}</h3>}
            <div className="gp-claim-list">
              {snapshot.claims.map((claim, index) => (
                <ClaimSection
                  key={claim.id}
                  claim={claim}
                  index={index}
                  sources={snapshot.sources}
                  conflicts={snapshot.conflicts}
                  defaultExpanded={complete ? index === 0 : true}
                  onSelectSource={openSource}
                />
              ))}
            </div>
          </section>
        ) : (
          <p className="gp-waiting" role="status">
            {live ? "正在拆解这句话…" : ""}
          </p>
        )}

        {imageOrigin ? (
          imageOrigin.status === "found" ? (
            <section className="gp-image-origin" aria-label={copy.imageOriginTitle}>
              <h4>{copy.imageOriginTitle}</h4>
              <p>{copy.imageOriginHint}</p>
              <a href={imageOrigin.url} target="_blank" rel="noreferrer">
                {imageOrigin.title}
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </section>
          ) : (
            <section className="gp-image-origin is-missing" aria-label={copy.imageOriginNotFound}>
              <h4>{copy.imageOriginNotFound}</h4>
              <p>{copy.imageOriginHint}</p>
            </section>
          )
        ) : null}
      </div>

      <p className="gp-announcer" role="status" aria-live="polite">
        {announce}
      </p>

      {drawer ? (
        <SourceDrawer source={drawer.source} relationLabel={drawer.relation} onClose={() => setDrawer(null)} />
      ) : null}
    </div>
  );
}

function relationWord(role: InvestigationEvidenceLink["role"]): string {
  switch (role) {
    case "support":
      return "支持";
    case "contradict":
      return "反驳";
    case "unassessed":
      return "待核对";
    default:
      return "相关材料";
  }
}

function markOriginal(snapshot: InvestigationSnapshotV1): string {
  // originalSpan 的高亮留给 #53 打磨；本期保证命题可对照原句（命题文本直接来自原句切片）。
  return snapshot.originalClaim;
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}
