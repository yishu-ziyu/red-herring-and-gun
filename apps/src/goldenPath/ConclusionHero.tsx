/**
 * ConclusionHero — 完成态文稿 lede（Issue #64）。
 * 第一视觉层级是 conclusion.directAnswer；kicker / judgment / 计数 / 时间降为弱 metadata。
 * 动效由外层 persistent region 的 emergence 承担，这里不抢焦点、不滚动。
 */
import { useState, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { JUDGMENT_LABEL, ROLE_LABEL, attachmentsForSource, pickDecisiveEvidence } from "./snapshotUi";
import { scrubFaceText } from "./scrubFace";
import { displayFollowUpClaim } from "../lib/composeFollowUpClaim";
import { PromptKitSource } from "./PromptKitSource";
import type { InvestigationEvidenceLink, InvestigationSource, InvestigationClaim } from "../lib/investigation";

const BREAK_DELIMS = /([、，。；：！？!?,.;:「」])/;

/** 结论断言按中文标点与引号拆成可换行的段（分隔符留在前一段末尾）：换行只发生在标点/引文边界，不在词中间。 */
export function answerBreakSegments(text: string): string[] {
  const pieces = text.split(BREAK_DELIMS);
  const segments: string[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const segment = (pieces[i] ?? "") + (pieces[i + 1] ?? "");
    if (segment) segments.push(segment);
  }
  return segments;
}

/** 短段（去掉标点引号空白后 ≤ maxCore 个实义字）锁为不换行，避免引文在词中间断行；长段保持可断，防止溢出。 */
export function isShortSegment(segment: string, maxCore = 12): boolean {
  const core = segment.replace(/[、，。；：！？!?,.;:「」\s]/gu, "");
  return [...core].length <= maxCore;
}

type ConclusionHeroProps = {
  directAnswer: string;
  /** 第一句判断句（含结尾标点）。缺失/为空时回退到 directAnswer 单层渲染。 */
  verdictLead?: string;
  /** 判断句之后的解释文本；缺失时不渲染解释层。 */
  rationale?: string;
  judgment: "supported" | "refuted" | "mixed" | "unresolved" | "not-applicable";
  boundaries: string[];
  claimCount: number;
  sourceCount: number;
  checkedAt?: string;
  originalClaim?: string;
  sources?: InvestigationSource[];
  claims?: InvestigationClaim[];
  leftoverNote?: string;
  gapNotes?: string[];
  onSelectSource?: (link: InvestigationEvidenceLink, source: InvestigationSource, claimId: string, trigger: HTMLElement) => void;
};

/** 320ms，落在 Issue #64 的 260–420ms，对应 --gp-motion-emerge。 */
const EMERGE_S = 0.32;
const EMERGE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const ANSWER_Y = 8;

export function ConclusionHero({
  directAnswer,
  verdictLead,
  rationale,
  judgment,
  boundaries,
  claimCount,
  sourceCount,
  checkedAt,
  originalClaim,
  sources = [],
  claims = [],
  leftoverNote = "",
  gapNotes = [],
  onSelectSource,
}: ConclusionHeroProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const reduce = Boolean(useReducedMotion());
  /** 完成态默认折叠：桌面展开成墙会把直答压到折页下面（走查 step-a-04 / step-b-03）。 */
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const rawLead = verdictLead && verdictLead.trim() ? verdictLead : directAnswer;
  const lead = scrubFaceText(rawLead) || rawLead;

  const explanation =
    verdictLead && verdictLead.trim() && rationale && rationale.trim() ? scrubFaceText(rationale) : "";

  const sourceRows = useMemo(
    () =>
      sources.map((source) => {
        const attachments = attachmentsForSource(source.id, claims);
        const seen = new Set<string>();
        const associated = attachments
          .filter((row) => {
            if (seen.has(row.claim.id)) return false;
            seen.add(row.claim.id);
            return true;
          })
          .map((row) => row.claim);
        return { source, attachments, associated };
      }),
    [sources, claims],
  );
  const keyEvidence = useMemo(() => pickDecisiveEvidence(claims, sources), [claims, sources]);
  const leadGaps = gapNotes.map((note) => note.trim()).filter(Boolean);
  const showGapLead = Boolean(leftoverNote.trim()) || leadGaps.length > 0 || judgment === "unresolved";

  const handleSelectSource = (
    link: InvestigationEvidenceLink,
    source: InvestigationSource,
    claimId: string,
    trigger: HTMLElement
  ) => {
    if (onSelectSource) {
      onSelectSource(link, source, claimId, trigger);
    } else if (source.url) {
      window.open(source.url, "_blank", "noreferrer");
    }
  };

  return (
    <motion.header
      className="gp-hero"
      aria-label="调查结论"
      data-gp-conclusion-judgment={judgment}
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : EMERGE_S, ease: EMERGE_EASE }}
    >
      <div className="gp-hero-inner">
        {/* 1. 核查原问题（对齐 ChatGPT 提示泡泡） */}
        {originalClaim ? (
          <div className="gp-hero-query" data-gp-hero-query>
            <span className="gp-hero-query-badge">待核查说法</span>
            <span className="gp-hero-query-text">“{displayFollowUpClaim(originalClaim)}”</span>
          </div>
        ) : null}

        {/* 2. 核心断言：必须先于来源胶囊，直答不被墙挡住 */}
        <motion.p
          className="gp-hero-answer"
          data-gp-direct-answer
          initial={reduce ? false : { y: ANSWER_Y, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: reduce ? 0 : EMERGE_S, ease: EMERGE_EASE }}
        >
          {answerBreakSegments(lead).map((segment, index) => (
            <span key={index} className={isShortSegment(segment) ? "is-nowrap" : undefined}>
              {segment}
            </span>
          ))}
        </motion.p>

        {/* 3. 理由与解释：跟直答同一口气，不插到关键依据后面 */}
        {explanation ? (
          <p className="gp-hero-rationale" data-gp-rationale>
            {explanation}
          </p>
        ) : null}

        {/* 4. 1–3 条决定性依据；没有就不凑相关材料 */}
        {keyEvidence.length > 0 ? (
          <div className="gp-hero-key-evidence" data-gp-key-evidence>
            <p className="gp-hero-key-label">关键依据</p>
            {keyEvidence.map((row) => {
              const proves =
                scrubFaceText(row.link.finding ?? "") || `${ROLE_LABEL[row.link.role]}：「${row.claimText}」`;
              const sourceTitle = row.source.title || row.source.url || row.source.id;
              return (
                <button
                  key={`${row.claimId}:${row.link.sourceId}:${row.link.role}`}
                  type="button"
                  className="gp-hero-key-item"
                  data-gp-key-evidence-item
                  data-gp-key-claim-id={row.claimId}
                  data-gp-source-id={row.source.id}
                  onClick={(event) => handleSelectSource(row.link, row.source, row.claimId, event.currentTarget)}
                >
                  <span className="gp-hero-key-proves">{proves}</span>
                  <span className="gp-hero-key-meta">
                    {ROLE_LABEL[row.link.role]} · {sourceTitle}
                  </span>
                </button>
              );
            })}
          </div>
        ) : null}

        {/* 5. 仍未查清 */}
        {showGapLead ? (
          <div className="gp-hero-gaps-lead" data-gp-gaps-lead>
            {leftoverNote.trim() ? (
              <p className="gp-note" data-gp-leftover-gap>
                {leftoverNote}
              </p>
            ) : null}
            {leadGaps.map((note) => (
              <p key={note} className="gp-note" data-gp-gap-status="open">
                {note}
              </p>
            ))}
            {judgment === "unresolved" ? (
              <p className="gp-hero-uncertainty" data-gp-uncertainty>
                {copy.uncertaintyLine}
              </p>
            ) : null}
          </div>
        ) : null}

        {/* 6. 适用边界 */}
        {boundaries.length > 0 ? (
          <div className="gp-hero-boundaries" data-gp-boundaries>
            {boundaries.map((b, index) => (
              <p key={b} className="gp-hero-boundary-line">
                {index === 0 ? <span className="gp-hero-boundary-label">适用边界</span> : null}
                {b}
              </p>
            ))}
          </div>
        ) : null}

        {/* 7. 来源目录：折在边界之后，首屏不是胶囊墙 */}
        {sources.length > 0 ? (
          <div className="gp-hero-sources-strip" data-gp-sources-strip>
            <button
              type="button"
              className="gp-hero-sources-toggle"
              onClick={() => setSourcesExpanded(!sourcesExpanded)}
              aria-expanded={sourcesExpanded}
            >
              <span className="gp-hero-sources-icon" aria-hidden="true">
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <circle cx="8" cy="8" r="6" />
                  <path d="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12" />
                </svg>
              </span>
              <span className="gp-hero-sources-label">{copy.collectedSources(sources.length)}</span>
              <svg
                className={`gp-hero-sources-chevron ${sourcesExpanded ? "is-expanded" : ""}`}
                viewBox="0 0 16 16"
                width="12"
                height="12"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="m4 6 4 4 4-4" />
              </svg>
            </button>
            {sourcesExpanded ? (
              <div className="gp-hero-sources-list">
                {sourceRows.map(({ source, attachments, associated }, idx) => {
                  const primary = attachments[0];
                  return (
                    <div key={source.id || idx} className="gp-hero-source-item" data-gp-hero-source={source.id}>
                      {primary ? (
                        <PromptKitSource
                          link={primary.link}
                          source={source}
                          claimId={primary.claim.id}
                          onSelect={handleSelectSource}
                        />
                      ) : (
                        <span className="gp-hero-source-unlinked" data-gp-source-unlinked>
                          {source.title || source.url || source.id}
                          {source.url ? ` ${source.url}` : ""}
                        </span>
                      )}
                      {associated.length > 0 ? (
                        <p className="gp-source-claims" data-gp-source-claims>
                          关联命题：{associated.map((claim) => claim.text).join("；")}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 7. 元信息行（判断标签 + 计数 + 查验时间） */}
        <p className="gp-hero-meta">
          <span className="gp-hero-judgment" data-gp-judgment={judgment}>
            {JUDGMENT_LABEL[judgment]}
          </span>
          <span className="gp-hero-meta-item" data-gp-hero-meta="claims">{copy.claimCount(claimCount)}</span>
          <span className="gp-hero-meta-item" data-gp-hero-meta="sources">{copy.sourceCount(sourceCount)}</span>
          {checkedAt ? <span className="gp-hero-meta-item" data-gp-hero-meta="time">{copy.checkedAt(formatTime(checkedAt))}</span> : null}
        </p>
      </div>
    </motion.header>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}

