/** 完成态总答。逐条引句与出处由 ResultClaim 紧接着展示。 */
import { motion, useReducedMotion } from "framer-motion";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { JUDGMENT_LABEL } from "./snapshotUi";
import { scrubBoundaryText, scrubFaceText } from "./scrubFace";

const BREAK_DELIMS = /([、，。；：！？!?,.;:「」])/;

export function answerBreakSegments(text: string): string[] {
  const pieces = text.split(BREAK_DELIMS);
  const segments: string[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const segment = (pieces[i] ?? "") + (pieces[i + 1] ?? "");
    if (segment) segments.push(segment);
  }
  return segments;
}

export function isShortSegment(segment: string, maxCore = 12): boolean {
  const core = segment.replace(/[、，。；：！？!?,.;:「」\s]/gu, "");
  return [...core].length <= maxCore;
}

type ConclusionHeroProps = {
  directAnswer: string;
  verdictLead?: string;
  rationale?: string;
  judgment: "supported" | "refuted" | "mixed" | "disputed" | "unresolved" | "not-applicable";
  boundaries: string[];
  checkedAt?: string;
  leftoverNote?: string;
};

const EMERGE_S = 0.32;
const EMERGE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

export function ConclusionHero({ directAnswer, verdictLead, rationale, judgment, boundaries, checkedAt, leftoverNote = "" }: ConclusionHeroProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const reduce = Boolean(useReducedMotion());
  const rawLead = verdictLead?.trim() || directAnswer;
  const lead = scrubFaceText(rawLead) || rawLead;
  const explanation = verdictLead?.trim() && rationale?.trim() ? scrubFaceText(rationale) : "";
  const visibleBoundaries = boundaries.map(scrubBoundaryText).filter(Boolean);

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
        <p className="gp-hero-answer" data-gp-direct-answer>
          {answerBreakSegments(lead).map((segment, index) => <span key={index} className={isShortSegment(segment) ? "is-nowrap" : undefined}>{segment}</span>)}
        </p>
        {explanation ? <p className="gp-hero-rationale" data-gp-rationale>{explanation}</p> : null}
        {leftoverNote.trim() || judgment === "unresolved" ? (
          <div className="gp-hero-gaps-lead" data-gp-gaps-lead>
            {leftoverNote.trim() ? <p className="gp-note" data-gp-leftover-gap>{leftoverNote}</p> : null}
            {judgment === "unresolved" ? <p className="gp-hero-uncertainty" data-gp-uncertainty>{copy.uncertaintyLine}</p> : null}
          </div>
        ) : null}
        {visibleBoundaries.length > 0 ? (
          <div className="gp-hero-boundaries" data-gp-boundaries>
            {visibleBoundaries.map((boundary, index) => <p key={boundary} className="gp-hero-boundary-line">{index === 0 ? <span className="gp-hero-boundary-label">适用边界</span> : null}{boundary}</p>)}
          </div>
        ) : null}
        <p className="gp-hero-meta">
          <span className="gp-hero-judgment" data-gp-judgment={judgment}>{JUDGMENT_LABEL[judgment]}</span>
          {checkedAt ? <span className="gp-hero-meta-item" data-gp-hero-meta="time">{copy.checkedAt(formatTime(checkedAt))}</span> : null}
        </p>
      </div>
    </motion.header>
  );
}

function formatTime(iso: string): string {
  const time = Date.parse(iso);
  return Number.isNaN(time) ? iso : new Date(time).toLocaleString("zh-CN", { hour12: false });
}
