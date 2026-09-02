/**
 * Evidence Pursuit UI helpers — map SSE / finalReport hops into process copy.
 * No search-engine theater; hops are why / what / found / still missing.
 */

export type PursuitHopView = {
  hop: number;
  atom?: string;
  goal: string;
  query: string;
  resultKind?: string;
  resultKindLabel?: string;
  missingAfter: string[];
  action?: string;
  stopReason?: string;
  stopReasonLabel?: string;
  status?: "loading" | "success" | "error" | "pending";
};

const KIND_LABEL: Record<string, string> = {
  primary: "原始来源",
  refutation: "反证或辟谣",
  repost: "二手转载",
  unrelated: "未对上题",
  empty: "没有新材料",
};

const STOP_REASON_LABEL: Record<string, string> = {
  "evidence-found": "已收敛",
  "no-new-evidence": "没有新证据",
  "rewrite-empty": "问法用完",
  "search-failed": "搜索失败",
};

export function displayOrNone(value?: string | string[] | null): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => item.trim()).filter(Boolean);
    return items.length > 0 ? items.join("、") : "无";
  }
  const text = (value ?? "").trim();
  return text || "无";
}

export function stopReasonLabel(reason?: string): string {
  if (!reason) return "";
  if (STOP_REASON_LABEL[reason]) return STOP_REASON_LABEL[reason];
  if (/^[a-z0-9_-]+$/i.test(reason)) return "";
  return reason.trim();
}

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
  const atom = typeof result?.atom === "string" ? result.atom : "";
  const stopRaw =
    typeof result?.stopReason === "string"
      ? result.stopReason
      : typeof result?.reason === "string"
        ? result.reason
        : undefined;
  if (!goal && !q && !resultKind && missingAfter.length === 0 && !result?.reasonText && !atom && !stopRaw) {
    return null;
  }
  return {
    hop,
    atom,
    goal: goal || "追索证据",
    query: q,
    resultKind,
    resultKindLabel: resultKindLabel(resultKind),
    missingAfter,
    action: typeof result?.action === "string" ? result.action : undefined,
    stopReason: stopRaw,
    stopReasonLabel: stopReasonLabel(stopRaw),
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
    const atom = typeof h.atom === "string" ? h.atom : "";
    const stopRaw = typeof h.stopReason === "string" ? h.stopReason : undefined;
    out.push({
      hop: typeof h.hop === "number" ? h.hop : out.length + 1,
      atom,
      goal,
      query,
      resultKind,
      resultKindLabel:
        typeof h.resultKindLabel === "string" ? h.resultKindLabel : resultKindLabel(resultKind),
      missingAfter,
      action: typeof h.action === "string" ? h.action : undefined,
      stopReason: stopRaw,
      stopReasonLabel: stopReasonLabel(stopRaw),
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
    const reason = typeof tool.result?.reason === "string" ? tool.result.reason : "";
    if (reason) {
      const atom = typeof tool.result?.atom === "string" ? tool.result.atom : "";
      for (let i = out.length - 1; i >= 0; i -= 1) {
        if (!atom || out[i].atom === atom) {
          out[i].stopReason = reason;
          out[i].stopReasonLabel = stopReasonLabel(reason);
          break;
        }
      }
      continue;
    }
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
