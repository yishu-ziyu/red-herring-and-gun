/**
 * 证据行上引用的那一句（#141 part c）。
 *
 * 这一句由核查模型挑：它从来源里逐字抄下支持或反驳这一截的那句话。
 * 我们只核对它真的是原文：忽略空白、全角半角和引号写法后，必须是本轮拿到的来源文字的一段，而且只有一句。
 * 核对不过就不存，界面改为显示我们的概括，不拿段落开头或别的句子顶替。
 */

export const QUOTE_MAX = 100;

// 比对时忽略空白、全角半角（｡ 与 。、, 与 ，）和引号样式：模型常把这些抄成另一种写法。
// 存下来的仍是来源里的原字，跳转片段才能在原网页上找到。
const QUOTE_MARKS: Record<string, string> = { "“": '"', "”": '"', "„": '"', "「": '"', "」": '"', "‘": "'", "’": "'" };
function folded(text: string): { chars: string; at: number[] } {
  let chars = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (/\s/.test(ch)) continue;
    const norm = QUOTE_MARKS[ch] ?? ch.normalize("NFKC");
    for (const c of norm) {
      chars += c;
      at.push(i);
    }
  }
  return { chars, at };
}

/** 核对通过返回来源里的这一句（原字，空白归一），否则返回空串。 */
export function verbatimQuote(quote: unknown, sourceText: unknown): string {
  const text = typeof quote === "string" ? quote.replace(/\s+/g, " ").trim() : "";
  const source = typeof sourceText === "string" ? sourceText : "";
  if (text.length < 6 || text.length > QUOTE_MAX) return "";
  if (/…|\.\.\./.test(text)) return "";
  // 一句话：句末标点只能出现在最后。
  if (/[。｡！？!?]/.test(text.slice(0, -1))) return "";
  const needle = folded(text).chars;
  const hay = folded(source);
  const start = hay.chars.indexOf(needle);
  if (!needle || start < 0) return "";
  const original = source.slice(hay.at[start], hay.at[start + needle.length - 1]! + 1).replace(/\s+/g, " ").trim();
  return original.length <= QUOTE_MAX ? original : "";
}

/** 原文链接 + 文本片段（#:~:text=），浏览器打开后高亮这一句。 */
export function quoteLinkUrl(url: string, quote: string | undefined): string {
  if (!/^https?:\/\//i.test(url) || url.includes(":~:")) return url;
  const text = (quote ?? "").trim().replace(/[。｡．！？!?；;，,、：:\s]+$/, "");
  if (!text) return url;
  const encoded = encodeURIComponent(text).replace(/-/g, "%2D");
  return url.includes("#") ? `${url}:~:text=${encoded}` : `${url}#:~:text=${encoded}`;
}
