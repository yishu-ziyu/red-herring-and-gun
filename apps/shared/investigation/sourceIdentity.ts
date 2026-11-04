/**
 * InvestigationSource.id 的稳定派生。
 *
 * id 是规范化 URL 的纯函数，不依赖 phase、role、evidence 排序或注册顺序。
 * 同一 URL 在一次 investigation 的任意 Snapshot 中必须得到同一 id。
 * 同一 URL 对不同部分可以有不同关系；对同一部分只有一种关系（见 oneRelationPerPart）。
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

/** 模型写回来的部分原文可能改了字；对得上才算同一部分：共有汉字至少六成，且明显最接近这一条。 */
function closestClaimAtom(text: string, atoms: readonly string[]): string | undefined {
  const key = claimAtomKey(text);
  if (atoms.some((atom) => claimAtomKey(atom) === key)) return text;
  const own = hanChars(text);
  const scored = atoms
    .map((atom) => {
      const other = hanChars(atom);
      return { atom, score: [...other].filter((ch) => own.has(ch)).length / Math.max(1, Math.max(own.size, other.size)) };
    })
    .sort((a, b) => b.score - a.score);
  const [best, next] = scored;
  return best && best.score >= 0.6 && best.score > (next?.score ?? 0) ? best.atom : undefined;
}

/**
 * 所有按部分原文对应的模型输出（判词、来源审核）都先对回拆题结果，
 * 否则模型改一个字，这一点的判断就找不到，页面变成「还查不清」。对不上的行原样留下。
 */
export function withClaimAtomsFromDecomposition<R extends { claimAtom?: unknown }>(rows: unknown, atoms: unknown): R[] {
  if (!Array.isArray(rows)) return [];
  const known = Array.isArray(atoms) ? atoms.filter((atom): atom is string => typeof atom === "string") : [];
  return rows.map((row) => {
    const atom = row && typeof row === "object" ? (row as R).claimAtom : undefined;
    const bound = typeof atom === "string" ? closestClaimAtom(atom, known) : undefined;
    return bound && bound !== atom ? { ...row, claimAtom: bound } : row;
  });
}

/** 同一部分、同一来源被审核出多种关系时的取舍：有方向的结论优先。 */
const RELATION_RANK: Record<string, number> = { conditional: 4, contradict: 3, support: 2, "context-only": 1, unverified: 0 };

/**
 * 一个来源对一个部分只有一种关系。模型可能给同一对写多行；所有读审核结果的地方都先过这里，
 * 否则结论取决于行的顺序，同样的审核结果会得出不同的判断。同一来源既支持又反驳，就是有条件成立。
 */
export function oneRelationPerPart<A extends { claimAtom: string; url: string; relation: string }>(audits: readonly A[]): A[] {
  const byPair = new Map<string, A>();
  for (const audit of audits) {
    const pair = `${claimAtomKey(audit.claimAtom)}\u0000${normalizeInvestigationSourceUrl(audit.url)}`;
    const held = byPair.get(pair);
    if (!held) byPair.set(pair, audit);
    else if ((held.relation === "support" && audit.relation === "contradict") || (held.relation === "contradict" && audit.relation === "support")) {
      byPair.set(pair, { ...held, relation: "conditional" });
    } else if ((RELATION_RANK[audit.relation] ?? 0) > (RELATION_RANK[held.relation] ?? 0)) byPair.set(pair, audit);
  }
  return [...byPair.values()];
}

/**
 * 找这一截、这个网址的方向核验结果。先按「这一截原文 + 网址」精确找；
 * 找不到时，在同一网址的核验结果里挑这一截文字最接近的那条（共有汉字至少占较短一方的一半）。
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
