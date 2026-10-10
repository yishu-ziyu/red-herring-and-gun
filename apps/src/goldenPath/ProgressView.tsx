/**
 * ProgressView — 调查进行中（和中断时）的版式，和结果页同一套头版式（#150）。
 * 只按真实进度一行行出现：拆出几截就出现几行，每一截找到资料、判完，那一行才往下填。
 * 不展示执行过程：没有角色、没有执行记录、没有来源条数，只有一句大白话说现在在做什么。
 */
import type { InvestigationClaim, InvestigationSnapshotV1 } from "../lib/investigation";
import { CHECKABILITY_HINT, claimLabel, LABEL_TEXT, LABEL_TONE } from "./snapshotUi";

type ProgressViewProps = {
  snapshot: InvestigationSnapshotV1;
  claims: InvestigationClaim[];
  /** 中断时整页冻结：不说「正在」。 */
  interrupted: boolean;
  /** 原句里没进本轮核查的部分，必须明说。 */
  leftoverNote: string;
};

export function ProgressView({ snapshot, claims, interrupted, leftoverNote }: ProgressViewProps) {
  const deferred = new Set(snapshot.scope?.deferredClaimIds ?? []);
  const status = interrupted ? "" : statusLine(snapshot, claims);
  return (
    <div className="gp-progress" data-gp-progress>
      {status ? (
        <p className="gp-progress-status" role="status" data-gp-progress-status>
          <span className="gp-progress-dot" aria-hidden="true" />
          {status}
        </p>
      ) : null}
      {claims.length > 0 ? (
        <section className="gp-result-parts" aria-label="每一截的进度">
          {claims.map((claim, index) => (
            <ProgressRow key={claim.id} claim={claim} index={index} deferred={deferred.has(claim.id)} interrupted={interrupted} />
          ))}
        </section>
      ) : null}
      {leftoverNote ? (
        <p className="gp-result-note" data-gp-leftover-gap>
          {leftoverNote}
        </p>
      ) : null}
    </div>
  );
}

function ProgressRow({
  claim,
  index,
  deferred,
  interrupted,
}: {
  claim: InvestigationClaim;
  index: number;
  deferred: boolean;
  interrupted: boolean;
}) {
  const label = claimLabel(claim);
  const reason = claim.reason?.trim() || (claim.checkability !== "checkable" ? CHECKABILITY_HINT[claim.checkability] : "");
  const hasMaterial = claim.evidence.length > 0;
  return (
    <article className="gp-part gp-progress-part" data-gp-progress-claim={claim.id}>
      <div className="gp-part-head">
        <span className="gp-part-title">
          <span className="gp-part-no" aria-hidden="true">{index + 1}</span>
          <span className="gp-part-text">{claim.text}</span>
        </span>
        {label ? (
          <span className={`gp-label gp-label--${LABEL_TONE[label]} gp-progress-label`}>{LABEL_TEXT[label]}</span>
        ) : null}
      </div>
      {label ? (
        reason ? <p className="gp-part-reason gp-progress-reason">{reason}</p> : null
      ) : deferred ? (
        <p className="gp-progress-wait">这一截本轮不查</p>
      ) : interrupted || claim.progress === "interrupted" ? (
        <p className="gp-progress-wait">没查完</p>
      ) : (
        <p className="gp-progress-wait">
          <span className="gp-progress-bar" aria-hidden="true" />
          {hasMaterial ? "找到资料，正在判断" : claim.progress === "pending" ? "等着查" : "正在找资料"}
        </p>
      )}
    </article>
  );
}

/** 现在在做什么：一句话，不提模型、引擎、步骤名。 */
function statusLine(snapshot: InvestigationSnapshotV1, claims: InvestigationClaim[]): string {
  const n = claims.length;
  if (snapshot.phase === "received" || n === 0) return "正在把这句话拆成几截";
  const judged = claims.filter((claim) => claimLabel(claim)).length;
  if (judged === n) return "各截都判完了，正在合成整句结论";
  if (judged > 0) return `拆成 ${n} 截，已判完 ${judged} 截`;
  if (snapshot.phase === "judging") return `拆成 ${n} 截，正在逐截判断`;
  return `拆成 ${n} 截，正在为每一截找公开资料`;
}
