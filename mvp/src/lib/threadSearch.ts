/**
 * Compact search line under thinking — titles only, never tool JSON.
 * ChatGPT/Claude: Searching… is a sibling of thinking, not inside it.
 */

export type ThreadSource = {
  title: string;
  url?: string;
};

export type ThreadSearchStatus = "hidden" | "searching" | "ready";

type SearchToolLike = {
  toolId?: string;
  toolName?: string;
  key?: string;
  title?: string;
  status?: string;
  query?: string;
  result?: Record<string, unknown>;
};

const SEARCH_RE = /search|360|anysearch|metaso|tavily|exa|parallel/;
const NOT_SEARCH_RE = /memory|reviewer|vision|stepfun|evidenceloop|evidencepursuit|证据追索|追索证据/;

export function isSearchTool(tool: SearchToolLike): boolean {
  const blob = `${tool.toolId ?? ""} ${tool.toolName ?? ""} ${tool.key ?? ""} ${tool.title ?? ""}`.toLowerCase();
  if (NOT_SEARCH_RE.test(blob)) return false;
  return SEARCH_RE.test(blob) || tool.title === "检索公开材料";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pushSource(out: ThreadSource[], seen: Set<string>, title?: string, url?: string) {
  const href = typeof url === "string" ? url.trim() : "";
  const label = (typeof title === "string" ? title.trim() : "") || href;
  if (!label) return;
  const key = (href || label).toLowerCase();
  if (seen.has(key) || out.length >= 8) return;
  seen.add(key);
  out.push({ title: label.slice(0, 120), url: href || undefined });
}

function ingestList(out: ThreadSource[], seen: Set<string>, list: unknown) {
  if (!Array.isArray(list)) return;
  for (const row of list) {
    if (typeof row === "string") {
      pushSource(out, seen, row, row.startsWith("http") ? row : undefined);
      continue;
    }
    const rec = asRecord(row);
    if (!rec) continue;
    pushSource(
      out,
      seen,
      typeof rec.title === "string"
        ? rec.title
        : typeof rec.name === "string"
          ? rec.name
          : undefined,
      typeof rec.url === "string" ? rec.url : typeof rec.href === "string" ? rec.href : undefined
    );
  }
}

function ingestToolResult(out: ThreadSource[], seen: Set<string>, result?: Record<string, unknown>) {
  if (!result) return;
  ingestList(out, seen, result.sources);
  ingestList(out, seen, result.results);
  ingestList(out, seen, result.items);
  ingestList(out, seen, result.webPages);
  ingestList(out, seen, result.organic);
  const data = asRecord(result.data);
  if (data) {
    ingestList(out, seen, data.sources);
    ingestList(out, seen, data.results);
  }
}

function ingestReport(out: ThreadSource[], seen: Set<string>, report: Record<string, unknown> | null | undefined) {
  if (!report) return;
  ingestList(out, seen, report.citationSources);
  ingestList(out, seen, report.sources);
  if (Array.isArray(report.evidenceChain)) {
    for (const row of report.evidenceChain) {
      const rec = asRecord(row);
      if (!rec) continue;
      ingestList(out, seen, rec.sourceRefs);
    }
  }
}

export function collectThreadSources(
  tools: SearchToolLike[] | null | undefined,
  report?: Record<string, unknown> | null
): ThreadSource[] {
  const out: ThreadSource[] = [];
  const seen = new Set<string>();
  ingestReport(out, seen, report);
  for (const tool of tools ?? []) {
    if (!isSearchTool(tool)) continue;
    ingestToolResult(out, seen, tool.result);
  }
  return out;
}

export function sourceDisplayUrl(url?: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    const path = parsed.pathname === "/" ? "" : parsed.pathname.replace(/\/$/, "");
    return `${host}${path}`;
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  }
}

export function threadSearchQuery(tools: SearchToolLike[] | null | undefined): string {
  const searchTools = (tools ?? []).filter(isSearchTool);
  const loading = [...searchTools]
    .reverse()
    .find((tool) => tool.status === "loading" || tool.status === "pending");
  const raw = (loading ?? searchTools[searchTools.length - 1]) as { query?: unknown } | undefined;
  const query = typeof raw?.query === "string" ? raw.query.trim() : "";
  return query;
}

export function threadSearchStatus(
  tools: SearchToolLike[] | null | undefined,
  report?: Record<string, unknown> | null
): ThreadSearchStatus {
  const searchTools = (tools ?? []).filter(isSearchTool);
  if (searchTools.some((tool) => tool.status === "loading" || tool.status === "pending")) {
    return "searching";
  }
  const sources = collectThreadSources(searchTools, report);
  if (searchTools.length === 0 && sources.length === 0) return "hidden";
  return "ready";
}
