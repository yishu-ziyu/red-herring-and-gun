/**
 * 检索压缩行。在思考折页外面：正在检索 → 查了 N 处来源。
 * 展开只给标题和链接，不给工具 JSON。
 */
import { useEffect, useState } from "react";
import type { ThreadSearchStatus, ThreadSource } from "../../../../lib/threadSearch";

export type MissionSearchFoldProps = {
  status: ThreadSearchStatus;
  sources: ThreadSource[];
};

export function MissionSearchFold({ status, sources }: MissionSearchFoldProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (status !== "ready") setOpen(false);
  }, [status]);

  if (status === "hidden") return null;

  const n = sources.length;
  const searching = status === "searching";
  const clickable = !searching && n > 0;
  const label = searching
    ? "正在检索公开来源"
    : n > 0
      ? `查了 ${n} 处来源`
      : "检索过公开来源";

  return (
    <div className="mission-search-fold">
      <button
        type="button"
        className={`mission-search-head${clickable ? " is-clickable" : ""}`}
        aria-expanded={clickable ? open : undefined}
        aria-label={searching ? "正在检索公开来源" : clickable ? "切换来源列表" : label}
        onClick={clickable ? () => setOpen((v) => !v) : undefined}
      >
        <span className={searching ? "mission-search-shimmer" : undefined}>{label}</span>
        {clickable ? (
          <svg className="mission-search-chev" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true">
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
      {open && n > 0 ? (
        <ul className="mission-search-list">
          {sources.map((source) => (
            <li key={source.url || source.title}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noopener noreferrer">
                  {source.title}
                </a>
              ) : (
                <span>{source.title}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
