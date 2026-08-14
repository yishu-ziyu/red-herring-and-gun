/**
 * InlineCitations — [n] chips bound to ordered sources + interactive source list.
 *
 * Contract: refs[i].n === i+1 and matches sources[i] after server/client binding.
 * Click chip → highlight footer row; expand row for snippet.
 */

import { useCallback, useId, useMemo, useState } from "react";
import styles from "./InlineCitations.module.css";
import {
  buildCiteRefs,
  type CiteRef,
  type CiteSource,
} from "../../lib/citationBinding";

export type { CiteRef, CiteSource };
export {
  hostFromUrl,
  buildCiteRefs,
  buildGlobalSources,
  sourcesFromStringRefs,
  clampMarkersToSources,
  stripCitationMarkers,
} from "../../lib/citationBinding";

/** @deprecated prefer buildCiteRefs; kept for call sites that only need numbered footer */
export function toCiteRefs(
  sources: Array<{ title?: string; url: string; snippet?: string }>
): CiteRef[] {
  return buildCiteRefs("", sources).refs;
}

export function toCiteRefsFromStrings(sourceRefs: string[]): CiteRef[] {
  return buildCiteRefs(
    "",
    sourceRefs
      .map((raw) => {
        const s = raw.trim();
        if (!/^https?:\/\//i.test(s)) return null;
        return { url: s, title: "" };
      })
      .filter((row): row is { url: string; title: string } => Boolean(row))
  ).refs;
}

function CiteArrow() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
    </svg>
  );
}

export function InlineCitations({
  text,
  sources,
  refs: refsProp,
  relatedOnly = false,
  className = "",
  footerLabel,
}: {
  text: string;
  /** Preferred: raw sources; numbers assigned 1..N after dedupe */
  sources?: CiteSource[];
  /** Optional pre-built refs (must already match text markers) */
  refs?: CiteRef[];
  /** Retrieval fill only — strip markers, label footer as 相关检索 */
  relatedOnly?: boolean;
  className?: string;
  footerLabel?: string;
}) {
  const reactId = useId();
  const [activeN, setActiveN] = useState<number | null>(null);
  const [expandedN, setExpandedN] = useState<number | null>(null);

  const { text: safeText, refs } = useMemo(() => {
    if (refsProp && refsProp.length > 0 && !sources) {
      return {
        text: relatedOnly
          ? text.replace(/\[\d+\]/g, "").replace(/[ \t]{2,}/g, " ").trim()
          : text,
        refs: refsProp,
      };
    }
    return buildCiteRefs(text, sources ?? [], { relatedOnly });
  }, [text, sources, refsProp, relatedOnly]);

  const parts = useMemo(() => safeText.split(/(\[\d+\])/g), [safeText]);
  const hasMarkers = parts.some((part) => /^\[\d+\]$/.test(part));
  const showFooter = refs.length > 0;
  const defaultFooterLabel = relatedOnly
    ? "相关检索（未写入句内引用）"
    : hasMarkers
      ? "引用与来源"
      : "来源";

  const focusRef = useCallback((n: number) => {
    setActiveN(n);
    setExpandedN(n);
    const el = document.getElementById(`${reactId}-ref-${n}`);
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [reactId]);

  if (!safeText && !showFooter) return null;

  return (
    <div className={`${styles.citeProse}${className ? ` ${className}` : ""}`.trim()}>
      {safeText ? (
        <p>
          {hasMarkers
            ? parts.map((part, i) => {
                const m = part.match(/^\[(\d+)\]$/);
                if (!m) return <span key={i}>{part}</span>;
                const n = Number(m[1]);
                const r = refs.find((x) => x.n === n);
                if (!r) {
                  return (
                    <span key={i} className={styles.citeMarkMuted} title="来源已过滤">
                      {n}
                    </span>
                  );
                }
                return (
                  <span key={i} className={styles.citeTip}>
                    <a
                      className={`${styles.citeMark}${activeN === n ? ` ${styles.citeMarkActive}` : ""}`}
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={`来源 ${n}：${r.label}`}
                      aria-describedby={`${reactId}-ref-${n}`}
                      onClick={(e) => {
                        // Primary: jump to footer row; second click / modifier still opens tab via default if needed
                        if (!e.metaKey && !e.ctrlKey) {
                          e.preventDefault();
                          focusRef(n);
                        }
                      }}
                      onMouseEnter={() => setActiveN(n)}
                      onFocus={() => setActiveN(n)}
                    >
                      {r.n}
                    </a>
                    <span className={styles.citeTipBox} role="tooltip">
                      {r.label}
                      {r.host ? ` · ${r.host}` : ""}
                    </span>
                  </span>
                );
              })
            : safeText}
        </p>
      ) : null}

      {showFooter ? (
        <div className={styles.citeFooter} role="list" aria-label={footerLabel || defaultFooterLabel}>
          <div className={styles.citeFooterHead}>{footerLabel || defaultFooterLabel}</div>
          {refs.map((r) => {
            const open = expandedN === r.n;
            const active = activeN === r.n;
            return (
              <div
                key={r.n}
                id={`${reactId}-ref-${r.n}`}
                role="listitem"
                className={`${styles.citeRefRow}${active ? ` ${styles.citeRefRowActive}` : ""}${
                  r.cited ? ` ${styles.citeRefRowCited}` : ""
                }`}
              >
                <a
                  className={styles.citeRef}
                  href={r.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onMouseEnter={() => setActiveN(r.n)}
                  onFocus={() => setActiveN(r.n)}
                >
                  <span className={styles.citeMark}>{r.n}</span>
                  <span className={styles.citeRefLabel}>{r.label}</span>
                  <span className={styles.citeSep}>·</span>
                  <span className={styles.citeRefHost}>{r.host}</span>
                  <span className={styles.citeArrow} aria-hidden>
                    <CiteArrow />
                  </span>
                </a>
                {r.snippet ? (
                  <button
                    type="button"
                    className={styles.citeSnippetToggle}
                    aria-expanded={open}
                    onClick={() => setExpandedN(open ? null : r.n)}
                  >
                    {open ? "收起摘要" : "查看摘要"}
                  </button>
                ) : null}
                {open && r.snippet ? <p className={styles.citeSnippet}>{r.snippet}</p> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
