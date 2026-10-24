/**
 * 展示各项判断、对应依据，以及追问和分享操作。历史记录使用同一视图。
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { InvestigationClaim, InvestigationSnapshotV1 } from "../../shared/investigation";
import { LABEL_TONE, labelText } from "../../shared/investigation";
import {
  claimLabel,
  formatDay,
  presentClaim,
  resultWording,
  type PresentedConclusion,
  type PresentedEvidence,
} from "../../shared/investigation/presentation";
import { ShareControl } from "./ShareControl";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import "./result.css";

type ResultViewProps = {
  snapshot: InvestigationSnapshotV1;
  claims: InvestigationClaim[];
  conclusion: PresentedConclusion;
  readOnly: boolean;
  onFollowUp?: (question: string) => void;
  onRecheck?: () => void;
  /** 保存到本机失败时才有。 */
  onRetrySave?: () => void;
  shareRunId?: string;
  brief: string;
};

export function ResultView({
  snapshot,
  claims,
  conclusion,
  readOnly,
  onFollowUp,
  onRecheck,
  onRetrySave,
  shareRunId,
  brief,
}: ResultViewProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const words = resultWording(lang);
  const { label, checkedDay } = conclusion;
  return (
    <div className="gp-result" data-gp-result>
      {snapshot.reusedFrom ? (
        <p className="gp-result-meta" data-gp-reused-result>
          <span>{copy.sameClaimNotice(formatDay(snapshot.reusedFrom.checkedAt))}</span>
          {onRecheck ? (
            <button type="button" className="gp-link-btn" data-gp-reused-recheck onClick={onRecheck}>
              {copy.recheck}
            </button>
          ) : null}
        </p>
      ) : null}
      <section className="gp-result-verdict" aria-label={copy.conclusionAria} data-gp-conclusion>
        <div data-gp-direct-answer>
          <span className={`gp-verdict-word gp-tone--${LABEL_TONE[label]}`} data-gp-conclusion-label={label}>
            {labelText(label, lang)}
          </span>
          <p className="gp-result-headline" data-gp-conclusion-reason={conclusion.hasReason ? "" : undefined}>
            {conclusion.lead}
          </p>
        </div>
        {conclusion.notCovered ? (
          <p className="gp-result-note" data-gp-leftover-gap>
            {conclusion.notCovered}
          </p>
        ) : null}
        {checkedDay || onRetrySave ? (
          <p className="gp-result-meta">
            {checkedDay ? <span>{words.checkedAt(checkedDay)}</span> : null}
            {onRetrySave ? (
              <button type="button" className="gp-link-btn is-error" data-gp-save-status="failed" data-gp-save-retry onClick={onRetrySave}>
                {copy.saveFailed}
              </button>
            ) : null}
          </p>
        ) : null}
      </section>

      {claims.length > 0 ? (
        <section className="gp-result-parts" aria-label={copy.partsAria}>
          {claims.map((claim, index) => (
            <PartCard key={claim.id} claim={claim} index={index} sources={snapshot.sources} />
          ))}
        </section>
      ) : null}

      <ResultActions
        readOnly={readOnly}
        onFollowUp={onFollowUp}
        onRecheck={snapshot.reusedFrom ? undefined : onRecheck}
        shareRunId={shareRunId}
        brief={brief}
      />
    </div>
  );
}

type SentenceLayout = {
  pieces: Array<{ text: string; part: { index: number; claim: InvestigationClaim } | null }>;
  /** 没有可靠定位的点；不能据此判断用户没有说过。 */
  unspanned: Array<{ index: number; claim: InvestigationClaim }>;
};

/**
 * 原句上每一点的位置只认 originalSpan，且那段原字必须出现在这一点的文字里；不猜、不模糊匹配。
 * 模型常给一点补上主语（原句「等于吃毒药」，这一点写「隔夜菜等于吃毒药」），这时只画原句里那几个字。
 * 两点位置重叠时只画编号靠前的那一点；后一点的原字仍在原句里，不列入定位失败。
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

/** 原句：每一点加底色，颜色同这一点的标签，右上角是编号。 */
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

/** 定位失败只说明技术限制，不把它解释成关于用户原意的判断。 */
export function UnspannedParts({ text, claims }: { text: string; claims: InvestigationClaim[] }) {
  const { lang } = useUiLang();
  const { unspanned } = layoutSentence(text, claims);
  if (unspanned.length === 0) return null;
  return (
    <p className="gp-original-unspanned" data-gp-unspanned-parts>
      {gpCopyFor(lang).unspannedParts}
      {unspanned.map(({ index, claim }) => `${partNumber(index)}${claim.text}`).join("；")}
    </p>
  );
}

function PartCard({ claim, index, sources }: { claim: InvestigationClaim; index: number; sources: InvestigationSnapshotV1["sources"] }) {
  const { lang } = useUiLang();
  const words = resultWording(lang);
  const part = presentClaim(claim, sources, lang);
  const { label } = part;

  return (
    <article className="gp-part" data-gp-claim-id={claim.id}>
      <PartNumber index={index} />
      <div className="gp-part-body">
        <div className="gp-part-head">
          <span className="gp-part-text" data-gp-part-text>{claim.text}</span>
          {label ? (
            <span className={`gp-label gp-label--${LABEL_TONE[label]}`} data-gp-claim-label={label}>
              {labelText(label, lang)}
            </span>
          ) : null}
        </div>
        {part.reason ? (
          <p className="gp-part-reason" data-gp-claim-reason={part.reasonFromModel ? "" : undefined}>
            {part.reason}
          </p>
        ) : null}

        {part.boundary ? (
          <p className="gp-part-boundary" data-gp-part-boundary>
            <span className="gp-part-boundary-label">{words.cannotInfer}</span>
            {part.boundary}
          </p>
        ) : null}

        {part.decisive.length > 0 ? (
          <ul className="gp-part-evidence">
            {part.decisive.map((evidence, i) => (
              <EvidenceRow key={`${evidence.sourceId}:${evidence.role}:${i}`} claimId={claim.id} evidence={evidence} />
            ))}
          </ul>
        ) : (
          <p className="gp-part-empty">{words.noDecisive}</p>
        )}

        {part.related.length > 0 ? (
          <details className="gp-fold gp-part-related" data-gp-related>
            <summary>{words.related(part.related.length)}</summary>
            <ul>
              {part.related.map((evidence) => (
                <EvidenceRow key={evidence.sourceId} claimId={claim.id} evidence={evidence} />
              ))}
            </ul>
          </details>
        ) : null}
      </div>
    </article>
  );
}

/** 每一点左侧的编号，和原句里的上标编号对应。 */
export function PartNumber({ index }: { index: number }) {
  return (
    <span className="gp-part-no" aria-hidden="true">
      {index + 1}
    </span>
  );
}

export function EvidenceRow({ claimId, evidence }: { claimId: string; evidence: PresentedEvidence }) {
  const { lang } = useUiLang();
  const words = resultWording(lang);
  const { quote, published, read } = evidence;
  return (
    <li className="gp-ev" data-gp-evidence-row data-gp-role={evidence.role} data-gp-evidence-claim={claimId} data-gp-source-id={evidence.sourceId} data-gp-material-kind={evidence.materialKind}>
      {quote?.kind === "snippet" ? (
        <span className="gp-ev-summary" data-gp-evidence-snippet>
          <span className="gp-ev-summary-label">{words.snippetTag}</span>
          {quote.text}
        </span>
      ) : quote?.kind === "page" ? (
        <q className="gp-ev-quote" data-gp-evidence-quote>{quote.text}</q>
      ) : quote?.kind === "summary" ? (
        <span className="gp-ev-summary" data-gp-evidence-summary>
          <span className="gp-ev-summary-label">{words.summaryTag}</span>
          {quote.text}
        </span>
      ) : null}
      <span className="gp-ev-src">
        <span className={`gp-ev-role is-${evidence.role}`}>{evidence.roleText}</span>
        {evidence.href ? (
          <a href={evidence.href} target="_blank" rel="noopener noreferrer" data-gp-evidence-link>
            {evidence.linkText} ↗
          </a>
        ) : (
          <span>{evidence.linkText}</span>
        )}
        <span className={published ? "gp-ev-date" : "gp-ev-date is-unknown"} data-gp-published={published ?? ""}>
          {published ?? words.publishedUnknown}
        </span>
        {evidence.dead ? <span className="gp-ev-dead">{words.deadLink}</span> : null}
        {evidence.provenance?.kind === "prior-round" ? <span data-gp-prior-round-mark>{evidence.provenance.text}</span> : null}
      </span>
      <div className="gp-ev-foot">
        <span data-gp-material-status data-gp-material-level={read.level}>{read.text}</span>
        <details className="gp-fold gp-ev-material" data-gp-material>
          <summary>{words.viewContext}</summary>
          <div className="gp-ev-context">
            {evidence.passage ? <blockquote data-gp-material-text>{evidence.passage}</blockquote> : <p>{words.noPassage}</p>}
            <small>{evidence.passageNote}</small>
          </div>
        </details>
      </div>
    </li>
  );
}

function ResultActions({
  readOnly,
  onFollowUp,
  onRecheck,
  shareRunId,
  brief,
}: Pick<ResultViewProps, "readOnly" | "onFollowUp" | "onRecheck" | "shareRunId" | "brief">) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 输入多行时框跟着变高，清空后缩回一行。
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [question]);
  const submit = () => {
    const text = question.trim();
    if (!text || !onFollowUp) return;
    onFollowUp(text);
    setQuestion("");
  };
  const canAsk = !readOnly && Boolean(onFollowUp);
  if (!canAsk && !shareRunId && !onRecheck) return null;
  return (
    <section className="gp-result-actions" aria-label={copy.nextAria} data-gp-result-actions>
      {canAsk ? (
        <form
          className="gp-result-ask"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <textarea
            ref={inputRef}
            value={question}
            rows={1}
            aria-label={copy.followUp}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder={copy.followUpPlaceholder}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <button type="submit" className="gp-btn gp-btn--primary" disabled={!question.trim()}>
            {copy.followUp}
          </button>
        </form>
      ) : null}
      <div className="gp-result-row">
        {shareRunId ? <ShareControl runId={shareRunId} brief={brief} /> : null}
        {onRecheck ? (
          <button type="button" className="gp-btn" onClick={onRecheck}>
            {copy.recheck}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/** ①…⑳，再往后用数字。 */
function partNumber(index: number): string {
  return index < 20 ? String.fromCharCode(0x2460 + index) : `${index + 1}.`;
}

