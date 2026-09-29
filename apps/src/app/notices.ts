/**
 * 产品壳里的提示文案与传输错误的公开化。
 */

/**
 * 超时不再一锤定音时的提示（契约 docs/evals/2026-09-12-mainpath-p0.md Change C）。
 * 服务端总超时之后管线仍在跑，这时等结果是可选的：人还在就继续跟着看，
 * 离开或刷新也能从同一条 run 取回同一份结论。
 */
export const TIMEOUT_PENDING_NOTICE = {
  zh: "还在查，可以离开页面，稍后回来或刷新能看到结果",
  en: "Still investigating. You can leave this page — come back later or refresh to see the result.",
};

/**
 * 打开历史条目失败时的提示（契约 docs/evals/2026-09-12-mainpath-p1.md Change G）。
 * 服务端 404/报错、网络中断、旧记录读不出可用快照，这三种都是「点了没反应」，
 * 必须说出来；条目本身的状态不动，用户还能再试。
 */
export const HISTORY_OPEN_FAILED_NOTICE = {
  zh: "这条历史暂时打不开，条目还留在列表里，可以稍后重试。",
  en: "This saved check can't be opened right now. It stays in your list; try again later.",
};

/** 浏览器把接口进程死掉写成 Failed to fetch，不能原样摊在首页主区。 */
export function publicTransportError(message: string, fallback: string): string {
  if (!message || /failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    return fallback;
  }
  return message;
}
