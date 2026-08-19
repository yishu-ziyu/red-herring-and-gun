/**
 * Evidence Pursuit UI helpers — map SSE / finalReport hops into process copy.
 * No search-engine theater; hops are why / what / found / still missing.
 */

export type PursuitHopView = {
  hop: number;
  goal: string;
  query: string;
  resultKind?: string;
  resultKindLabel?: string;
  missingAfter: string[];
  action?: string;
  status?: "loading" | "success" | "error" | "pending";
};

const KIND_LABEL: Record<string, string> = {
  primary: "原始来源",
  refutation: "反证或辟谣",
  repost: "二手转载",
  unrelated: "未对上题",
  empty: "没有新材料",
};

export function isEvidencePursuitTool(tool: {
  toolId?: string | null;
  toolName?: string | null;
  title?: string | null;
  key?: string | null;
  result?: Record<string, unknown> | null;
}): boolean {
  if (tool.result && tool.result.kind === "evidence_pursuit") return true;
  const blob = `${tool.toolId ?? ""} ${tool.toolName ?? ""} ${tool.title ?? ""} ${tool.key ?? ""}`.toLowerCase();
  return /evidenceloop|evidencepursuit|证据追索|追索证据/.test(blob.replace(/[\s_-]+/g, ""));
}

export function resultKindLabel(kind?: string): string {
  if (!kind) return "";
  return KIND_LABEL[kind] || kind;
}

export function formatPursuitDetail(hop: {
  goal?: string;
  query?: string;
  resultKind?: string;
  missingAfter?: string[];
  reasonText?: string;
}): string {
  if (hop.reasonText) return hop.reasonText;
  const parts: string[] = [];
  if (hop.goal) parts.push(`目标：${hop.goal}`);
  if (hop.query) {
    const q = hop.query.length > 28 ? `${hop.query.slice(0, 28)}…` : hop.query;
    parts.push(`搜「${q}」`);
  }
  const kind = resultKindLabel(hop.resultKind);
  if (kind) parts.push(kind);
  if (hop.missingAfter && hop.missingAfter.length > 0) {
    parts.push(`还缺${hop.missingAfter.slice(0, 3).join("、")}`);
  }
  return parts.join(" · ") || "追索证据";
}

export function hopFromResult(
  result?: Record<string, unknown> | null,
  query?: string
): PursuitHopView | null {
  if (!result || result.kind !== "evidence_pursuit") {
    if (!query) return null;
  }
  const missingRaw = result?.missingAfter ?? result?.missingEvidence;
  const missingAfter = Array.isArray(missingRaw)
    ? missingRaw.filter((x): x is string => typeof x === "string")
    : [];
  const hop = typeof result?.hop === "number" ? result.hop : typeof result?.round === "number" ? result.round : 0;
  const goal = typeof result?.goal === "string" ? result.goal : "";
  const q = typeof result?.query === "string" ? result.query : query ?? "";
  const resultKind = typeof result?.resultKind === "string" ? result.resultKind : undefined;
  if (!goal && !q && !resultKind && missingAfter.length === 0 && !result?.reasonText) return null;
  return {
    hop,
    goal: goal || "追索证据",
    query: q,
    resultKind,
    resultKindLabel: resultKindLabel(resultKind),
    missingAfter,
    action: typeof result?.action === "string" ? result.action : undefined,
  };
}

export function hopsFromReport(report?: Record<string, unknown> | null): PursuitHopView[] {
  const block = report?.evidencePursuit;
  if (!block || typeof block !== "object") return [];
  const hops = (block as { hops?: unknown }).hops;
  if (!Array.isArray(hops)) return [];
  const out: PursuitHopView[] = [];
  for (const raw of hops) {
    if (!raw || typeof raw !== "object") continue;
    const h = raw as Record<string, unknown>;
    const query = typeof h.query === "string" ? h.query : "";
    const goal = typeof h.goal === "string" ? h.goal : "追索证据";
    const resultKind = typeof h.resultKind === "string" ? h.resultKind : undefined;
    const missingAfter = Array.isArray(h.missingAfter)
      ? h.missingAfter.filter((x): x is string => typeof x === "string")
      : [];
    out.push({
      hop: typeof h.hop === "number" ? h.hop : out.length + 1,
      goal,
      query,
      resultKind,
      resultKindLabel:
        typeof h.resultKindLabel === "string" ? h.resultKindLabel : resultKindLabel(resultKind),
      missingAfter,
      action: typeof h.action === "string" ? h.action : undefined,
      status: "success",
    });
  }
  return out;
}

export function hopsFromTools(
  tools: Array<{
    query?: string;
    status?: string;
    result?: Record<string, unknown>;
    toolName?: string;
    title?: string;
    key?: string;
    toolId?: string;
  }>
): PursuitHopView[] {
  const out: PursuitHopView[] = [];
  for (const tool of tools) {
    if (!isEvidencePursuitTool(tool)) continue;
    if (typeof tool.result?.reason === "string") continue;
    const hop = hopFromResult(tool.result ?? null, tool.query);
    if (!hop) continue;
    hop.status =
      tool.status === "loading" || tool.status === "pending"
        ? "loading"
        : tool.status === "error"
          ? "error"
          : "success";
    out.push(hop);
  }
  return out;
}
