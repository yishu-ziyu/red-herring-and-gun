/**
 * 类型闸补复核：读起来像可核对流传说法、却被标 verifiable=false 的原子，改回可核查。
 * 纯函数；搜不搜仍由 splitVerifiableAtoms 读改写后的 verifiable。
 */

const STANCE =
  /不应该|应该|不该|应当|有意义|无意义|没有意义|毫无意义|没意义|失去意义|很好|很坏|真好|真坏|太好|太坏|好得很|坏得很|是好的|是坏的/;
const RANT = /不管老百姓|死活|混蛋|傻逼|白痴|无耻/;
const FIRST_PERSON =
  /这药对[我咱]|对我(来说|很|失眠|有效)|我(觉得|认为|感觉|个人认为)/;
const OBJECT =
  /某地|[省市县区镇州旗]|政府|公司|医院|学校|局|委|中心|大学|卫健|疾控|警方|官方|菜|肉|油|奶|盐|糖|食品|食物|水果|蔬菜|药|疫苗|\d/;
const JUDGMENT = /会|已经|决定|开通|致癌|免票|要建|导致|造成/;
const WEIBO = /免票|免费|要建|打架|全武行|P图|p图|偷车|打电话/;
const HUI_COMPOUND = /社会|机会|会议|会计|学会|工会|会员/;

function looksLikeStanceOrExperience(text: string): boolean {
  return STANCE.test(text) || RANT.test(text) || FIRST_PERSON.test(text);
}

function hasObjectAndJudgment(text: string): boolean {
  const stripped = text.split(HUI_COMPOUND).join("");
  return OBJECT.test(stripped) && JUDGMENT.test(stripped);
}

/** 像不像可核对流传说法。不像（规范/价值/纯骂/第一人称体验）优先。 */
export function looksLikeCirculatingClaim(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (looksLikeStanceOrExperience(t)) return false;
  if (WEIBO.test(t)) return true;
  return hasObjectAndJudgment(t);
}

function rewriteType(text: string): "causal" | "fact" {
  return /导致/.test(text) ? "causal" : "fact";
}

/**
 * 对 verifiable===false 且像流传说法的条目改回 verifiable=true。
 * 非数组原样返回；不改已可核查条目。
 */
export function forceCheckableAtomTypes(claimAtomTypes: unknown): unknown {
  if (!Array.isArray(claimAtomTypes)) return claimAtomTypes;
  return claimAtomTypes.map((item) => {
    if (!item || typeof item !== "object") return item;
    const rec = item as Record<string, unknown>;
    const text = typeof rec.text === "string" ? rec.text : "";
    if (!text || rec.verifiable !== false) return item;
    if (!looksLikeCirculatingClaim(text)) return item;
    return { ...rec, verifiable: true, type: rewriteType(text) };
  });
}
