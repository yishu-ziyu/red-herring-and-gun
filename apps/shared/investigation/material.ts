/** 一份来源最多取得的正文字数；达到上限即视为只取得部分正文。 */
export const SOURCE_CONTENT_MAX_CHARS = 12_000;

export type MaterialReadLevel = "read" | "partial" | "none";

/**
 * 每条依据旁的读取状态小标签（结果页和分享页同一口径）：
 * 一句话同时交代这句摘自正文还是搜索摘要、正文读到没有。缺省一律按没读到说。
 */
export function materialReadTag(
  link: { excerptKind?: string },
  source: { fetchStatus?: string; excerptKind?: string }
): { text: string; level: MaterialReadLevel } {
  const status = source.fetchStatus;
  if (link.excerptKind === "page-excerpt") {
    return status === "truncated" ? { text: "只读到部分正文", level: "partial" } : { text: "已读正文", level: "read" };
  }
  if (link.excerptKind === "search-snippet") {
    if (status === "fetched" && source.excerptKind === "page-excerpt") return { text: "已读正文，这句摘自搜索摘要", level: "read" };
    if (status === "truncated") return { text: "只读到部分正文，这句摘自搜索摘要", level: "partial" };
    if (status === "failed") return { text: "正文无法打开，只有搜索摘要", level: "none" };
    if (status === "restricted") return { text: "正文需要登录或付费，未能读取", level: "none" };
    return { text: "只有搜索摘要", level: "none" };
  }
  return { text: "无法确定这句出自正文还是摘要", level: "none" };
}

/** 展开「查看上下文」时，说明这段文字是什么。 */
export function materialPassageLabel(kind: unknown): string {
  if (kind === "search-snippet") return "这段是搜索结果中的摘要，不是网页正文";
  if (kind === "page-excerpt") return "这段是本次读取的网页正文";
  return "这段材料的类型不明";
}

/** 取得时间不代替发布日期；旧材料缺少时间时保持未知。 */
export function materialRetrievedLabel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return "取得时间未知";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "取得时间未知";
  return `取得于 ${date.toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" })}`;
}

/**
 * 每条来源读没读到正文，由系统标在来源旁边。模型写局限说明时还不知道判定后补读的结果，
 * 它写的「只有搜索摘要、未读取正文」可能是错的。
 * 所以去掉模型文字里讲读取状态的分句，其余照留；「未取得研究报告全文」这类讲缺少原始资料的话不算读取状态。
 */
const READ_STATUS = /(搜索|检索)摘要|(未|没有|没能|无法)(读取|读到|打开|取得)(原?网页)?正文|(只|仅)(有|拿到|取得)了?摘要/;
export function withoutReadStatus(text: string): string {
  const kept = text
    .split(/(?<=[。；;！？])/)
    .map((sentence) => {
      const clauses = sentence.split(/(?<=[，,])/);
      const rest = clauses.filter((c) => !READ_STATUS.test(c));
      if (rest.length === clauses.length) return sentence;
      return rest.join("").replace(/[，,]\s*$/, "");
    })
    .join("")
    .replace(/^[，,；;。\s]+/, "")
    .trim();
  return kept && !/[。！？]$/.test(kept) ? `${kept.replace(/[，,；;]+$/, "")}。` : kept;
}

/** 代码里管原句的一部分叫「一截」，用户看不懂；模型照着提示词也会写出来。 */
export function plainPartWording(text: string): string {
  return text.replace(/(两|三|四|五|几|各|每|这一|那一|另一|某一|一)截/g, "$1点");
}
