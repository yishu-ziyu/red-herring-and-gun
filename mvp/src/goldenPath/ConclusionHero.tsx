/**
 * ConclusionHero — 完成态文稿 lede（Issue #64）。
 * 第一视觉层级是 conclusion.directAnswer；kicker / judgment / 计数 / 时间降为弱 metadata。
 * 动效由外层 persistent region 的 emergence 承担，这里不抢焦点、不滚动。
 */
import { motion, useReducedMotion } from "framer-motion";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { JUDGMENT_LABEL } from "./snapshotUi";

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
};

/** 320ms，落在 Issue #64 的 260–420ms，对应 --gp-motion-emerge。 */
const EMERGE_S = 0.32;
const EMERGE_EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const ANSWER_Y = 8;

export function ConclusionHero({ directAnswer, verdictLead, rationale, judgment, boundaries, claimCount, sourceCount, checkedAt }: ConclusionHeroProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const reduce = Boolean(useReducedMotion());
  const lead = verdictLead && verdictLead.trim() ? verdictLead : directAnswer;
  const explanation = verdictLead && verdictLead.trim() && rationale && rationale.trim() ? rationale : "";

  return (
    <motion.header
      className="gp-hero"
      aria-label="调查结论"
      data-gp-conclusion-judgment={judgment}
      initial={reduce ? false : { height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      transition={{ duration: reduce ? 0 : EMERGE_S, ease: EMERGE_EASE }}
    >
      <div className="gp-hero-inner">
        <motion.p
          className="gp-hero-answer"
          data-gp-direct-answer
          initial={reduce ? false : { y: ANSWER_Y, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: reduce ? 0 : EMERGE_S, ease: EMERGE_EASE }}
        >
          {lead}
        </motion.p>
        {explanation ? (
          <p className="gp-hero-rationale" data-gp-rationale>
            {explanation}
          </p>
        ) : null}
        {judgment === "unresolved" ? (
          <p className="gp-hero-uncertainty" data-gp-uncertainty>
            {copy.uncertaintyLine}
          </p>
        ) : null}
        <div className="gp-hero-meta">
          <span className="gp-hero-judgment" data-gp-judgment={judgment}>
            {JUDGMENT_LABEL[judgment]}
          </span>
          <span className="gp-hero-meta-item" data-gp-hero-meta="claims">{copy.claimCount(claimCount)}</span>
          <span className="gp-hero-meta-item" data-gp-hero-meta="sources">{copy.sourceCount(sourceCount)}</span>
          {checkedAt ? <span className="gp-hero-meta-item" data-gp-hero-meta="time">{copy.checkedAt(formatTime(checkedAt))}</span> : null}
        </div>
        {boundaries.length > 0 ? (
          <div className="gp-hero-boundaries" data-gp-boundaries>
            <ul className="gp-hero-boundary-list">
              {boundaries.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>
        ) : null}
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
