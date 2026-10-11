/** 结果页和分享页使用同一口径；材料类型缺失时不能从网址或引号推断。 */
export function materialKindLabel(kind: unknown): string {
  if (kind === "search-snippet") return "搜索摘要";
  if (kind === "page-excerpt") return "已取得的正文摘录";
  return "材料类型未知";
}

export function sourceReadStatus(source: { fetchStatus?: string; excerptKind?: string }): string {
  switch (source.fetchStatus) {
    case "snippet-only": return "只取得搜索摘要，尚未读取正文";
    case "fetched": return source.excerptKind === "page-excerpt" ? "已取得可访问的正文" : "正文读取情况未知";
    case "truncated": return "只取得部分正文，未读部分未知";
    case "restricted": return "正文访问受限";
    case "failed": return "正文读取失败";
    default: return "正文读取情况未知";
  }
}

/** 取得时间不代替发布日期；旧材料缺少时间时保持未知。 */
export function materialRetrievedLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "取得时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "取得时间未知";
  return `取得于 ${date.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`;
}
