/**
 * InvestigationCanvas — 唯一调查画布（Issue #52 同画布 + Issue #64 persistent conclusion）。
 * investigating → complete 不换壳：结论区从调查中就存在，完成时同一节点显现 directAnswer。
 * 原始说法与命题保持原位。不抢焦点、不滚动、不关闭已打开的 Drawer。
 * interrupted：保留已获真实数据、无伪结论、可重试。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { InlineLoader } from "generative-loaders";
import type {
  InvestigationEvidenceLink,
  InvestigationSnapshotV1,
  InvestigationSource,
} from "@rhg/core/investigation";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { phaseHeadline, readImageOrigin, type ImageOriginView } from "./snapshotUi";
import { buildClaimTraceSegments } from "./claimTrace";
import { ClaimSection } from "./ClaimSection";
import { ConclusionHero } from "./ConclusionHero";
import {
  SourceDrawer,
  buildSourceDrawerViewFromClick,
  resolveSourceDrawerView,
  sourceDrawerSessionIdentity,
  type SourceDrawerView,
} from "./SourceDrawer";

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

type DrawerSession = {
  identity: string;
  claimId: string;
  sourceId: string;
  role: InvestigationEvidenceLink["role"];
  initialView: SourceDrawerView;
} | null;

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
  const [drawer, setDrawer] = useState<DrawerSession>(null);
  const [announce, setAnnounce] = useState("");
  const [hoverClaimId, setHoverClaimId] = useState<string | null>(null);
  const [focusClaimId, setFocusClaimId] = useState<string | null>(null);
  const [expandedTraceClaimId, setExpandedTraceClaimId] = useState<string | null>(null);
  // Pointer hover wins. Keyboard focus clears stale hover so a parked pointer cannot hijack Tab. Touch uses expanded-active.
  const tracedClaimId = hoverClaimId ?? focusClaimId ?? expandedTraceClaimId;
  const triggerRef = useRef<HTMLElement | null>(null);
  const lastConfirmedRef = useRef<{ identity: string; view: SourceDrawerView } | null>(null);

  const handleHeaderHover = (claimId: string | null) => {
    setHoverClaimId(claimId);
  };

  const handleHeaderFocus = (claimId: string | null) => {
    setFocusClaimId(claimId);
    if (claimId) setHoverClaimId(null);
  };

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
  const openSource = (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement,
  ) => {
    const claim = snapshot.claims.find((item) => item.id === claimId);
    const initialView = buildSourceDrawerViewFromClick(snapshot.claims, claimId, source, link);
    if (!initialView) return;
    const identity = sourceDrawerSessionIdentity(claimId, claim?.evidence ?? [], link);
    triggerRef.current = trigger;
    lastConfirmedRef.current = { identity, view: initialView };
    setDrawer({ identity, claimId, sourceId: source.id, role: link.role, initialView });
  };
  const closeDrawer = useCallback(() => {
    const trigger = triggerRef.current;
    lastConfirmedRef.current = null;
    setDrawer(null);
    window.setTimeout(() => trigger?.focus(), 0);
  }, []);

  const liveView = drawer
    ? resolveSourceDrawerView(snapshot.claims, snapshot.sources, drawer.claimId, drawer.identity)
    : null;
  if (drawer && liveView) {
    lastConfirmedRef.current = { identity: drawer.identity, view: liveView };
  }
  const heldView =
    drawer && lastConfirmedRef.current?.identity === drawer.identity
      ? lastConfirmedRef.current.view
      : drawer?.initialView ?? null;
  const drawerView = liveView ?? heldView;

  return (
    <div className="gp-canvas" data-gp-phase={snapshot.phase}>
      <div className="gp-canvas-inner">
        <section
          className={complete ? "gp-conclusion-region is-complete" : "gp-conclusion-region is-pending"}
          data-gp-conclusion-region
          data-gp-conclusion-state={complete ? "complete" : "pending"}
          aria-hidden={complete ? undefined : true}
        >
          {complete && conclusion ? (
            <ConclusionHero
              directAnswer={conclusion.directAnswer}
              judgment={conclusion.judgment}
              boundaries={conclusion.boundaries}
              claimCount={snapshot.claims.length}
              sourceCount={snapshot.sources.length}
              checkedAt={snapshot.checkedAt}
            />
          ) : null}
        </section>

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
          <div className="gp-original-meta">
            <span className="gp-original-label">{copy.canvasOriginalLabel}</span>
            <div className="gp-original-side">
              {restoredAt ? (
                <em className="gp-original-time">{copy.oldCaseNotice(formatDate(restoredAt))}</em>
              ) : null}
              {!complete && !interrupted && live ? (
                <span className="gp-live-pill" aria-label="正在调查">
                  <span className="gp-live-dot" aria-hidden="true" />
                  <span>正在调查</span>
                </span>
              ) : null}
              {complete || interrupted ? (
                <button type="button" className="gp-link-btn" onClick={onReverify}>
                  {copy.reviewAgain}
                </button>
              ) : (
                <button type="button" className="gp-link-btn" onClick={onBackHome}>
                  {copy.backHome}
                </button>
              )}
            </div>
          </div>
          <blockquote className="gp-original-quote">
            <span className="gp-quote-open" aria-hidden="true">“</span>
            <span className="gp-original-text" data-gp-traced-claim={tracedClaimId ?? ""}>
              {renderOriginalClaim(snapshot, tracedClaimId)}
            </span>
            <span className="gp-quote-close" aria-hidden="true">”</span>
          </blockquote>
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
                  onHeaderHover={handleHeaderHover}
                  onHeaderFocus={handleHeaderFocus}
                  onExpandedTrace={setExpandedTraceClaimId}
                />
              ))}
            </div>
          </section>
        ) : live ? (
          <p className="gp-waiting" role="status">
            <InlineLoader variant="signal" size={15} />
            正在拆解这句话…
          </p>
        ) : null}

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

      {drawer && drawerView ? (
        <SourceDrawer
          key={drawer.identity}
          view={drawerView}
          resolveState={liveView ? "live" : "held"}
          onClose={closeDrawer}
        />
      ) : null}
    </div>
  );
}

function renderOriginalClaim(snapshot: InvestigationSnapshotV1, tracedClaimId: string | null) {
  const segments = buildClaimTraceSegments(snapshot.originalClaim, snapshot.claims);
  return segments.map((segment, index) => {
    if (!segment.traceable || !segment.claimId || segment.text.length === 0) {
      return <span key={`plain-${index}`}>{segment.text}</span>;
    }
    const active = tracedClaimId === segment.claimId;
    return (
      <mark
        key={`trace-${segment.claimId}-${index}`}
        className={`gp-trace-mark${active ? " is-active" : ""}`}
        data-gp-trace-claim={segment.claimId}
        data-gp-trace-active={active ? "true" : "false"}
      >
        {segment.text}
      </mark>
    );
  });
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}
