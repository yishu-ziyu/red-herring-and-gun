/**
 * ProgressView — 调查进行中（和中断时）的版式，和结果页同一套头版式（#150）。
 * 只按真实进度一行行出现：拆出几截就出现几行，每一截找到资料、判完，那一行才往下填。
 * 不展示执行过程：没有角色、没有执行记录、没有来源条数，只有一句大白话说现在在做什么。
 * 例外（2026-10-22 用户决定）：还没判完的一截下面列出已经找到的网页标题，只列标题。
 */
import { LABEL_TEXT, LABEL_TONE, type InvestigationClaim, type InvestigationSnapshotV1 } from "../../shared/investigation";
import { CHECKABILITY_HINT, claimLabel } from "./snapshotUi";
import { EvidenceRow } from "./ResultView";

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
  const status = interrupted ? "" : statusLine(snapshot, claims, deferred);
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
            <ProgressRow key={claim.id} claim={claim} index={index} sources={snapshot.sources} deferred={deferred.has(claim.id)} interrupted={interrupted} />
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
  sources,
  deferred,
  interrupted,
}: {
  claim: InvestigationClaim;
  index: number;
  sources: InvestigationSnapshotV1["sources"];
  deferred: boolean;
  interrupted: boolean;
}) {
  const label = claimLabel(claim);
  const reason = claim.reason?.trim() || (claim.checkability !== "checkable" ? CHECKABILITY_HINT[claim.checkability] : "");
  const hasMaterial = claim.evidence.length > 0;
  const waiting = !label && !deferred && !interrupted && claim.progress !== "interrupted";
  const foundTitles = waiting ? foundSourceTitles(claim, sources) : [];
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
      {foundTitles.length > 0 ? (
        <ul className="gp-progress-found" aria-label="已经找到的网页" data-gp-progress-found>
          {foundTitles.map((title, i) => (
            <li key={title} style={{ animationDelay: `${i * 120}ms` }}>{title}</li>
          ))}
        </ul>
      ) : null}
      {interrupted && hasMaterial ? (
        <ul className="gp-part-evidence">
          {claim.evidence.map((link, i) => {
            const source = sources.find((item) => item.id === link.sourceId);
            return source ? <EvidenceRow key={`${link.sourceId}:${i}`} claimId={claim.id} link={link} source={source} /> : null;
          })}
        </ul>
      ) : null}
    </article>
  );
}

/** 这一截已经找到的网页标题，按找到的顺序去重。 */
function foundSourceTitles(claim: InvestigationClaim, sources: InvestigationSnapshotV1["sources"]): string[] {
  const titles: string[] = [];
  for (const link of claim.evidence) {
    const title = sources.find((source) => source.id === link.sourceId)?.title?.trim();
    if (title && !titles.includes(title)) titles.push(title);
  }
  return titles;
}

/** 现在在做什么：一句话，不提模型、引擎、步骤名。和下面每一截那一行说的一致。 */
function statusLine(snapshot: InvestigationSnapshotV1, claims: InvestigationClaim[], deferred: Set<string>): string {
  const n = claims.length;
  if (snapshot.phase === "received" || n === 0) return "正在把这句话拆成几截";
  const judged = claims.filter((claim) => claimLabel(claim)).length;
  if (judged === n) return "各截都判完了，正在合成整句结论";
  if (judged > 0) return `拆成 ${n} 截，已判完 ${judged} 截`;
  const active = claims.filter((claim) => !deferred.has(claim.id));
  const withMaterial = active.filter((claim) => claim.evidence.length > 0).length;
  if (snapshot.phase === "judging" || (active.length > 0 && withMaterial === active.length)) return `拆成 ${n} 截，正在判断`;
  if (withMaterial > 0) return `拆成 ${n} 截，正在找资料和判断`;
  return `拆成 ${n} 截，正在为每一截找公开资料`;
}
