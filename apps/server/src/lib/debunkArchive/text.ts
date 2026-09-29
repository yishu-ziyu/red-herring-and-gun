// Deterministic Chinese text helpers shared by extraction and lookup.
// No model calls, no synonym tables: NFKC + punctuation-free character bigrams.

/** Question / hearsay boilerplate that carries no claim content. */
const BOILERPLATE = /是不是真的|是真的吗|是真的么|真的假的|真的吗|是否属实|属实吗|是谣言吗|是假的吗|网上流传|网传|听说|据说|有人说|吗|么/g;
/** Function characters that differ between phrasings of the same claim. */
const DROP_CHARS = /[的了]/g;

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[​-‍﻿]/g, "")
    .toLowerCase();
}

/**
 * Character bigrams over each CJK run (a single character stays as itself),
 * whole tokens for latin/number runs. Runs never cross punctuation.
 */
export function tokenize(s: string): string[] {
  const t = normalizeText(s).replace(BOILERPLATE, " ").replace(DROP_CHARS, "");
  const out: string[] = [];
  const runs = t.match(/[㐀-鿿]+|[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];
  for (const run of runs) {
    if (/^[a-z0-9]/.test(run)) {
      out.push(run);
    } else if (run.length === 1) {
      out.push(run);
    } else {
      for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
    }
  }
  return out;
}

/** Bigram Jaccard similarity of two strings, 0..1. */
export function similarity(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
