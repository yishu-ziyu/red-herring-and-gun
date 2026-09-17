import type { InvestigationClaim } from "../lib/investigation";

const BUDGET_GAP = "检索预算未覆盖";
const MODEL_UNCOVERED = "模型未覆盖";

function hasBudgetOrModelLeftover(claim: InvestigationClaim): boolean {
  if (claim.gaps.some((gap) => gap.description.includes(BUDGET_GAP))) return true;
  return (claim.boundary ?? "").includes(MODEL_UNCOVERED);
}

/**
 * 完成态空尾巴：检索名额没覆盖、或模型没写出判词的空壳。
 * 查过但没材料的「证据不足」卡不是空壳，必须留下。
 */
export function isCompleteEmptyShell(claim: InvestigationClaim): boolean {
  if (claim.checkability !== "checkable") return false;
  if (claim.evidence.length > 0) return false;
  if (hasBudgetOrModelLeftover(claim)) return true;
  if (claim.judgment === "unresolved" || claim.judgment === "supported" || claim.judgment === "refuted" || claim.judgment === "mixed") {
    return false;
  }
  return true;
}

export function leftoverClaimTexts(claims: InvestigationClaim[]): string[] {
  return claims.filter(isCompleteEmptyShell).map((claim) => claim.text.trim()).filter(Boolean);
}

const SENTENCE_SPLIT = /[。！？；!?;\n]+/;
const CLAUSE_COMMA = /[，,、]/;

function compactText(text: string): string {
  return text.replace(/\s+/g, "").replace(/[“”"「」『』'']/g, "");
}

/**
 * 用户对前一句的确认/质疑语气，不是新的事实主张。
 * 这些片段可以表达「请核实上一句」，但不能被当成独立命题再次检索。
 */
export function isMetaQuestionFragment(text: string): boolean {
  const compact = compactText(text)
    .replace(/[？?！!。；;，,、]+$/g, "")
    .trim();
  if (!compact) return true;
  return /^(?:(?:这|这个|该|这个说法|该说法))?(?:真的假的|是真的吗|真的(?:吗|么|嘛)|是吗|对吗|没错吗|靠谱吗|可信(?:吗|么)|可靠吗|属实吗)$/.test(compact);
}

function sentencesOf(originalClaim: string): string[] {
  return originalClaim
    .split(SENTENCE_SPLIT)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 4 && !isMetaQuestionFragment(part));
}

function commaParts(sentence: string): string[] {
  return sentence
    .split(CLAUSE_COMMA)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 4);
}

function longestCommonLen(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  let best = 0;
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return best;
}

function covers(claimText: string, clause: string): boolean {
  const claim = compactText(claimText);
  const piece = compactText(clause);
  if (!claim || !piece) return false;
  if (claim.includes(piece) || piece.includes(claim)) return true;
  const shorter = Math.min(claim.length, piece.length);
  const need = Math.min(shorter, Math.max(4, Math.ceil(shorter * 0.45)));
  return longestCommonLen(claim, piece) >= need;
}

/** 原句里有、命题列表盖不住的句子。整句都没盖住就整句留下；只有半句被盖住才按逗号拆开。 */
export function uncoveredOriginalClauses(originalClaim: string, claimTexts: string[]): string[] {
  const texts = claimTexts.map((text) => text.trim()).filter(Boolean);
  const leftover: string[] = [];
  for (const sentence of sentencesOf(originalClaim)) {
    const parts = commaParts(sentence);
    const uncoveredParts = parts.filter((part) => !texts.some((text) => covers(text, part)));
    // 先看逗号分句：半句被盖住就只留下没盖住的半句，避免整句因前半句 LCS 被当成已覆盖。
    if (parts.length > 1) {
      if (uncoveredParts.length === 0) continue;
      if (uncoveredParts.length < parts.length) {
        leftover.push(...uncoveredParts);
      } else {
        leftover.push(sentence);
      }
      continue;
    }
    if (!texts.some((text) => covers(text, sentence))) leftover.push(sentence);
  }
  return leftover;
}

function mergeLeftover(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text || isMetaQuestionFragment(text)) continue;
    if (out.some((existing) => covers(existing, text) || covers(text, existing))) continue;
    out.push(text);
  }
  return out;
}

/** 完成/中断态「这些这次没查」：空壳命题 + 原句里没被命题盖住的分句。 */
export function leftoverTextsForCanvas(originalClaim: string, claims: InvestigationClaim[]): string[] {
  return mergeLeftover([...leftoverClaimTexts(claims), ...uncoveredOriginalClauses(originalClaim, claims.map((claim) => claim.text))]);
}

function clipAtom(text: string, max = 72): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 一条「尚缺」：这些没查，所以结论没拿它们。不出现检索预算/模型未覆盖。 */
export function leftoverGapSentence(texts: string[]): string {
  if (texts.length === 0) return "";
  const names = texts.map((text) => `「${clipAtom(text)}」`).join("、");
  return `这些这次没查：${names}。结论没有拿它们当依据。`;
}
