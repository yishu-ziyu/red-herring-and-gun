import type { SubclaimVerdict, VerdictSource } from "./types.js";
import { claimAtomKey, compactStrings, compactText, MAX_CLAIM_ATOMS } from "./text.js";
import { bindDualBucketCitations, hasDirectionalBoundHttpUrl } from "../citationBinding.js";

const SUBCLAIM_VERDICTS = ["true", "false", "partial", "unverified", "exaggerated"];

function allowedUrlSet(searchSources?: Array<{ url?: unknown }>): Set<string> | null {
  if (!searchSources) return null;
  return new Set(searchSources.map((s) => String(s?.url ?? "").trim()).filter(Boolean));
}

function sanitizeEvidenceGaps(value: unknown): string[] {
  return compactStrings(value, 3, 120);
}

function demoteUnsourcedTrueFalse(
  verdict: SubclaimVerdict["verdict"],
  supporting: VerdictSource[],
  contradicting: VerdictSource[],
  gaps: string[]
): { verdict: SubclaimVerdict["verdict"]; evidenceGaps: string[] } {
  if (verdict !== "true" && verdict !== "false") {
    return { verdict, evidenceGaps: gaps };
  }
  // 方向专属契约（Review 5128449568 Blocker 3）：true 只认支撑桶、false 只认反证桶
  // （alignFalseEvidenceBuckets 已先行改桶）；错桶 URL 不算该方向的证据，
  // 与 deriveOverallVerdict / applyConclusionGate / Snapshot 判词映射同向。
  if (
    hasDirectionalBoundHttpUrl({
      verdict,
      supportingSources: supporting,
      contradictingSources: contradicting,
    })
  ) {
    return { verdict, evidenceGaps: gaps };
  }
  const evidenceGaps = gaps.some((g) => g.includes("待补证"))
    ? gaps
    : ["待补证", ...gaps].slice(0, 3);
  return { verdict: "unverified", evidenceGaps };
}

/**
 * 原子命题立场分桶。supportingSources = 支持该原子命题；contradictingSources = 反驳该原子命题。
 * 结构化输出曾把 [n] 只绑在 supportingSources 上，模型会把证伪材料塞进 supporting。
 * verdict=false、反证桶为空、且不是 related-only 检索垫时，按判词改桶。
 * 不用 finding 文本或否定词猜语义。
 */
export function alignFalseEvidenceBuckets<T>(input: {
  verdict: string;
  supporting: T[];
  contradicting: T[];
  sourcesRelatedOnly?: boolean;
}): { supporting: T[]; contradicting: T[] } {
  const verdict = String(input.verdict ?? "").trim().toLowerCase();
  if (
    verdict === "false" &&
    input.sourcesRelatedOnly !== true &&
    input.supporting.length > 0 &&
    input.contradicting.length === 0
  ) {
    return { supporting: [], contradicting: input.supporting };
  }
  return { supporting: input.supporting, contradicting: input.contradicting };
}

/**
 * 锚原子 merge：幻觉拦截 + 未覆盖补 unverified + 可选 URL 交叉校验。
 * evidence [n] 按 supportingSources 再 contradictingSources 的合并顺序重写。
 * 无 http(s) 的 true/false 收成 unverified（related-only 由 bind/derive/reviewer 处理）。
 * 调用方应对「可核查原子」调用（排除层之后），不要把立场原子塞进来。
 */
export function mergeSubclaimVerdicts(
  claimAtoms: unknown,
  verdicts: unknown,
  searchSources?: Array<{ url?: unknown }>
): SubclaimVerdict[] {
  const atoms = compactStrings(claimAtoms, MAX_CLAIM_ATOMS, 180).map((s) => claimAtomKey(s));
  const raw = Array.isArray(verdicts) ? verdicts : [];
  const covered = new Set<string>();
  const result: SubclaimVerdict[] = [];
  const allowed = allowedUrlSet(searchSources);
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const atom = typeof rec.claimAtom === "string" ? rec.claimAtom : "";
    if (!atom) continue;
    const atomKey = claimAtomKey(atom);
    if (!atoms.includes(atomKey)) continue;
    covered.add(atomKey);
    const verdict = (SUBCLAIM_VERDICTS.includes(String(rec.verdict))
      ? String(rec.verdict)
      : "unverified") as SubclaimVerdict["verdict"];
    const aligned = alignFalseEvidenceBuckets({
      verdict,
      supporting: Array.isArray(rec.supportingSources) ? rec.supportingSources : [],
      contradicting: Array.isArray(rec.contradictingSources) ? rec.contradictingSources : [],
    });
    const bound = bindDualBucketCitations(
      rec.evidence,
      aligned.supporting,
      aligned.contradicting,
      allowed
    );
    const supportingSources = bound.supportingSources;
    const contradictingSources = bound.contradictingSources;
    const guarded = demoteUnsourcedTrueFalse(
      verdict,
      supportingSources,
      contradictingSources,
      sanitizeEvidenceGaps(rec.evidenceGaps)
    );
    result.push({
      claimAtom: atom,
      verdict: guarded.verdict,
      evidence: compactText(bound.text, 240),
      boundary: compactText(rec.boundary, 200),
      supportingSources,
      contradictingSources,
      evidenceGaps: guarded.evidenceGaps,
    });
  }
  for (const atom of atoms) {
    if (!covered.has(atom)) {
      result.push({
        claimAtom: atom,
        verdict: "unverified",
        evidence: "",
        boundary: "模型未覆盖，待补证",
        supportingSources: [],
        contradictingSources: [],
        evidenceGaps: [],
      });
    }
  }
  return result;
}

/**
 * 排除层：claimAtoms × claimAtomTypes → 可核查 / 不可核查。
 * 不变量：verifiable=false 绝不进入 verifiable。
 */
export function splitVerifiableAtoms(
  claimAtoms: unknown,
  claimAtomTypes: unknown
): { verifiable: string[]; nonVerifiable: Array<{ text: string; type: string }> } {
  const atoms = compactStrings(claimAtoms, MAX_CLAIM_ATOMS, 180).map((s) => claimAtomKey(s));
  const typed = new Map<string, { verifiable: boolean; type: string }>();
  if (Array.isArray(claimAtomTypes)) {
    for (const item of claimAtomTypes) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const text = typeof rec.text === "string" ? rec.text : "";
      if (!text) continue;
      typed.set(claimAtomKey(text), {
        verifiable: rec.verifiable !== false,
        type: typeof rec.type === "string" ? rec.type.slice(0, 40) : "",
      });
    }
  }
  const verifiable: string[] = [];
  const nonVerifiable: Array<{ text: string; type: string }> = [];
  for (const atom of atoms) {
    const info = typed.get(atom);
    if (info && info.verifiable === false) {
      nonVerifiable.push({ text: atom, type: info.type });
    } else {
      verifiable.push(atom);
    }
  }
  return { verifiable, nonVerifiable };
}
