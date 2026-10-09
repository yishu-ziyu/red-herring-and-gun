/**
 * ResultView — 查完的一轮（#141）：结论 → 每一截的判断和依据 → 追问 / 分享 / 新调查。
 * 依据直接摊在每一截下面，不再走抽屉。历史回看、追问轮用同一个版式。
 */
import { useState } from "react";
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSnapshotV1, InvestigationSource } from "../lib/investigation";
import {
  CHECKABILITY_HINT,
  claimLabel,
  domainOf,
  LABEL_TEXT,
  LABEL_TONE,
  publishedDay,
  PUBLISHED_UNKNOWN,
  quoteFragmentUrl,
  quoteSentence,
  ROLE_LABEL,
  sourceExcerpt,
  type LabelKey,
} from "./snapshotUi";
import { ShareControl } from "./ShareControl";
import "./result.css";

type ResultViewProps = {
  snapshot: InvestigationSnapshotV1;
  claims: InvestigationClaim[];
  label: LabelKey;
  /** 结论第一句（标签后面那句）。 */
  lead: string;
  /** 这一句是不是模型写的理由；追问改写、改版前的快照不是。 */
  hasReason: boolean;
  /** 原句里没进本轮核查的部分，必须明说。 */
  leftoverNote: string;
  readOnly: boolean;
  onFollowUp?: (question: string) => void;
  onNewInvestigation: () => void;
  shareRunId?: string;
  brief: string;
};

export function ResultView({
  snapshot,
  claims,
  label,
  lead,
  hasReason,
  leftoverNote,
  readOnly,
  onFollowUp,
  onNewInvestigation,
  shareRunId,
  brief,
}: ResultViewProps) {
  const day = checkedDay(snapshot.checkedAt);
  return (
    <div className="gp-result" data-gp-result>
      <section className="gp-result-verdict" aria-label="结论" data-gp-conclusion>
        <div data-gp-direct-answer>
          <span className={`gp-label gp-label--${LABEL_TONE[label]}`} data-gp-conclusion-label={label}>
            {LABEL_TEXT[label]}
          </span>
          <p className="gp-result-headline" data-gp-conclusion-reason={hasReason ? "" : undefined}>
            {lead}
          </p>
        </div>
        {leftoverNote ? (
          <p className="gp-result-note" data-gp-leftover-gap>
            {leftoverNote}
          </p>
        ) : null}
        {day ? <p className="gp-result-meta">核查于 {day}</p> : null}
      </section>

      {claims.length > 0 ? (
        <section aria-label="每一截的判断和依据">
          <h2 className="gp-result-heading">每一截的判断和依据</h2>
          {claims.map((claim, index) => (
            <PartCard key={claim.id} claim={claim} index={index} sources={snapshot.sources} />
          ))}
        </section>
      ) : null}

      <ResultActions
        readOnly={readOnly}
        onFollowUp={onFollowUp}
        onNewInvestigation={onNewInvestigation}
        shareRunId={shareRunId}
        brief={brief}
      />
    </div>
  );
}

function PartCard({ claim, index, sources }: { claim: InvestigationClaim; index: number; sources: InvestigationSource[] }) {
  const label = claimLabel(claim);
  const sourceOf = (link: InvestigationEvidenceLink) => sources.find((s) => s.id === link.sourceId);
  const decisive = claim.evidence.filter(
    (link) => (link.role === "contradict" || link.role === "support") && sourceOf(link),
  );
  const decisiveIds = new Set(decisive.map((link) => link.sourceId));
  const seen = new Set<string>();
  const related = claim.evidence.filter((link) => {
    if (link.role === "contradict" || link.role === "support") return false;
    if (decisiveIds.has(link.sourceId) || seen.has(link.sourceId) || !sourceOf(link)) return false;
    seen.add(link.sourceId);
    return true;
  });
  const reason = claim.reason?.trim() || (claim.checkability !== "checkable" ? CHECKABILITY_HINT[claim.checkability] : "");
  const boundary = claim.boundary?.trim().replace(/^不能推出[：:]?/, "") ?? "";

  return (
    <article className="gp-part" data-gp-claim-id={claim.id}>
      <div className="gp-part-head">
        <span className="gp-part-title">
          <span className="gp-part-no" aria-hidden="true">{partNumber(index)}</span>
          <span className="gp-part-text" data-gp-part-text>{claim.text}</span>
        </span>
        {label ? (
          <span className={`gp-label gp-label--${LABEL_TONE[label]}`} data-gp-claim-label={label}>
            {LABEL_TEXT[label]}
          </span>
        ) : null}
      </div>
      {reason ? (
        <p className="gp-part-reason" data-gp-claim-reason={claim.reason ? "" : undefined}>
          {reason}
        </p>
      ) : null}

      {decisive.length > 0 ? (
        <ul className="gp-part-evidence">
          {decisive.map((link, i) => (
            <EvidenceRow key={`${link.sourceId}:${link.role}:${i}`} claimId={claim.id} link={link} source={sourceOf(link)!} />
          ))}
        </ul>
      ) : (
        <p className="gp-part-empty">没有找到直接支持或反驳这一截的依据。</p>
      )}

      {related.length > 0 ? (
        <details className="gp-part-related" data-gp-related>
          <summary>另有 {related.length} 条只和话题相关，没有用来判断</summary>
          <ul>
            {related.map((link) => {
              const source = sourceOf(link)!;
              const day = publishedDay(source);
              return (
                <li key={link.sourceId} data-gp-related-row>
                  {source.url ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">{source.title?.trim() || domainOf(source.url)}</a>
                  ) : (
                    source.title?.trim() || source.id
                  )}
                  （{sourceName(source)}，
                  <span data-gp-published={day ?? ""}>{day ?? PUBLISHED_UNKNOWN}</span>）
                </li>
              );
            })}
          </ul>
        </details>
      ) : null}

      {boundary ? (
        <p className="gp-part-boundary" data-gp-part-boundary>
          不能推出：{boundary}
        </p>
      ) : null}
    </article>
  );
}

function EvidenceRow({ claimId, link, source }: { claimId: string; link: InvestigationEvidenceLink; source: InvestigationSource }) {
  const passage = link.passage?.trim() ?? "";
  // #135：只有和这一截绑定的段落才当原文引用；只有整篇摘要时照实标「来源摘要」。
  const quote = passage ? quoteSentence(passage) : "";
  const summary = quote ? "" : sourceExcerpt(source);
  const href = source.url ? (quote ? quoteFragmentUrl(source.url, passage) : source.url) : "";
  const day = publishedDay(source);
  return (
    <li className="gp-ev" data-gp-evidence-row data-gp-role={link.role} data-gp-evidence-claim={claimId} data-gp-source-id={source.id}>
      <span className={`gp-ev-role is-${link.role}`}>{ROLE_LABEL[link.role]}</span>
      {quote ? (
        <q className="gp-ev-quote" data-gp-evidence-quote>{quote}</q>
      ) : summary ? (
        <span className="gp-ev-summary" data-gp-evidence-summary>
          <span className="gp-ev-summary-label">来源摘要</span>
          {summary}
        </span>
      ) : null}
      <span className="gp-ev-src">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" data-gp-evidence-link>
            {sourceName(source)} ↗
          </a>
        ) : (
          <span>{sourceName(source)}</span>
        )}
        <span className={day ? "gp-ev-date" : "gp-ev-date is-unknown"} data-gp-published={day ?? ""}>
          {day ?? PUBLISHED_UNKNOWN}
        </span>
        {source.reachable === false ? <span className="gp-ev-dead">打不开</span> : null}
        {link.provenance === "prior-round" ? <span className="gp-ev-prior" data-gp-prior-round-mark>依据来自刚才那一轮</span> : null}
      </span>
    </li>
  );
}

function ResultActions({
  readOnly,
  onFollowUp,
  onNewInvestigation,
  shareRunId,
  brief,
}: Pick<ResultViewProps, "readOnly" | "onFollowUp" | "onNewInvestigation" | "shareRunId" | "brief">) {
  const [question, setQuestion] = useState("");
  const submit = () => {
    const text = question.trim();
    if (!text || !onFollowUp) return;
    onFollowUp(text);
    setQuestion("");
  };
  return (
    <section className="gp-result-actions" aria-label="接下来" data-gp-result-actions>
      {!readOnly && onFollowUp ? (
        <form
          className="gp-result-ask"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            value={question}
            rows={1}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="针对这份调查继续问"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" className="gp-btn gp-btn--primary" disabled={!question.trim()}>
            追问
          </button>
        </form>
      ) : null}
      <div className="gp-result-row">
        {shareRunId ? <ShareControl runId={shareRunId} brief={brief} /> : null}
        <button type="button" className="gp-btn gp-result-new" onClick={onNewInvestigation}>
          新调查
        </button>
      </div>
    </section>
  );
}

/** ①…⑳，再往后用数字。 */
function partNumber(index: number): string {
  return index < 20 ? String.fromCharCode(0x2460 + index) : `${index + 1}.`;
}

function sourceName(source: InvestigationSource): string {
  return source.publisher?.trim() || (source.url ? domainOf(source.url) : "") || source.title?.trim() || source.id;
}

function checkedDay(iso: string | undefined): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
