/**
 * 来源发布日期（#140）：谣言常是旧闻重发，用户要看到每个来源是哪天发的。
 * 只认三处出处，按顺序：检索方给的日期 → 网页自己的发布元数据 → URL 里的日期。
 * 不从正文猜、不用抓取时间顶替；不可能的日期（未来、1990 年以前）一律当作没有。
 */

const MIN_YEAR = 1990;

/** 任意日期写法 → YYYY-MM-DD；认不出或不可能的日期返回 undefined。 */
export function normalizePublishedDate(raw: unknown, now: Date = new Date()): string | undefined {
  if (typeof raw !== "string") return undefined;
  const m = raw.trim().match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})(?!\d)/) ?? raw.trim().match(/^(\d{4})(\d{2})(\d{2})(?!\d)/);
  if (!m) return undefined;
  return validDay(Number(m[1]), Number(m[2]), Number(m[3]), now);
}

function validDay(y: number, mo: number, d: number, now: Date): string | undefined {
  if (y < MIN_YEAR) return undefined;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return undefined;
  // 允许一天时差（来源所在时区可能比服务器早一天）。
  if (t > now.getTime() + 24 * 3600 * 1000) return undefined;
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

const URL_DATE_PATTERNS: RegExp[] = [
  /\/((?:19|20)\d{2})-(\d{2})\/(\d{2})(?=[/_.]|$)/, // /2019-04/03/
  /\/((?:19|20)\d{2})\/(\d{2})\/(\d{2})(?=[/_.]|$)/, // /2024/02/18/
  /\/((?:19|20)\d{2})(\d{2})\/(\d{2})(?=\/)/, // /201411/25/
  /[/t_]((?:19|20)\d{2})(\d{2})(\d{2})(?=[/_.]|$)/, // /20230128/ 、t20240218_
];

/** URL 路径里写明的日期。只看路径，不看查询参数。 */
export function dateFromUrl(url: string, now: Date = new Date()): string | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  for (const re of URL_DATE_PATTERNS) {
    const m = path.match(re);
    if (!m) continue;
    const day = validDay(Number(m[1]), Number(m[2]), Number(m[3]), now);
    if (day) return day;
  }
  return undefined;
}

const META_NAMES = /^(?:article:published_time|og:published_time|og:article:published_time|pubdate|publishdate|publish_date|publication_date|datepublished|dc\.date\.issued|firstpublishedtime)$/i;

/** 网页自己写的发布日期：发布元数据 → JSON-LD datePublished → <time datetime>。 */
export function dateFromHtml(html: string, now: Date = new Date()): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = tag.match(/\b(?:property|name|itemprop)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!name || !META_NAMES.test(name.trim())) continue;
    const day = normalizePublishedDate(tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1], now);
    if (day) return day;
  }
  for (const m of html.matchAll(/"datePublished"\s*:\s*"([^"]+)"/g)) {
    const day = normalizePublishedDate(m[1], now);
    if (day) return day;
  }
  for (const m of html.matchAll(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/gi)) {
    const day = normalizePublishedDate(m[1], now);
    if (day) return day;
  }
  return undefined;
}
