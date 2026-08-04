/**
 * bilingualNormalize.ts — Plan P2-6 · 多语言（双语规范化）
 *
 * 借鉴秘塔 + 秘塔学术模式的双语搜索经验：
 *   - 检测输入语言（zh / en / mixed）
 *   - 翻译一致性：同子命题的中英文版本应能在 factCheckResult 中对齐
 *   - 不冒充原文证据：翻译推断的证据不得当作原文引用
 *
 * 设计原则（plan §4）：
 *   - 先英→中规范化（保留原文 + 翻译 span）
 *   - 翻译仅用于子命题对齐；判定结论仍以原文为锚
 *   - 语言检测失败时默认 zh（当前 MVP 主要语言）
 */

export type DetectedLanguage = "zh" | "en" | "mixed" | "unknown";

export interface NormalizedClaim {
  original: string;
  detectedLanguage: DetectedLanguage;
  /** 规范化版本（去除多余空白） */
  normalized: string;
  /** 翻译版本（如能翻译） */
  translation?: string;
  /** 对齐的子命题 ID（同中英文版本应同 ID） */
  alignKey: string;
}

const ZH_RANGE = /[\u4e00-\u9fff]/;
const EN_RANGE = /[A-Za-z]/;

/**
 * 检测语言（按字符集覆盖度）：
 *   - 中文字符 > 30% 字符总数 → zh
 *   - 英文字符 > 70% → en
 *   - 中英都 ≥ 20% → mixed
 *   - 其它 → unknown
 */
export function detectLanguage(text: string): DetectedLanguage {
  if (!text || text.trim().length === 0) return "unknown";
  const cleaned = text.replace(/\s+/g, "");
  if (cleaned.length === 0) return "unknown";

  const zhCount = (cleaned.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const enCount = (cleaned.match(/[A-Za-z]/g) ?? []).length;

  const zhRatio = zhCount / cleaned.length;
  const enRatio = enCount / cleaned.length;

  if (zhRatio > 0.3 && enRatio > 0.2) return "mixed";
  if (zhRatio > 0.3) return "zh";
  if (enRatio > 0.7) return "en";
  return "unknown";
}

/**
 * 生成对齐键（中英文版本的同一说法应产出同 alignKey）。
 *
 * 算法：去除所有空白 + 转小写 + 取前 32 字符的 SHA-256-like 哈希。
 * MVP 简化：使用 32 字符前缀。
 */
export function makeAlignKey(text: string): string {
  const cleaned = text.replace(/\s+/g, "").toLowerCase();
  return cleaned.slice(0, 32);
}

/**
 * 规范化 claim：去除多余空白，统一标点。
 */
export function normalizeClaim(text: string): NormalizedClaim {
  const normalized = text.replace(/\s+/g, " ").trim();
  return {
    original: text,
    detectedLanguage: detectLanguage(text),
    normalized,
    alignKey: makeAlignKey(normalized),
  };
}

/**
 * 对齐两个 claim（中英版本）。
 * 真实场景应接翻译 API（DeepL / 百度翻译 / OpenAI）；MVP 仅基于归一化。
 */
export function alignClaims(a: NormalizedClaim, b: NormalizedClaim): boolean {
  return a.alignKey === b.alignKey;
}

/**
 * 拆分 mixed claim 为中英两部分（启发式：第一个中文段落 + 第一个英文段落）。
 */
export function splitBilingual(claim: string): { zh: string; en: string } {
  const m = claim.match(/([\u4e00-\u9fff][^A-Za-z]*)/);
  if (!m) return { zh: "", en: claim };
  const zhPart = m[1]?.trim() ?? "";
  const enPart = claim.replace(zhPart, "").trim();
  return { zh: zhPart, en: enPart };
}

/**
 * 闸门：判断给定翻译是否为推断（不可当原文证据使用）。
 */
export function isInferredTranslation(originalLang: DetectedLanguage, claimLang: DetectedLanguage): boolean {
  return originalLang !== claimLang && originalLang !== "unknown" && claimLang !== "unknown";
}