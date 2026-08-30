/**
 * Citation binding — keep [n] markers aligned with ordered source lists.
 *
 * Invariant (local scope): after sanitizing sources, every [n] in text either
 * maps to sources[n-1] or is removed. Source list order is authoritative.
 *
 * Used by merge / atom bind / final report assembly so FE can trust numbers.
 */

export type CiteSource = {
  url: string;
  title: string;
  snippet: string;
};

export type BoundCitation = {
  text: string;
  sources: CiteSource[];
  /** old 1-based index → new 1-based index (survivors only) */
  remap: Map<number, number>;
  /** true when sources were injected from retrieval, not model-cited */
  relatedOnly: boolean;
};

const MARKER_RE = /\[(\d+)\]/g;

export function normalizeUrl(url: string): string {
  return typeof url === "string" ? url.trim() : "";
}

/**
 * Filter + dedupe model sources; build old→new index map for marker rewrite.
 * allowedUrls=null means keep any well-formed URL (still dedupe).
 */
export function filterSourcesWithRemap(
  raw: unknown,
  allowedUrls: Set<string> | null = null
): { sources: CiteSource[]; remap: Map<number, number> } {
  const sources: CiteSource[] = [];
  const remap = new Map<number, number>();
  const urlToNew = new Map<string, number>();
  if (!Array.isArray(raw)) return { sources, remap };

  for (let i = 0; i < raw.length; i += 1) {
    const oldN = i + 1;
    const item = raw[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = normalizeUrl(typeof rec.url === "string" ? rec.url : "");
    if (!url) continue;
    if (allowedUrls && !allowedUrls.has(url)) continue;

    const existing = urlToNew.get(url);
    if (existing != null) {
      remap.set(oldN, existing);
      continue;
    }
    if (sources.length >= 5) continue;

    const next = sources.length + 1;
    sources.push({
      url,
      title: typeof rec.title === "string" ? rec.title.slice(0, 200) : "",
      snippet: typeof rec.snippet === "string" ? rec.snippet.slice(0, 320) : "",
    });
    urlToNew.set(url, next);
    remap.set(oldN, next);
  }
  return { sources, remap };
}

/** Rewrite [n] using remap; drop markers with no survivor. Collapse leftover spaces lightly. */
export function remapCitationMarkers(text: string, remap: Map<number, number>): string {
  if (typeof text !== "string" || !text) return typeof text === "string" ? text : "";
  const next = text.replace(MARKER_RE, (_full, nStr: string) => {
    const mapped = remap.get(Number(nStr));
    return mapped != null ? `[${mapped}]` : "";
  });
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/** Drop every [n] marker (used when sources are auto-filled from retrieval). */
export function stripCitationMarkers(text: string): string {
  if (typeof text !== "string" || !text) return typeof text === "string" ? text : "";
  return text
    .replace(MARKER_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/**
 * Align prose markers to a final ordered source list (1..N).
 * Markers outside 1..N are removed. Does not reorder sources.
 */
export function clampMarkersToSources(text: string, sourceCount: number): string {
  if (typeof text !== "string" || !text) return typeof text === "string" ? text : "";
  if (sourceCount <= 0) return stripCitationMarkers(text);
  const next = text.replace(MARKER_RE, (_full, nStr: string) => {
    const n = Number(nStr);
    return n >= 1 && n <= sourceCount ? `[${n}]` : "";
  });
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/**
 * Bind model evidence + raw sources under an optional URL whitelist.
 * Source order after filter is the only truth for [n].
 */
export function bindLocalCitations(
  evidence: unknown,
  rawSources: unknown,
  allowedUrls: Set<string> | null = null
): BoundCitation {
  const textIn = typeof evidence === "string" ? evidence : "";
  const { sources, remap } = filterSourcesWithRemap(rawSources, allowedUrls);
  const text = remapCitationMarkers(textIn, remap);
  return {
    text: clampMarkersToSources(text, sources.length),
    sources,
    remap,
    relatedOnly: false,
  };
}

/**
 * When model left supporting empty and we inject retrieval hits:
 * show sources as related search, never invent citation alignment.
 */
export function bindRelatedSourcesOnly(
  evidence: unknown,
  retrieved: Array<{ url?: string; title?: string; snippet?: string }>
): BoundCitation {
  const textIn = typeof evidence === "string" ? evidence : "";
  const { sources } = filterSourcesWithRemap(retrieved, null);
  return {
    text: stripCitationMarkers(textIn),
    sources,
    remap: new Map(),
    relatedOnly: true,
  };
}

/** Global first-seen unique sources across verdicts (claim order). */
export function buildGlobalCiteSources(
  verdicts: Array<{ supportingSources?: CiteSource[] | null | undefined; sourcesRelatedOnly?: unknown }>
): CiteSource[] {
  const out: CiteSource[] = [];
  const seen = new Set<string>();
  for (const v of verdicts) {
    // relatedOnly（检索填充）源从未被模型引用：出处只是关键词检索命中，可能完全不相关。
    // 混进全局「参考资料」会让用户点开无关页面，打破「来源能点开」的承诺。
    if (v.sourcesRelatedOnly === true) continue;
    const list = Array.isArray(v.supportingSources) ? v.supportingSources : [];
    for (const s of list) {
      const url = normalizeUrl(s?.url ?? "");
      if (!url || seen.has(url)) continue;
      seen.add(url);
      out.push({
        url,
        title: typeof s.title === "string" ? s.title : "",
        snippet: typeof s.snippet === "string" ? s.snippet : "",
      });
    }
  }
  return out;
}

/**
 * Conclusion uses global first-seen numbering (same as ResultView footer).
 * Clamp markers to that list; do not invent sources.
 */
export function bindGlobalConclusion(
  conclusion: unknown,
  verdicts: Array<{ supportingSources?: CiteSource[] | null | undefined; sourcesRelatedOnly?: unknown }>
): { text: string; sources: CiteSource[] } {
  const sources = buildGlobalCiteSources(verdicts);
  const textIn = typeof conclusion === "string" ? conclusion : "";
  return {
    text: clampMarkersToSources(textIn, sources.length),
    sources,
  };
}

/**
 * evidenceChain layer: sourceRefs may be URLs or titles.
 * Prefer URL entries; number by that filtered list; clamp evidence markers.
 */
export function bindEvidenceChainLayer(
  evidence: unknown,
  sourceRefs: unknown,
  titleByUrl?: Map<string, { title: string; snippet?: string }>
): { text: string; sources: CiteSource[]; sourceRefs: string[] } {
  const refsIn = Array.isArray(sourceRefs)
    ? sourceRefs.filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    : [];
  const sources: CiteSource[] = [];
  const seen = new Set<string>();
  for (const raw of refsIn) {
    const s = raw.trim();
    if (!/^https?:\/\//i.test(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    const known = titleByUrl?.get(s);
    sources.push({
      url: s,
      title: known?.title || "",
      snippet: known?.snippet || "",
    });
    if (sources.length >= 8) break;
  }
  const text = clampMarkersToSources(typeof evidence === "string" ? evidence : "", sources.length);
  return {
    text,
    sources,
    sourceRefs: sources.map((s) => s.url),
  };
}

/**
 * Normalize a full finalReport's citation fields in place.
 * Call after subclaimVerdicts are final (merged + atom-bound).
 */
export function normalizeReportCitations(report: Record<string, unknown>): void {
  if (!report || typeof report !== "object") return;

  const verdicts = Array.isArray(report.subclaimVerdicts) ? report.subclaimVerdicts : [];
  const normalizedVerdicts = verdicts.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const v = raw as Record<string, unknown>;
    // relatedOnly fill already stripped markers; still clamp + dedupe sources.
    if (v.sourcesRelatedOnly === true) {
      const { sources } = filterSourcesWithRemap(v.supportingSources, null);
      return {
        ...v,
        evidence: stripCitationMarkers(typeof v.evidence === "string" ? v.evidence : ""),
        supportingSources: sources,
      };
    }
    const bound = bindLocalCitations(v.evidence, v.supportingSources, null);
    return {
      ...v,
      evidence: bound.text,
      supportingSources: bound.sources,
    };
  });
  report.subclaimVerdicts = normalizedVerdicts;

  const globalBound = bindGlobalConclusion(
    report.conclusion,
    normalizedVerdicts as Array<{ supportingSources?: CiteSource[] }>
  );
  if (typeof report.conclusion === "string") {
    report.conclusion = globalBound.text;
  }
  report.citationSources = globalBound.sources;

  if (Array.isArray(report.evidenceChain)) {
    const titleByUrl = new Map(
      globalBound.sources.map((s) => [s.url, { title: s.title, snippet: s.snippet }] as const)
    );
    report.evidenceChain = report.evidenceChain.map((layer) => {
      if (!layer || typeof layer !== "object") return layer;
      const rec = layer as Record<string, unknown>;
      const bound = bindEvidenceChainLayer(rec.evidence, rec.sourceRefs, titleByUrl);
      return {
        ...rec,
        evidence: bound.text,
        sourceRefs: bound.sourceRefs.length > 0 ? bound.sourceRefs : rec.sourceRefs,
        _citeSources: bound.sources,
      };
    });
  }

  if (Array.isArray(report.claimItems)) {
    const byAtom = new Map<string, Record<string, unknown>>();
    for (const v of normalizedVerdicts) {
      if (v && typeof v === "object" && typeof (v as { claimAtom?: unknown }).claimAtom === "string") {
        byAtom.set(String((v as { claimAtom: string }).claimAtom), v as Record<string, unknown>);
      }
    }
    report.claimItems = report.claimItems.map((item) => {
      if (!item || typeof item !== "object") return item;
      const rec = item as Record<string, unknown>;
      if (!rec.verdict || typeof rec.verdict !== "object") return item;
      const verdict = rec.verdict as Record<string, unknown>;
      const atom =
        typeof verdict.claimAtom === "string"
          ? verdict.claimAtom
          : typeof rec.text === "string"
            ? rec.text
            : "";
      const synced = byAtom.get(atom);
      if (!synced) return item;
      return { ...rec, verdict: { ...verdict, ...synced } };
    });
  }
}
