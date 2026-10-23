/**
 * InvestigationCanvas — 唯一调查画布（Issue #52 同画布 + Issue #64 persistent conclusion）。
 * investigating → complete 不换壳：结论区从调查中就存在，完成时同一节点显现 directAnswer。
 * 原始说法与命题保持原位。不抢焦点、不滚动、不关闭已打开的 Drawer。
 * interrupted：保留已获真实数据、无伪结论、可重试。
 * 调查中和查完同一套头版式（#150）：调查中用 ProgressView 一行行填，不展示执行过程。
 */
import { useEffect, useState } from "react";
import type { InvestigationSnapshotV1 } from "../../shared/investigation";
import { judgmentToLabel } from "../../shared/investigation";
import { scrubFaceText } from "../../shared/scrubFace";
import { useUiLang } from "../lib/useUiLang";
import { displayFollowUpClaim, conclusionMissesFollowUp, followUpQuestionLead } from "../../shared/followUp";
import { isUrlOnlyClaim, type CaseImage } from "../lib/caseIntake";
import { gpCopyFor } from "./copy";
import { leftoverGapSentence, leftoverTextsForCanvas, isCompleteEmptyShell } from "./leftoverClaims";
import { OriginalSentence, ResultView, UnspannedParts } from "./ResultView";
import { ProgressView } from "./ProgressView";
import { buildConclusionBrief } from "./ShareControl";
import { IntakeImages } from "./IntakeImages";

type InvestigationCanvasProps = {
  snapshot: InvestigationSnapshotV1;
  /** 停止：三态由服务端确认驱动，不提前说已停止。 */
  stop?: "idle" | "stopping" | "stopped";
  onStop?: () => void;
  /** 保存状态：独立于结果存在与否，不把失败藏在 console。 */
  saveStatus?: "idle" | "local" | "failed";
  /** 保存失败要真的能点重试，不能只写「重试」两个字。 */
  onRetrySave?: () => void;
  /** 从历史记录打开的旧结果：结果下面给「重新核查」。 */
  restoredAt?: number;
  onReverify: () => void;
  /** 追问回调：就当前结论继续深入查证 */
  onFollowUp?: (question: string) => void;
  /** 这次提交的链接抓取失败（登录墙/空页）：调查全程都要看见，不能只亮 12 秒。 */
  linkUnreachable?: boolean;
  readOnly?: boolean;
  /** 这次上传的图片：显示在「你调查的说法」下面。历史回看没有。 */
  images?: CaseImage[];
  /** 这一轮在服务端的调查编号：有才显示「分享」（老历史没有）。 */
  shareRunId?: string;
  /** 正在跑的这一轮开始的时间（本机时钟）；历史回看没有。 */
  startedAt?: number;
};


export function InvestigationCanvas({
  snapshot,
  stop: liveStop = "idle",
  onStop,
  saveStatus = "idle",
  onRetrySave,
  restoredAt,
  onReverify,
  onFollowUp,
  linkUnreachable = false,
  readOnly = false,
  images,
  shareRunId,
  startedAt,
}: InvestigationCanvasProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  // 历史只读也保留用户主动停止的事实，不把它重新解释成网络中断。
  const stop = snapshot.interruptionReason === "cancelled" ? "stopped" : liveStop;
  const [announce, setAnnounce] = useState("");

  // 状态变化用一句轻量播报解释发生了什么（渐进呈现，不是 Agent 日志）。
  useEffect(() => {
    if (snapshot.phase === "interrupted" || stop !== "idle") setAnnounce("");
    else if (snapshot.phase === "decomposed") setAnnounce(copy.canvasClaimsLabel);
    else if (snapshot.phase === "investigating") setAnnounce("正在逐条追查出处");
    else if (snapshot.phase === "judging") setAnnounce("正在对照证据形成判断");
    else if (snapshot.phase === "complete") setAnnounce("");
  }, [snapshot.phase, stop, copy.canvasClaimsLabel]);


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
    <div
      className="gp-canvas"
      data-gp-phase={snapshot.phase}
      data-gp-single-claim={snapshot.claims.length === 1 ? "true" : undefined}
    >
      <div className="gp-canvas-inner gp-column">
        {interrupted ? (
          <section className="gp-interrupted" role="alert" data-gp-interrupted>
            <strong>{interruptedAnswer ? copy.interruptedPartialTitle : copy.interruptedTitle}</strong>
            <p>{interruptedAnswer ? copy.interruptedPartialBody : copy.interruptedBody}</p>
            {interruptedAnswer ? (
              <p className="gp-interrupted-answer" data-gp-interrupted-answer>
                {interruptedAnswer}
              </p>
            ) : null}
            <div className="gp-interrupted-actions" hidden={readOnly}>
              <button type="button" className="gp-btn gp-btn--primary" onClick={onReverify}>
                {copy.interruptedRetry}
              </button>
            </div>
          </section>
        ) : null}

        <section className="gp-original" aria-label={copy.canvasOriginalLabel}>
          <blockquote className="gp-original-quote" data-gp-original-sentence>
            <span className="gp-quote-open" aria-hidden="true">“</span>
            <OriginalSentence text={displayFollowUpClaim(snapshot.originalClaim)} claims={resultClaims} />
            <span aria-hidden="true">”</span>
          </blockquote>
          {complete ? <UnspannedParts text={displayFollowUpClaim(snapshot.originalClaim)} claims={resultClaims} /> : null}
          <IntakeImages images={images} />
        </section>

        {complete && conclusion ? (
          <ResultView
            snapshot={snapshot}
            claims={resultClaims}
            label={conclusion.label ?? judgmentToLabel(conclusion.judgment)}
            lead={displayLead}
            hasReason={Boolean(conclusion.reason) && !followUpRewrite && !unopenedEmpty}
            leftoverNote={leftoverSentence}
            readOnly={readOnly}
            onFollowUp={onFollowUp}
            onRecheck={restoredAt && !readOnly ? onReverify : undefined}
            onRetrySave={saveStatus === "failed" ? onRetrySave : undefined}
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
            {stop === "stopped" && !readOnly ? (
              <div className="gp-stopped-actions">
                <button type="button" className="gp-btn gp-btn--primary" data-gp-stopped-retry onClick={onReverify}>
                  {copy.reviewAgain}
                </button>
              </div>
            ) : null}
          </section>
        ) : null}

        {!complete ? (
          <ProgressView
            snapshot={snapshot}
            claims={resultClaims}
            interrupted={snapshot.phase === "interrupted" || stop !== "idle"}
            leftoverNote={leftoverSentence}
            startedAt={startedAt}
            onStop={!interrupted && onStop && stop === "idle" ? onStop : undefined}
          />
        ) : null}

      </div>

      <p className="gp-announcer" role="status" aria-live="polite">
        {announce}
      </p>

    </div>
  );
}
