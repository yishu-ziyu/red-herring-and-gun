import type { LoopTodo, LoopTool, TodoStatus } from "./types.js";

const TODO_STATUSES = new Set<TodoStatus>(["pending", "active", "done", "error"]);
const FETCH_TIMEOUT_MS = 8000;
const FETCH_MAX_CHARS = 6000;

export type SearchFn = (query: string) => Promise<unknown>;
export type FetchFn = (url: string) => Promise<unknown>;

export function compactSearchResult(raw: unknown): {
  sources: Array<{ url: string; title: string; snippet: string }>;
  answer?: string;
  error?: string;
} {
  if (!raw || typeof raw !== "object") return { sources: [] };
  const rec = raw as Record<string, unknown>;
  if (rec._source === "tool-error" || typeof rec.error === "string") {
    return {
      sources: [],
      error: typeof rec.error === "string" ? rec.error : String(rec.traceText ?? "检索失败"),
    };
  }
  const sources: Array<{ url: string; title: string; snippet: string }> = [];
  const seen = new Set<string>();
  const list = Array.isArray(rec.sources) ? rec.sources : [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      url,
      title: typeof row.title === "string" ? row.title.slice(0, 200) : url,
      snippet: typeof row.snippet === "string" ? row.snippet.slice(0, 320) : "",
    });
    if (sources.length >= 6) break;
  }
  const answer = typeof rec.answer === "string" ? rec.answer.slice(0, 500) : undefined;
  return answer ? { sources, answer } : { sources };
}

export function collectHttpUrls(raw: unknown, into: Set<string>): void {
  if (!raw || typeof raw !== "object") return;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.url === "string" && /^https?:\/\//i.test(rec.url)) into.add(rec.url.trim());
  if (Array.isArray(rec.sources)) {
    for (const item of rec.sources) collectHttpUrls(item, into);
  }
}

function asTodoStatus(value: unknown): TodoStatus {
  const key = typeof value === "string" ? value.trim() : "";
  return TODO_STATUSES.has(key as TodoStatus) ? (key as TodoStatus) : "pending";
}

export function parseTodos(raw: unknown): LoopTodo[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { todos?: unknown }).todos)
      ? (raw as { todos: unknown[] }).todos
      : [];
  const out: LoopTodo[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i += 1) {
    const item = list[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = typeof rec.label === "string" ? rec.label.trim() : typeof rec.content === "string" ? rec.content.trim() : "";
    if (!label) continue;
    const id = typeof rec.id === "string" && rec.id.trim() ? rec.id.trim() : `t${i + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: label.slice(0, 80), status: asTodoStatus(rec.status) });
    if (out.length >= 12) break;
  }
  return out;
}

function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  return h === "::1" || h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd");
}

export function stripHtml(html: string): { title: string; text: string } {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = (titleMatch?.[1] ?? "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FETCH_MAX_CHARS);
  return { title, text };
}

export async function fetchPublicPage(url: string): Promise<{ url: string; title: string; text: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("链接无效");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("只能打开 http(s) 链接");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("不能打开内网地址");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { Accept: "text/html,text/plain;q=0.9,*/*;q=0.5" },
    });
    if (!response.ok) throw new Error(`页面返回 ${response.status}`);
    const html = await response.text();
    const { title, text } = stripHtml(html);
    return { url: parsed.toString(), title: title || parsed.hostname, text };
  } finally {
    clearTimeout(timer);
  }
}

export function createLoopTools(opts: {
  search: SearchFn;
  fetchPage?: FetchFn;
  allowedUrls: Set<string>;
  todos: { current: LoopTodo[] };
}): LoopTool[] {
  const fetchPage = opts.fetchPage ?? fetchPublicPage;

  return [
    {
      name: "todo_write",
      description: "写下或更新核查任务板。",
      inputSchema: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                label: { type: "string" },
                status: { type: "string" },
              },
            },
          },
        },
        required: ["todos"],
      },
      execute: (args) => {
        const todos = parseTodos(args);
        if (todos.length > 0) opts.todos.current = todos;
        const allDone =
          opts.todos.current.length > 0 && opts.todos.current.every((item) => item.status === "done");
        return allDone
          ? { todos: opts.todos.current, hint: "任务已全部完成，下一步必须 submit_verdict。" }
          : { todos: opts.todos.current };
      },
    },
    {
      name: "web_search",
      description: "检索公开材料。",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      execute: async (args) => {
        const query = typeof args.query === "string" ? args.query.trim() : "";
        if (!query) return { sources: [], error: "缺少 query" };
        const compact = compactSearchResult(await opts.search(query));
        collectHttpUrls(compact, opts.allowedUrls);
        return compact;
      },
    },
    {
      name: "web_fetch",
      description: "打开本次检索返回的页面。",
      inputSchema: {
        type: "object",
        properties: { url: { type: "string" } },
        required: ["url"],
      },
      execute: async (args) => {
        const url = typeof args.url === "string" ? args.url.trim() : "";
        if (!/^https?:\/\//i.test(url)) return { error: "缺少 http(s) url" };
        if (!opts.allowedUrls.has(url)) {
          return { error: "只能打开本次检索返回的链接", url };
        }
        const page = await fetchPage(url);
        return page;
      },
    },
    {
      name: "submit_verdict",
      description: "提交判断并结束。",
      inputSchema: {
        type: "object",
        properties: {
          verdictType: { type: "string" },
          conclusion: { type: "string" },
          claimAtoms: { type: "array" },
          claimAtomTypes: { type: "array" },
          subclaimVerdicts: { type: "array" },
          keyFindings: { type: "array" },
        },
        required: ["verdictType", "conclusion"],
      },
      execute: (args) => ({ submitted: true, ...args }),
    },
  ];
}
