/**
 * ConclusionHero — 完成态文稿 lede（Issue #64）。
 * 第一视觉层级是 conclusion.directAnswer；kicker / judgment / 计数 / 时间降为弱 metadata。
 * 动效由外层 persistent region 的 emergence 承担，这里不抢焦点、不滚动。
 */
import { useState, useMemo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { JUDGMENT_LABEL } from "./snapshotUi";
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
  onSelectSource,
}: ConclusionHeroProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const reduce = Boolean(useReducedMotion());
  /** 完成态默认折叠：桌面展开成墙会把直答压到折页下面（走查 step-a-04 / step-b-03）。 */
  const [sourcesExpanded, setSourcesExpanded] = useState(false);

  const rawLead = verdictLead && verdictLead.trim() ? verdictLead : directAnswer;
  let lead = scrubFaceText(rawLead) || rawLead;
  if (lead.trim() === "这句话里有站住的部分，也有没站住的部分。") {
    lead = "原句混淆了事实与推论：部分细节属实，但核心断言不能成立。";
  }

  const explanation =
    verdictLead && verdictLead.trim() && rationale && rationale.trim() ? scrubFaceText(rationale) : "";

  // 映射各 sourceId 对应的核查立场，用于 PromptKitSource 徽标与染色
  const sourceRoles = useMemo(() => {
    const map = new Map<string, InvestigationEvidenceLink["role"]>();
    for (const claim of claims) {
      for (const link of claim.evidence ?? []) {
        if (!map.has(link.sourceId)) {
          map.set(link.sourceId, link.role);
        }
      }
    }
    return map;
  }, [claims]);

  const firstClaimId = claims[0]?.id ?? "claim-1";

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

        {/* 3. 来源条：默认折叠，挂在结论第一句下面 */}
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
              <span className="gp-hero-sources-label">已查验 {sources.length} 个信息来源</span>
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
                {sources.map((srcItem, idx) => {
                  const role = sourceRoles.get(srcItem.id) ?? "unassessed";
                  const link: InvestigationEvidenceLink = {
                    sourceId: srcItem.id,
                    role,
                  };
                  return (
                    <PromptKitSource
                      key={srcItem.id || idx}
                      link={link}
                      source={srcItem}
                      claimId={firstClaimId}
                      onSelect={handleSelectSource}
                    />
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 4. 理由与解释 */}
        {explanation ? (
          <p className="gp-hero-rationale" data-gp-rationale>
            {explanation}
          </p>
        ) : null}

        {/* 5. 存疑说明 */}
        {judgment === "unresolved" ? (
          <p className="gp-hero-uncertainty" data-gp-uncertainty>
            {copy.uncertaintyLine}
          </p>
        ) : null}

        {/* 6. 适用边界与安全提醒（安静脚注：顶线 + 小灰标签，无卡片无图标） */}
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

