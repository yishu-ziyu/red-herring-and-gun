import { isBlockedUrl } from "./ssrfGuard.js";
import type { AtomSearchBundle, AtomSearchSource } from "./atomSearch.js";
import { SOURCE_CONTENT_MAX_CHARS } from "../../../shared/investigation/material.js";

const MAX_BYTES = 64_000;
const MAX_URLS = 4;
const TIMEOUT_MS = 15_000;
const ACCESS_WALL = /sina visitor system|登录后查看|登录可见|登录后可见|请先登录|需要登录|sign in to continue|log in to continue|\bpassport\.[a-z0-9-]+\.(?:com|cn|net)\b|captcha|access denied|verify you are human/i;

type ContentResult = Pick<AtomSearchSource, "excerptKind" | "fetchStatus" | "fetchNote" | "retrievedAt"> & { snippet?: string };

async function readSource(url: string, signal: AbortSignal): Promise<ContentResult> {
  if (!/^https?:\/\//i.test(url) || isBlockedUrl(url) || new URL(url).username || new URL(url).password) {
    return { fetchStatus: "restricted", fetchNote: "网址被安全规则拦截，未读取正文，保留检索摘要" };
  }
  try {
    const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
      signal,
      redirect: "error",
      headers: { Accept: "text/plain" },
    });
    if (!response.ok) {
      await response.body?.cancel();
      return {
        fetchStatus: [401, 403, 429, 451].includes(response.status) ? "restricted" : "failed",
        fetchNote: `正文读取返回 HTTP ${response.status}，保留检索摘要`,
      };
    }
    const reader = response.body?.getReader();
    if (!reader) return { fetchStatus: "failed", fetchNote: "正文读取为空，保留检索摘要" };
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    let truncated = false;
    try {
      while (true) {
        signal.throwIfAborted();
        const { done, value } = await reader.read();
        if (done) { text += decoder.decode(); break; }
        const remaining = MAX_BYTES - bytes;
        bytes += value.byteLength;
        text += decoder.decode(value.subarray(0, remaining), { stream: true });
        if (bytes >= MAX_BYTES || text.length > SOURCE_CONTENT_MAX_CHARS + 2_000) {
          truncated = true;
          await reader.cancel();
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
    const returnedUrl = text.match(/^URL Source:\s*(https?:\/\/\S+)/m)?.[1];
    if (returnedUrl && isBlockedUrl(returnedUrl)) {
      return { fetchStatus: "restricted", fetchNote: "正文跳转地址被安全规则拦截，保留检索摘要" };
    }
    const contentStart = text.search(/^Markdown Content:\s*$/m);
    const content = (contentStart >= 0 ? text.slice(contentStart).replace(/^Markdown Content:\s*/, "") : text).trim();
    if (ACCESS_WALL.test(content) || /^Warning:.*(?:[45]\d\d|error)/im.test(text)) {
      return { fetchStatus: "restricted", fetchNote: "正文存在登录、验证或访问限制，保留检索摘要" };
    }
    if (content.length < 200) {
      return { fetchStatus: "failed", fetchNote: "正文为空或过短，保留检索摘要" };
    }
    truncated ||= content.length > SOURCE_CONTENT_MAX_CHARS;
    return {
      snippet: content.slice(0, SOURCE_CONTENT_MAX_CHARS),
      excerptKind: "page-excerpt",
      fetchStatus: truncated ? "truncated" : "fetched",
      retrievedAt: new Date().toISOString(),
      ...(truncated ? { fetchNote: "正文读取达到大小上限，仅核对已读部分；未读部分未知" } : {}),
    };
  } catch {
    signal.throwIfAborted();
    return { fetchStatus: "failed", fetchNote: "正文读取失败，保留检索摘要" };
  }
}

/** 只提升本轮检索材料；不增加搜索或模型调用，所有消费者仍读同一 canonical 材料。 */
export async function enrichSearchSources(bundle: AtomSearchBundle, signal?: AbortSignal, deadline?: number, selectedUrls: readonly string[] = [], onSource?: () => void): Promise<void> {
  signal?.throwIfAborted();
  const urls = new Set<string>();
  const lists = Object.values(bundle.byAtomKey);
  for (const url of selectedUrls) {
    if (urls.size >= MAX_URLS) break;
    if (lists.some((list) => list.some((source) => source.url === url && !source.provenance && source.excerptKind !== "page-excerpt"))) urls.add(url);
  }
  if (!urls.size) return;
  const timeout = Math.min(TIMEOUT_MS, deadline === undefined ? TIMEOUT_MS : Math.max(0, deadline - Date.now()));
  const controller = new AbortController();
  const cancel = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    await Promise.all([...urls].map(async (url) => {
      let result: ContentResult;
      try { result = await readSource(url, controller.signal); }
      catch {
        signal?.throwIfAborted();
        result = { fetchStatus: "failed", fetchNote: "正文读取超时，保留检索摘要" };
      }
      signal?.throwIfAborted();
      // 一份读完就保留；其他读取被取消，不能撤回此前已取得的材料。
      for (const list of [...lists, bundle.aggregate.sources, ...bundle.forAgent.map((item) => item.sources)]) {
        for (const source of list) {
          if (source.url === url && !source.provenance && source.excerptKind !== "page-excerpt") Object.assign(source, { fetchNote: undefined }, result);
        }
      }
      onSource?.();
    }));
    signal?.throwIfAborted();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", cancel);
  }
}
