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
      return "能信";
    case "false":
    case "rumor":
      return "不能信";
    case "mixed_misleading":
    case "mixed":
    case "partial":
      return "只能信一部分";
    case "unverified":
    case "uncertain":
    case "maybe":
    case "unknown":
      return "还查不清";
    default: {
      const raw = typeof verdictType === "string" ? verdictType.trim() : "";
      if (!raw) return "—";
      // Machine-looking enums must not leak into Chinese UI.
      if (looksLikeMachineToken(raw)) return "还查不清";
      return raw;
    }
  }
}

/**
 * 能不能信：优先用报告 recommendation，否则按 verdictType 推导。
 */
export function shareAdviceFromVerdict(
  recommendation?: string | null,
  verdictType?: string | null
): string {
  const rec = typeof recommendation === "string" ? recommendation.trim() : "";
  if (rec) return rec;
  const key = normalizeKey(verdictType);
  if (key === "false" || key === "rumor") {
    return "不能信。公开材料不支持这句话。";
  }
  if (key === "true") {
    return "能信。看来源，不要改写成更满的说法。";
  }
  if (key === "partial" || key === "mixed" || key === "mixed_misleading") {
    return "只能信一部分。哪一截成立、哪一截没有依据，看下面。";
  }
  if (key === "unverified" || key === "uncertain" || key === "maybe" || key === "unknown") {
    return "还查不清。先别当已经证实。";
  }
  return "先看来源，再判断能不能信。";
}

/** Map fact_checker factCheckResult → Chinese. */
export function humanizeFactCheckResult(result?: string | null): string {
  const key = normalizeKey(result);
  switch (key) {
    case "true":
      return "能信";
    case "false":
      return "不能信";
    case "partial":
      return "只能信一部分";
    case "unverified":
    case "uncertain":
    case "maybe":
      return "还查不清";
    default: {
      const raw = typeof result === "string" ? result.trim() : "";
      if (!raw) return "—";
      if (looksLikeMachineToken(raw)) return "还查不清";
      return raw;
    }
  }
}

/** Map planner claimType → Chinese. */
export function humanizeClaimType(claimType?: string | null): string {
  const key = normalizeKey(claimType);
  switch (key) {
    case "causal":
      return "因果推断";
    case "concept":
      return "概念说法";
    case "event":
      return "事件说法";
    case "mixed":
      return "混合说法";
    case "fact":
      return "事实陈述";
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
