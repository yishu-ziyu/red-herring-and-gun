/**
 * InvestigationCanvas — 唯一调查画布（Issue #52 同画布 + Issue #64 persistent conclusion）。
 * investigating → complete 不换壳：结论区从调查中就存在，完成时同一节点显现 directAnswer。
 * 原始说法与命题保持原位。不抢焦点、不滚动、不关闭已打开的 Drawer。
 * interrupted：保留已获真实数据、无伪结论、可重试。
 * 调查中和查完同一套头版式（#150）：调查中用 ProgressView 一行行填，不展示执行过程。
 */
import { useEffect, useState } from "react";
import type { InvestigationSnapshotV1 } from "../lib/investigation";
import { judgmentToLabel } from "../lib/investigation";
import { scrubFaceText } from "../lib/scrubFace";
import { useUiLang } from "../lib/useUiLang";
import { displayFollowUpClaim, conclusionMissesFollowUp, followUpQuestionLead } from "../lib/composeFollowUpClaim";
import { isUrlOnlyClaim, type CaseImage } from "../lib/caseIntake";
import { gpCopyFor } from "./copy";
import { leftoverGapSentence, leftoverTextsForCanvas, isCompleteEmptyShell } from "./leftoverClaims";
import { OriginalSentence, ResultView, UnspannedParts } from "./ResultView";
import { ProgressView, motionMs, prefersReducedMotion } from "./ProgressView";
import { journeyCopy } from "./journeyCopy";
import { buildConclusionBrief } from "./ShareControl";
import { IntakeImages } from "./IntakeImages";
import { SourcePopoverProvider } from "./SourcePill";

type InvestigationCanvasProps = {
  snapshot: InvestigationSnapshotV1;
  /** 连接/运行是否仍在进行（决定调查态的进行中语气）。 */
  live: boolean;
  /** 停止：三态由服务端确认驱动，不提前说已停止。 */
  stop?: "idle" | "stopping" | "stopped";
  onStop?: () => void;
  /** 保存状态：独立于结果存在与否，不把失败藏在 console。 */
  saveStatus?: "idle" | "local" | "failed";
  /** 保存失败要真的能点重试，不能只写「重试」两个字。 */
  onRetrySave?: () => void;
  restoredAt?: number;
  onReverify: () => void;
  onBackHome: () => void;
  /** 追问回调：就当前结论继续深入查证 */
  onFollowUp?: (question: string) => void;
  /** 这次提交的链接抓取失败（登录墙/空页）：调查全程都要看见，不能只亮 12 秒。 */
  linkUnreachable?: boolean;
  readOnly?: boolean;
  /** 这次上传的图片：显示在「你调查的说法」下面。历史回看没有。 */
  images?: CaseImage[];
  /** 这一轮在服务端的调查编号：有才显示「分享」（老历史没有）。 */
  shareRunId?: string;
};

const COMPLETION_HOLD_MS = 1200;

export function InvestigationCanvas({
  snapshot,
  live,
  stop: liveStop = "idle",
  onStop,
  saveStatus = "idle",
  onRetrySave,
  restoredAt,
  onReverify,
  onBackHome,
  onFollowUp,
  linkUnreachable = false,
  readOnly = false,
  images,
  shareRunId,
}: InvestigationCanvasProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  // 历史只读也保留用户主动停止的事实，不把它重新解释成网络中断。
  const stop = snapshot.interruptionReason === "cancelled" ? "stopped" : liveStop;
  const conclusion = snapshot.conclusion;
  const complete = snapshot.phase === "complete" && Boolean(conclusion);
  const isLiveProgress = live && !complete && snapshot.phase !== "interrupted" && stop === "idle" && !readOnly && !restoredAt;
  const [seenLiveProgress, setSeenLiveProgress] = useState(isLiveProgress);
  if (isLiveProgress && !seenLiveProgress) setSeenLiveProgress(true);
  const [completionStage, setCompletionStage] = useState<"hold" | "leaving" | "report">("hold");
  const animateCompletion = seenLiveProgress && !readOnly && !restoredAt;
  const showReport = complete && (!animateCompletion || completionStage === "report");

  useEffect(() => {
    if (!complete || !animateCompletion) return;
    let exitTimer: ReturnType<typeof setTimeout> | undefined;
    const holdTimer = setTimeout(() => {
      setCompletionStage("leaving");
      exitTimer = setTimeout(() => setCompletionStage("report"), motionMs(prefersReducedMotion() ? "--gp-motion-fast" : "--gp-motion-ui"));
    }, prefersReducedMotion() ? motionMs("--gp-motion-fast") : COMPLETION_HOLD_MS);
    return () => {
      clearTimeout(holdTimer);
      clearTimeout(exitTimer);
    };
  }, [complete, animateCompletion]);

  // 状态变化用一句轻量播报解释发生了什么（渐进呈现，不是 Agent 日志）。
  const announce = showReport && seenLiveProgress ? journeyCopy.phaseDone : "";
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
  // 结论第一句：标签后面那一句，和分享页同一份（服务端 publicAnswer）。
  const rawLead = displayVerdictLead?.trim() ? displayVerdictLead : displayDirectAnswer;
  const displayLead = scrubFaceText(rawLead) || rawLead;
  // 用户点过停止就不再把它读成「中断」：同一次事故不该有两种说法。
  // 分条已齐的总答仍要看见，不能跟着黄卡一起藏掉。
  // 结论简报的「核查范围」和「关键来源」：追问区的复制按钮与分享区的复制按钮用同一份。
  const coverageNote = snapshot.scope
    ? `${lang === "en" ? "Scope: " : "核查范围："}${snapshot.claims.filter((c) => snapshot.scope!.includedClaimIds.includes(c.id)).map((c) => c.text).join("；")}${snapshot.scope.deferredClaimIds.length ? `${lang === "en" ? ". Not covered: " : "。本轮未覆盖："}${snapshot.claims.filter((c) => snapshot.scope!.deferredClaimIds.includes(c.id)).map((c) => c.text).join("；")}` : ""}`
    : undefined;
  const briefSourceUrls = (conclusion?.sourceIds.length
    ? conclusion.sourceIds.map((id) => snapshot.sources.find((source) => source.id === id)?.url)
    : snapshot.sources.map((source) => source.url)
  ).filter((url): url is string => Boolean(url));
  const interrupted = snapshot.phase === "interrupted" && stop !== "stopped";
  const closedAnswer = snapshot.phase === "interrupted" ? snapshot.conclusion?.directAnswer?.trim() ?? "" : "";
  const interruptedAnswer = interrupted ? closedAnswer : "";
  const resultClaims = complete ? snapshot.claims.filter((c) => !isCompleteEmptyShell(c)) : snapshot.claims;
  const leftoverTexts =
    complete || interrupted ? leftoverTextsForCanvas(snapshot.originalClaim, snapshot.claims) : [];
  const leftoverSentence = leftoverTexts.length > 0 ? leftoverGapSentence(leftoverTexts) : "";
  return (
    // 进度页和结果页的引用共用一张引用卡；抽屉用 useRegisterDrawerOpener 自己登记，不用改这里。
    <SourcePopoverProvider>
    <div
      className="gp-canvas gp-canvas--journey"
      data-gp-phase={snapshot.phase}
      data-gp-presentation={complete ? showReport ? "report" : completionStage : "progress"}
      data-gp-single-claim={snapshot.claims.length === 1 ? "true" : undefined}
    >
      <div className="gp-canvas-inner">
        <section className="gp-original" aria-label={copy.canvasOriginalLabel}>
          <div className="gp-original-meta">
            <span className="gp-original-label">{copy.canvasOriginalLabel}</span>
            <div className="gp-original-side">
              {restoredAt ? (
                <em className="gp-original-time">{copy.oldCaseNotice(formatDate(restoredAt))}</em>
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
                    {saveStatus === "failed" ? copy.saveFailed : copy.saveLocal}
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
              data-gp-original-sentence
            >
              <OriginalSentence text={displayFollowUpClaim(snapshot.originalClaim)} claims={resultClaims} />
            </span>
            <span className="gp-quote-close" aria-hidden="true">”</span>
          </blockquote>
          {showReport ? <UnspannedParts text={displayFollowUpClaim(snapshot.originalClaim)} claims={resultClaims} /> : null}
          <IntakeImages images={images} />
        </section>

        {showReport && conclusion ? (
          <ResultView
            snapshot={snapshot}
            claims={resultClaims}
            label={conclusion.label ?? judgmentToLabel(conclusion.judgment)}
            lead={displayLead}
            hasReason={Boolean(conclusion.reason) && !followUpRewrite && !unopenedEmpty}
            leftoverNote={leftoverSentence}
            readOnly={readOnly}
            onFollowUp={onFollowUp}
            onNewInvestigation={onBackHome}
            shareRunId={shareRunId}
            brief={buildConclusionBrief({
              originalClaim: snapshot.originalClaim,
              directAnswer: displayDirectAnswer,
              boundaries: conclusion.boundaries,
              checkedAt: snapshot.checkedAt,
              sourceUrls: briefSourceUrls,
              coverageNote,
            })}
          />
        ) : null}

        {!showReport ? (
          <ProgressView
            snapshot={snapshot}
            claims={snapshot.claims}
            interrupted={snapshot.phase === "interrupted" || stop !== "idle"}
            leftoverNote={leftoverSentence}
            finishing={complete}
            leaving={complete && completionStage === "leaving"}
          />
        ) : null}

        {interrupted ? (
          <section className="gp-interrupted" role="alert" data-gp-interrupted>
            <strong>{journeyCopy.interruptedTitle}</strong>
            <p>{interruptedAnswer ? "已经找到的资料和查完的要点都留在上面。下面保留停下前写出的回答。" : journeyCopy.interruptedBody}</p>
            {interruptedAnswer ? (
              <p className="gp-interrupted-answer" data-gp-interrupted-answer>{interruptedAnswer}</p>
            ) : null}
            <div className="gp-interrupted-actions" hidden={readOnly}>
              <button type="button" className="gp-primary-btn" onClick={onReverify}>{journeyCopy.retry}</button>
              <button type="button" className="gp-ghost-btn" onClick={onBackHome}>{copy.backHome}</button>
            </div>
          </section>
        ) : null}

        {stop !== "idle" ? (
          <section
            className={`gp-stopped${stop === "stopping" ? " is-stopping" : ""}`}
            role="status"
            data-gp-stopped
            data-gp-stop-state={stop}
          >
            <strong>{stop === "stopping" ? copy.stoppingInvestigation : copy.stoppedInvestigation}</strong>
            <p>{stop === "stopping" ? "正在停止调查。已经找到的资料会保留。" : closedAnswer ? "已经找到的资料和查完的要点都留在上面。下面保留停下前写出的回答。" : journeyCopy.interruptedBody}</p>
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

      </div>

      <p className="gp-announcer" role="status" aria-live="polite">
        {announce}
      </p>

    </div>
    </SourcePopoverProvider>
  );
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}
