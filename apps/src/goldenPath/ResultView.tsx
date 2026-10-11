/**
 * ResultView — 查完的一轮（#141）：结论 → 每一截的判断和依据 → 追问 / 分享 / 新调查。
 * 依据直接摊在每一截下面，不再走抽屉。历史回看、追问轮用同一个版式。
 * 版式是 2026-10-10 用户选的头版式（#150，DECISIONS.md）：大字结论在上，各截不套卡片，证据像脚注。
 */
import { useMemo, useState } from "react";
import type { InvestigationClaim, InvestigationConflict, InvestigationEvidenceLink, InvestigationSnapshotV1, InvestigationSource, PublicActivity } from "../lib/investigation";
import {
  CHECKABILITY_HINT,
  claimLabel,
  JUDGMENT_LABEL,
  LABEL_TEXT,
  LABEL_TONE,
  type LabelKey,
} from "./snapshotUi";
import { Icon } from "./Icon";
import { journeyCopy } from "./journeyCopy";
import { AllSourcesButton, EvidenceProvenance } from "./SourceDrawer";
import { SourceCitation } from "./SourcePill";
import { claimSourceRelations, publisherOf, relationText, roleRank } from "./sourceUi";
import { ShareControl } from "./ShareControl";
import "./result.css";

type ResultViewProps = {
  snapshot: InvestigationSnapshotV1;
  activities?: PublicActivity[];
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
  activities,
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
  const citations = useMemo(() => {
    const seen = new Set<string>();
    return claims.flatMap((claim, index) => claimSourceRelations(claim, index + 1, snapshot.sources))
      .sort((a, b) => roleRank(a.role) - roleRank(b.role))
      .filter(({ source }) => !seen.has(source.id) && Boolean(seen.add(source.id)));
  }, [claims, snapshot.sources]);
  const rationale = withoutReferenceMarkers(snapshot.conclusion?.rationale ?? "");
  const boundaries = snapshot.conclusion?.boundaries.filter((text) => text.trim()) ?? [];
  return (
    <div className="gp-result" data-gp-result>
      <RunSummary snapshot={snapshot} claims={claims} activities={activities} />
      <section className="gp-result-verdict" aria-label="结论" data-gp-conclusion>
        <div data-gp-direct-answer>
          <div className={`gp-result-label gp-tone--${LABEL_TONE[label]}`}>
            <span className="gp-result-rule" aria-hidden="true" />
            <span className={`gp-label gp-label--${LABEL_TONE[label]}`} data-gp-conclusion-label={label}>
              {LABEL_TEXT[label]}
            </span>
          </div>
          <h2 className="gp-result-headline" data-gp-conclusion-reason={hasReason ? "" : undefined}>
            {withoutReferenceMarkers(lead)}
          </h2>
        </div>
        {rationale || citations.length > 0 ? (
          <p className="gp-result-rationale">
            {rationale}<SourceCitation items={citations} />
          </p>
        ) : null}
        <div className="gp-result-meta">
          {day ? <span>{day} 查完</span> : null}
          <AllSourcesButton sources={snapshot.sources} claims={claims} />
        </div>
        {boundaries.length > 0 ? (
          <div className="gp-result-care"><b>问题在哪</b><span>{boundaries.map(withoutReferenceMarkers).join(" ")}</span></div>
        ) : null}
        {leftoverNote ? (
          <p className="gp-result-note" data-gp-leftover-gap>
            {leftoverNote}
          </p>
        ) : null}
      </section>

      {claims.length > 0 ? (
        <section className="gp-result-parts" aria-label="分开来看">
          <h2 className="gp-result-section">分开来看</h2>
          <div className="gp-result-reading">
            {claims.map((claim, index) => (
              <PartCard key={claim.id} claim={claim} index={index} sources={snapshot.sources} conflicts={snapshot.conflicts} />
            ))}
          </div>
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

function RunSummary({ snapshot, claims, activities }: Pick<ResultViewProps, "snapshot" | "claims" | "activities">) {
  const read = snapshot.sources.filter((source) => source.fetchStatus === "fetched" && source.excerptKind === "page-excerpt").length;
  const summary = `查过了：拆成 ${snapshot.claims.length} 个要点，找到 ${snapshot.sources.length} 份资料${read > 0 ? `，读完 ${read} 份` : ""}`;
  const items = activities?.map((activity) => activityText(activity, claims)).filter(Boolean) ?? [];
  if (items.length === 0) return <p className="gp-result-done" role="status" aria-live="polite">{summary}</p>;
  return (
    <details className="gp-result-done">
      <summary><Icon name="chevron-right" className="gp-chevron" />{summary}</summary>
      <ol>{items.map((text, index) => <li key={index}><em>{String(index + 1).padStart(2, "0")}</em>{text}</li>)}</ol>
    </details>
  );
}

function activityText(activity: PublicActivity, claims: InvestigationClaim[]): string {
  const claimNo = claims.findIndex((claim) => activity.claimIds.includes(claim.id)) + 1;
  const { title, claimText, role, judgment, description } = activity.payload;
  switch (activity.kind) {
    case "claim_decomposed": return claimNo && claimText ? `拆出第 ${claimNo} 个要点：${claimText}` : "";
    case "source_found": return title ? `找到《${title}》` : "";
    case "source_checked": return claimNo && title && (role === "support" || role === "contradict" || role === "context-only")
      ? `读完《${title}》，${relationText(role, claimNo)}` : "";
    case "evidence_assessed": return claimNo && Object.hasOwn(JUDGMENT_LABEL, judgment)
      ? `判断第 ${claimNo} 个要点：${JUDGMENT_LABEL[judgment as keyof typeof JUDGMENT_LABEL]}` : "";
    case "gap_identified": return claimNo && description ? `记下第 ${claimNo} 个要点${journeyCopy.gapLine(description)}` : "";
    case "conflict_detected": return claimNo ? `第 ${claimNo} 个要点的资料一边支持、一边反驳` : "";
    case "run_completed": return activity.payload.phase === "complete" ? "全部查完，写出结论" : "";
    default: return "";
  }
}

function withoutReferenceMarkers(text: string): string {
  return text.replace(/\[\d+(?:\s*[,，、–-]\s*\d+)*\]/g, "").trim();
}

type SentenceLayout = {
  pieces: Array<{ text: string; part: { index: number; claim: InvestigationClaim } | null }>;
  /** 没有可靠定位的截；不能据此判断用户没有说过。 */
  unspanned: Array<{ index: number; claim: InvestigationClaim }>;
};

/**
 * 原句上每一截的位置只认 originalSpan，且那段原字必须出现在这一截的文字里；不猜、不模糊匹配。
 * 模型常给一截补上主语（原句「等于吃毒药」，这一截写「隔夜菜等于吃毒药」），这时只画原句里那几个字。
 * 两截位置重叠时只画编号靠前的那一截；后一截的原字仍在原句里，不列入定位失败。
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

/** 定位失败只说明技术限制，不把它解释成关于用户原意的判断。 */
export function UnspannedParts({ text, claims }: { text: string; claims: InvestigationClaim[] }) {
  const { unspanned } = layoutSentence(text, claims);
  if (unspanned.length === 0) return null;
  return (
    <p className="gp-original-unspanned" data-gp-unspanned-parts>
      以下条目暂未可靠定位到原句：
      {unspanned.map(({ index, claim }) => `${partNumber(index)}${claim.text}`).join("；")}
    </p>
  );
}

function PartCard({ claim, index, sources, conflicts }: {
  claim: InvestigationClaim;
  index: number;
  sources: InvestigationSource[];
  conflicts: InvestigationConflict[];
}) {
  const label = claimLabel(claim);
  const items = useMemo(() => claimSourceRelations(claim, index + 1, sources), [claim, index, sources]);
  // 没有整截理由时用依据里的概括（和进度页同一个来源）：依据列表挪进了抽屉，这里不能只剩一个引用。
  const finding = claim.evidence.find((link) => link.finding?.trim())?.finding?.trim();
  const reason = withoutReferenceMarkers(claim.reason?.trim() || finding || CHECKABILITY_HINT[claim.checkability]);
  const boundary = claim.boundary?.trim() ?? "";
  const claimConflicts = conflicts.filter((conflict) => conflict.claimId === claim.id);
  return (
    <article className="gp-part" data-gp-claim-id={claim.id}>
      <div className="gp-part-head">
        <span>{journeyCopy.partHeading(index + 1)}</span>
        <span className={`gp-label gp-label--${label ? LABEL_TONE[label] : "muted"}`} data-gp-claim-label={label ?? undefined}>
          {label ? LABEL_TEXT[label] : journeyCopy.partInterrupted}
        </span>
      </div>
      <h3 className="gp-part-text" data-gp-part-text>{claim.text}</h3>
      {reason || items.length > 0 ? (
        <p className="gp-part-reason">
          <span data-gp-claim-reason={claim.reason ? "" : undefined}>{reason}</span>
          <SourceCitation items={items} />
        </p>
      ) : null}
      {claimConflicts.map((conflict) => (
        <p key={conflict.id} className="gp-part-note gp-part-conflict" data-gp-part-conflict>
          <Icon name="split" /><span>{conflictText(conflict, sources)}</span>
        </p>
      ))}
      {claim.gaps.filter((gap) => gap.status === "open").map((gap) => (
        <p key={gap.id} className="gp-part-note gp-part-gap" data-gp-part-gap>
          <Icon name="circle-alert" /><span>{journeyCopy.gapLine(withoutReferenceMarkers(gap.description))}</span>
        </p>
      ))}
      {boundary ? (
        <p className="gp-part-note gp-part-boundary" data-gp-part-boundary>
          <Icon name="info" /><span>{journeyCopy.boundaryLine(withoutReferenceMarkers(boundary))}</span>
        </p>
      ) : null}
    </article>
  );
}

function conflictText(conflict: InvestigationConflict, sources: InvestigationSource[]): string {
  if (conflict.reasonStatus === "known" && conflict.reason?.trim()) {
    return withoutReferenceMarkers(`${conflict.summary} ${conflict.reason}`);
  }
  const side = (position: "support" | "contradict") => {
    const entry = conflict.sides.find((item) => item.position === position);
    const publishers = sources.filter((source) => entry?.sourceIds.includes(source.id)).map(publisherOf);
    return publishers.length > 0 ? { publisher: publishers.join("、"), summary: withoutReferenceMarkers(entry?.summary ?? "") } : undefined;
  };
  return journeyCopy.conflictLine(side("support"), side("contradict"));
}

export function EvidenceRow({ claimId, link, source }: { claimId: string; link: InvestigationEvidenceLink; source: InvestigationSource }) {
  // 引文只保证出自这条依据实际取得的文字；摘要不能冒充网页正文。
  return <EvidenceProvenance claimId={claimId} link={link} source={source} />;
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
      <div className="gp-result-ask-box">
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
              rows={2}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="针对这份调查继续问…"
              aria-label="针对这份调查继续问"
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
      </div>
    </section>
  );
}

/** ①…⑳，再往后用数字。 */
function partNumber(index: number): string {
  return index < 20 ? String.fromCharCode(0x2460 + index) : `${index + 1}.`;
}

function checkedDay(iso: string | undefined): string {
  if (!iso) return "";
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const d = new Date(time);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
