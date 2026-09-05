/**
 * missionShell/labels.ts
 *
 * Display-layer humanization for mission process shell.
 * Machine values stay on MissionShellModel; UI maps them here.
 */

const OLD_MIXED_STAMP = "只能信一部分";

function isOldMixedStamp(value: string): boolean {
  return value.replace(/[。．.]+$/u, "") === OLD_MIXED_STAMP;
}

function labelForOldMixedStamp(verdictType?: string | null): string {
  return normalizeKey(verdictType) === "partial" ? "部分成立" : "有真有假";
}

/** 显示边界：只改句首旧总判词，不改库存，也不改其它自然语言。 */
function rewriteLeadingOldMixedStamp(text: string, verdictType?: string | null): string {
  const raw = text.trim();
  if (!raw.startsWith(OLD_MIXED_STAMP)) return raw;
  const label = labelForOldMixedStamp(verdictType);
  const rest = raw.slice(OLD_MIXED_STAMP.length).replace(/^[。．.\s]+/u, "").trim();
  return rest ? `${label}。${rest}` : label;
}

/**
 * 结果胶囊用。旧报告可能持久化了「只能信一部分」，只在显示时改成新文案，不改库存。
 * 未知自然语言原样留下。
 */
export function displayFaceVerdict(
  faceVerdict?: string | null,
  verdictType?: string | null,
): string {
  const face = typeof faceVerdict === "string" ? faceVerdict.trim() : "";
  if (!face) return humanizeVerdictType(verdictType);
  return rewriteLeadingOldMixedStamp(face, verdictType);
}

/**
 * 分享区用。库存 recommendation 若以旧总判词开头，只替换这一截；其余原文留下。
 */
export function displayShareAdvice(
  recommendation?: string | null,
  verdictType?: string | null,
): string {
  const rec = typeof recommendation === "string" ? recommendation.trim() : "";
  if (!rec) return "";
  if (isOldMixedStamp(rec)) return shareAdviceFallback(verdictType);
  return rewriteLeadingOldMixedStamp(rec, verdictType);
}

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
      return "有真有假";
    case "partial":
      return "部分成立";
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
function shareAdviceFallback(verdictType?: string | null): string {
  const key = normalizeKey(verdictType);
  if (key === "false" || key === "rumor") {
    return "不能信。公开材料不支持这句话。";
  }
  if (key === "true") {
    return "能信。看来源，不要改写成更满的说法。";
  }
  if (key === "mixed" || key === "mixed_misleading") {
    return "有真有假。哪一截成立、哪一截没有依据，看下面。";
  }
  if (key === "partial") {
    return "部分成立。哪一层站住、哪一层没有，看下面。";
  }
  if (key === "unverified" || key === "uncertain" || key === "maybe" || key === "unknown") {
    return "还查不清。先别当已经证实。";
  }
  return "先看来源，再判断能不能信。";
}

export function shareAdviceFromVerdict(
  recommendation?: string | null,
  verdictType?: string | null
): string {
  const rec = typeof recommendation === "string" ? recommendation.trim() : "";
  if (rec) return displayShareAdvice(rec, verdictType);
  return shareAdviceFallback(verdictType);
}

/** Map fact_checker factCheckResult → Chinese. */
export function humanizeFactCheckResult(result?: string | null): string {
  const key = normalizeKey(result);
  switch (key) {
    case "true":
      return "能信";
    case "false":
      return "不能信";
    case "mixed_misleading":
    case "mixed":
      return "有真有假";
    case "partial":
      return "部分成立";
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
