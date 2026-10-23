/**
 * ResultView — 查完的一轮（#141）：结论 → 每一点的判断和依据 → 追问 / 分享。
 * 依据直接摊在每一点下面，不走抽屉。历史回看、追问轮用同一个版式。
 * 版式是 2026-10-10 用户选的头版式（#150）：大字结论在上，各点不套卡片，证据像脚注。
 */
import { useLayoutEffect, useRef, useState } from "react";
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSnapshotV1, InvestigationSource } from "../../shared/investigation";
import {
  LABEL_TEXT,
  LABEL_TONE,
  materialPassageLabel,
  materialReadTag,
  materialRetrievedLabel,
  quoteLinkUrl,
  type LabelKey,
} from "../../shared/investigation";
import { CHECKABILITY_HINT, claimLabel, domainOf, formatDay, publishedDay, PUBLISHED_UNKNOWN, ROLE_LABEL } from "./snapshotUi";
import { ShareControl } from "./ShareControl";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
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
  /** 从历史记录打开的旧结果才有。 */
  onRecheck?: () => void;
  /** 保存到本机失败时才有。 */
  onRetrySave?: () => void;
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
  onRecheck,
  onRetrySave,
  shareRunId,
  brief,
}: ResultViewProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const day = formatDay(snapshot.checkedAt);
  return (
    <div className="gp-result" data-gp-result>
      <section className="gp-result-verdict" aria-label="结论" data-gp-conclusion>
        <div data-gp-direct-answer>
          <span className={`gp-verdict-word gp-tone--${LABEL_TONE[label]}`} data-gp-conclusion-label={label}>
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
        {day || onRetrySave ? (
          <p className="gp-result-meta">
            {day ? <span>{copy.checkedAt(day)}</span> : null}
            {onRetrySave ? (
              <button type="button" className="gp-link-btn is-error" data-gp-save-status="failed" data-gp-save-retry onClick={onRetrySave}>
                {copy.saveFailed}
              </button>
            ) : null}
          </p>
        ) : null}
      </section>

      {claims.length > 0 ? (
        <section className="gp-result-parts" aria-label="每一点的判断和依据">
          {claims.map((claim, index) => (
            <PartCard key={claim.id} claim={claim} index={index} sources={snapshot.sources} />
          ))}
        </section>
      ) : null}

      <ResultActions
        readOnly={readOnly}
        onFollowUp={onFollowUp}
        onRecheck={onRecheck}
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
  const { unspanned } = layoutSentence(text, claims);
  if (unspanned.length === 0) return null;
  return (
    <p className="gp-original-unspanned" data-gp-unspanned-parts>
      这几点没能在原句中标出：
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
      <PartNumber index={index} />
      <div className="gp-part-body">
        <div className="gp-part-head">
          <span className="gp-part-text" data-gp-part-text>{claim.text}</span>
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

        {boundary ? (
          <p className="gp-part-boundary" data-gp-part-boundary>
            <span className="gp-part-boundary-label">不能推出</span>
            {boundary}
          </p>
        ) : null}

        {decisive.length > 0 ? (
          <ul className="gp-part-evidence">
            {decisive.map((link, i) => (
              <EvidenceRow key={`${link.sourceId}:${link.role}:${i}`} claimId={claim.id} link={link} source={sourceOf(link)!} />
            ))}
          </ul>
        ) : (
          <p className="gp-part-empty">没有找到直接支持或反驳这一点的依据。</p>
        )}

        {related.length > 0 ? (
          <details className="gp-fold gp-part-related" data-gp-related>
            <summary>另有 {related.length} 条相关材料，未用于判断</summary>
            <ul>
              {related.map((link) => (
                <EvidenceRow key={link.sourceId} claimId={claim.id} link={link} source={sourceOf(link)!} />
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

export function EvidenceRow({ claimId, link, source }: { claimId: string; link: InvestigationEvidenceLink; source: InvestigationSource }) {
  // 引文只保证出自这条依据实际取得的文字；摘要不能冒充网页正文。
  const quote = link.quote?.trim() ?? "";
  const summary = quote ? "" : link.relationReason?.trim() ?? "";
  const href = source.url ? quoteLinkUrl(source.url, link.excerptKind === "page-excerpt" ? quote : "") : "";
  const day = publishedDay(source);
  const passage = link.passage?.trim() ?? "";
  const read = materialReadTag(link, source);
  const passageNote = [
    materialPassageLabel(link.excerptKind),
    source.fetchNote ? `正文读取情况：${source.fetchNote}` : "",
    materialRetrievedLabel(source.retrievedAt),
  ].filter(Boolean).join("；");
  return (
    <li className="gp-ev" data-gp-evidence-row data-gp-role={link.role} data-gp-evidence-claim={claimId} data-gp-source-id={source.id} data-gp-material-kind={link.excerptKind ?? "unknown"}>
      {quote ? (
        <q className="gp-ev-quote" data-gp-evidence-quote>{quote}</q>
      ) : summary ? (
        <span className="gp-ev-summary" data-gp-evidence-summary>
          <span className="gp-ev-summary-label">概括</span>
          {summary}
        </span>
      ) : null}
      <span className="gp-ev-src">
        <span className={`gp-ev-role is-${link.role}`}>{ROLE_LABEL[link.role]}</span>
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" data-gp-evidence-link>
            {source.title?.trim() || sourceName(source)} ↗
          </a>
        ) : (
          <span>{sourceName(source)}</span>
        )}
        <span className={day ? "gp-ev-date" : "gp-ev-date is-unknown"} data-gp-published={day ?? ""}>
          {day ?? PUBLISHED_UNKNOWN}
        </span>
        {source.reachable === false ? <span className="gp-ev-dead">链接已失效</span> : null}
        {link.provenance === "prior-round" ? <span data-gp-prior-round-mark>来自上一轮</span> : null}
      </span>
      <div className="gp-ev-foot">
        <span data-gp-material-status data-gp-material-level={read.level}>{read.text}</span>
        <details className="gp-fold gp-ev-material" data-gp-material>
          <summary>查看上下文</summary>
          <div className="gp-ev-context">
            {passage ? <blockquote data-gp-material-text>{passage}</blockquote> : <p>这条依据没有保存可检查的上下文。</p>}
            <small>{passageNote}</small>
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
    <section className="gp-result-actions" aria-label="接下来" data-gp-result-actions>
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
            aria-label="追问"
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="针对这次调查继续提问"
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

function sourceName(source: InvestigationSource): string {
  return source.publisher?.trim() || (source.url ? domainOf(source.url) : "") || source.title?.trim() || source.id;
}
