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
  PublicActivity,
} from "../lib/investigation";
import { useUiLang } from "../lib/useUiLang";
import { displayFollowUpClaim, conclusionMissesFollowUp, followUpQuestionLead } from "../lib/composeFollowUpClaim";
import { isUrlOnlyClaim } from "../lib/caseIntake";
import { gpCopyFor } from "./copy";
import { phaseHeadline, readImageOrigin, type ImageOriginView } from "./snapshotUi";
import { buildClaimTraceSegments } from "./claimTrace";
import { leftoverClaimTexts, leftoverGapSentence, leftoverTextsForCanvas, isCompleteEmptyShell } from "./leftoverClaims";
import { ClaimSection } from "./ClaimSection";
import { ActivityFeed } from "./ActivityFeed";
import { ShareControl } from "./ShareControl";
import { ConclusionHero } from "./ConclusionHero";
import { FollowUpSection } from "./FollowUpSection";
import { InvestigationScope } from "./InvestigationScope";
import { InvestigationDossier } from "./InvestigationDossier";
import { WorkRoles, roleIndexForPhase } from "./WorkRoles";
import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { useEnteringIds } from "./useEnteringIds";
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
  /** 公共活动（可选）：空数组是合法常态，活动层坏了不影响结果。 */
  activities?: PublicActivity[];
  /** 停止：三态由服务端确认驱动，不提前说已停止。 */
  stop?: "idle" | "stopping" | "stopped";
  onStop?: () => void;
  /** 保存状态：独立于结果存在与否，不把失败藏在 console。 */
  saveStatus?: "idle" | "local" | "syncing" | "synced" | "failed";
  /** 同步失败要真的能点重试，不能只写「重试」两个字。 */
  onRetrySave?: () => void;
  /** 有服务端 caseId 才谈得上分享：没有对象就没有分享。 */
  shareCaseId?: string | null;
  /** 完成态 finalReport（imageOrigin side-channel）。 */
  finalReport?: Record<string, unknown> | null;
  restoredAt?: number;
  onReverify: () => void;
  onBackHome: () => void;
  /** 追问回调：就当前结论继续深入查证 */
  onFollowUp?: (question: string) => void;
  /** 这次提交的链接抓取失败（登录墙/空页）：调查全程都要看见，不能只亮 12 秒。 */
  linkUnreachable?: boolean;
  readOnly?: boolean;
  onAdjustFocus?: (question: string) => void;
  adjustingFocus?: boolean;
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
  activities = [],
  stop = "idle",
  onStop,
  saveStatus = "idle",
  onRetrySave,
  shareCaseId = null,
  finalReport,
  restoredAt,
  onReverify,
  onBackHome,
  onFollowUp,
  linkUnreachable = false,
  readOnly = false,
  onAdjustFocus,
  adjustingFocus = false,
}: InvestigationCanvasProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [drawer, setDrawer] = useState<DrawerSession>(null);
  const [announce, setAnnounce] = useState("");
  const [hoverClaimId, setHoverClaimId] = useState<string | null>(null);
  const [focusClaimId, setFocusClaimId] = useState<string | null>(null);
  const [expandedTraceClaimId, setExpandedTraceClaimId] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [suggestedQuestion, setSuggestedQuestion] = useState("");
  const evidenceRef = useRef<HTMLElement | null>(null);
  const followUpRef = useRef<HTMLDivElement | null>(null);
  const prepareFollowUp = (question = "") => {
    setSuggestedQuestion(question);
    window.requestAnimationFrame(() => {
      const input = followUpRef.current?.querySelector<HTMLTextAreaElement>("textarea");
      input?.focus();
    });
  };
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
  const urlOnly = isUrlOnlyClaim(snapshot.originalClaim);
  const unopenedLink = linkUnreachable || (complete && urlOnly && snapshot.claims.length === 0);
  const followUpQuestion = displayFollowUpClaim(snapshot.originalClaim);
  const followUpRewrite =
    complete &&
    conclusion &&
    conclusionMissesFollowUp(conclusion.verdictLead || conclusion.directAnswer, snapshot.originalClaim)
      ? followUpQuestionLead(followUpQuestion, conclusion.judgment)
      : "";
  const unopenedEmpty = Boolean(complete && conclusion && unopenedLink && snapshot.claims.length === 0);
  const displayDirectAnswer = unopenedEmpty
    ? copy.linkUnreachableVerdict
    : followUpRewrite || conclusion?.directAnswer || "";
  const displayVerdictLead = unopenedEmpty
    ? copy.linkUnreachableVerdict
    : followUpRewrite || conclusion?.verdictLead;
  // 用户点过停止就不再把它读成「中断」：同一次事故不该有两种说法。
  // 分条已齐的总答仍要看见，不能跟着黄卡一起藏掉。
  const interrupted = snapshot.phase === "interrupted" && stop !== "stopped";
  const closedAnswer = snapshot.phase === "interrupted" ? snapshot.conclusion?.directAnswer?.trim() ?? "" : "";
  const interruptedAnswer = interrupted ? closedAnswer : "";
  const interruptedHasJudgments = !interruptedAnswer && snapshot.claims.some((claim) => claim.judgment);
  const resultClaims = complete ? snapshot.claims.filter((c) => !isCompleteEmptyShell(c)) : snapshot.claims;
  const leftoverTexts =
    complete || interrupted ? leftoverTextsForCanvas(snapshot.originalClaim, snapshot.claims) : [];
  const leftoverSentence = leftoverTexts.length > 0 ? leftoverGapSentence(leftoverTexts) : "";
  const gapNotes = complete
    ? resultClaims.flatMap((claim) =>
        claim.gaps
          .map((gap) => gap.description.trim())
          .filter((note) => note && !note.includes("检索预算未覆盖") && !note.includes("模型未覆盖")),
      )
    : [];
  const claimIds = snapshot.claims.map((claim) => claim.id);
  const claimEnter = useEnteringIds(claimIds, live && !complete && !interrupted);
  const openSource = (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement,
  ) => {
    const claim = snapshot.claims.find((item) => item.id === claimId);
    const initialView = buildSourceDrawerViewFromClick(snapshot.claims, claimId, source, link, snapshot.sources);
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

  const jumpToConflict = useCallback((claimId: string) => {
    // 先精确落争点块，再回退命题卡。逗号选择器做不到这件事：命题卡是争点的祖先，
    // 文档序里先命中卡片，高亮就落在整卡上（.gp-conflict.is-target-highlight 的脉冲动画永不触发）。
    const el =
      document.querySelector<HTMLElement>(`[data-gp-claim-id="${claimId}"] .gp-conflict`) ??
      document.querySelector<HTMLElement>(`[data-gp-claim-id="${claimId}"]`);
    if (!el) return;
    el.classList.add("is-target-highlight");
    el.focus?.();
    window.setTimeout(() => el.classList.remove("is-target-highlight"), 2400);
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
    <div
      className="gp-canvas"
      data-gp-phase={snapshot.phase}
      data-gp-single-claim={snapshot.claims.length === 1 ? "true" : undefined}
    >
      <div className="gp-canvas-inner">
        <section
          className={complete ? "gp-conclusion-region is-complete" : "gp-conclusion-region is-pending"}
          data-gp-conclusion-region
          data-gp-conclusion-state={complete ? "complete" : "pending"}
          aria-hidden={complete ? undefined : true}
        >
          {complete && conclusion ? (
            <ConclusionHero
              directAnswer={displayDirectAnswer}
              verdictLead={displayVerdictLead}
              rationale={conclusion.rationale}
              judgment={conclusion.judgment}
              boundaries={conclusion.boundaries}
              claimCount={snapshot.claims.length}
              sourceCount={snapshot.sources.length}
              checkedAt={snapshot.checkedAt}
              originalClaim={snapshot.originalClaim}
              sources={snapshot.sources}
              claims={snapshot.claims}
              leftoverNote={leftoverSentence}
              gapNotes={gapNotes}
              onSelectSource={openSource}
            />
          ) : null}
        </section>

        {complete ? <div className="gp-reading-actions" aria-label={lang === "en" ? "Read or investigate further" : "查看依据或继续补查"}>
          {resultClaims.length > 0 ? <button type="button" className="gp-ghost-btn" data-gp-read-existing onClick={() => {
            evidenceRef.current?.focus();
          }}>{snapshot.sources.length ? (lang === "en" ? "Read existing evidence" : "查看已有依据") : (lang === "en" ? "Read investigation details" : "查看核查详情")}</button> : null}
          {!readOnly && onFollowUp ? <button type="button" className="gp-ghost-btn" onClick={() => prepareFollowUp()}>{lang === "en" ? "Investigate further" : "继续补查"}</button> : null}
          <p>{lang === "en" ? "Reading evidence does not start another investigation." : "查看依据不会重新调查；补查需明确发送问题。"}</p>
        </div> : null}

        {complete || interrupted ? <InvestigationScope snapshot={snapshot} onAsk={readOnly || !complete ? undefined : prepareFollowUp} onAdjustFocus={readOnly ? undefined : onAdjustFocus} adjusting={adjustingFocus} /> : null}

        {interrupted ? (
          <section className="gp-interrupted" role="alert" data-gp-interrupted>
            <strong>{interruptedAnswer ? copy.interruptedPartialTitle : copy.interruptedTitle}</strong>
            <p>
              {interruptedAnswer ? copy.interruptedPartialBody : copy.interruptedBody}
              {interruptedHasJudgments ? ` ${copy.interruptedHasJudgments}` : ""}
            </p>
            {interruptedAnswer ? (
              <p className="gp-interrupted-answer" data-gp-interrupted-answer>
                {interruptedAnswer}
              </p>
            ) : null}
            <div className="gp-interrupted-actions" hidden={readOnly}>
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
                <button
                  type="button"
                  className={`gp-live-pill ${isPaused ? "is-paused" : ""}`}
                  aria-label={isPaused ? "已暂停慢读，点击恢复" : "正在调查，点击暂停慢读"}
                  title={isPaused ? "已暂停慢读，点击恢复跟随" : "点击暂停自动滚动慢读"}
                  onClick={() => setIsPaused(!isPaused)}
                >
                  <span className="gp-live-dot" aria-hidden="true" />
                  <span>{isPaused ? "已暂停慢读" : "正在调查"}</span>
                </button>
              ) : null}
              {saveStatus !== "idle" ? (
                saveStatus === "failed" && onRetrySave ? (
                  <button
                    type="button"
                    className="gp-save-state is-failed"
                    data-gp-save-status="failed"
                    data-gp-save-retry
                    onClick={onRetrySave}
                  >
                    {copy.saveFailed}
                  </button>
                ) : (
                  <span className={`gp-save-state is-${saveStatus}`} data-gp-save-status={saveStatus}>
                    {saveStatus === "synced"
                      ? copy.saveSynced
                      : saveStatus === "syncing"
                        ? copy.saveSyncing
                        : saveStatus === "failed"
                          ? copy.saveFailed
                          : copy.saveLocal}
                  </span>
                )
              ) : null}
              {!complete && !interrupted && onStop && stop !== "stopped" ? (
                <button
                  type="button"
                  className="gp-link-btn"
                  data-gp-stop
                  disabled={stop === "stopping"}
                  onClick={onStop}
                >
                  {stop === "stopping" ? copy.stoppingInvestigation : copy.stopInvestigation}
                </button>
              ) : null}
              {!complete && !interrupted ? (
                <button type="button" className="gp-link-btn" onClick={onBackHome}>
                  {copy.backHome}
                </button>
              ) : null}
            </div>
          </div>
          <blockquote className="gp-original-quote">
            <span className="gp-quote-open" aria-hidden="true">“</span>
            <span
              className="gp-original-text"
              // 长 URL 一类不可断词会撑破左栏（实测 scrollW 357 / clientW 298），与原句同栏的
              // 其它文本一样按任意字符断行。
              style={{ overflowWrap: "anywhere" }}
              data-gp-traced-claim={tracedClaimId ?? ""}
            >
              {renderOriginalClaim(snapshot, tracedClaimId)}
            </span>
            <span className="gp-quote-close" aria-hidden="true">”</span>
          </blockquote>
        </section>

        {!complete && !interrupted ? (
          <ActivityFeed
            activities={activities}
            snapshot={snapshot}
            onSelectSource={openSource}
            onSelectConflict={jumpToConflict}
          />
        ) : null}

        {stop !== "idle" ? (
          <section
            className={`gp-stopped${stop === "stopping" ? " is-stopping" : ""}`}
            role="status"
            data-gp-stopped
            data-gp-stop-state={stop}
          >
            <strong>{stop === "stopping" ? copy.stoppingInvestigation : copy.stoppedInvestigation}</strong>
            <p>{copy.stoppedBody}</p>
            {stop === "stopped" && closedAnswer ? (
              <p className="gp-interrupted-answer" data-gp-interrupted-answer>
                {closedAnswer}
              </p>
            ) : null}
            {stop === "stopped" ? (
              <div className="gp-stopped-actions">
                <button type="button" className="gp-primary-btn" data-gp-stopped-retry onClick={onReverify}>
                  {copy.reviewAgain}
                </button>
                <button type="button" className="gp-ghost-btn" onClick={onBackHome}>
                  {copy.backHome}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {!complete && !interrupted ? (
          <>
            <WorkRoles
              compact
              phase={snapshot.phase}
              activeIndex={roleIndexForPhase(snapshot.phase)}
              preClaimWork={snapshot.preClaimWork}
              sourceCount={snapshot.sources?.length ?? 0}
            />

            <ThinkingDisclosure snapshot={snapshot} live={live} />
          </>
        ) : null}

        {resultClaims.length > 0 || (!complete && leftoverSentence) ? (
          <section className="gp-claims" aria-label={copy.canvasEvidenceLabel} ref={evidenceRef} tabIndex={-1}>
            {!complete ? (
              <h3 className="gp-section-label">{copy.canvasClaimsLabel}</h3>
            ) : (
              <h2 className="gp-section-label">逐条核查详情</h2>
            )}
            <div className="gp-claim-list">
              {resultClaims.map((claim, index) => (
                <ClaimSection
                  key={claim.id}
                  claim={claim}
                  index={index}
                  sources={snapshot.sources}
                  conflicts={snapshot.conflicts}
                  entering={claimEnter.isEntering(claim.id)}
                  enterDelayMs={claimEnter.delayMs(claim.id)}
                  enterLive={live && !complete && !interrupted}
                  defaultExpanded={
                    complete
                      ? claim.evidence.length > 0 || Boolean(claim.judgment) || claim.gaps.length > 0
                      : interrupted
                        ? true
                        : claim.progress !== "pending"
                  }
                  onSelectSource={openSource}
                  onHeaderHover={handleHeaderHover}
                  onHeaderFocus={handleHeaderFocus}
                  onExpandedTrace={setExpandedTraceClaimId}
                  asResult={complete}
                  asWork={!complete && !interrupted}
                  conclusionText={
                    complete && conclusion
                      ? `${conclusion.directAnswer ?? ""}${conclusion.verdictLead ?? ""}${conclusion.rationale ?? ""}`
                      : ""
                  }
                />
              ))}
            </div>
            {!complete && leftoverSentence ? (
              <aside className="gp-leftover-gap" aria-label={copy.gapLabel} data-gp-leftover-gap>
                <p className="gp-note">{leftoverSentence}</p>
              </aside>
            ) : null}
          </section>
        ) : null}

        {resultClaims.length === 0 && leftoverSentence === "" && live ? (
          <div className="gp-waiting-area" role="status">
            <span style={{ display: "none" }}>正在拆解这句话…</span>
          </div>
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

        {complete && conclusion ? (
          <>
            {!readOnly ? <div ref={followUpRef} className="gp-followup-target">
            <FollowUpSection
              suggestedQuestion={suggestedQuestion}
              coverageNote={snapshot.scope ? `${lang === "en" ? "Scope: " : "核查范围："}${snapshot.claims.filter((c) => snapshot.scope!.includedClaimIds.includes(c.id)).map((c) => c.text).join("；")}${snapshot.scope.deferredClaimIds.length ? `${lang === "en" ? ". Not covered: " : "。本轮未覆盖："}${snapshot.claims.filter((c) => snapshot.scope!.deferredClaimIds.includes(c.id)).map((c) => c.text).join("；")}` : ""}` : undefined}
              onFollowUp={onFollowUp}
              onReverify={onReverify}
              directAnswer={displayDirectAnswer}
              originalClaim={snapshot.originalClaim}
              boundaries={conclusion.boundaries}
              claims={snapshot.claims}
              // Text overlap is only a display hint, not proof of an uninvestigated claim.
              // Automatic follow-ups use explicit missing claims/gaps, never URL-prefixed raw fragments.
              leftoverTexts={leftoverClaimTexts(snapshot.claims)}
              checkedAt={snapshot.checkedAt}
              sourceUrls={(conclusion.sourceIds.length
                ? conclusion.sourceIds.map((id) => snapshot.sources.find((source) => source.id === id)?.url)
                : snapshot.sources.map((source) => source.url)
              ).filter((url): url is string => Boolean(url))}
            />
            </div> : null}
            <InvestigationDossier
              snapshot={snapshot}
              activities={activities}
              onSelectSource={openSource}
              onSelectConflict={jumpToConflict}
            />
            {shareCaseId ? <ShareControl caseId={shareCaseId} /> : null}
          </>
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

/** 「你调查的说法」区渲染的原文：追问轮只留用户自己写的部分（裁切规则在 lib 里，四处显示同一份）。 */
function renderOriginalClaim(snapshot: InvestigationSnapshotV1, tracedClaimId: string | null) {
  const segments = buildClaimTraceSegments(displayFollowUpClaim(snapshot.originalClaim), snapshot.claims);
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
