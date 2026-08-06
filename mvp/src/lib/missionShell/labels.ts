/**
 * missionShell/labels.ts
 *
 * Display-layer humanization for mission process shell.
 * Machine values stay on MissionShellModel; UI maps them here.
 */

/** Map report verdictType enum → user-facing Chinese label. */
export function humanizeVerdictType(verdictType?: string | null): string {
  const key = normalizeKey(verdictType);
  switch (key) {
    case "true":
      return "倾向成立";
    case "false":
      return "倾向不成立";
    case "mixed_misleading":
    case "mixed":
    case "partial":
      return "部分误导/夸大";
    case "unverified":
    case "uncertain":
    case "maybe":
      return "尚难核实";
    default: {
      const raw = typeof verdictType === "string" ? verdictType.trim() : "";
      if (!raw) return "—";
      // Machine-looking enums must not leak into Chinese UI.
      if (looksLikeMachineToken(raw)) return "尚难核实";
      return raw;
    }
  }
}

/** Map fact_checker factCheckResult → Chinese. */
export function humanizeFactCheckResult(result?: string | null): string {
  const key = normalizeKey(result);
  switch (key) {
    case "true":
      return "倾向成立";
    case "false":
      return "倾向不成立";
    case "partial":
      return "部分成立";
    case "unverified":
    case "uncertain":
    case "maybe":
      return "尚难核实";
    default: {
      const raw = typeof result === "string" ? result.trim() : "";
      if (!raw) return "—";
      if (looksLikeMachineToken(raw)) return "尚难核实";
      return raw;
    }
  }
}

/** Map planner claimType → Chinese. */
export function humanizeClaimType(claimType?: string | null): string {
  const key = normalizeKey(claimType);
  switch (key) {
    case "causal":
      return "因果命题";
    case "concept":
      return "概念命题";
    case "event":
      return "事件命题";
    case "mixed":
      return "混合命题";
    default: {
      const raw = typeof claimType === "string" ? claimType.trim() : "";
      if (!raw) return "";
      if (looksLikeMachineToken(raw)) return "命题类型待定";
      return raw;
    }
  }
}

/** Map confidence / reliability enums (high|medium|low) → Chinese. */
export function humanizeConfidenceLevel(level?: string | null): string {
  const key = normalizeKey(level);
  switch (key) {
    case "high":
      return "高";
    case "medium":
    case "med":
      return "中";
    case "low":
      return "低";
    default: {
      const raw = typeof level === "string" ? level.trim() : "";
      if (!raw) return "—";
      if (looksLikeMachineToken(raw)) return "—";
      return raw;
    }
  }
}

/**
 * Format a report-review issue for shell UI.
 * error → 「严重 · 」+ message; warn → 「注意 · 」+ message; else bare message.
 */
export function formatReviewIssue(issue: {
  severity?: string | null;
  message?: string | null;
}): string {
  const message =
    typeof issue.message === "string" ? issue.message.trim() : "";
  if (!message) return "";
  const severity = normalizeKey(issue.severity);
  if (severity === "error") return `严重 · ${message}`;
  if (severity === "warn" || severity === "warning") return `注意 · ${message}`;
  return message;
}

function normalizeKey(value?: string | null): string {
  return typeof value === "string" ? value.trim().toLowerCase().replace(/[\s-]+/g, "_") : "";
}

/** ascii snake/kebab/camel tokens that should never render raw in UI */
function looksLikeMachineToken(raw: string): boolean {
  return /^[a-z][a-z0-9_-]*$/i.test(raw);
}
