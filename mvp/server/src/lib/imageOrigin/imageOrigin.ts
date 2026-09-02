/**
 * Screenshot image-origin gate (P2, screenshot branch only).
 * Reverse-image hits may cite the picture's origin. OCR/text-search hits must not.
 * No reverse-image vendor → explicit gap, never invent a source.
 */

// reverseImage 模块对本文件仅 type-import（ReverseImageHit 等），运行时无环。
import { isReverseImageVendorConfigured } from "../reverseImage/search360ReverseImage.js";

export const IMAGE_ORIGIN_NOT_FOUND = "原图没查到";
export const IMAGE_ORIGIN_NOT_FOUND_ALT = "原图出处未查到";

const HTTP_URL_RE = /^https?:\/\//i;
const DATA_URL_RE = /data:image\/[a-zA-Z0-9.+-]+;base64,[a-zA-Z0-9+/=\s]+/gi;
const ORIGIN_CLAIM_RE = /这张图的来源|这张图来自|原图(?:的)?来源|原图出处(?!未查到)|image origin/i;

export type ImagePayload = {
  mimeType?: string;
  dataUrl: string;
};

export type ReverseImageHit = {
  url: string;
  title?: string;
  snippet?: string;
};

export type TextSearchHit = {
  url: string;
  title?: string;
  snippet?: string;
};

export type ImageOriginStatus = "found" | "not_found" | "unavailable";

export type ImageOriginResult = {
  status: ImageOriginStatus;
  /** Reverse-image is the only channel that may fill url. */
  channel: "reverse-image" | "none";
  url?: string;
  title?: string;
  snippet?: string;
  /** User-facing: origin title/url, or 原图没查到 / 原图出处未查到. */
  label: string;
};

export type ReverseImageSearchFn = (input: {
  images: ImagePayload[];
  ocrTexts: string[];
  sourceHints: string[];
}) => Promise<ReverseImageHit[]>;

export type ImageOriginLookupInput = {
  images: ImagePayload[];
  ocrTexts?: string[];
  sourceHints?: string[];
  /** Injected reverse-image adapter. Omit when no vendor exists. */
  reverseImageSearch?: ReverseImageSearchFn;
  /** OCR/text hits — accepted only so the gate can ignore them. */
  textSearchHits?: TextSearchHit[];
};

const GAP_COPY = IMAGE_ORIGIN_NOT_FOUND;
const FALSE_ORIGIN_GUARD = "不能把转载帖当成这张图的来源";

export function isHttpUrl(url: string): boolean {
  return typeof url === "string" && HTTP_URL_RE.test(url.trim());
}

function stringList(value: unknown, max = 24): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()].slice(0, max);
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

export function visionHintsFromExtraction(visual: unknown): {
  ocrTexts: string[];
  sourceHints: string[];
} {
  const rec =
    visual && typeof visual === "object" && !Array.isArray(visual)
      ? (visual as Record<string, unknown>)
      : {};
  return {
    ocrTexts: stringList(rec.ocrTexts),
    sourceHints: stringList(rec.sourceHints),
  };
}

function firstReverseHit(hits: ReverseImageHit[] | undefined): ReverseImageHit | undefined {
  if (!Array.isArray(hits)) return undefined;
  for (const hit of hits) {
    if (!hit || typeof hit !== "object") continue;
    const url = String(hit.url || "").trim();
    if (!isHttpUrl(url)) continue;
    return {
      url,
      title: typeof hit.title === "string" ? hit.title.slice(0, 200) : "",
      snippet: typeof hit.snippet === "string" ? hit.snippet.slice(0, 320) : "",
    };
  }
  return undefined;
}

export function notFoundImageOrigin(status: "not_found" | "unavailable" = "not_found"): ImageOriginResult {
  return {
    status,
    channel: "none",
    label: GAP_COPY,
  };
}

/**
 * GATE: origin URL comes only from reverse-image hits.
 * textSearchHits / OCR sourceHints are ignored even when they contain http(s) URLs.
 */
export function resolveImageOrigin(input: {
  reverseImageHits?: ReverseImageHit[];
  textSearchHits?: TextSearchHit[];
  reverseImageAvailable?: boolean;
}): ImageOriginResult {
  const hit = firstReverseHit(input.reverseImageHits);
  if (hit) {
    return {
      status: "found",
      channel: "reverse-image",
      url: hit.url,
      title: hit.title || "",
      snippet: hit.snippet || "",
      label: hit.title || hit.url,
    };
  }
  const unavailable = input.reverseImageAvailable === false;
  return notFoundImageOrigin(unavailable ? "unavailable" : "not_found");
}

/**
 * Reverse-image vendor configured = API key + public base URL（临时图床）。
 * 无配置 → false：上层按「查不到原图」降级，绝不发明图源。
 */
export function reverseImageVendorAvailable(env?: Record<string, string>): boolean {
  return env ? isReverseImageVendorConfigured(env) : false;
}

export async function lookupImageOrigin(input: ImageOriginLookupInput): Promise<ImageOriginResult> {
  let hits: ReverseImageHit[] = [];
  let available = Boolean(input.reverseImageSearch);
  if (input.reverseImageSearch) {
    try {
      const raw = await input.reverseImageSearch({
        images: input.images,
        ocrTexts: input.ocrTexts ?? [],
        sourceHints: input.sourceHints ?? [],
      });
      hits = Array.isArray(raw) ? raw : [];
    } catch {
      hits = [];
      available = false;
    }
  }
  return resolveImageOrigin({
    reverseImageHits: hits,
    textSearchHits: input.textSearchHits,
    reverseImageAvailable: available,
  });
}

export async function safeLookupImageOrigin(
  lookup: () => Promise<ImageOriginResult>
): Promise<ImageOriginResult> {
  try {
    const result = await lookup();
    if (!result || typeof result !== "object") return notFoundImageOrigin("unavailable");
    if (result.status === "found" && result.channel === "reverse-image" && isHttpUrl(result.url || "")) {
      return result;
    }
    return {
      status: result.status === "unavailable" ? "unavailable" : "not_found",
      channel: "none",
      label: GAP_COPY,
    };
  } catch {
    return notFoundImageOrigin("unavailable");
  }
}

/** Walk a value and strip image bytes / data URLs so they never appear in logs. */
export function redactForLog(value: unknown): unknown {
  if (typeof value === "string") {
    if (value.startsWith("data:image/") || /;base64,/.test(value)) return "[redacted-image]";
    return value.replace(DATA_URL_RE, "[redacted-image]");
  }
  if (Array.isArray(value)) return value.map((item) => redactForLog(item));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (/dataUrl|imageBytes|base64|screenshot/i.test(key) && typeof item === "string") {
        out[key] = "[redacted-image]";
        continue;
      }
      out[key] = redactForLog(item);
    }
    return out;
  }
  return value;
}

export function attachImageOriginToBundle(
  bundle: {
    imageOrigin?: ImageOriginResult;
    aggregate: { unresolvedEvidenceGaps: string[] };
  },
  origin: ImageOriginResult
): void {
  bundle.imageOrigin = origin;
  if (origin.status === "found") return;
  const gaps = bundle.aggregate.unresolvedEvidenceGaps;
  if (!Array.isArray(gaps)) return;
  if (gaps.some((g) => g === IMAGE_ORIGIN_NOT_FOUND || g === IMAGE_ORIGIN_NOT_FOUND_ALT)) return;
  gaps.push(IMAGE_ORIGIN_NOT_FOUND);
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？\n])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function sentenceCitesUrl(sentence: string, url: string): boolean {
  if (!url) return false;
  if (sentence.includes(url)) return true;
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host.length >= 4 && sentence.includes(host);
  } catch {
    return false;
  }
}

function scrubOriginClaims(text: string, origin: ImageOriginResult, bannedUrls: string[]): string {
  if (typeof text !== "string" || !text) return typeof text === "string" ? text : "";
  const sentences = splitSentences(text);
  if (sentences.length === 0) return text;
  const kept: string[] = [];
  for (const sentence of sentences) {
    const claimsOrigin = ORIGIN_CLAIM_RE.test(sentence);
    const citesBanned = bannedUrls.some((url) => sentenceCitesUrl(sentence, url));
    const citesFound = origin.status === "found" && origin.url ? sentenceCitesUrl(sentence, origin.url) : false;
    if (claimsOrigin && citesBanned && !citesFound) continue;
    if (claimsOrigin && origin.status !== "found") continue;
    kept.push(sentence);
  }
  return kept.join("");
}

function ensureGapCopy(text: string, origin: ImageOriginResult): string {
  const t = (text ?? "").trim();
  if (origin.status === "found" && origin.url) {
    if (t.includes(origin.url) || t.includes("原图出处")) return t;
    if (!t) return `原图出处：${origin.url}。`;
    return `${t.replace(/[。．.]*$/, "")}。原图出处：${origin.url}。`;
  }
  if (t.includes(IMAGE_ORIGIN_NOT_FOUND) || t.includes(IMAGE_ORIGIN_NOT_FOUND_ALT)) return t;
  if (!t) return `${IMAGE_ORIGIN_NOT_FOUND}。`;
  return `${t.replace(/[。．.]*$/, "")}。${IMAGE_ORIGIN_NOT_FOUND}。`;
}

function pushUnique(list: unknown, item: string, max = 8): string[] {
  const arr = Array.isArray(list)
    ? list.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
    : [];
  if (arr.some((v) => v.includes(item) || item.includes(v))) return arr.slice(0, max);
  return [...arr, item].slice(0, max);
}

function collectHttpUrls(value: unknown, into: Set<string>): void {
  if (typeof value === "string" && isHttpUrl(value)) {
    into.add(value.trim());
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectHttpUrls(item, into);
    return;
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    if (typeof rec.url === "string" && isHttpUrl(rec.url)) into.add(rec.url.trim());
    for (const nested of Object.values(rec)) collectHttpUrls(nested, into);
  }
}

/**
 * Improve metric: origin URLs that exist only in OCR/text search (not reverse-image) must be 0.
 */
export function countOcrOnlyImageOriginCitations(
  origin: ImageOriginResult | undefined,
  textSearchUrls: string[]
): number {
  if (!origin || origin.status !== "found" || !origin.url) return 0;
  if (origin.channel === "reverse-image") return 0;
  const text = new Set(textSearchUrls.map((u) => u.trim()).filter(Boolean));
  return text.has(origin.url) ? 1 : 0;
}

export function countOcrOnlyImageOriginCitationsInReport(
  report: Record<string, unknown>,
  textSearchUrls: string[]
): number {
  const origin = asOrigin(report.imageOrigin);
  let n = countOcrOnlyImageOriginCitations(origin, textSearchUrls);
  const blobs = [
    String(report.conclusion ?? ""),
    String(report.summaryForPublic ?? ""),
    String(report.recommendation ?? ""),
  ];
  if (Array.isArray(report.whyHardToVerify)) {
    for (const item of report.whyHardToVerify) if (typeof item === "string") blobs.push(item);
  }
  if (Array.isArray(report.evidenceChain)) {
    for (const layer of report.evidenceChain) {
      if (!layer || typeof layer !== "object") continue;
      const rec = layer as Record<string, unknown>;
      if (typeof rec.finding === "string") blobs.push(rec.finding);
      if (typeof rec.evidence === "string") blobs.push(rec.evidence);
    }
  }
  const textOnly = textSearchUrls.filter((url) => origin?.channel !== "reverse-image" || url !== origin.url);
  for (const url of textOnly) {
    for (const blob of blobs) {
      if (ORIGIN_CLAIM_RE.test(blob) && blob.includes(url)) n += 1;
    }
  }
  return n;
}

function asOrigin(value: unknown): ImageOriginResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rec = value as Record<string, unknown>;
  if (rec.status !== "found" && rec.status !== "not_found" && rec.status !== "unavailable") return undefined;
  return {
    status: rec.status,
    channel: rec.channel === "reverse-image" ? "reverse-image" : "none",
    url: typeof rec.url === "string" ? rec.url : undefined,
    title: typeof rec.title === "string" ? rec.title : undefined,
    snippet: typeof rec.snippet === "string" ? rec.snippet : undefined,
    label: typeof rec.label === "string" ? rec.label : GAP_COPY,
  };
}

function publicOrigin(origin: ImageOriginResult): ImageOriginResult {
  if (origin.status === "found" && origin.channel === "reverse-image" && isHttpUrl(origin.url || "")) {
    return {
      status: "found",
      channel: "reverse-image",
      url: origin.url,
      title: origin.title || "",
      snippet: origin.snippet || "",
      label: origin.title || origin.url || origin.label,
    };
  }
  return notFoundImageOrigin(origin.status === "unavailable" ? "unavailable" : "not_found");
}

function scrubRecordStrings(
  rec: Record<string, unknown>,
  keys: string[],
  origin: ImageOriginResult,
  bannedUrls: string[]
): void {
  for (const key of keys) {
    if (typeof rec[key] !== "string") continue;
    rec[key] = scrubOriginClaims(rec[key] as string, origin, bannedUrls);
  }
}

/**
 * Write the origin field and strip OCR-text URLs from 「这张图的来源」 claims.
 * Idempotent. Does not invent a source.
 */
export function applyImageOriginToReport(
  report: Record<string, unknown>,
  origin: ImageOriginResult | undefined
): void {
  if (!report || typeof report !== "object" || !origin) return;
  const safe = publicOrigin(origin);
  const urls = new Set<string>();
  collectHttpUrls(report, urls);
  const banned = [...urls].filter((url) => url !== safe.url);

  report.imageOrigin = safe;

  report.conclusion = ensureGapCopy(
    scrubOriginClaims(String(report.conclusion ?? ""), safe, banned),
    safe
  );
  if (typeof report.summaryForPublic === "string") {
    report.summaryForPublic = ensureGapCopy(
      scrubOriginClaims(report.summaryForPublic, safe, banned),
      safe
    );
  }
  if (typeof report.recommendation === "string") {
    report.recommendation = scrubOriginClaims(report.recommendation, safe, banned);
  }

  report.cannotSay = pushUnique(report.cannotSay, FALSE_ORIGIN_GUARD);
  if (safe.status !== "found") {
    report.whyHardToVerify = pushUnique(report.whyHardToVerify, IMAGE_ORIGIN_NOT_FOUND);
  } else if (safe.url) {
    const sources = Array.isArray(report.citationSources) ? [...report.citationSources] : [];
    const hasOrigin = sources.some(
      (item) => item && typeof item === "object" && String((item as { url?: unknown }).url || "").trim() === safe.url
    );
    if (!hasOrigin) {
      sources.push({
        url: safe.url,
        title: safe.title || "原图出处",
        snippet: safe.snippet || "",
      });
      report.citationSources = sources;
    }
  }

  if (Array.isArray(report.subclaimVerdicts)) {
    report.subclaimVerdicts = report.subclaimVerdicts.map((item) => {
      if (!item || typeof item !== "object") return item;
      const rec = item as Record<string, unknown>;
      scrubRecordStrings(rec, ["evidence", "boundary"], safe, banned);
      const gaps = Array.isArray(rec.evidenceGaps) ? rec.evidenceGaps.slice() : [];
      if (safe.status !== "found" && !gaps.some((g) => String(g).includes("原图"))) {
        rec.evidenceGaps = [...gaps, IMAGE_ORIGIN_NOT_FOUND].slice(0, 4);
      }
      return rec;
    });
  }

  if (Array.isArray(report.evidenceChain)) {
    report.evidenceChain = report.evidenceChain.map((layer) => {
      if (!layer || typeof layer !== "object") return layer;
      const rec = { ...(layer as Record<string, unknown>) };
      scrubRecordStrings(rec, ["finding", "evidence", "boundary"], safe, banned);
      return rec;
    });
  }
}
