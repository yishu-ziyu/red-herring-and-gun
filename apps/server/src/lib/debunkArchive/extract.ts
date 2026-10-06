import { similarity } from "./text.js";

export interface ArchiveItem {
  /** One rumor statement the article addresses. */
  statement: string;
  /** Verbatim sentences stating the finding for this statement (may be empty). */
  keySentences: string[];
}

export interface ArchiveRecord {
  url: string;
  title: string;
  /** YYYY-MM-DD */
  publishDate: string;
  originalPublisher: string;
  statements: string[];
  verdict: string;
  /** 2-5 verbatim sentences for the article as a whole. */
  keySentences: string[];
  items: ArchiveItem[];
  fullText: string;
  /** single: one story; roundup: several stories in one page; other: states no claim. */
  kind: "single" | "roundup" | "other";
  source: "piyao";
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", emsp: " ", ensp: " ", ldquo: "“", rdquo: "”" };

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? "");
}

function textOf(html: string): string {
  return decode(html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "").replace(/<[^>]+>/g, ""))
    .replace(/[  　]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------- titles

const VERDICT_TOKEN = /是真是假|真假|都是谣言|这些谣言|谣言|假的|均不实|不实|不属实|别传|别被|别再传|已辟谣|辟谣|必须澄清|澄清|别信|纯属|谨防|当心|注意|真相|虚假|全是假/;
const AUTHORITY_TAIL = /^.{0,8}(?:通报|回应|辟谣|澄清|提醒|说明|答复|表态)$/;
const LEAD_VERDICT = /^(?:假的|别信|别被误导|别被骗|这些谣言都别信|权威辟谣|辟谣|谣言|真相|注意|警惕)[：:！!，,]\s*/;
/** A result clause (what happened to the rumor-monger), not a claim. */
const RESULT_CHUNK = /被(?:罚|拘|查|处罚|拘留|批评教育|约谈)|已被|警方|通报|回应|已辟谣/;
/** Does the title state a claim at all? Slogans that merely mention 谣言/辟谣 do not. */
function statesClaim(title: string, spans: string[]): boolean {
  return (
    /[？?]/.test(title) ||
    /网传|传言|据传/.test(title) ||
    /^(?:假的|谣言|不实)[！!：:]/.test(title) ||
    /(?:……|…)[^？?]{0,14}(?:谣言|澄清|不实|假|别信|别传|别被|辟谣)/.test(title) ||
    (spans.length >= 1 && /辟谣|不实|谣言|澄清|伪造|编造|回应|假/.test(title.replace(/[“「『][^”」』]*[”」』]/g, "")) && !/活动|开展|启动|举办|宣传|培训|座谈|签约|倡议/.test(title)) ||
    /[？?！!，,”」]\s*(?:不实|是谣言|系谣言|纯属谣言|谣言|假的)/.test(title)
  );
}
const OPEN_Q = "“\"「『";
const CLOSE_Q = "”\"」』";

function unwrapQuotes(s: string): string {
  let t = s.trim();
  if (t.length >= 2 && OPEN_Q.includes(t[0]) && CLOSE_Q.includes(t[t.length - 1])) t = t.slice(1, -1).trim();
  return t;
}

function quotedSpans(s: string): string[] {
  return [...s.matchAll(/[“「『]([^”」』]{4,90})[”」』]/g)].map((m) => m[1].trim());
}

/** Claims stated by a title such as 「XX？谣言！」, 「网传“XX”」, 「A、B、C……都是谣言」. */
export function statementsFromTitle(rawTitle: string): string[] {
  const title = rawTitle
    .replace(/^【[^】]{1,8}】\s*/, "")
    .replace(/^[^｜|丨]{1,12}[｜|丨]\s*/, "")
    .replace(/[“「『][^”」』]*[”」』]/g, (q) => q.replace(/[？?！!]/g, ""))
    .replace(/\s*中国互联网联合辟谣平台.*$/, "")
    .replace(/[（(][^）)]*[）)]\s*$/, "")
    .trim();
  if (!statesClaim(title, quotedSpans(title))) return [];
  const chunks = title
    .replace(LEAD_VERDICT, "")
    .split(/[？?！!。；;]|……|…|\.{3,}|——/)
    .map((c) => c.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (let chunk of chunks) {
    chunk = chunk
      .replace(LEAD_VERDICT, "")
      .replace(/[，, ]?(?:这)?是真的[吗么]$|是真是假$/, "")
      .replace(/[，, ]?(?:纯属|都是|均为|均|全是|全|是|为|系)?(?:假的|谣言|不实(?:信息|谣言)?|误传|误读|假消息|不属实)$/, "")
      .replace(/[→↓↑]+$/, "")
      .trim();
    if (!chunk) continue;
    if (out.length && chunk.length <= 8 && !/[“「『]/.test(chunk)) continue; // commentary tail such as 网友热议 / 回应来了
    if (/榜$|榜来了|来了$/.test(chunk)) continue;
    if (AUTHORITY_TAIL.test(chunk)) continue;
    if (out.length && RESULT_CHUNK.test(chunk)) continue;
    if (VERDICT_TOKEN.test(chunk) && (chunk.length <= 14 || /^(?:别|这些|均|全)/.test(chunk)) && !/网传|传言/.test(chunk)) continue;
    const spans = quotedSpans(chunk);
    // 网传“XX” / “XX”系AI伪造 / “A”“B”“C”: the quoted text is the claim
    if (spans.length >= 2 || (spans.length === 1 && (/^(?:网传|传言|据传|网上流传)|^[“「『][^”」』]+[”」』]\s*(?:系|是|为|不实|不属实)/.test(chunk) || /辟谣|澄清|编造|造谣|捏造|否认|回应|伪造/.test(chunk)))) {
      out.push(...spans);
      continue;
    }
    const stripped = unwrapQuotes(chunk.replace(/^(?:网传|网上流传|传言称?|据传|网友称|有网友称)[：:，, ]?/, ""));
    const parts = stripped.split("、").map((p) => p.trim());
    if (parts.length >= 2 && parts.every((p) => p.length >= 6)) out.push(...parts.map(unwrapQuotes));
    else out.push(stripped);
  }
  return dedupe(out.filter((s) => s.length >= 4 && /[㐀-鿿]/.test(s)));
}

function dedupe(a: string[]): string[] {
  return [...new Set(a)];
}

// ---------------------------------------------------------------- body

const BOILERPLATE_SENTENCE = /↑|温馨提示|不信谣|不传谣|责任编辑|来源[：:]|扫码|关注.{0,6}公众号|转发|举报电话|点击|↓|欢迎|编辑[：:]|审核[：:]|监制|策划|出品|图片来源|资料来源/;
const FINDING_STRONG = /经查|经核实|经调查|核查|核实|不实|不属实|系谣言|是谣言|为谣言|纯属谣言|虚假|系伪造|系编造|系AI|与事实不符/;
const FINDING_MID = /通报|回应|并非|不涉及|不存在|不是|实际上|事实上|误读|误传|辟谣|夸大|没有此类|未发现|尚未/;
const FINDING_WEAK = /没有|专家|科学|证据|研究|标准|规定|数据/;

function sentencesOf(paragraph: string): string[] {
  return (paragraph.match(/[^。！？!?]+[。！？!?]?[”」』）)"]*/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

function scoreSentence(s: string): number {
  if (s.length < 10 || s.length > 160 || BOILERPLATE_SENTENCE.test(s) || (s.match(/[㐀-鿿]/g)?.length ?? 0) < 6) return -1;
  return (FINDING_STRONG.test(s) ? 3 : 0) + (FINDING_MID.test(s) ? 2 : 0) + (FINDING_WEAK.test(s) ? 1 : 0);
}

function pickKeySentences(paragraphs: string[], max: number, min: number): string[] {
  const cands = paragraphs.flatMap(sentencesOf).map((s, order) => ({ s, order, score: scoreSentence(s) })).filter((c) => c.score >= 0);
  const picked = new Set<number>();
  for (const floor of [2, 1, 0]) {
    for (const c of [...cands].sort((a, b) => b.score - a.score || a.order - b.order)) {
      if (picked.size >= max) break;
      if (c.score >= floor && (floor > 0 || picked.size < min)) picked.add(c.order);
    }
    if (picked.size >= min && floor <= 1) break;
  }
  return cands.filter((c) => picked.has(c.order)).map((c) => c.s);
}

/** The claim a paragraph opens with (roundup item header), or null. */
function claimFromParagraph(p: string): string | null {
  let m = p.match(/^[【\[]?谣言[】\]]?[：:\s]+([^。！]{4,120})/);
  const head = m ? m[1] : p;
  const spans = quotedSpans(head.slice(0, 60));
  if (m) {
    const q = quotedSpans(m[1]);
    return unwrapQuotes((q[0] ?? m[1].replace(/^(?:网传|网上流传)[：:，, ]?/, "")).trim()) || null;
  }
  m = p.match(/^(?:近日，)?(?:网传|网上流传|有传言称|传言称|谣言称|有网友(?:称|发帖称|声称))[：:，, ]?/);
  if (!m) return null;
  if (spans[0]) return spans[0];
  const rest = p.slice(m[0].length).match(/^[^。！？]{6,100}/);
  return rest ? rest[0].trim() : null;
}

const VERDICT_CLAUSE = /均为谣言|系[^，。]{0,6}谣言|属于谣言|没有科学依据|无科学依据|并非如此|不是真的|不科学|不可信|不靠谱|不实|不属实|系谣言|是谣言|为谣言|纯属谣言|虚假信息|虚假视频|系虚假|系伪造|系编造|系AI|并非事实|与事实不符|没有此类|不存在|不准确|夸大|误读|误传/;

function verdictOf(paragraphs: string[], title: string): string {
  for (const p of paragraphs) {
    for (const sent of sentencesOf(p)) {
      if (BOILERPLATE_SENTENCE.test(sent)) continue;
      const clause = sent.split(/[，,；;]/).map((c) => c.replace(/[。！？!?]+$/, "").trim()).find((c) => VERDICT_CLAUSE.test(c));
      if (clause) return clause.slice(0, 60);
    }
  }
  const tail = title.split(/[？?！!。]/).map((c) => c.trim()).filter((c) => VERDICT_CLAUSE.test(c) || /假的|别信|别传|别被/.test(c));
  return tail.at(-1) ?? "";
}

// ---------------------------------------------------------------- page

const ROUNDUP_TITLE = /辟谣榜|盘点|这些(?:都是)?谣言|年度|月度|汇总|周报|别被这些|这些涉/;

export function extractPiyaoArticle(html: string, url: string): ArchiveRecord | null {
  const head = html.match(/<div class="con_tit"[^>]*>([\s\S]*?)<\/div>/);
  const title = head ? textOf(head[1].match(/<h2[^>]*>([\s\S]*?)<\/h2>/)?.[1] ?? "") : "";
  const bodyStart = html.search(/id="detailContent"/);
  if (!title || bodyStart < 0) return null;
  const bodyEnd = html.indexOf('class="zrbj', bodyStart);
  const bodyHtml = html.slice(bodyStart, bodyEnd > 0 ? bodyEnd : bodyStart + 80000);
  const paragraphs = [...bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => textOf(m[1])).filter(Boolean);

  const headText = head![1];
  const originalPublisher = textOf(headText.match(/来源[：:]\s*([\s\S]*?)(?:<span|$)/)?.[1] ?? "");
  const publishDate =
    headText.match(/时间[：:]\s*(\d{4}-\d{2}-\d{2})/)?.[1] ??
    html.match(/<meta name="publishdate" content="(\d{4}-\d{2}-\d{2})"/i)?.[1] ??
    url.replace(/^.*\/(\d{4})(\d{2})(\d{2})\/.*$/, "$1-$2-$3");

  const titleStatements = statementsFromTitle(title);

  // Blocks: a section header ("辟 谣 …", "误 区 …", "通 报 …") or a paragraph that opens
  // with a claim starts a block that runs until the next one. Only claim blocks carry statements.
  const blocks: { statements: string[]; paragraphs: string[]; header: boolean }[] = [];
  for (const p of paragraphs) {
    const h = p.match(/^([㐀-鿿]) ([㐀-鿿]) (\S.*)$/);
    if (h) {
      blocks.push({ statements: /^(?:辟谣|误区|求证|谣言)$/.test(h[1] + h[2]) ? statementsFromTitle(h[3]) : [], paragraphs: [p], header: true });
      continue;
    }
    const claim = claimFromParagraph(p);
    if (claim) blocks.push({ statements: [claim], paragraphs: [p], header: false });
    else if (blocks.length) blocks[blocks.length - 1].paragraphs.push(p);
  }
  const claimBlocks = blocks.filter((b) => b.statements.length);

  const roundup =
    titleStatements.length >= 3 ||
    claimBlocks.length >= 3 ||
    blocks.filter((b) => b.header).length >= 2 ||
    (ROUNDUP_TITLE.test(title) && (titleStatements.length >= 2 || claimBlocks.length >= 1));
  const articleKey = pickKeySentences(paragraphs, 5, 2);

  let items: ArchiveItem[];
  if (roundup) {
    items = claimBlocks.flatMap((b) => {
      const keySentences = pickKeySentences(b.header && b.paragraphs.length > 1 ? b.paragraphs.slice(1) : b.paragraphs, 3, 1);
      return b.statements.map((statement) => ({ statement, keySentences }));
    });
    for (const s of titleStatements) {
      const hit = items.find((i) => similarity(i.statement, s) >= 0.6);
      if (!hit) items.push({ statement: s, keySentences: [] });
    }
  } else {
    const statements = titleStatements.length ? titleStatements : claimBlocks.slice(0, 1).flatMap((b) => b.statements);
    items = statements.map((statement) => ({ statement, keySentences: articleKey }));
  }
  items = items.filter((i, k) => items.findIndex((j) => j.statement === i.statement) === k);

  const kind: ArchiveRecord["kind"] = roundup ? "roundup" : items.length ? "single" : "other";
  return {
    url,
    title,
    publishDate,
    originalPublisher,
    statements: items.map((i) => i.statement),
    verdict: kind === "other" ? "" : verdictOf(paragraphs, title),
    keySentences: kind === "other" ? [] : articleKey,
    items,
    fullText: paragraphs.join("\n"),
    kind,
    source: "piyao",
  };
}
