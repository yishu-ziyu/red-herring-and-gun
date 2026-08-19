/**
 * Folded evidence-pursuit hops under the search line.
 * Cognitive process: why / what / found / still missing. Collapsed next to the verdict.
 */
import { useState } from "react";
import type { PursuitHopView } from "../../../../lib/evidencePursuitUi";
import { formatPursuitDetail } from "../../../../lib/evidencePursuitUi";
import styles from "./WebSearch.module.css";

export type MissionPursuitFoldProps = {
  hops: PursuitHopView[];
  live?: boolean;
};

function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

export function MissionPursuitFold({ hops, live = false }: MissionPursuitFoldProps) {
  const n = hops.length;
  const [open, setOpen] = useState(false);
  const running = live && hops.some((h) => h.status === "loading");

  if (n === 0) return null;

  const current = hops[hops.length - 1];
  const label = running
    ? current?.goal
      ? `正在追索证据 · ${current.goal}`
      : "正在追索证据"
    : `追索了 ${n} 跳`;

  return (
    <div
      className={[styles.ws, styles.wsThread].join(" ")}
      data-state={running ? "loading" : "done"}
      aria-label={running ? "正在追索证据" : "证据追索"}
    >
      <div className={styles.wsRow}>
        <span className={styles.wsLabel}>
          <span className={[styles.wsShimmer, running ? "" : styles.isDone].filter(Boolean).join(" ")}>
            {label}
          </span>
          <button
            type="button"
            className={styles.wsChevron}
            aria-label="切换证据追索"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Caret />
          </button>
        </span>
      </div>
      <div
        className={[styles.wsCollapsible, open ? "" : styles.isCollapsed].filter(Boolean).join(" ")}
        aria-hidden={!open}
      >
        <ol className={styles.wsHopList}>
          {hops.map((hop, index) => (
            <li key={`${hop.hop}-${hop.query}-${index}`} className={styles.wsHop}>
              <span className={styles.wsHopGoal}>{hop.goal || "追索证据"}</span>
              <span className={styles.wsHopMeta}>
                {formatPursuitDetail({
                  query: hop.query,
                  resultKind: hop.resultKind,
                  missingAfter: hop.missingAfter,
                })}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
