/** 一份来源最多取得的正文字数；达到上限即视为只取得部分正文。 */
export const SOURCE_CONTENT_MAX_CHARS = 12_000;

export type MaterialReadLevel = "read" | "partial" | "none";

/**
 * 每条依据旁的读取状态小标签（结果页和分享页同一口径）：
 * 一句大白话同时交代这句摘自正文还是搜索摘要、正文读到没有。缺省一律按没读到说。
 */
export function materialReadTag(
  link: { excerptKind?: string },
  source: { fetchStatus?: string; excerptKind?: string }
): { text: string; level: MaterialReadLevel } {
  const status = source.fetchStatus;
  if (link.excerptKind === "page-excerpt") {
    return status === "truncated" ? { text: "只读到一部分正文", level: "partial" } : { text: "读过正文", level: "read" };
  }
  if (link.excerptKind === "search-snippet") {
    if (status === "fetched" && source.excerptKind === "page-excerpt") return { text: "读过正文，这句摘自搜索摘要", level: "read" };
    if (status === "truncated") return { text: "只读到一部分正文，这句摘自搜索摘要", level: "partial" };
    if (status === "failed") return { text: "正文没打开，只看到搜索摘要", level: "none" };
    if (status === "restricted") return { text: "正文要登录或付费，没读到", level: "none" };
    return { text: "只看到搜索摘要", level: "none" };
  }
  return { text: "不清楚这句摘自正文还是摘要", level: "none" };
}

/** 展开「看原文上下文」时，说明这段文字是什么。 */
export function materialPassageLabel(kind: unknown): string {
  if (kind === "search-snippet") return "这段是搜索结果里的摘要，不是网页正文";
  if (kind === "page-excerpt") return "这段是这次读到的网页正文";
  return "这段材料的类型不清楚";
}

/** 取得时间不代替发布日期；旧材料缺少时间时保持未知。 */
export function materialRetrievedLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "取得时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "取得时间未知";
  return `取得于 ${date.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`;
}
