import type { SubclaimVerdict, VerdictSource } from "./types.js";
import { claimAtomKey, compactStrings, compactText } from "./text.js";

const SUBCLAIM_VERDICTS = ["true", "false", "partial", "unverified", "exaggerated"];

function sanitizeVerdictSources(
  value: unknown,
  searchSources?: Array<{ url?: unknown }>
): VerdictSource[] {
  if (!Array.isArray(value)) return [];
  const knownUrls = searchSources
    ? new Set(searchSources.map((s) => String(s?.url ?? "").trim()).filter(Boolean))
    : null;
  const out: VerdictSource[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const rec = candidate as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!url) continue;
    if (knownUrls && !knownUrls.has(url)) continue;
    out.push({
      url,
      title: typeof rec.title === "string" ? rec.title.slice(0, 200) : "",
      snippet: typeof rec.snippet === "string" ? rec.snippet.slice(0, 320) : "",
    });
  }
  return out.slice(0, 5);
}

function sanitizeEvidenceGaps(value: unknown): string[] {
  return compactStrings(value, 3, 120);
}

/**
 * 锚原子 merge：幻觉拦截 + 未覆盖补 unverified + 可选 URL 交叉校验。
 * 调用方应对「可核查原子」调用（排除层之后），不要把立场原子塞进来。
 */
export function mergeSubclaimVerdicts(
  claimAtoms: unknown,
  verdicts: unknown,
  searchSources?: Array<{ url?: unknown }>
): SubclaimVerdict[] {
  const atoms = compactStrings(claimAtoms, 6, 180).map((s) => claimAtomKey(s));
  const raw = Array.isArray(verdicts) ? verdicts : [];
  const covered = new Set<string>();
  const result: SubclaimVerdict[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const atom = typeof rec.claimAtom === "string" ? rec.claimAtom : "";
    if (!atom) continue;
    const atomKey = claimAtomKey(atom);
    if (!atoms.includes(atomKey)) continue;
    covered.add(atomKey);
    result.push({
      claimAtom: atom,
      verdict: (SUBCLAIM_VERDICTS.includes(String(rec.verdict))
        ? String(rec.verdict)
        : "unverified") as SubclaimVerdict["verdict"],
      evidence: compactText(rec.evidence, 200),
      boundary: compactText(rec.boundary, 200),
      supportingSources: sanitizeVerdictSources(rec.supportingSources, searchSources),
      contradictingSources: sanitizeVerdictSources(rec.contradictingSources, searchSources),
      evidenceGaps: sanitizeEvidenceGaps(rec.evidenceGaps),
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
  const atoms = compactStrings(claimAtoms, 6, 180).map((s) => claimAtomKey(s));
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
