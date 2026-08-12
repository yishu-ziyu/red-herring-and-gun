/**
 * ThinkingReasoning — per-agent reasoning reveal (process chrome, not personhood).
 *
 * Driven only by real agent_thought sentences from the stream.
 * Does not invent text or fake delays when sentences arrive from the backend.
 * Backend may pace SSE; this UI reveals whatever has arrived so far.
 * Copy avoids anthropomorphic "I am thinking" framing (DESIGN v0.7).
 */
import { useEffect, useRef, useState } from "react";
import { formatThoughtElapsedLabel } from "../../../../lib/reasoningThoughts";
import styles from "./ThinkingReasoning.module.css";

// Geometry — keep in sync with ThinkingReasoning.module.css
const SENT_H = 40; // 2 lines × 20px
const GAP = 4;
const MAX_H = 180;
const FADE = 16;
const COLLAPSE_BEAT = 360;

export interface ThinkingReasoningProps {
  /** Real reasoning sentences from agent_thought (ordered). */
  sentences: string[];
  /** True while this agent step is still loading. */
  thinking: boolean;
  /** Wall-clock ms for "推理用时 Ns" (from agent latency / stream timestamps). */
  elapsedMs?: number;
  className?: string;
}

export function ThinkingReasoning({
  sentences,
  thinking,
  elapsedMs,
  className,
}: ThinkingReasoningProps) {
  const done = !thinking;
  const [open, setOpen] = useState(false);
  const [collapseReady, setCollapseReady] = useState(done);
  const [fade, setFade] = useState({ top: false, bottom: true });
  const viewportRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // When thinking finishes, wait a short beat then allow fold (matches design).
  useEffect(() => {
    if (thinking) {
      setCollapseReady(false);
      setOpen(false);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setCollapseReady(true);
      return;
    }
    const t = setTimeout(() => setCollapseReady(true), COLLAPSE_BEAT);
    return () => clearTimeout(t);
  }, [thinking]);

  // Auto-scroll stream to newest sentence while thinking (not user-scroll mode).
  useEffect(() => {
    if (!thinking) return;
    const count = sentences.length;
    if (count <= prevCountRef.current) {
      prevCountRef.current = count;
      return;
    }
    prevCountRef.current = count;
  }, [sentences.length, thinking]);

  const count = sentences.length;
  if (!thinking && count === 0) return null;

  // Stay expanded until collapse beat finishes after done.
  const visuallyExpanded = done ? (collapseReady ? open : true) : true;

  const contentH = count > 0 ? count * SENT_H + (count - 1) * GAP : 0;
  const capped = contentH > MAX_H;
  const viewH = count === 0 ? 0 : capped ? MAX_H : contentH;
  const scrollable = done && open;
  const translate = scrollable ? 0 : capped ? MAX_H - FADE - contentH : 0;

  const showTop = scrollable ? fade.top : capped;
  const showBottom = scrollable ? fade.bottom : capped;
  const mask = capped
    ? `linear-gradient(to bottom, transparent 0, #000 ${showTop ? FADE : 0}px, #000 calc(100% - ${showBottom ? FADE : 0}px), transparent 100%)`
    : "none";

  const onScroll = () => {
    const el = viewportRef.current;
    if (!el) return;
    setFade({
      top: el.scrollTop > 1,
      bottom: el.scrollTop + el.clientHeight < el.scrollHeight - 1,
    });
  };

  const toggle = () => {
    if (!done || !collapseReady) return;
    const next = !open;
    if (next) {
      setFade({ top: false, bottom: true });
      if (viewportRef.current) viewportRef.current.scrollTop = 0;
    }
    setOpen(next);
  };

  const phase = thinking || !collapseReady ? "thinking" : "done";
  const elapsedLabel = formatThoughtElapsedLabel(elapsedMs);

  return (
    <div
      className={[styles.tr, className].filter(Boolean).join(" ")}
      data-phase={phase}
      data-thinking={thinking ? "1" : "0"}
    >
      <button
        type="button"
        className={styles.trHeader + (done && collapseReady ? " " + styles.isClickable : "")}
        aria-expanded={visuallyExpanded}
        aria-label={thinking ? "模型推理进行中" : "切换推理记录"}
        onClick={done && collapseReady ? toggle : undefined}
      >
        {done && collapseReady ? (
          <span className={styles.trLabel}>
            推理用时 <span className={styles.trVerb}>{elapsedLabel}</span>
          </span>
        ) : (
          <span className={styles.trLabel + " " + styles.trShimmer}>整理推理…</span>
        )}
        {done && collapseReady ? (
          <svg
            className={styles.trChevron}
            viewBox="0 0 24 24"
            width="12"
            height="12"
            aria-hidden="true"
          >
            <path
              d="m4.5 15.75 7.5-7.5 7.5 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
      </button>

      <div
        className={
          styles.trCollapsible + (visuallyExpanded ? "" : " " + styles.isCollapsed)
        }
      >
        <div className={styles.trInner}>
          <div
            ref={viewportRef}
            className={styles.trViewport + (scrollable ? " " + styles.isScroll : "")}
            style={{
              height: `${viewH}px`,
              WebkitMaskImage: mask,
              maskImage: mask,
            }}
            onScroll={scrollable ? onScroll : undefined}
          >
            <div
              className={styles.trStream}
              style={{ transform: `translateY(${translate}px)` }}
            >
              {sentences.slice(0, count).map((line, i) => (
                <p key={`${i}-${line.slice(0, 24)}`} className={styles.trSentence}>
                  {line}
                </p>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
