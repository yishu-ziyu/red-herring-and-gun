/**
 * ConclusionHero — 完成态第一视觉层级（Issue #52 第五节）。
 * 第一句是 conclusion.directAnswer（对原句的直接回答），
 * 不是 0–100 分、不是内部 verdict 四字章；判词只作次级信号。
 */
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { JUDGMENT_LABEL, JUDGMENT_TONE } from "./snapshotUi";

type ConclusionHeroProps = {
  directAnswer: string;
  judgment: "supported" | "refuted" | "mixed" | "unresolved" | "not-applicable";
  boundaries: string[];
  claimCount: number;
  sourceCount: number;
  checkedAt?: string;
};

const HERO_LEAD: Record<ConclusionHeroProps["judgment"], string> = {
  supported: "调查完成",
  refuted: "调查完成",
  mixed: "调查完成",
  unresolved: "调查完成，证据还不够下强结论",
  "not-applicable": "调查完成",
};

export function ConclusionHero({ directAnswer, judgment, boundaries, claimCount, sourceCount, checkedAt }: ConclusionHeroProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  return (
    <section className="gp-hero" aria-label="调查结论" data-gp-conclusion-judgment={judgment}>
      <div className="gp-hero-main">
        <span className="gp-hero-lead">
          <span className="gp-hero-check" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M4 10.5 8.2 14.5 16 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          {HERO_LEAD[judgment]}
        </span>
        <p className="gp-hero-answer" data-gp-direct-answer>{directAnswer}</p>
      </div>
      <div className="gp-hero-meta">
        <span className={`gp-chip gp-chip--${JUDGMENT_TONE[judgment]}`} data-gp-judgment={judgment}>
          {JUDGMENT_LABEL[judgment]}
        </span>
        <span className="gp-hero-meta-item">{copy.claimCount(claimCount)}</span>
        <span className="gp-hero-meta-item">{copy.sourceCount(sourceCount)}</span>
        {checkedAt ? <span className="gp-hero-meta-item">{copy.checkedAt(formatTime(checkedAt))}</span> : null}
      </div>
      {boundaries.length > 0 ? (
        <div className="gp-hero-boundaries">
          <strong>{copy.boundaryLabel}</strong>
          <ul>
            {boundaries.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
