/**
 * InvestigationSource.id 的稳定派生（Issue #76）。
 *
 * id 是规范化 URL 的纯函数，不依赖 phase、role、evidence 排序或注册顺序。
 * 同一 URL 在一次 investigation 的任意 Snapshot 中必须得到同一 id。
 * 同 URL 的 support / contradict 仍是两条 EvidenceLink，不在这里合成 stance。
 */
import { claimAtomKey } from "../claimAtomText.js";

export function normalizeInvestigationSourceUrl(url: string): string {
  return url.trim();
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** CSS-safe、跨 Snapshot 稳定：只由规范化 URL 决定。 */
export function investigationSourceId(url: string): string {
  return `src-${fnv1a64Hex(normalizeInvestigationSourceUrl(url))}`;
}

function hanChars(text: string): Set<string> {
  return new Set(text.match(/\p{Script=Han}/gu) ?? []);
}

/**
 * 找这一截、这个网址的方向核验结果。先按「这一截原文 + 网址」精确找；
 * 找不到时，在同一网址的核验结果里挑这一截文字最接近的那条（共有汉字至少占较短一方的一半）。
 * 2026-10-10：核验模型把这一截写成「吃隔夜菜等于吃毒药」，精确匹配全部落空，所有来源被降为「只和话题相关」，结论成了「还查不清」。
 */
export function findClaimSourceRelationAudit<A extends { claimAtom: string; url: string }>(
  audits: readonly A[],
  claimAtom: string,
  url: string,
): A | undefined {
  const target = normalizeInvestigationSourceUrl(url);
  const sameUrl = audits.filter((audit) => normalizeInvestigationSourceUrl(audit.url) === target);
  const key = claimAtomKey(claimAtom);
  const exact = sameUrl.find((audit) => claimAtomKey(audit.claimAtom) === key);
  if (exact) return exact;
  const own = hanChars(claimAtom);
  let best: A | undefined;
  let bestScore = 0;
  for (const audit of sameUrl) {
    const other = hanChars(audit.claimAtom);
    const shared = [...other].filter((ch) => own.has(ch)).length;
    const score = shared / Math.max(1, Math.min(own.size, other.size));
    if (score > bestScore) {
      best = audit;
      bestScore = score;
    }
  }
  if (best && bestScore >= 0.5) return best;
  return undefined;
}
