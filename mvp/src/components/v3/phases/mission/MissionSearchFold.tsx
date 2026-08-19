/**
 * 检索压缩行。思考折页外面：正在检索 "query" → 来源一条条进来 → 查了 N 处。
 * 展开只给标题和链接，不给工具 JSON。
 */
import { useEffect, useRef, useState } from "react";
import { sourceDisplayUrl, type ThreadSearchStatus, type ThreadSource } from "../../../../lib/threadSearch";
import styles from "./WebSearch.module.css";

export type MissionSearchFoldProps = {
  status: ThreadSearchStatus;
  sources: ThreadSource[];
  query?: string;
};

type SiteState = "pending" | "loading" | "done";

function sourceKey(source: ThreadSource) {
  return (source.url || source.title).toLowerCase();
}

const MERIDIANS = {
  L: "M6.057 11.565 C2.081 11.565 0.371 8.159 0.371 5.964 C0.371 3.642 2.152 0.329 6.05 0.329",
  ML: "M6.012 11.55 C4.575 10.496 3.333 8.116 3.321 5.964 C3.307 3.399 4.974 0.977 6.012 0.329",
  MR: "M6.012 11.55 C7.211 10.781 8.715 8.287 8.715 5.964 C8.715 3.399 7.24 1.233 6.012 0.329",
  R: "M6.012 11.55 C9.677 11.55 11.65 8.487 11.65 5.964 C11.65 3.499 9.748 0.329 6.012 0.329",
};

function Globe({ motion }: { motion: boolean }) {
  const values = [MERIDIANS.L, MERIDIANS.ML, MERIDIANS.MR, MERIDIANS.R, MERIDIANS.L].join(";");
  return (
    <svg viewBox="0 0 12 12" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="0.85" strokeLinecap="round" aria-hidden="true">
      <circle cx="6" cy="6" r="5.7" opacity="0.9" />
      <line x1="0.3" y1="6" x2="11.7" y2="6" opacity="0.9" />
      {motion
        ? ["0s", "-1.2s", "-2.4s", "-3.6s", "-4.8s", "-6s"].map((begin) => (
            <path key={begin} d={MERIDIANS.L} opacity="0">
              <animate
                attributeName="d"
                dur="7.2s"
                begin={begin}
                repeatCount="indefinite"
                calcMode="spline"
                keyTimes="0;0.25;0.5;0.75;1"
                keySplines="0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1;0.42 0 0.58 1"
                values={values}
              />
              <animate
                attributeName="opacity"
                dur="7.2s"
                begin={begin}
                repeatCount="indefinite"
                calcMode="linear"
                keyTimes="0;0.05;0.7;0.75;1"
                values="0;0.9;0.9;0;0"
              />
            </path>
          ))
        : <path d={MERIDIANS.ML} opacity="0.7" />}
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

function Caret() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </svg>
  );
}

function ArrowUp() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4.5 10.5 12 3m0 0 7.5 7.5M12 3v18" />
    </svg>
  );
}

function Dots() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden="true">
      <circle cx="12" cy="12" r="9" strokeWidth="1.8" strokeDasharray="1.8 3.6" strokeLinecap="round" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </svg>
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function MissionSearchFold({ status, sources, query = "" }: MissionSearchFoldProps) {
  const [open, setOpen] = useState(() => status === "searching" && sources.length > 0);
  const [siteStates, setSiteStates] = useState<Record<string, SiteState>>({});
  const startedRef = useRef(new Set<string>());
  const timersRef = useRef<number[]>([]);
  const searching = status === "searching";
  const n = sources.length;
  const canToggle = n > 0;
  const reduceMotion = prefersReducedMotion();

  useEffect(() => {
    if (status === "searching" && n > 0) setOpen(true);
    if (status === "ready") setOpen(false);
  }, [status, n]);

  useEffect(() => () => {
    timersRef.current.forEach((id) => window.clearTimeout(id));
    timersRef.current = [];
  }, []);

  useEffect(() => {
    if (status === "ready") {
      timersRef.current.forEach((id) => window.clearTimeout(id));
      timersRef.current = [];
      setSiteStates(Object.fromEntries(sources.map((source) => [sourceKey(source), "done"])));
      sources.forEach((source) => startedRef.current.add(sourceKey(source)));
      return;
    }
    if (status !== "searching") return;

    const newcomers = sources.filter((source) => !startedRef.current.has(sourceKey(source)));
    if (newcomers.length === 0) return;

    const already = startedRef.current.size;
    newcomers.forEach((source, index) => {
      const key = sourceKey(source);
      startedRef.current.add(key);
      const loadAt = reduceMotion ? 0 : (already + index) * 800;
      const doneAt = reduceMotion ? 0 : loadAt + 1600;
      setSiteStates((prev) => ({
        ...prev,
        [key]: loadAt === 0 ? "loading" : "pending",
      }));
      if (loadAt > 0) {
        timersRef.current.push(
          window.setTimeout(() => {
            setSiteStates((prev) => (prev[key] === "done" ? prev : { ...prev, [key]: "loading" }));
          }, loadAt)
        );
      }
      timersRef.current.push(
        window.setTimeout(() => {
          setSiteStates((prev) => ({ ...prev, [key]: "done" }));
        }, doneAt)
      );
    });
  }, [reduceMotion, sources, status]);

  if (status === "hidden") return null;

  const label = searching
    ? query
      ? `正在检索 "${query}"`
      : "正在检索公开来源"
    : n > 0
      ? `查了 ${n} 处来源`
      : "检索过公开来源";

  return (
    <div
      className={[styles.ws, styles.wsThread].join(" ")}
      data-state={searching ? "loading" : "done"}
      aria-label={searching ? "正在检索公开来源" : undefined}
    >
      <div className={styles.wsRow}>
        <SearchIcon />
        <span className={styles.wsLabel}>
          <span className={[styles.wsShimmer, searching ? "" : styles.isDone].filter(Boolean).join(" ")}>
            {label}
          </span>
          {canToggle ? (
            <button
              type="button"
              className={styles.wsChevron}
              aria-label="切换来源列表"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              <Caret />
            </button>
          ) : null}
        </span>
      </div>

      {canToggle ? (
        <div
          className={[styles.wsCollapsible, open ? "" : styles.isCollapsed].filter(Boolean).join(" ")}
          aria-hidden={!open}
        >
          <div className={styles.wsCollapsibleInner}>
            <div className={styles.wsResults}>
              <span className={styles.wsRail} />
              <ul className={styles.wsList}>
                {sources.map((source, index) => {
                  const key = sourceKey(source);
                  const state = siteStates[key] ?? (searching ? (index === 0 ? "loading" : "pending") : "done");
                  const href = source.url;
                  const host = sourceDisplayUrl(source.url);
                  const rowClass = styles.wsSite;
                  const inner = (
                    <>
                      <span className={styles.wsBullet}>
                        <span className={styles.wsDots}>
                          <Dots />
                        </span>
                        <span className={styles.wsGlobe}>
                          <Globe motion={state === "loading" && !reduceMotion} />
                        </span>
                        <span className={styles.wsCheck}>
                          <Check />
                        </span>
                      </span>
                      <span className={styles.wsTitle}>{source.title}</span>
                      {host ? (
                        <>
                          <span className={styles.wsSep}>·</span>
                          <span className={styles.wsUrl}>{host}</span>
                        </>
                      ) : null}
                      {href ? (
                        <span className={styles.wsArrow}>
                          <ArrowUp />
                        </span>
                      ) : null}
                    </>
                  );
                  const rowStyle = { animationDelay: `${index * 40}ms` };
                  return (
                    <li key={key}>
                      {href && state === "done" ? (
                        <a
                          className={rowClass}
                          data-state={state}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={source.title}
                          style={rowStyle}
                        >
                          {inner}
                        </a>
                      ) : (
                        <span className={rowClass} data-state={state} style={rowStyle}>
                          {inner}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
