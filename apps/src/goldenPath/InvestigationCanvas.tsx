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
import { ProgressView } from "./ProgressView";
import { buildConclusionBrief } from "./ShareControl";
import { IntakeImages } from "./IntakeImages";

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


export function InvestigationCanvas({
  snapshot,
  live,
  stop = "idle",
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
  const [announce, setAnnounce] = useState("");

  // 状态变化用一句轻量播报解释发生了什么（渐进呈现，不是 Agent 日志）。
  useEffect(() => {
    if (snapshot.phase === "decomposed") setAnnounce(copy.canvasClaimsLabel);
    else if (snapshot.phase === "investigating") setAnnounce("正在逐条追查出处");
    else if (snapshot.phase === "judging") setAnnounce("正在对照证据形成判断");
    else if (snapshot.phase === "complete") setAnnounce("");
  }, [snapshot.phase, copy.canvasClaimsLabel]);


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
  const interruptedHasJudgments = !interruptedAnswer && snapshot.claims.some((claim) => claim.judgment);
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
      <div className="gp-canvas-inner">
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

        {!complete ? (
          <ProgressView snapshot={snapshot} claims={resultClaims} interrupted={interrupted} leftoverNote={leftoverSentence} />
        ) : null}

      </div>

      <p className="gp-announcer" role="status" aria-live="polite">
        {announce}
      </p>

    </div>
  );
}

function formatDate(ts: number): string {
  try {
    return new Date(ts).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(ts);
  }
}
