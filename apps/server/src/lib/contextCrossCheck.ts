/**
 * contextCrossCheck.ts — 语境核查：截图内容真 与 配文曲解 分离（截图类谣言）。
 *
 * 产品问题：截图类谣言常是「截图内容本身是真的，但配文曲解/夹带/张冠李戴」。
 * 本模块做确定性轻量对比——用户配文的核心断言词，在「图内声明 + OCR 文本」里
 * 一个都找不到时，在报告里显式提示，但**不改变主判定**（verdict/subclaim 纪律不动）。
 *
 * 防误报红线：
 * - 只有视觉提取非空（有图且真的认出了内容）才触发；
 * - 配文核心词 <2 个不判（说不清就闭嘴）；
 * - 任何不确定都改「不提示」，宁漏不误。
 */

const STOP = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "也", "很", "到", "说", "要",
  "去", "你", "会", "着", "看", "好", "自己", "这", "那", "吗", "吧", "呢", "这个", "那个", "什么",
  "怎么", "为什么", "是不是", "真的", "假的", "到底", "究竟", "难道", "居然",
]);

/** 模态/指代词：两头都可能出现，不参与「截图有没有说这个要点」的判定。 */
const IGNORE_TOKENS = new Set([
  "截图", "图片", "照片", "视频", "录像", "这段", "这条", "这个", "那个", "到底", "群里",
  "据说", "传闻", "听说", "他们说", "网传", "网上", "话", "文字", "画面",
]);

/** 提取配文里的核心断言词（中文段按停用词切开，取 2-8 字片段；英文/数字 token 保留）。 */
export function coreClaimTokens(claim: string): string[] {
  const cleaned = claim
    .replace(/[，。！？、；：""''（）【】《》]/g, " ")
    .toLowerCase();
  const STOP_ARR = [...STOP];
  const segRe = new RegExp(`(${STOP_ARR.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g");
  const out = new Set<string>();
  for (const part of cleaned.split(/\s+/)) {
    const seg = part.trim();
    if (!seg) continue;
    if (/^(?:[a-z0-9][a-z0-9._-]{2,}|20\d{2}[年号]?\d{0,2})$/i.test(seg)) {
      out.add(seg.slice(0, 12));
      continue;
    }
    for (const piece of seg.split(segRe)) {
      const p = piece.trim();
      if (!p || p.length < 2 || STOP.has(p) || IGNORE_TOKENS.has(p)) continue;
      if (/^(20\d{2}|[0-9]{1,3}[年月日号%％]?)$/.test(p)) continue;
      if (p.length <= 6) out.add(p);
      // 统一再做 2 字滑动，让「医院」这类实体从「这家医院」里出来；限 12 个候选。
      for (let i = 0; i + 2 <= p.length && out.size < 12; i += 1) {
        const gram = p.slice(i, i + 2);
        if (!IGNORE_TOKENS.has(gram)) out.add(gram);
      }
    }
  }
  return [...out].slice(0, 12);
}

/** 拼接截图语料：图内声明 + OCR 文本 + 视觉摘要。 */
function extractVisualCorpus(visual: unknown): string {
  if (!visual || typeof visual !== "object" || Array.isArray(visual)) return "";
  const rec = visual as Record<string, unknown>;
  const parts: string[] = [];
  const pushStrings = (key: string) => {
    const v = rec[key];
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) parts.push(item.trim());
        else if (item && typeof item === "object") {
          const row = item as Record<string, unknown>;
          if (typeof row.text === "string" && row.text.trim()) parts.push(row.text.trim());
          if (typeof row.claim === "string" && row.claim.trim()) parts.push(row.claim.trim());
        }
      }
    }
  };
  pushStrings("extractedClaims");
  pushStrings("ocrTexts");
  pushStrings("visualSummary");
  return parts.join(" ");
}

export interface ContextCrossCheckResult {
  matchedTokens: string[];
  missingTokens: string[];
  /** 本次是否有图内可读内容可供对比。 */
  visible: boolean;
  /** 用户可读提示（写入 whyHardToVerify）；空数组 = 无提示。 */
  hint?: string;
}

/**
 * 对比「配文核心词」与「截图语料」。只做确定性结论：
 * 配文核心词 >=2 个且全部未在图内出现 → 提示「配文要点截图里没有」。
 */
export function contextCrossCheck(input: {
  claim: string;
  visualExtraction?: unknown;
}): ContextCrossCheckResult {
  if (!input.visualExtraction) {
    return { matchedTokens: [], missingTokens: [], visible: false };
  }
  const corpus = extractVisualCorpus(input.visualExtraction);
  if (!corpus.trim()) {
    return { matchedTokens: [], missingTokens: [], visible: false };
  }
  const tokens = coreClaimTokens(input.claim);
  if (tokens.length < 2) {
    return { matchedTokens: [], missingTokens: [], visible: true };
  }
  const matched = tokens.filter((t) => corpus.includes(t));
  const missing = tokens.filter((t) => !corpus.includes(t));
  if (matched.length > 0) {
    // 有命中不打扰；记录缺失词供审计
    return { matchedTokens: matched, missingTokens: missing, visible: true };
  }
  return {
    matchedTokens: [],
    missingTokens: missing,
    visible: true,
    hint: `配文说的要点（${missing.slice(0, 3).join("、")}）在截图内容里没有出现——要把「截图本身」和「配文加的解读」分开看。`,
  };
}

/** 挂到 finalReport：不改判定，只追加提示与 cannotSay 边界。 */
export function applyContextCrossCheckToReport(
  report: Record<string, unknown>,
  input: { claim: string; visualExtraction?: unknown }
): void {
  if (!report || typeof report !== "object") return;
  const result = contextCrossCheck(input);
  report._contextChecked = result.visible;
  if (!result.hint) return;
  const yes = (v: unknown) =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  report.whyHardToVerify = [...yes(report.whyHardToVerify), result.hint].slice(0, 8);
  const guard = "不要断言配文解读与截图内容一致；只陈述截图本身能看到的事实。";
  report.cannotSay = yes(report.cannotSay).includes(guard)
    ? report.cannotSay
    : [...yes(report.cannotSay), guard].slice(0, 6);
  report.claimContextMismatch = {
    missingTokens: result.missingTokens,
    hint: result.hint,
  };
}