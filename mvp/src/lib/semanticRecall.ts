/**
 * semanticRecall — 记忆语义召回（确定性，零依赖）— G2 / agentbook Ch.3
 *
 * 词面 bigram 召回的缺口：同义说法（电瓶车/电动车）与转述（被偷/失窃）零交集。
 * 这里做确定性语义桥接，不引入 embedding 模型或 LLM rerank（每案零开销零延迟）：
 * 1. 领域同义词组 → 规范 token（syn:<组id>），任意成员命中即桥接；
 * 2. 汉字字符集 Dice 系数，捕捉转述改写的模糊重叠；
 * 3. 与既有 bigram Jaccard 加权合成，输出 0–100（与 calculateClaimSimilarity 同标度）。
 * 升级路径：需要更强泛化时再挂本地 embedding（ADR-001 Phase 3 备选）。
 */

/** 谣言域同义词组：新词组直接追加，命中任一成员 → 同一规范 token。 */
export const RUMOR_SYNONYM_GROUPS: string[][] = [
  ["电瓶车", "电动车", "电动自行车", "电单车"],
  ["被偷", "失窃", "被盗", "被偷走"],
  ["偷走", "盗走", "窃取"],
  ["打疫苗", "接种疫苗", "注射疫苗", "打针"],
  ["辟谣", "不实", "谣言", "假消息", "不实信息"],
  ["官方通报", "警方通报", "通报", "警情通报"],
  ["悬赏", "赏金", "通缉"],
  ["死亡率", "致死率"],
  ["致癌", "患癌", "癌变", "导致癌症"],
  ["免费", "免票", "免单", "不要钱"],
  ["补贴", "津贴", "补助", "发放"],
  ["地铁", "轨道交通", "城铁"],
  ["截图", "P图", "合成图", "PS图", "改图"],
  ["视频", "短视频", "录像", "监控"],
  ["感冒", "流感", "上呼吸道感染"],
  ["住院", "就医", "看医生", "就诊"],
  ["高考", "大学入学考试", "统考"],
  ["录取通知书", "大学通知书", "录取信"],
  ["退休金", "养老金", "退休工资"],
  ["医保", "医疗保险", "社保卡"],
  ["怀孕", "妊娠", "有喜"],
  ["生育津贴", "生育补贴", "产假津贴"],
  ["非洲", "国外", "海外", "境外"],
  ["销毁", "报废", "处置", "回收"],
];

const SYNONYM_TOKEN_MAP: Map<string, string> = (() => {
  const map = new Map<string, string>();
  RUMOR_SYNONYM_GROUPS.forEach((group, index) => {
    const canonical = `syn:${index}`;
    for (const term of group) map.set(term, canonical);
  });
  return map;
})();

/** 文本里命中的同义词组（规范 token 集合）。 */
export function synonymTokensOf(text: string): Set<string> {
  const hits = new Set<string>();
  for (const [term, canonical] of SYNONYM_TOKEN_MAP) {
    if (term && text.includes(term)) hits.add(canonical);
  }
  return hits;
}

function normalizeForRecall(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

/** 语义 token：既有 bigram + 拉丁词 + 同义词规范 token。 */
export function semanticTokensOf(text: string): Set<string> {
  const normalized = normalizeForRecall(text);
  const tokens = new Set<string>(normalized.match(/[a-z0-9]{2,}/g) ?? []);
  for (let i = 0; i < normalized.length - 1; i += 1) {
    const pair = normalized.slice(i, i + 2);
    if (/^[\p{Script=Han}]{2}$/u.test(pair)) tokens.add(pair);
  }
  for (const syn of synonymTokensOf(normalized)) tokens.add(syn);
  return tokens;
}

/** 汉字字符集 Dice 系数：捕捉「被偷→失窃」这类改写的残余重叠。 */
export function hanCharDice(a: string, b: string): number {
  const han = (s: string) => (s.match(/[\p{Script=Han}]/gu) ?? []);
  const charsA = han(a);
  const charsB = han(b);
  if (charsA.length === 0 || charsB.length === 0) return 0;
  const setB = new Map<string, number>();
  for (const c of charsB) setB.set(c, (setB.get(c) ?? 0) + 1);
  let inter = 0;
  for (const c of charsA) {
    const remain = setB.get(c) ?? 0;
    if (remain > 0) {
      inter += 1;
      setB.set(c, remain - 1);
    }
  }
  return (2 * inter) / (charsA.length + charsB.length);
}

/**
 * 语义相似度（0–100，与 knowledgeBase.calculateClaimSimilarity 同标度）。
 * 三路信号合成，取词面与同义词中的强者为语义主信号：
 * - lex：非同义词 token 的 Jaccard（原词面信号）；
 * - syn：同义词组 Jaccard（单独计算，不被 bigram 基数稀释——这是桥接的关键）；
 * - dice：汉字字符集重叠（捕捉转述改写残余重叠）。
 */
export function semanticClaimSimilarity(claimA: string, claimB: string): number {
  const tokensA = semanticTokensOf(claimA);
  const tokensB = semanticTokensOf(claimB);
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  const synA = synonymTokensOf(claimA);
  const synB = synonymTokensOf(claimB);
  const lexOnlyA = new Set([...tokensA].filter((t) => !t.startsWith("syn:")));
  const lexOnlyB = new Set([...tokensB].filter((t) => !t.startsWith("syn:")));

  let lexInter = 0;
  lexOnlyA.forEach((t) => {
    if (lexOnlyB.has(t)) lexInter += 1;
  });
  const lexUnion = new Set([...lexOnlyA, ...lexOnlyB]).size;
  const lex = lexUnion > 0 ? lexInter / lexUnion : 0;

  let synInter = 0;
  synA.forEach((t) => {
    if (synB.has(t)) synInter += 1;
  });
  const synUnion = new Set([...synA, ...synB]).size;
  const syn = synUnion > 0 ? synInter / synUnion : 0;

  const dice = hanCharDice(claimA, claimB);
  const semanticMain = Math.max(lex, syn * 0.9);
  const a = normalizeForRecall(claimA);
  const b = normalizeForRecall(claimB);
  const substringBonus = a.includes(b.slice(0, 8)) || b.includes(a.slice(0, 8)) ? 0.18 : 0;

  return Math.min(100, Math.round((semanticMain * 0.78 + dice * 0.22 + substringBonus) * 100));
}
