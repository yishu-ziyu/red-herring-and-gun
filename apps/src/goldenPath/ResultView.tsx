/**
 * ResultView — 查完的一轮（#141）：结论 → 每一截的判断和依据 → 追问 / 分享 / 新调查。
 * 依据直接摊在每一截下面，不再走抽屉。历史回看、追问轮用同一个版式。
 */
import { useState } from "react";
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSnapshotV1, InvestigationSource } from "../lib/investigation";
import { quoteLinkUrl } from "../lib/investigation";
import {
  CHECKABILITY_HINT,
  claimLabel,
  domainOf,
  LABEL_TEXT,
  LABEL_TONE,
  publishedDay,
  PUBLISHED_UNKNOWN,
  ROLE_LABEL,
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

type SentenceLayout = {
  pieces: Array<{ text: string; part: { index: number; claim: InvestigationClaim } | null }>;
  /** 没有可用下标的截：原句里找不到它的原字。 */
  unspanned: Array<{ index: number; claim: InvestigationClaim }>;
};

/**
 * 原句上每一截的位置只认 originalSpan，且那段原字必须出现在这一截的文字里；不猜、不模糊匹配。
 * 模型常给一截补上主语（原句「等于吃毒药」，这一截写「隔夜菜等于吃毒药」），这时只画原句里那几个字。
 * 两截位置重叠时只画编号靠前的那一截；后一截的原字确实在原句里，所以也不放进「没有直接写出」那一行。
 */
function layoutSentence(text: string, claims: InvestigationClaim[]): SentenceLayout {
  const accepted: Array<{ start: number; end: number; index: number; claim: InvestigationClaim }> = [];
  const unspanned: SentenceLayout["unspanned"] = [];
  claims.forEach((claim, index) => {
    const span = claim.originalSpan;
    const usable =
      span &&
      Number.isInteger(span.start) &&
      Number.isInteger(span.end) &&
      span.start >= 0 &&
      span.end <= text.length &&
      span.start < span.end &&
      claim.text.includes(text.slice(span.start, span.end));
    if (!usable) {
      unspanned.push({ index, claim });
      return;
    }
    if (accepted.some((a) => span.start < a.end && a.start < span.end)) return;
    accepted.push({ start: span.start, end: span.end, index, claim });
  });
  accepted.sort((a, b) => a.start - b.start);
  const pieces: SentenceLayout["pieces"] = [];
  let cursor = 0;
  for (const a of accepted) {
    if (a.start > cursor) pieces.push({ text: text.slice(cursor, a.start), part: null });
    pieces.push({ text: text.slice(a.start, a.end), part: { index: a.index, claim: a.claim } });
    cursor = a.end;
  }
  if (cursor < text.length) pieces.push({ text: text.slice(cursor), part: null });
  return { pieces, unspanned };
}

/** 「你调查的说法」里的原句：每一截画下划线，颜色同这一截的标签，右上角是编号。 */
export function OriginalSentence({ text, claims }: { text: string; claims: InvestigationClaim[] }) {
  return (
    <>
      {layoutSentence(text, claims).pieces.map((piece, i) => {
        if (!piece.part) return <span key={i}>{piece.text}</span>;
        const label = claimLabel(piece.part.claim);
        const tone = label ? LABEL_TONE[label] : "muted";
        return (
          <span key={i} className={`gp-span gp-span--${tone}`} data-gp-span-part={piece.part.index + 1}>
            {piece.text}
            <sup>{partNumber(piece.part.index)}</sup>
          </span>
        );
      })}
    </>
  );
}

/** 原句里找不到原字的截，列成一行放在原句下面；都找得到时不显示。 */
export function UnspannedParts({ text, claims }: { text: string; claims: InvestigationClaim[] }) {
  const { unspanned } = layoutSentence(text, claims);
  if (unspanned.length === 0) return null;
  return (
    <p className="gp-original-unspanned" data-gp-unspanned-parts>
      原句没有直接写出、但判断要用到：
      {unspanned.map(({ index, claim }) => `${partNumber(index)}${claim.text}`).join("；")}
    </p>
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
  // 引号里只放核查时挑出、已核对逐字出自原文的那一句（quote.ts）；没有这一句就写我们的概括，不拿别的句子顶替。
  const quote = link.quote?.trim() ?? "";
  const summary = quote ? "" : link.relationReason?.trim() ?? "";
  const href = source.url ? quoteLinkUrl(source.url, quote) : "";
  const day = publishedDay(source);
  return (
    <li className="gp-ev" data-gp-evidence-row data-gp-role={link.role} data-gp-evidence-claim={claimId} data-gp-source-id={source.id}>
      <span className={`gp-ev-role is-${link.role}`}>{ROLE_LABEL[link.role]}</span>
      {quote ? (
        <q className="gp-ev-quote" data-gp-evidence-quote>{quote}</q>
      ) : summary ? (
        <span className="gp-ev-summary" data-gp-evidence-summary>
          <span className="gp-ev-summary-label">我们的概括</span>
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
