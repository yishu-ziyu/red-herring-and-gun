/**
 * 拆题的角色与忠实性检查（纯函数，不调用模型）。
 *
 * 拆题模型给每条命题标：role（main 主要主张 / premise 必要前提 / background 背景细节）、
 * issuer（这一条是不是在说发文机关或出处）、span（原句里对应的那一截，逐字）。
 * 整句判定读这些标记（sentenceVerdict.listAssessedClaims）；这里只做三件确定性的事：
 *   1 短单句不拆；2 编造的命题（span 对不上原句）丢掉；3 价值判断句标为立场型。
 */
import { claimAtomKey } from "./text.js";

type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | null => (value && typeof value === "object" && !Array.isArray(value) ? (value as Rec) : null);
const squash = (text: string) => text.replace(/\s+/g, "");

/** 短单句：不超过这个长度、且没有分句标点和并列词，就认为只有一个主张。 */
const SHORT_CLAIM_MAX = 30;
const CLAUSE_OR_PARALLEL = /[，,；;、。！？!?\n]|与|和|及|跟|或|而且|并且|且|还能|也能|以及|但是|但|却|同时|另外/;

export function collapseShortSingleClaim(
  claim: string,
  atoms: string[],
  types: unknown
): { atoms: string[]; types: unknown } {
  const text = claim.replace(/\s+/g, " ").trim();
  if (atoms.length < 2 || text.length === 0 || text.length > SHORT_CLAIM_MAX || CLAUSE_OR_PARALLEL.test(text)) {
    return { atoms, types };
  }
  const list = Array.isArray(types) ? types.map(rec).filter((t): t is Rec => t !== null) : [];
  const anyCheckable = list.length === 0 || list.some((t) => t.verifiable !== false);
  const kept = anyCheckable ? list.find((t) => t.verifiable !== false) : list[0];
  const kind = typeof kept?.type === "string" && kept.type ? kept.type : anyCheckable ? "fact" : "value";
  return {
    atoms: [text],
    types: [{ text, verifiable: anyCheckable, type: kind, role: "main" }],
  };
}

/**
 * 拆出来的一截用了原句没有的字，就是模型改写了原话：换回它在原句里的那一截（span）。
 * 2026-10-10：「隔夜菜会致癌」被改写成「隔夜菜会产生致癌物」，查的是另一句更弱的话，整句被判成「属实」。
 * 只补主语之类、所有字都出自原句的条目（例：「等于吃毒药」写成「隔夜菜等于吃毒药」）不动。
 */
export function keepOriginalWording(
  claim: string,
  atoms: string[],
  types: unknown
): { atoms: string[]; types: unknown; restored: string[] } {
  const source = squash(claim);
  const sourceChars = new Set(source.match(/\p{Script=Han}/gu) ?? []);
  const spanByKey = new Map<string, string>();
  for (const item of Array.isArray(types) ? types : []) {
    const r = rec(item);
    if (r && typeof r.text === "string" && typeof r.span === "string" && source.includes(squash(r.span))) {
      spanByKey.set(claimAtomKey(r.text), r.span.trim());
    }
  }
  const replacement = new Map<string, string>();
  for (const atom of atoms) {
    const added = (squash(atom).match(/\p{Script=Han}/gu) ?? []).filter((ch) => !sourceChars.has(ch));
    const span = spanByKey.get(claimAtomKey(atom));
    if (added.length > 0 && span) replacement.set(claimAtomKey(atom), span);
  }
  if (replacement.size === 0) return { atoms, types, restored: [] };
  const swap = (text: string) => replacement.get(claimAtomKey(text)) ?? text;
  return {
    atoms: atoms.map(swap),
    types: Array.isArray(types)
      ? types.map((item) => {
          const r = rec(item);
          return r && typeof r.text === "string" ? { ...r, text: swap(r.text) } : item;
        })
      : types,
    restored: atoms.filter((atom) => replacement.has(claimAtomKey(atom))),
  };
}

/**
 * 原句里找不到对应片段的命题是拆题编造的（FactLens）：丢掉。
 * 只看写了 span 的条目；没写的（旧输出、沿用上一轮的命题）不丢。全部都对不上时不清空，保留全部。
 */
export function dropUntraceableAtoms(
  claim: string,
  atoms: string[],
  types: unknown
): { atoms: string[]; types: unknown; dropped: string[] } {
  const source = squash(claim);
  const spanByKey = new Map<string, string>();
  for (const item of Array.isArray(types) ? types : []) {
    const r = rec(item);
    if (r && typeof r.text === "string" && typeof r.span === "string" && r.span.trim()) {
      spanByKey.set(claimAtomKey(r.text), squash(r.span));
    }
  }
  const dropped = atoms.filter((atom) => {
    const span = spanByKey.get(claimAtomKey(atom));
    return span !== undefined && !source.includes(span);
  });
  if (dropped.length === 0 || dropped.length === atoms.length) return { atoms, types, dropped: [] };
  const droppedKeys = new Set(dropped.map((atom) => claimAtomKey(atom)));
  return {
    atoms: atoms.filter((atom) => !droppedKeys.has(claimAtomKey(atom))),
    types: Array.isArray(types)
      ? types.filter((item) => !droppedKeys.has(claimAtomKey(String(rec(item)?.text ?? ""))))
      : types,
    dropped,
  };
}

const VALUE_WORD = /不该|不应该|不应当|不应|应该|应当/;
/** 「所以…应该…」是从前提推出的结论（桥接命题），要按可核查的主张对待，不能当立场丢开。 */
const LEAP = /^(所以|因此|于是|因而|由此|可见)|所以|因此/;
const FACT_VERB = /会|已经|已被|决定|规定|法规|指南|标准|条例|规范|说明书|适应症|合同|章程|开通|致癌|导致|造成|超标|超出|超过|高于|低于|增加|减少|达到|发布|宣布|通知|\d/;

/**
 * 只含价值词（不该 / 应该）、没有事实动词或数字的句子是立场，不是可核对的说法。
 * 模型偶尔把「小区里就不该允许养大型犬」当事实去查，查回来一堆地方规定，再判成「有真有假」（NEW-301）。
 * 流传的因果句、带数字或事实动词的句子不动（forceCheckable 那道闸负责把它们保持为可核查）。
 */
export function markStanceAtoms(types: unknown): unknown {
  if (!Array.isArray(types)) return types;
  return types.map((item) => {
    const r = rec(item);
    const text = typeof r?.text === "string" ? r.text : "";
    if (!r || r.verifiable === false || !text) return item;
    if (!VALUE_WORD.test(text) || FACT_VERB.test(text) || LEAP.test(text)) return item;
    return { ...r, verifiable: false, type: "normative" };
  });
}

/**
 * 整句本身是立场（拆题的整句判定 verifiable=false）而模型一条命题都没给：
 * 把原句作为一条立场型命题，免得整句落成「没有命题」被当成证据不足（NEW-301）。
 */
export function ensureStanceAtom(
  claim: string,
  atoms: string[],
  types: unknown,
  stanceClaimType: unknown
): { atoms: string[]; types: unknown } {
  const stance = rec(stanceClaimType);
  const text = claim.replace(/\s+/g, " ").trim();
  if (atoms.length > 0 || !text || !stance || stance.verifiable !== false) return { atoms, types };
  const kind = typeof stance.type === "string" && stance.type && stance.type !== "mixed" ? stance.type : "value";
  return { atoms: [text], types: [{ text, verifiable: false, type: kind, role: "main" }] };
}
