import type { Evidence, Provenance } from "./types.js";

const EXCERPT_MAX_CODE_POINTS = 320;

/** 追踪参数：utm_* 一律去掉；其余按本表精确匹配（大小写不敏感）。 */
export const TRACKING_QUERY_PARAMS: readonly string[] = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "spm",
  "share_token",
];

function isTrackingQueryParam(key: string): boolean {
  const lower = key.toLowerCase();
  if (lower.startsWith("utm_")) return true;
  return TRACKING_QUERY_PARAMS.includes(lower);
}

function stripOneHostPrefix(hostname: string): string {
  if (hostname.startsWith("www.")) return hostname.slice(4);
  if (hostname.startsWith("m.")) return hostname.slice(2);
  return hostname;
}

function clipCodePoints(text: string, max: number): string {
  const points = [...text];
  if (points.length <= max) return text;
  return points.slice(0, max).join("");
}

export function canonicalizeUrl(url: string): string | null {
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  parsed.hash = "";
  parsed.hostname = stripOneHostPrefix(parsed.hostname.toLowerCase());
  if (
    (parsed.protocol === "http:" && parsed.port === "80") ||
    (parsed.protocol === "https:" && parsed.port === "443")
  ) {
    parsed.port = "";
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (isTrackingQueryParam(key)) parsed.searchParams.delete(key);
  }
  parsed.searchParams.sort();

  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return parsed.toString();
}

export function toEvidence(
  raw: { url: string; title?: string; snippet?: string; publishedAt?: string; provider?: string },
  provenance: Provenance,
  now?: Date
): Omit<Evidence, "id"> | null {
  const canonicalUrl = canonicalizeUrl(raw.url);
  if (!canonicalUrl) return null;

  const evidence: Omit<Evidence, "id"> = {
    url: raw.url,
    canonicalUrl,
    host: new URL(canonicalUrl).hostname,
    excerpt: clipCodePoints(raw.snippet ?? "", EXCERPT_MAX_CODE_POINTS),
    retrievedAt: (now ?? new Date()).toISOString(),
    tier: "unknown",
    provenance,
  };
  if (raw.title !== undefined) evidence.title = raw.title;
  if (raw.publishedAt !== undefined) evidence.publishedAt = raw.publishedAt;
  return evidence;
}
