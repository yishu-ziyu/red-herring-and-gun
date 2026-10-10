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

/** 一句话在来源里的原文（原字，空白归一）；不在来源里返回空串。 */
function locate(sentence: string, source: string): string {
  // 句末标点不比：模型常把原文里的「，」抄成「。」。
  const needle = folded(sentence.replace(/[。｡！？!?，,；;：:]+$/, "")).chars;
  const hay = folded(source);
  const start = needle ? hay.chars.indexOf(needle) : -1;
  if (start < 0) return "";
  return source.slice(hay.at[start], hay.at[start + needle.length - 1]! + 1).replace(/\s+/g, " ").trim();
}

/** 和这一截共有的汉字数：模型抄了好几句时，用它挑出讲这一截的那一句。 */
function overlap(sentence: string, partText: string): number {
  const own = new Set(partText.match(/\p{Script=Han}/gu) ?? []);
  return new Set((sentence.match(/\p{Script=Han}/gu) ?? []).filter((ch) => own.has(ch))).size;
}

/**
 * 核对通过返回来源里的一句（原字，空白归一），否则返回空串。
 * 2026-10-10 的 6 次调查里，47 次拒绝有 34 次是模型抄了不止一句、8 次带省略号，只有 5 次不是原文。
 * 所以按句号和省略号切开，逐句核对是不是原文，再挑和这一截共有汉字最多的那一句。
 */
export function verbatimQuote(quote: unknown, sourceText: unknown, partText = ""): string {
  const text = typeof quote === "string" ? quote.replace(/\s+/g, " ").trim() : "";
  const source = typeof sourceText === "string" ? sourceText : "";
  // 记下被拒的句子和比对的来源开头，下次运行就能看出是模型改写了还是比对太严。
  const reject = (reason: string) => {
    if (text) console.warn(`[quote] rejected (${reason}) quote=${JSON.stringify(text.slice(0, 120))} source=${JSON.stringify(source.replace(/\s+/g, " ").slice(0, 160))}`);
    return "";
  };
  if (!text) return "";
  const sentences = text
    .split(/(?<=[。｡！？!?])|…+|\.{3,}/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 6);
  const found = sentences
    .map((sentence) => locate(sentence, source))
    .filter((original) => original.length >= 6 && original.length <= QUOTE_MAX);
  if (found.length === 0) return reject(sentences.length === 0 ? "too short" : "not in source text");
  return found.reduce((best, cur) => (overlap(cur, partText) > overlap(best, partText) ? cur : best));
}

/** 原文链接 + 文本片段（#:~:text=），浏览器打开后高亮这一句。 */
export function quoteLinkUrl(url: string, quote: string | undefined): string {
  if (!/^https?:\/\//i.test(url) || url.includes(":~:")) return url;
  const text = (quote ?? "").trim().replace(/[。｡．！？!?；;，,、：:\s]+$/, "");
  if (!text) return url;
  const encoded = encodeURIComponent(text).replace(/-/g, "%2D");
  return url.includes("#") ? `${url}:~:text=${encoded}` : `${url}#:~:text=${encoded}`;
}
