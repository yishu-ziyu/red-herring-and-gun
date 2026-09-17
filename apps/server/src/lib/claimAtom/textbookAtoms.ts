/**
 * 课文 / 百科长文被按句号切成十几条时，抽回可核查断言。
 * 短谣、少条拆题原样返回。不默默丢掉检索名额语义：这里只收句子切片，不代替检索上限。
 *
 * 走查：模型常把课文转述成 9 条而不是原句切片，所以长文不依赖「像不像按句切开」。
 */
import { claimAtomKey } from "./text.js";

const SENTENCE_SPLIT = /(?<=[。！？；])/;
const NARRATIVE_OPEN =
  /^(又称|蜿蜒于|在民间|而在民间|这句话曾|据说|稳居|在流传甚广|在建造工艺上)/;
const TEXTBOOK_META = /写进.{0,12}教科书|写进.{0,12}教材|科普读物/;
const CIRCULATING = /唯一|肉眼|太空|可见|糯米/;

/** 长文硬上限：超过就不是在抽断言，是在按句切片。 */
export const NARRATIVE_ATOM_CAP = 4;

/** 流传说法 / 可独立核对的谓语。分数越高越该留下。 */
function assertiveScore(atom: string): number {
  const t = atom.replace(/\s+/g, "").trim();
  if (!t) return 0;
  if (NARRATIVE_OPEN.test(t) && !CIRCULATING.test(t)) return 0;
  if (TEXTBOOK_META.test(t) && !CIRCULATING.test(t)) return 0;
  let score = 0;
  if (/唯一|肉眼|太空|可见/.test(t)) score += 4;
  if (/世界遗产|世界文化/.test(t)) score += 3;
  if (/超过|总长|两万/.test(t)) score += 3;
  if (/军事防御|防御工程/.test(t)) score += 3;
  if (/全是|就能|完全适用|一定能|等于/.test(t)) score += 8;
  if (/所以|因此/.test(t)) score += 2;
  if (/是|属于|已是|最早|始建|导致|造成|达到|掺入/.test(t)) score += 1;
  if (/\d/.test(t)) score += 1;
  return score;
}

const LEAP_MARK = /所以|因此|于是|由此可见|这说明|所以说/;
const SEARCH_ATOM_BUDGET = 6;

/** 「所以 / 因此」之后的结论句。背景事实不得把它们挤掉。 */
export function extractLeapAtoms(claim: string): string[] {
  const text = (claim ?? "").trim();
  if (!text) return [];
  const match = text.match(LEAP_MARK);
  if (!match || match.index == null) return [];
  const mark = match[0];
  const rest = text.slice(match.index + mark.length).replace(/^[，,、\s]+/, "");
  if (rest.length < 6) return [];
  // 连词留在第一条跳跃上，避免总答/判词对不上原句里的「所以 / 因此」。
  return (mark + rest)
    .split(/[。；;]/)
    .flatMap((chunk) => chunk.split(/，(?=[^，]{8,})/))
    .map((part) => part.replace(/^[，,、\s]+|[。．.\s]+$/g, "").trim())
    .filter((part) => part.length >= 6);
}

function atomCoversLeap(atom: string, leap: string): boolean {
  const a = atom.replace(/\s+/g, "");
  const b = leap.replace(/\s+/g, "");
  if (!a || !b) return false;
  const core = b.replace(/^(所以说|所以|因此|于是|由此可见)/, "").replace(/^[，,、]+/, "");
  return a.includes(b) || b.includes(a) || (core.length >= 4 && a.includes(core));
}

/**
 * 原句后半截跳跃必须进待查清单。已有的背景原子保留，但检索名额先给跳跃。
 */
export function ensureLeapAtoms(claim: string, atoms: string[]): string[] {
  const leaps = extractLeapAtoms(claim);
  if (leaps.length === 0) return atoms;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const key = claimAtomKey(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(text);
  };
  // 模型已经给出带主语的完整主张时，优先保留完整主张，不再额外制造
  // 「所以可以中和酸」这类脱离主语的跳跃残句。真正漏掉的 leap 仍优先补入。
  const coveringAtoms = atoms.filter((atom) => leaps.some((leap) => atomCoversLeap(atom, leap)));
  const missingLeaps = leaps.filter((leap) => !coveringAtoms.some((atom) => atomCoversLeap(atom, leap)));
  for (const atom of coveringAtoms) push(atom);
  for (const leap of missingLeaps) push(leap);
  for (const atom of atoms) {
    if (coveringAtoms.includes(atom)) continue;
    push(atom);
  }
  if (out.length <= SEARCH_ATOM_BUDGET) return out;
  const priorityKeys = new Set([...coveringAtoms, ...missingLeaps].map((item) => claimAtomKey(item)));
  const prioritized = out.filter((atom) => priorityKeys.has(claimAtomKey(atom)));
  const rest = out.filter((atom) => !priorityKeys.has(claimAtomKey(atom)));
  return [...prioritized, ...rest].slice(0, SEARCH_ATOM_BUDGET);
}

function compact(text: string): string {
  return text.replace(/\s+/g, "");
}

function userAsksAboutTextbook(claim: string): boolean {
  const t = compact(claim);
  return t.length < 80 && /教科书|教材/.test(t);
}

/**
 * 「写进教科书」不是流传谣言本身。太空可见绑在教科书元叙述上时，只留可核查的那截。
 */
function stripTextbookWrapper(atom: string, keepMeta: boolean): string | null {
  const raw = typeof atom === "string" ? atom.trim() : "";
  if (!raw) return null;
  if (keepMeta) return raw;
  if (TEXTBOOK_META.test(raw) && !CIRCULATING.test(raw)) return null;
  let next = raw
    .replace(/[，,]?这?句话曾被写进[^。]*/g, "")
    .replace(/写进无数教科书与科普读物/g, "")
    .replace(/写进教科书/g, "")
    .trim();
  next = next.replace(/^[「「"']+|[」」"']+$/g, "").trim();
  if (!next || NARRATIVE_OPEN.test(compact(next))) return CIRCULATING.test(raw) ? raw : null;
  return next;
}

function looksLikeLongNarrative(claim: string, atoms: string[]): boolean {
  if (compact(claim).length < 120) return false;
  if (atoms.length > NARRATIVE_ATOM_CAP) return true;
  const sentences = claim
    .split(SENTENCE_SPLIT)
    .map((s) => compact(s).trim())
    .filter((s) => s.length >= 8);
  return sentences.length >= 5;
}

/**
 * 长课文按句切开或转述成很多条时，只留可独立核查的断言（最多 4 条，保原句序）。
 * 不是课文、或本来就不多，原样返回。
 */
export function collapseNarrativeAtoms(claim: string, atoms: string[]): string[] {
  const keepMeta = userAsksAboutTextbook(claim);
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of atoms) {
    const stripped = stripTextbookWrapper(item, keepMeta);
    if (!stripped) continue;
    const key = claimAtomKey(stripped);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(stripped);
  }
  if (unique.length <= NARRATIVE_ATOM_CAP) return unique;
  if (claim.includes("同一条核查的追问，不是新案件。")) return unique;
  if (!looksLikeLongNarrative(claim, unique)) return unique;

  const ranked = unique
    .map((atom, index) => ({ atom, index, score: assertiveScore(atom) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, NARRATIVE_ATOM_CAP)
    .sort((a, b) => a.index - b.index)
    .map((row) => row.atom);
  return ranked.length > 0 ? ranked : unique.slice(0, NARRATIVE_ATOM_CAP);
}

/** 拆题类型表跟着保留下来的原子走，丢掉被收掉的课文切片。 */
export function retainAtomTypes(atoms: string[], types: unknown): unknown {
  if (!Array.isArray(types)) return types;
  const keys = new Set(atoms.map((atom) => claimAtomKey(atom)));
  return types.filter((item) => {
    if (!item || typeof item !== "object") return false;
    const text = typeof (item as { text?: unknown }).text === "string" ? (item as { text: string }).text : "";
    return keys.has(claimAtomKey(text));
  });
}
