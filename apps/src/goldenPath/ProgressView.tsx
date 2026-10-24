/**
 * 按快照展示调查进度、已找到的来源和各项判断；支持停止和中断状态。
 */
import { useEffect, useState } from "react";
import { LABEL_TONE, labelText, type InvestigationClaim, type InvestigationSnapshotV1 } from "../../shared/investigation";
import { claimLabel, claimReason, presentEvidence } from "../../shared/investigation/presentation";
import { EvidenceRow, PartNumber } from "./ResultView";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";

type ProgressViewProps = {
  snapshot: InvestigationSnapshotV1;
  claims: InvestigationClaim[];
  /** 中断时整页冻结：不说「正在」。 */
  interrupted: boolean;
  connectionUnavailable?: boolean;
  /** 原句里没进本轮核查的部分，必须明说。 */
  notCovered: string;
  /** 这一轮开始的时间（本机时钟）；没有就不显示已用时间。 */
  startedAt?: number;
  /** 正在跑的这一轮才有。 */
  onStop?: () => void;
};

export function ProgressView({ snapshot, claims, interrupted, connectionUnavailable = false, notCovered, startedAt, onStop }: ProgressViewProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const deferred = new Set(snapshot.scope?.deferredClaimIds ?? []);
  const status = interrupted || connectionUnavailable ? "" : statusLine(snapshot, claims, deferred, copy);
  return (
    <div className="gp-progress" data-gp-progress>
      {status ? (
        <div className="gp-progress-status-row">
          <p className="gp-progress-status" role="status" data-gp-progress-status>
            {status}
          </p>
          <span className="gp-progress-side">
            {startedAt ? <ElapsedClock startedAt={startedAt} /> : null}
            {onStop ? (
              <button type="button" className="gp-link-btn" data-gp-stop onClick={onStop}>
                {copy.stopInvestigation}
              </button>
            ) : null}
          </span>
        </div>
      ) : null}
      {claims.length > 0 ? (
        <section className="gp-result-parts" aria-label={copy.progressAria}>
          {claims.map((claim, index) => (
            <ProgressRow key={claim.id} claim={claim} index={index} sources={snapshot.sources} deferred={deferred.has(claim.id)} interrupted={interrupted} connectionUnavailable={connectionUnavailable} />
          ))}
        </section>
      ) : null}
      {notCovered ? (
        <p className="gp-result-note" data-gp-leftover-gap>
          {notCovered}
        </p>
      ) : null}
    </div>
  );
}

function ProgressRow({
  claim,
  index,
  sources,
  deferred,
  interrupted,
  connectionUnavailable,
}: {
  claim: InvestigationClaim;
  index: number;
  sources: InvestigationSnapshotV1["sources"];
  deferred: boolean;
  interrupted: boolean;
  connectionUnavailable: boolean;
}) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const label = claimLabel(claim);
  const reason = claimReason(claim, lang);
  const hasMaterial = claim.evidence.length > 0;
  const waiting = !label && !deferred && !interrupted && !connectionUnavailable && claim.progress !== "interrupted";
  const foundTitles = waiting ? foundSourceTitles(claim, sources) : [];
  return (
    <article className="gp-part" data-gp-progress-claim={claim.id}>
      <PartNumber index={index} />
      <div className="gp-part-body">
        <div className="gp-part-head">
          <span className="gp-part-text">{claim.text}</span>
          {label ? <span className={`gp-label gp-label--${LABEL_TONE[label]}`}>{labelText(label, lang)}</span> : null}
        </div>
        {label ? (
          reason ? <p className="gp-part-reason">{reason}</p> : null
        ) : deferred ? (
          <p className="gp-progress-wait">{copy.progressDeferred}</p>
        ) : interrupted || claim.progress === "interrupted" ? (
          <p className="gp-progress-wait">{copy.progressUnfinished}</p>
        ) : connectionUnavailable ? (
          <p className="gp-progress-wait">{copy.progressAwaitReconnect}</p>
        ) : (
          <p className="gp-progress-wait">
            <span className="gp-progress-bar" aria-hidden="true" />
            {hasMaterial ? copy.progressHasMaterial : claim.progress === "pending" ? copy.progressPending : copy.progressSearching}
          </p>
        )}
        {foundTitles.length > 0 ? (
          <ul className="gp-progress-found" aria-label={copy.foundPagesAria} data-gp-progress-found>
            {foundTitles.map((title) => (
              <li key={title}>{title}</li>
            ))}
          </ul>
        ) : null}
        {(interrupted || connectionUnavailable) && hasMaterial ? (
          <ul className="gp-part-evidence">
            {claim.evidence.map((link, i) => {
              const source = sources.find((item) => item.id === link.sourceId);
              return source ? <EvidenceRow key={`${link.sourceId}:${i}`} claimId={claim.id} evidence={presentEvidence(link, source, lang)} /> : null;
            })}
          </ul>
        ) : null}
      </div>
    </article>
  );
}

function ElapsedClock({ startedAt }: { startedAt: number }) {
  const { lang } = useUiLang();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  return <span data-gp-progress-clock>{gpCopyFor(lang).elapsed(seconds)}</span>;
}

/** 这一点已经找到的网页标题，按找到的顺序去重。 */
function foundSourceTitles(claim: InvestigationClaim, sources: InvestigationSnapshotV1["sources"]): string[] {
  const titles: string[] = [];
  for (const link of claim.evidence) {
    const title = sources.find((source) => source.id === link.sourceId)?.title?.trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

/** 现在在做什么：一句话，不提模型、引擎、步骤名。和下面每一点那一行说的一致。 */
function statusLine(
  snapshot: InvestigationSnapshotV1,
  claims: InvestigationClaim[],
  deferred: Set<string>,
  copy: ReturnType<typeof gpCopyFor>
): string {
  const n = claims.length;
  if (snapshot.phase === "received" || n === 0) return copy.statusSplitting;
  const judged = claims.filter((claim) => claimLabel(claim)).length;
  if (judged === n) return copy.statusAllJudged(n);
  if (judged > 0) return copy.statusSomeJudged(n, judged);
  const active = claims.filter((claim) => !deferred.has(claim.id));
  const withMaterial = active.filter((claim) => claim.evidence.length > 0).length;
  if (snapshot.phase === "judging") return copy.statusJudging(n);
  if (withMaterial > 0) return copy.statusWithMaterial(n, withMaterial);
  return copy.statusSearching(n);
}
