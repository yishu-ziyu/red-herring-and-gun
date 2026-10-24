import { claimAtomKey } from "../../../../shared/claimAtomText.js";
import { FOLLOW_UP_MARKER, followUpCoveredByAtom, followUpQuestionOf } from "../../../../shared/followUp.js";

const FOLLOW_UP_ATOM_CAP = 2;

/**
 * 访客完整管道也会把追问再拆成流行病学 / IARC / 临床多条。
 * 第一句就会拿旁支出来顶替这句追问。收成「这句追问 + 至多一条覆盖它的原子」。
 */
export function collapseFollowUpAtoms(claim: string, atoms: string[]): string[] {
  if (!String(claim).includes(FOLLOW_UP_MARKER)) return atoms;
  const question = followUpQuestionOf(claim);
  if (!question) return atoms;
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const item of atoms) {
    const text = typeof item === "string" ? item.trim() : "";
    if (!text) continue;
    const key = claimAtomKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(text);
  }
  const covering = unique.filter((atom) => followUpCoveredByAtom(question, atom));
  const out: string[] = [question];
  const questionKey = claimAtomKey(question);
  for (const atom of covering) {
    if (claimAtomKey(atom) === questionKey) continue;
    out.push(atom);
    if (out.length >= FOLLOW_UP_ATOM_CAP) break;
  }
  return out;
}
