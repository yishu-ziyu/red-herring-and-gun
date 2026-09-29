/**
 * 把判词说明写进结论时用的两个小工具：按句末截断，以及把每条判词说明里的局部 [n] 映射到全局来源编号。
 * （原 conclusionGate.ts：整句收权门、repair 触发、repair 文字都已被整句规则表取代并删除，只留这两件。）
 */

/** 截在 max 以内最后一个句末（连同其后的引号与 [n] 标记）；一句都没说完时补「…」。 */
export function clipSentence(value: unknown, max: number): string {
  const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length <= max) return text;
  const ends = [...text.slice(0, max).matchAll(/[。！？；](?:["”」』]|\s*\[\d+\])*/g)];
  const last = ends.at(-1);
  if (!last || last.index === undefined) return `${text.slice(0, max - 1)}…`;
  const tail = text.slice(last.index).match(/^[。！？；](?:["”」』]|\s*\[\d+\])*/)![0];
  return text.slice(0, last.index + tail.length);
}

type ScopedSource = { url: string; title: string; snippet: string };

function collectBucketSources(value: unknown): ScopedSource[] {
  if (!Array.isArray(value)) return [];
  const out: ScopedSource[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = String(rec.url ?? "").trim();
    if (!/^https?:\/\//i.test(url)) continue;
    out.push({
      url,
      title: String(rec.title ?? "").slice(0, 200),
      snippet: String(rec.snippet ?? "").slice(0, 320),
    });
  }
  return out;
}

/**
 * 把局部 [n] 映射到全局 source index（Review 5128220693 Blocker 2）。
 * 局部编号与判词双桶同构：supporting → [1..S]，contradicting → [S+1..S+C]。
 * 映射不到存活全局来源的 marker 直接删除，绝不错绑。
 */
function remapLocalMarkersToGlobal(
  evidence: string,
  supporting: ScopedSource[],
  contradicting: ScopedSource[],
  globalIndex: Map<string, number>
): string {
  const next = evidence.replace(/\[(\d+)\]/g, (_full, nStr: string) => {
    const n = Number(nStr);
    const local =
      n >= 1 && n <= supporting.length
        ? supporting[n - 1]
        : n > supporting.length && n <= supporting.length + contradicting.length
          ? contradicting[n - supporting.length - 1]
          : undefined;
    if (!local) return "";
    const mapped = globalIndex.get(local.url);
    return mapped != null ? `[${mapped}]` : "";
  });
  return next
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/**
 * 按判词顺序（与 normalizeReportCitations 的全局 first-seen 同序）构造全局
 * source index，把每段 evidence 的局部 marker 显式映射到全局编号。
 * 只取前 2 条有源判词（与旧行为同 cap）；返回的 texts 可直接拼进整句 conclusion，
 * 不得再被当成局部编号解读。
 */
export function buildScopedEvidence(value: unknown): {
  texts: string[];
  globalSources: ScopedSource[];
} {
  const texts: string[] = [];
  const globalSources: ScopedSource[] = [];
  const globalIndex = new Map<string, number>();
  if (!Array.isArray(value)) return { texts, globalSources };
  const scoped: Array<{ evidence: string; supporting: ScopedSource[]; contradicting: ScopedSource[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    if (rec.sourcesRelatedOnly === true) continue;
    const supporting = collectBucketSources(rec.supportingSources);
    const contradicting = collectBucketSources(rec.contradictingSources);
    if (supporting.length === 0 && contradicting.length === 0) continue;
    scoped.push({ evidence: clipSentence(rec.evidence, 120), supporting, contradicting });
    for (const src of [...supporting, ...contradicting]) {
      if (!globalIndex.has(src.url)) {
        globalIndex.set(src.url, globalSources.length + 1);
        globalSources.push(src);
      }
    }
    if (scoped.length >= 2) break;
  }
  for (const entry of scoped) {
    const remapped = remapLocalMarkersToGlobal(
      entry.evidence,
      entry.supporting,
      entry.contradicting,
      globalIndex
    );
    if (remapped) texts.push(remapped);
  }
  return { texts, globalSources };
}
