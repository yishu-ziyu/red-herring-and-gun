import { tierOf } from "../rules/sourceTiers.js";
import type { Pivot } from "./types.js";

const GENERIC_ENTITIES = new Set([
  "记者",
  "网友",
  "有人",
  "某人",
  "媒体",
  "知情人士",
  "消息人士",
  "相关人士",
  "有关部门",
  "各方",
  "网传",
  "网上",
  "官方",
  "外界",
  "业内",
  "专家",
  "分析人士",
  "路过",
]);

const LINK_CAP = 20;
const ENTITY_CAP = 10;
const IMAGE_CAP = 10;

const DOC_NUMBER_RE =
  /(?:[\u4e00-\u9fff]{1,12})?〔\d{4}〕\d+号|(?:[\u4e00-\u9fff]{1,12})?[(（]\d{4}[)）]\d+号/g;
const ZH_DATE_RE = /(\d{4})年(\d{1,2})月(\d{1,2})日/g;
const ISO_DATE_RE = /(\d{4})-(\d{2})-(\d{2})/g;
const CITED_ORG_RE = /据([\u4e00-\u9fff]{2,12})(?:报道|消息|通报)/g;
const SAID_ORG_RE = /([\u4e00-\u9fff]{2,12})(?:表示|称|回应)/g;

export type PivotPage = {
  id: string;
  host: string;
  text: string;
  links: string[];
  images: string[];
};

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function linkExpectedValue(url: string): 1 | 2 | 3 {
  const host = hostOf(url);
  if (!host) return 1;
  const tier = tierOf(host);
  if (tier === "A") return 3;
  if (tier === "B") return 2;
  return 1;
}

function padIso(year: string, month: string, day: string): string | undefined {
  const m = Number(month);
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${year}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function collectMatches(re: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(re)) {
    const value = match[0];
    if (value) out.push(value);
  }
  return out;
}

function collectGroups(re: RegExp, text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(re)) {
    const value = match[1];
    if (value) out.push(value);
  }
  return out;
}

export function extractPivots(page: PivotPage, depth: number): Pivot[] {
  const seen = new Set<string>();
  const pivots: Pivot[] = [];
  let i = 0;

  const add = (kind: Pivot["kind"], value: string, why: string, expectedValue: 1 | 2 | 3): boolean => {
    if (!value || seen.has(value)) return false;
    seen.add(value);
    pivots.push({
      id: `${page.id}:p${i}`,
      kind,
      value,
      why,
      expectedValue,
      fromEvidenceId: page.id,
      depth,
    });
    i += 1;
    return true;
  };

  let links = 0;
  for (const url of page.links) {
    if (links >= LINK_CAP) break;
    const host = hostOf(url);
    if (!host || host === page.host.toLowerCase()) continue;
    if (add("link", url, "外链", linkExpectedValue(url))) links += 1;
  }

  for (const doc of collectMatches(DOC_NUMBER_RE, page.text)) {
    add("doc_number", doc, "文号", 1);
  }

  for (const match of page.text.matchAll(ZH_DATE_RE)) {
    const iso = padIso(match[1], match[2], match[3]);
    if (iso) add("date", iso, "日期", 1);
  }
  for (const match of page.text.matchAll(ISO_DATE_RE)) {
    add("date", `${match[1]}-${match[2]}-${match[3]}`, "日期", 1);
  }

  let images = 0;
  for (const url of page.images) {
    if (images >= IMAGE_CAP) break;
    if (add("image", url, "图片", 1)) images += 1;
  }

  let entities = 0;
  const names = [...collectGroups(CITED_ORG_RE, page.text), ...collectGroups(SAID_ORG_RE, page.text)];
  for (const name of names) {
    if (entities >= ENTITY_CAP) break;
    if (GENERIC_ENTITIES.has(name)) continue;
    if (add("entity", name, "被引机构", 2)) entities += 1;
  }

  return pivots;
}
