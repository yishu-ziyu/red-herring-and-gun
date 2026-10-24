/**
 * 展示当前调查或历史快照；中断时保留已取得的材料并提供重试。
 */
import { useEffect, useState } from "react";
import type { InvestigationSnapshotV1 } from "../../shared/investigation";
import { conclusionBrief, notCoveredNote, presentConclusion, shownClaims } from "../../shared/investigation/presentation";
import { displayFollowUpClaim } from "../../shared/followUp";
import { useUiLang } from "../lib/useUiLang";
import type { CaseImage } from "../lib/caseIntake";
import { gpCopyFor } from "./copy";
import { OriginalSentence, ResultView, UnspannedParts } from "./ResultView";
import { ProgressView } from "./ProgressView";
import { IntakeImages } from "./IntakeImages";

type InvestigationCanvasProps = {
  snapshot: InvestigationSnapshotV1;
  connectionUnavailable?: boolean;
  /** 停止：三态由服务端确认驱动，不提前说已停止；历史回看里用户停过的也是 stopped。 */
  stop?: "idle" | "stopping" | "stopped";
  onStop?: () => void;
  /** 保存状态：独立于结果存在与否，不把失败藏在 console。 */
  saveStatus?: "idle" | "local" | "failed";
  /** 保存失败要真的能点重试，不能只写「重试」两个字。 */
  onRetrySave?: () => void;
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
  connectionUnavailable = false,
  stop = "idle",
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
  const [announce, setAnnounce] = useState("");

  // 状态变化用一句轻量播报解释发生了什么（渐进呈现，不是 Agent 日志）。
  useEffect(() => {
    if (connectionUnavailable || snapshot.phase === "interrupted" || stop !== "idle") setAnnounce("");
    else if (snapshot.phase === "decomposed") setAnnounce(copy.canvasClaimsLabel);
    else if (snapshot.phase === "investigating") setAnnounce(copy.announceInvestigating);
    else if (snapshot.phase === "judging") setAnnounce(copy.announceJudging);
    else if (snapshot.phase === "complete") setAnnounce("");
  }, [snapshot.phase, stop, copy, connectionUnavailable]);


  const conclusion = presentConclusion(snapshot, { linkUnreachable, lang });
  const complete = snapshot.phase === "complete" && conclusion !== null;
  // 用户点过停止就不再把它读成「中断」：同一次事故不该有两种说法。
  const interrupted = snapshot.phase === "interrupted" && stop !== "stopped";
  // 分条已齐的总答仍要看见，不能跟着黄卡一起藏掉。
  const closedAnswer = snapshot.phase === "interrupted" ? snapshot.conclusion?.directAnswer?.trim() ?? "" : "";
  const interruptedAnswer = interrupted ? closedAnswer : "";
  const claims = shownClaims(snapshot);
  const notCovered = complete || interrupted ? notCoveredNote(snapshot, lang) : "";
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
            <OriginalSentence text={displayFollowUpClaim(snapshot.originalClaim)} claims={claims} />
            <span aria-hidden="true">”</span>
          </blockquote>
          {complete ? <UnspannedParts text={displayFollowUpClaim(snapshot.originalClaim)} claims={claims} /> : null}
          <IntakeImages images={images} />
        </section>

        {complete && conclusion ? (
          <ResultView
            snapshot={snapshot}
            claims={claims}
            conclusion={conclusion}
            readOnly={readOnly}
            onFollowUp={onFollowUp}
            onRecheck={(restoredAt || snapshot.reusedFrom) && !readOnly ? onReverify : undefined}
            onRetrySave={saveStatus === "failed" ? onRetrySave : undefined}
            shareRunId={shareRunId}
            brief={conclusionBrief(snapshot, conclusion, claims, lang)}
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
            claims={claims}
            interrupted={snapshot.phase === "interrupted" || stop !== "idle"}
            connectionUnavailable={connectionUnavailable}
            notCovered={notCovered}
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
