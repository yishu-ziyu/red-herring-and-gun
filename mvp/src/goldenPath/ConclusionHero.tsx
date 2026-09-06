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
    <header className="gp-hero" aria-label="调查结论" data-gp-conclusion-judgment={judgment}>
      <div className="gp-hero-kicker">
        <span className="gp-hero-kicker-label">调查结论</span>
        <span className="gp-hero-kicker-sep" aria-hidden="true">·</span>
        <span className="gp-hero-lead">{HERO_LEAD[judgment]}</span>
      </div>
      <h2 className="gp-hero-answer" data-gp-direct-answer>{directAnswer}</h2>
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
          <span className="gp-hero-boundary-title">{copy.boundaryLabel}</span>
          <ul className="gp-hero-boundary-list">
            {boundaries.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </header>
  );
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return iso;
  }
}
