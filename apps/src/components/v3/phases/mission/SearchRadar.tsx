/**
 * SearchRadar — 多路检索雷达（纯展示组件，Issue #12）。
 *
 * 多路检索 provider 沿路径汇入一个证据池，展示真实统计。
 * 视觉基于 Magic UI "Animated Beam / Multiple Inputs"（MIT，见 AnimatedBeam.tsx 头注），
 * 仅移植单个 AnimatedBeam + 多输入布局思路；数据全部由 props 传入，
 * 不接 SSE、不自造数字：stats 未返回时不显示 0 占位。
 */
import { createRef, useEffect, useRef, useState, type RefObject } from "react";
import { AnimatedBeam } from "./AnimatedBeam";
import styles from "./SearchRadar.module.css";

export type SearchRadarProviderStatus =
  | "pending"
  | "running"
  | "completed"
  | "partial"
  | "failed";

export type SearchRadarProvider = {
  id: string;
  label: string;
  status: SearchRadarProviderStatus;
  resultCount: number;
};

export type SearchRadarStats = {
  rawResultCount: number;
  uniqueSourceCount: number;
  sharedSourceCount: number;
  singleProviderSourceCount: number;
};

export type SearchRadarProps = {
  providers: SearchRadarProvider[];
  stats?: SearchRadarStats;
  phase: "idle" | "started" | "progress" | "completed";
  onOpenSources?: () => void;
  className?: string;
};

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

/** 与 WebSearch 相同的 matchMedia 直查模式：可测、不依赖 framer-motion 全局缓存。 */
function usePrefersReducedMotion(): boolean {
  const [reduce, setReduce] = useState(
    () => typeof window !== "undefined" && !!window.matchMedia?.(REDUCE_QUERY)?.matches
  );
  useEffect(() => {
    const mql = typeof window !== "undefined" ? window.matchMedia?.(REDUCE_QUERY) : undefined;
    if (!mql || typeof mql.addEventListener !== "function") return;
    const onChange = () => setReduce(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  return reduce;
}

const STATUS_TEXT: Record<SearchRadarProviderStatus, string> = {
  pending: "等待中",
  running: "检索中",
  completed: "完成",
  partial: "部分返回",
  failed: "失败",
};

function StatusIcon({ status }: { status: SearchRadarProviderStatus }) {
  // 形状先区分状态，颜色只是辅助：partial/failed/completed 不靠颜色单独区分。
  const common = {
    viewBox: "0 0 24 24",
    width: 14,
    height: 14,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };
  switch (status) {
    case "pending":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" strokeDasharray="2 4" />
        </svg>
      );
    case "running":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="8" opacity="0.35" />
        </svg>
      );
    case "completed":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5.2" />
        </svg>
      );
    case "partial":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 12V7" />
          <path d="M12 12l4 2.4" />
        </svg>
      );
    case "failed":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      );
  }
}

function providerDetail(p: SearchRadarProvider): string {
  // 只有真实返回了结果的态才带数字；pending/running/failed 不预告数字。
  if (p.status === "completed" || p.status === "partial")
    return `${STATUS_TEXT[p.status]} · ${p.resultCount} 条`;
  return STATUS_TEXT[p.status];
}

export function SearchRadar({ providers, stats, phase, onOpenSources, className }: SearchRadarProps) {
  const reduceMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  // 每个 provider 一个稳定的端口 ref（按 id 缓存），路径从行右端小端口出发，
  // 不覆盖文字。
  const portRefs = useRef(new Map<string, RefObject<HTMLSpanElement | null>>());
  const portRefFor = (id: string): RefObject<HTMLSpanElement | null> => {
    let r = portRefs.current.get(id);
    if (!r) {
      r = createRef<HTMLSpanElement>();
      portRefs.current.set(id, r);
    }
    return r;
  };

  if (providers.length === 0) return null;

  const runningCount = providers.filter((p) => p.status === "running").length;
  const showStats = Boolean(stats);

  return (
    <div
      className={[styles.radar, className].filter(Boolean).join(" ")}
      data-testid="search-radar"
      data-phase={phase}
      data-reduced-motion={reduceMotion ? "true" : "false"}
    >
      <div className={styles.head}>
        <span className={styles.title}>多路检索雷达</span>
        <span className={styles.phase} data-testid="radar-phase">
          {phase === "idle"
            ? "等待开始"
            : phase === "completed"
              ? "检索完成"
              : runningCount > 0
                ? `${runningCount} 路检索中`
                : "检索进行中"}
        </span>
      </div>

      <div className={styles.canvas} ref={containerRef}>
        {providers.map((p, i) => (
          <AnimatedBeam
            key={p.id}
            containerRef={containerRef}
            fromRef={portRefFor(p.id)}
            toRef={poolRef}
            pathColor="#d4d7dd"
            pathOpacity={0.35}
            gradientStartColor="#15a06a"
            gradientStopColor="#0ea5b7"
            duration={4}
            delay={i * 0.4}
            play={!reduceMotion && p.status === "running"}
          />
        ))}

        <ul className={styles.providers}>
          {providers.map((p) => (
            <li
              key={p.id}
              className={styles.provider}
              data-status={p.status}
              data-testid={`radar-provider-${p.id}`}
            >
              <span className={styles.providerIcon}>
                <StatusIcon status={p.status} />
              </span>
              <span className={styles.providerLabel}>{p.label}</span>
              <span className={styles.providerStatus}>{providerDetail(p)}</span>
              <span className={styles.port} ref={portRefFor(p.id)} aria-hidden />
            </li>
          ))}
        </ul>

        <div className={styles.pool} ref={poolRef} data-testid="radar-pool" data-done={showStats ? "true" : "false"}>
          <span className={styles.poolTitle}>证据池</span>
          {showStats ? (
            <span className={styles.poolStats} data-testid="radar-stats">
              {stats!.rawResultCount} 条原始结果 → {stats!.uniqueSourceCount} 个去重来源
            </span>
          ) : (
            <span className={styles.poolPending}>来源统计整理中</span>
          )}
        </div>
      </div>

      {showStats ? (
        <div className={styles.summary}>
          <p className={styles.summaryLine} data-testid="radar-summary">
            {providers.length} 路检索 · {stats!.rawResultCount} 条原始结果 →{" "}
            {stats!.uniqueSourceCount} 个去重来源
          </p>
          <p className={styles.summaryLine} data-testid="radar-overlap">
            共同命中 {stats!.sharedSourceCount} 个 · 单路发现 {stats!.singleProviderSourceCount} 个
          </p>
          <p className={styles.footnote}>
            “共同命中”仅表示同一 URL 被多路检索命中，不代表结论可信度。
          </p>
        </div>
      ) : null}

      <button
        type="button"
        className={styles.openSources}
        onClick={onOpenSources}
        disabled={!onOpenSources}
      >
        查看来源明细
      </button>
    </div>
  );
}
