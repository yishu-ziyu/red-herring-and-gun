/**
 * Frontend citation binding — mirrors server rules so [n] always maps to sources[n-1].
 * Prefer report fields already normalized by the server; still clamp defensively.
 */

export type CiteSource = {
  url: string;
  title: string;
  snippet?: string;
};

export type CiteRef = {
  n: number;
  label: string;
  host: string;
  url: string;
  snippet?: string;
  /** true when this number appears in the prose */
  cited: boolean;
};

export function hostFromUrl(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const MARKER_RE = /\[(\d+)\]/g;

export function stripCitationMarkers(text: string): string {
  if (!text) return text;
  return text
    .replace(MARKER_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

export function clampMarkersToSources(text: string, sourceCount: number): string {
  if (!text) return text;
  if (sourceCount <= 0) return stripCitationMarkers(text);
  return text
    .replace(MARKER_RE, (_full, nStr: string) => {
      const n = Number(nStr);
      return n >= 1 && n <= sourceCount ? `[${n}]` : "";
    })
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/** Dedupe by URL, preserve first-seen order, cap at 8. */
export function dedupeSources(sources: CiteSource[]): CiteSource[] {
  const out: CiteSource[] = [];
  const seen = new Set<string>();
  for (const s of sources) {
    const url = typeof s?.url === "string" ? s.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({
      url,
      title: (typeof s.title === "string" && s.title.trim()) || "",
      snippet: typeof s.snippet === "string" ? s.snippet : undefined,
    });
    if (out.length >= 8) break;
  }
  return out;
}

export function collectCitedNumbers(text: string): Set<number> {
  const set = new Set<number>();
  if (!text) return set;
  for (const m of text.matchAll(MARKER_RE)) {
    set.add(Number(m[1]));
  }
  return set;
}

/**
 * Build display refs: n is 1-based index into deduped sources (authoritative).
 * cited=true when [n] appears in text after clamp.
 */
export function buildCiteRefs(
  text: string,
  sources: CiteSource[],
  options?: { relatedOnly?: boolean }
): { text: string; refs: CiteRef[] } {
  const deduped = dedupeSources(sources);
  const relatedOnly = options?.relatedOnly === true;
  const safeText = relatedOnly
    ? stripCitationMarkers(text)
    : clampMarkersToSources(text, deduped.length);
  const cited = collectCitedNumbers(safeText);

  const refs: CiteRef[] = deduped.map((s, i) => {
    const n = i + 1;
    const host = hostFromUrl(s.url);
    return {
      n,
      label: s.title || host || s.url,
      host: host || "link",
      url: s.url,
      snippet: s.snippet,
      cited: cited.has(n),
    };
  });

  return { text: safeText, refs };
}

/** Aggregate first-seen unique sources across subclaim lists (global conclusion numbering). */
export function buildGlobalSources(
  groups: Array<{ sources: CiteSource[]; relatedOnly?: boolean }>
): CiteSource[] {
  const out: CiteSource[] = [];
  const seen = new Set<string>();
  for (const g of groups) {
    // Related-only fills do not participate in global [n] for conclusion.
    if (g.relatedOnly) continue;
    for (const s of g.sources) {
      const url = typeof s?.url === "string" ? s.url.trim() : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push(s);
    }
  }
  return out;
}

export function sourcesFromStringRefs(
  sourceRefs: string[],
  titleByUrl?: Map<string, { title: string; snippet?: string }>
): CiteSource[] {
  const out: CiteSource[] = [];
  const seen = new Set<string>();
  for (const raw of sourceRefs) {
    const s = raw.trim();
    if (!/^https?:\/\//i.test(s) || seen.has(s)) continue;
    seen.add(s);
    const known = titleByUrl?.get(s);
    out.push({
      url: s,
      title: known?.title || "",
      snippet: known?.snippet,
    });
  }
  return out;
}
