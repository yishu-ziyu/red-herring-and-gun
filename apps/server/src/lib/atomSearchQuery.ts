/**
 * Per-atom retrieval queries for Case Pipeline.
 * Raw atom text is not enough for Weibo-scale rumors: also hunt 辟谣 / 规划 traces.
 */

const FILLER = /我说|原来|叫谁|这是|那个|一下|真的吗|是不是/g;
const STOP = new Set([
  "的", "了", "是", "在", "我", "有", "和", "就", "不", "人", "都", "也", "很", "到", "说", "要", "去", "你", "会", "着", "没有", "看", "好", "自己", "这", "那", "吗", "吧", "呢",
]);

export function looksLikePlanOrPrediction(atom: string): boolean {
  return /将|要建|拟建|计划建|规划|即将|准备建|会上马|要修|要开通/.test(atom);
}

/** Drop first-person filler so slangy Weibo sentences still hit 辟谣 pages. */
function compactAtomForSearch(atom: string): string {
  const stripped = atom
    .replace(FILLER, " ")
    .replace(/[，。！？、；：""''（）【】《》]/g, " ")
    .replace(/[的了是在和就把给与]/g, " ");
  const parts = stripped
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP.has(w));
  return [...new Set(parts)].slice(0, 6).join(" ");
}

export function topicTokens(atom: string): string[] {
  const compact = compactAtomForSearch(atom)
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const han = atom.replace(/[^一-鿿A-Za-z0-9]/g, "");
  const grams: string[] = [];
  for (let n = 2; n <= 3; n++) {
    for (let i = 0; i + n <= han.length; i++) {
      const g = han.slice(i, i + n);
      if (!STOP.has(g)) grams.push(g);
    }
  }
  return [...new Set([...compact, ...grams])].slice(0, 24);
}

/** Generic insult/affair captions need a public-bulletin query, not the empty “是不是真的”. */
function extraRumorQueries(atom: string): string[] {
  const extra: string[] = [];
  if (/P图|p图|配图/.test(atom) && /侮辱|辱骂|侮辱性/.test(atom)) {
    extra.push("P图 编造 侮辱性文字 发群 警方通报 辟谣");
  }
  if (/出轨/.test(atom) && /短视频|视频/.test(atom)) {
    extra.push("短视频 散布 婚内出轨 不实言论 警方通报 辟谣");
  }
  if (/电瓶车/.test(atom) && /非洲|境外/.test(atom)) {
    extra.push("电瓶车被偷至境外 非洲 P图 辟谣 警方通报");
  }
  return extra;
}

const SCREENSHOT_RE = /截图|P图|p图|配图|原图|聊天记录/;
const QUOTE_RE = /[「『"]([^」』"]{4,40})[」』"]/;

/** Percentage / 万亿 / 例 / GDP·同比·确诊 + number. Dates and version numbers do not count. */
function looksLikeStatistic(atom: string): boolean {
  if (/\d+(?:\.\d+)?\s*[%％]|百分之\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*个百分点/.test(atom)) return true;
  if (/\d+(?:\.\d+)?\s*[万亿]|\d+\s*例/.test(atom)) return true;
  const stripped = atom
    .replace(/20\d{2}(?:\s*年)?/g, " ")
    .replace(/\d{1,2}\s*月(?:\s*\d{1,2}\s*日)?/g, " ")
    .replace(/\d{1,2}\s*日/g, " ");
  return /(?:GDP|gdp|同比|环比|确诊).{0,12}\d/.test(stripped);
}

const AUTHORITY_SITES: ReadonlyArray<string> = [
  "site:piyao.org.cn", // 中国互联网联合辟谣平台（综合官方回应）
  "site:nhc.gov.cn", // 国家卫健委（健康类）
];
const HEALTH_RE = /(癌|疫苗|治疗|养生|食品|药品|血压|血糖|健康|病|感染|传染|停课|封城)/;
const SOCIAL_RE = /(死亡|爆炸|火灾|车祸|地震|下雪|补贴|领钱|疫苗|停课|封城|转发)/;

function looksLikeHealthOrSocialRumor(atom: string): boolean {
  return HEALTH_RE.test(atom) || SOCIAL_RE.test(atom);
}

/** 权威站点直查：健康/社会谣言至少带 1 路，独立于 3 路配额，官方来源命中即高权重。 */
function authoritySiteQueries(atom: string): string[] {
  const compact = compactAtomForSearch(atom);
  if (!compact) return [];
  const out: string[] = [];
  out.push(`${AUTHORITY_SITES[0]} ${compact}`); // 联合辟谣平台恒带
  if (HEALTH_RE.test(atom)) out.push(`${AUTHORITY_SITES[1]} ${compact}`);
  return out;
}

/** 英文谣言分语言策略：claim 主体为英文时，检索走英文谣言语境（rumor/debunk/fact-check），
 *  而不是套中文「辟谣/官方通报」后缀。 */
function looksLikeEnglishClaim(atom: string): boolean {
  const letters = (atom.match(/[a-zA-Z]/g) ?? []).length;
  const cjk = (atom.match(/[一-鿿]/g) ?? []).length;
  return letters > 0 && letters > cjk * 2;
}
function enRumorQueries(atom: string): string[] {
  if (!looksLikeEnglishClaim(atom)) return [];
  const words = atom.match(/[a-zA-Z][a-zA-Z0-9'-]{2,}/g) ?? [];
  const head = words.slice(0, 3).join(" ");
  const base = head || atom.slice(0, 40);
  return [`${base} debunked OR rumour OR fact check`, `${base} official statement OR statement`];
}

function timeSpan(atom: string): string {
  const hits = atom.match(/20\d{2}|\d{1,2}\s*月\s*\d{1,2}\s*日|\d{1,2}\s*月|\d{1,2}\s*日/g) ?? [];
  return hits.slice(0, 3).join(" ");
}

export function buildAtomSearchQueries(atom: string): string[] {
  const t = atom.replace(/\s+/g, " ").trim();
  if (!t) return [];
  const plan = looksLikePlanOrPrediction(t);
  const extras = extraRumorQueries(t);
  const when = timeSpan(t);
  const quoted = QUOTE_RE.exec(t)?.[1]?.trim() ?? "";
  const exact = quoted ? `"${quoted}" ${when}`.trim() : t;
  const screenshotQ = SCREENSHOT_RE.test(t) ? `${t} 原图 出处 首发` : undefined;
  const quoteQ = QUOTE_RE.test(t) ? `${t} 原话 语境` : undefined;
  const statisticQ = looksLikeStatistic(t) ? `${t} 公报 原始数据` : undefined;
  const suffix = plan ? "规划 批复 承诺 文件 辟谣" : "辟谣 不实 谣言 官方通报";
  const second = `${t} ${suffix}`;
  const compact = compactAtomForSearch(t);
  const typed = Boolean(screenshotQ || quoteQ || statisticQ);
  const allowThird = extras.length > 0 || /\d/.test(t) || /20\d{2}|月|日/.test(t) || typed;
  const third =
    allowThird && compact && compact !== t && extras.length === 0 ? `${compact} ${suffix}` : undefined;
  const temporal = allowThird ? (when ? `${t} ${when}` : `${t} 时间 日期`) : undefined;
  // 权威站点直查独立于 3 路配额：健康/社会/截图谣言必带官方站点查询。
  const siteQueries = looksLikeHealthOrSocialRumor(t) || /截图|P图|p图/.test(t)
    ? authoritySiteQueries(t)
    : [];
  // 英文谣言走分语言查询（不套中文后缀）。
  const enQueries = enRumorQueries(t);
  const queries = [...extras, ...siteQueries, ...enQueries, exact, screenshotQ, quoteQ, statisticQ, second, third, temporal]
    .filter((q): q is string => Boolean(q))
    .map((q) => q.replace(/\s+/g, " ").trim());
  return [...new Set(queries)].slice(0, (allowThird ? 3 : 2) + siteQueries.length + enQueries.length);
}
