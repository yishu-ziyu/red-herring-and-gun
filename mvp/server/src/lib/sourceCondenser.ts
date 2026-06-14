/**
 * sourceCondenser.ts — 把搜索结果浓缩成 奕枢风格 的精炼摘要
 *
 * 用一个 LLM 调用批量处理所有来源,每个来源产 1-3 句精炼摘要。
 * 失败/超时返回空 Map,UI 自动 fallback 到原始 snippet。
 *
 * 风格基线（来自 yishu-style skill 7 条铁律）:
 * - 一段一观点,1-3 句浓缩
 * - 零修辞零情绪（禁词: 震惊/竟然/原来/那一刻/意味着什么）
 * - 数字精确（"8 倍"好于"几倍"）
 * - 客观对位,不带情绪的对比
 * - 直接引用关键术语(人名/机构/数字/日期)
 * - 不补充原摘要里没有的信息
 */

import { callAgentWithFallback } from "./providerRouter.js";

const YISHU_SYSTEM_PROMPT = [
  "# 角色",
  "你是一个跟阮一峰风格一致的技术写作者,正在为一篇「信息核查报告」做来源摘要。",
  "",
  "# 任务",
  "对每个搜索来源写一段精炼摘要:",
  "1. 1-3 句话,每句一个观点",
  "2. 一段一观点,不碎不堆",
  "3. 零修辞零情绪,禁词: 震惊/竟然/原来/那一刻/意味着什么/不为人知",
  "4. 数字精确: '8 倍'好于'几倍';'5 GHz'好于'较高频段'",
  "5. 客观对位: 不要'国内落后/国外先进'这种带情绪的对比",
  "6. 直接引用关键术语(人名/机构/数字/日期/结论),不加'我觉得/我认为'",
  "7. 干净收尾: 不要'希望对你有帮助/读到这里'",
  "8. 不补充原摘要里没有的信息",
  "",
  "# 输出格式（严格 JSON 对象,不是数组,顶层必须包含 snippets 键）",
  '{"snippets": [{"id": "S1", "snippet": "..."}, {"id": "S2", "snippet": "..."}]}',
  "",
  "# 边界",
  "- 长度: 每个 snippet 30-150 字",
  "- 如果原内容是模板化/纯链接,没有实质信息: snippet 写 '模板化内容,无实质信息'",
  "- 如果原内容超出 200 字但都是同义反复: 取最具体的一段浓缩",
  "",
  "# 自检",
  "写完每个 snippet 必跑:",
  "- 是否有'震惊/竟然/原来/那一刻' = 应为 0 处",
  "- 是否有具体数字(年份/百分比/剂量/频率) = 至少 1 处",
  "- 是否能在 30-150 字内讲清楚这个来源在讲什么",
].join("\n");

// 强制 JSON object 输出的 schema（router 看到 responseSchema 会用 json_object 约束）
const CONDENSER_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    snippets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          snippet: { type: "string" },
        },
        required: ["id", "snippet"],
      },
    },
  },
  required: ["snippets"],
};

export interface RawSourceForCondense {
  id: string;
  title: string;
  rawSnippet: string;
}

export interface CondensedSnippet {
  id: string;
  snippet: string;
}

const MAX_SNIPPET_INPUT_CHARS = 1500;
const MIN_RAW_SNIPPET_CHARS = 20;

/**
 * 把搜索来源批量浓缩成 奕枢风格 摘要。
 * 返回 Map<id, condensedSnippet>;失败/超时/输出解析失败时返回空 Map。
 */
export async function condenseSourcesInYishuStyle(
  env: Record<string, string>,
  sources: RawSourceForCondense[],
  claim: string
): Promise<Map<string, string>> {
  if (sources.length === 0) return new Map();

  const usable = sources
    .map((s) => ({
      id: s.id,
      title: s.title.slice(0, 100),
      rawSnippet: s.rawSnippet.slice(0, MAX_SNIPPET_INPUT_CHARS),
    }))
    .filter((s) => s.rawSnippet.length >= MIN_RAW_SNIPPET_CHARS);

  if (usable.length === 0) return new Map();

  const userContent = JSON.stringify({
    claim,
    sources: usable,
  }, null, 2);

  try {
    const result = await callAgentWithFallback({
      agentId: "source_condenser",
      systemPrompt: YISHU_SYSTEM_PROMPT,
      userContent,
      responseSchema: CONDENSER_RESPONSE_SCHEMA,
      maxTokens: 2400,
      env,
      // 不传 codexBin/codexBypass 等 - 让 router 按默认 fallback 链走
      reasoningEffort: "low",
      codexBin: "",
    });

    // result.output 已是 schema 解析后的对象: { snippets: [{id, snippet}] }
    const output = result.output;
    const snippets = Array.isArray(output?.snippets) ? output.snippets : [];

    const map = new Map<string, string>();
    for (const entry of snippets) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.snippet === "string" &&
        entry.snippet.trim().length > 0
      ) {
        const trimmed = entry.snippet.trim();
        map.set(entry.id, trimmed.length > 200 ? trimmed.slice(0, 200) + "…" : trimmed);
      }
    }
    return map;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[sourceCondenser] 浓缩失败，回退到原 snippet: ${reason}`);
    return new Map();
  }
}

/**
 * 把搜索来源批量浓缩成 奕枢风格 摘要,直接挂到 search360Result.sources[i].condensedSnippet。
 * 失败/超时静默:search360Result.sources 保持原样,UI 端 fallback 到原 snippet。
 */
export async function attachCondensedSnippets(
  env: Record<string, string>,
  claim: string,
  search360Result: any
): Promise<void> {
  if (!search360Result || !Array.isArray(search360Result.sources)) return;
  const sources = search360Result.sources as Array<Record<string, unknown>>;
  if (sources.length === 0) return;

  const inputForCondenser = sources.map((s, i) => ({
    id: String(s.id ?? `S${i + 1}`),
    title: String(s.title ?? ""),
    rawSnippet: String(s.snippet ?? s.summary ?? s.content ?? s.desc ?? ""),
  }));

  const condensed = await condenseSourcesInYishuStyle(env, inputForCondenser, claim);
  if (condensed.size === 0) return;

  for (const source of sources) {
    const id = String(source.id ?? "");
    if (id && condensed.has(id)) {
      source.condensedSnippet = condensed.get(id);
    }
  }
}

/**
 * 从可能是 markdown 包裹的文本中抽出 JSON 数组。
 * 处理三种形态: 纯数组 / ```json\n[...]\n``` / 数组前后有散文本。
 * (当前 condenseSourcesInYishuStyle 改用 responseSchema + snippets 包装对象,
 * 不再需要；但保留作为纯文本 fallback 工具。)
 */
function extractJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  // 形态 1: 纯 JSON
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  // 形态 2: ```json ... ``` 包裹
  const fence = trimmed.match(/```(?:json)?\s*(\[[\s\S]*?\])\s*```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  // 形态 3: 在散文本里嵌入一个 JSON 数组
  const embedded = trimmed.match(/\[[\s\S]*?\{[\s\S]*?"id"[\s\S]*?"snippet"[\s\S]*?\}[\s\S]*?\]/);
  if (embedded) {
    try {
      const parsed = JSON.parse(embedded[0]);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through
    }
  }

  return null;
}