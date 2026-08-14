/**
 * ThinkingReasoning — 思考折页。几何和收折节奏来自仓库里那份原型
 * （流式句子、180 上限、查完自动折上）。
 *
 * 句子只来自真实 agent_thought，不编 jwt.verify 那类演示稿。
 * 思考中默认展开，点标题可折上；查完自动折上，再点可回看。
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
  /** Wall-clock ms for "思考已完成 · Ns". */
  elapsedMs?: number;
  className?: string;
  /** thread = 核查页主折页（占位高度按原型）；inline = 嵌在步骤里 */
  layout?: "inline" | "thread";
}

function Chevron() {
  return (
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
  );
}

export function ThinkingReasoning({
  sentences,
  thinking,
  elapsedMs,
  className,
  layout = "inline",
}: ThinkingReasoningProps) {
  const done = !thinking;
  const [open, setOpen] = useState(thinking);
  const [collapseReady, setCollapseReady] = useState(done);
  const [fade, setFade] = useState({ top: false, bottom: true });
  const viewportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (thinking) {
      setOpen(true);
      setCollapseReady(true);
      return;
    }
    if (!open) {
      setCollapseReady(true);
      return;
    }
    setOpen(false);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      setCollapseReady(true);
      return;
    }
    setCollapseReady(false);
    const t = setTimeout(() => setCollapseReady(true), COLLAPSE_BEAT);
    return () => clearTimeout(t);
    // Only react to the thinking → done edge. `open` is user state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thinking]);

  const count = sentences.length;
  const visuallyExpanded = thinking ? open : collapseReady ? open : true;
  const clickable = thinking ? count > 0 : collapseReady;

  useEffect(() => {
    if (!thinking || !visuallyExpanded) return;
    const el = viewportRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [thinking, visuallyExpanded, sentences]);

  if (layout !== "thread" && !thinking && count === 0) return null;

  const contentH = count > 0 ? count * SENT_H + (count - 1) * GAP : 0;
  const capped = contentH > MAX_H;
  const viewH = count === 0 ? 0 : thinking && visuallyExpanded ? MAX_H : capped ? MAX_H : contentH;
  const scrollable = (done && open) || (thinking && visuallyExpanded && count > 0);
  const translate = thinking || scrollable ? 0 : capped ? MAX_H - FADE - contentH : 0;

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
    if (!clickable) return;
    const next = !visuallyExpanded;
    setCollapseReady(true);
    setOpen(next);
    if (next) {
      setFade({ top: false, bottom: true });
      if (viewportRef.current) {
        viewportRef.current.scrollTop = thinking ? viewportRef.current.scrollHeight : 0;
      }
    }
  };

  const phase = thinking || !collapseReady ? "thinking" : "done";
  const elapsedLabel = formatThoughtElapsedLabel(elapsedMs);

  return (
    <div
      className={[styles.tr, className].filter(Boolean).join(" ")}
      data-phase={phase}
      data-thinking={thinking ? "1" : "0"}
      data-empty={count === 0 ? "1" : "0"}
      data-open={visuallyExpanded ? "1" : "0"}
      data-layout={layout}
    >
      <button
        type="button"
        className={styles.trHeader + (clickable ? " " + styles.isClickable : "")}
        aria-expanded={visuallyExpanded}
        aria-label={thinking || !collapseReady ? "思考中" : "切换思考记录"}
        onClick={clickable ? toggle : undefined}
      >
        {thinking || !collapseReady ? (
          <span className={styles.trLabel + " " + styles.trShimmer}>思考中</span>
        ) : (
          <span className={styles.trLabel}>
            <span className={styles.trVerb}>思考已完成</span>
            {elapsedLabel ? ` · ${elapsedLabel}` : ""}
          </span>
        )}
        {clickable ? <Chevron /> : null}
      </button>

      <div className={styles.trCollapsible + (visuallyExpanded ? "" : " " + styles.isCollapsed)}>
        <div className={styles.trInner}>
          {count > 0 ? (
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
              <div className={styles.trStream} style={{ transform: `translateY(${translate}px)` }}>
                {sentences.map((line, i) => (
                  <p
                    key={i}
                    className={
                      styles.trSentence +
                      (thinking && i === count - 1 ? " " + styles.trSentenceLive : "")
                    }
                  >
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
