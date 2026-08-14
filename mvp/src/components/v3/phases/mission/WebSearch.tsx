/**
 * WebSearch — progressive search-result strip for mission process rows.
 *
 * Data comes from orchestrate tool_start / tool_result (query + sources).
 * Presentation may stagger pending → loading → done; it never invents URLs.
 */
import { useEffect, useMemo, useState } from "react";
import styles from "./WebSearch.module.css";

export type WebSearchSiteState = "pending" | "loading" | "done" | "error";

export interface WebSearchSite {
  id: string;
  title: string;
  /** Host or path shown after the title (e.g. who.int/...) */
  urlLabel: string;
  /** Full URL for open-in-new-tab when present */
  href?: string;
}

export interface WebSearchProps {
  query: string;
  sites: WebSearchSite[];
  /** Tool-level status from stream adapter */
  status?: "pending" | "loading" | "success" | "error";
  /** When true and status is success, skip staggered reveal */
  instantDone?: boolean;
  className?: string;
  defaultOpen?: boolean;
}

// Six meridians, phase-offset by 1/6 of the cycle, read as one rotating sphere.
const M = {
  L: "M6.057 11.565 C2.081 11.565 0.371 8.159 0.371 5.964 C0.371 3.642 2.152 0.329 6.05 0.329",
  ML: "M6.012 11.55 C4.575 10.496 3.333 8.116 3.321 5.964 C3.307 3.399 4.974 0.977 6.012 0.329",
  MR: "M6.012 11.55 C7.211 10.781 8.715 8.287 8.715 5.964 C8.715 3.399 7.24 1.233 6.012 0.329",
  R: "M6.012 11.55 C9.677 11.55 11.65 8.487 11.65 5.964 C11.65 3.499 9.748 0.329 6.012 0.329",
};

function Globe() {
  const values = [M.L, M.ML, M.MR, M.R, M.L].join(";");
  return (
    <svg
      viewBox="0 0 12 12"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="0.85"
      strokeLinecap="round"
      style={{ overflow: "visible" }}
      aria-hidden
    >
      <circle cx="6" cy="6" r="5.7" opacity="0.9" />
      <line x1="0.3" y1="6" x2="11.7" y2="6" opacity="0.9" />
      {["0s", "-1.2s", "-2.4s", "-3.6s", "-4.8s", "-6s"].map((begin) => (
        <path key={begin} d={M.L} opacity="0">
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
      ))}
    </svg>
  );
}

const SearchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
  </svg>
);
const Caret = () => (
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
    <path d="m4.5 15.75 7.5-7.5 7.5 7.5" />
  </svg>
);
const ArrowUp = () => (
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
const Dots = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" aria-hidden>
    <circle cx="12" cy="12" r="9" strokeWidth="1.8" strokeDasharray="1.8 3.6" strokeLinecap="round" />
  </svg>
);
const Check = () => (
  <svg
    viewBox="0 0 24 24"
    width="16"
    height="16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.6"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M9 12.75 11.25 15 15 9.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
  </svg>
);

function hostnameLabel(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  try {
    const withProto = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    const u = new URL(withProto);
    const host = u.hostname.replace(/^www\./, "");
    const path = u.pathname === "/" ? "" : u.pathname.replace(/\/$/, "");
    const shortPath = path.length > 36 ? `${path.slice(0, 36)}…` : path;
    return shortPath ? `${host}${shortPath}` : host;
  } catch {
    return t.replace(/^https?:\/\//i, "").replace(/^www\./, "").slice(0, 64);
  }
}

/** Map tool result.sources (and similar) into WebSearch rows. Never invents URLs. */
export function sitesFromSearchResult(result?: Record<string, unknown> | null): WebSearchSite[] {
  if (!result || typeof result !== "object") return [];
  const bags: unknown[] = [];
  if (Array.isArray(result.sources)) bags.push(...result.sources);
  if (Array.isArray(result.supportingEvidence)) bags.push(...result.supportingEvidence);
  if (Array.isArray(result.contradictingEvidence)) bags.push(...result.contradictingEvidence);

  const out: WebSearchSite[] = [];
  const seen = new Set<string>();

  for (const raw of bags) {
    if (typeof raw === "string") {
      const href = raw.startsWith("http") ? raw : undefined;
      const title = raw.trim();
      if (!title) continue;
      const key = (href || title).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        id: key,
        title: title.slice(0, 120),
        urlLabel: href ? hostnameLabel(href) : title.slice(0, 64),
        href,
      });
      continue;
    }
    if (!raw || typeof raw !== "object") continue;
    const o = raw as {
      id?: string;
      title?: string;
      name?: string;
      url?: string;
      href?: string;
      domain?: string;
      snippet?: string;
    };
    const href = (o.url || o.href || "").trim() || undefined;
    const title = (o.title || o.name || o.domain || href || "").trim();
    if (!title && !href) continue;
    const key = (href || title).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: o.id || key,
      title: (title || href || "来源").slice(0, 120),
      urlLabel: o.domain?.trim() || (href ? hostnameLabel(href) : title.slice(0, 64)),
      href,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function isSearchShellTool(tool: {
  toolId?: string;
  toolName?: string;
  title?: string;
  query?: string;
  result?: Record<string, unknown>;
}): boolean {
  const key = `${tool.toolId ?? ""} ${tool.toolName ?? ""} ${tool.title ?? ""}`
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (/memorysearch|memorywrite|reportreviewer|vision|stepfun/.test(key)) return false;
  if (/search|360|anysearch|metaso|tavily|exa|parallel|serp|bing|google/.test(key)) return true;
  if (tool.result && Array.isArray(tool.result.sources)) return true;
  if (typeof tool.query === "string" && /检索|公开材料/.test(tool.title ?? "")) return true;
  return /检索公开材料|公开材料已返回/.test(tool.title ?? "");
}

export function WebSearch({
  query,
  sites,
  status = "loading",
  instantDone = false,
  className,
  defaultOpen = true,
}: WebSearchProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [siteStates, setSiteStates] = useState<WebSearchSiteState[]>(() =>
    sites.map(() => (status === "success" && instantDone ? "done" : "pending"))
  );

  const siteKey = useMemo(() => sites.map((s) => s.id).join("|"), [sites]);
  const toolDone = status === "success" || status === "error";
  const headerDone = toolDone && (sites.length === 0 || siteStates.every((s) => s === "done" || s === "error"));

  useEffect(() => {
    if (sites.length === 0) {
      setSiteStates([]);
      return;
    }

    if (status === "error") {
      setSiteStates(sites.map(() => "error"));
      return;
    }

    if (status === "pending" || status === "loading") {
      setSiteStates(sites.map(() => "pending"));
      return;
    }

    // success: optionally stagger reveal so rows do not hard-pop
    if (instantDone) {
      setSiteStates(sites.map(() => "done"));
      return;
    }

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setSiteStates(sites.map(() => "done"));
      return;
    }

    setSiteStates(sites.map(() => "pending"));
    const timers: ReturnType<typeof setTimeout>[] = [];
    sites.forEach((_, i) => {
      const discover = 120 + i * 220;
      const finish = discover + 420;
      timers.push(
        setTimeout(() => {
          setSiteStates((prev) => prev.map((v, j) => (j === i ? "loading" : v)));
        }, discover)
      );
      timers.push(
        setTimeout(() => {
          setSiteStates((prev) => prev.map((v, j) => (j === i ? "done" : v)));
        }, finish)
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [siteKey, status, instantDone, sites.length]);

  const labelPrefix = status === "error" ? "检索失败" : headerDone ? "已检索" : "正在检索";
  const q = query.trim() || "公开材料";

  const openSite = (site: WebSearchSite) => {
    if (!site.href) return;
    window.open(site.href, "_blank", "noopener,noreferrer");
  };

  return (
    <div
      className={[styles.ws, className].filter(Boolean).join(" ")}
      data-state={headerDone ? "done" : status === "error" ? "error" : "loading"}
      data-testid="web-search"
    >
      <div className={styles.wsRow}>
        <SearchIcon />
        <span className={styles.wsLabel}>
          <span className={styles.wsShimmer + (headerDone || status === "error" ? " " + styles.isDone : "")}>
            {labelPrefix}{" "}
            <span className={styles.wsQuote}>
              “{q.length > 64 ? `${q.slice(0, 64)}…` : q}”
            </span>
          </span>
          <button
            type="button"
            className={styles.wsChevron}
            aria-label="展开或收起检索结果"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          >
            <Caret />
          </button>
        </span>
      </div>

      <div className={styles.wsCollapsible + (open ? "" : " " + styles.isCollapsed)}>
        <div className={styles.wsCollapsibleInner}>
          <div className={styles.wsResults}>
            <span className={styles.wsRail} />
            {sites.length === 0 ? (
              <div className={styles.wsEmpty}>
                {status === "loading" || status === "pending"
                  ? "正在等待搜索引擎返回来源…"
                  : status === "error"
                    ? "本次检索未返回可用来源。"
                    : "未返回可展示的来源条目。"}
              </div>
            ) : (
              <ul className={styles.wsList}>
                {sites.map((site, i) => {
                  const st = siteStates[i] ?? (headerDone ? "done" : "pending");
                  const clickable = st === "done" && Boolean(site.href);
                  return (
                    <li
                      key={site.id}
                      className={styles.wsSite}
                      data-state={st}
                      role={clickable ? "link" : undefined}
                      tabIndex={clickable ? 0 : undefined}
                      onClick={clickable ? () => openSite(site) : undefined}
                      onKeyDown={
                        clickable
                          ? (e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                openSite(site);
                              }
                            }
                          : undefined
                      }
                      aria-label={clickable ? `打开来源 ${site.title}` : undefined}
                    >
                      <span className={styles.wsBullet}>
                        <span className={styles.wsDots}>
                          <Dots />
                        </span>
                        <span className={styles.wsGlobe}>
                          <Globe />
                        </span>
                        <span className={styles.wsCheck}>
                          <Check />
                        </span>
                      </span>
                      <span className={styles.wsTitle}>{site.title}</span>
                      <span className={styles.wsSep}>·</span>
                      <span className={styles.wsUrl}>{site.urlLabel}</span>
                      <span className={styles.wsArrow}>
                        <ArrowUp />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
