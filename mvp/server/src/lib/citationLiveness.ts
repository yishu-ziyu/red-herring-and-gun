/**
 * Citation liveness — 「来源能点开」承诺的落点。
 *
 * 检索索引天然滞后：搜索时活着、发布时已 404/410 的引用链接直接掏空结论可信度。
 * 在 finalReport 发布前对全局引用做一次真实探活，死链剔除并把 [n] 标记重绑到幸存来源。
 * 何时查、超时、并发、死活判定全部由代码负责，不进模型。
 */

import {
  bindEvidenceChainLayer,
  bindGlobalConclusion,
  clampMarkersToSources,
  filterSourcesWithRemap,
  remapCitationMarkers,
  type CiteSource,
} from "./citationBinding.js";

export type LivenessStatus = "alive" | "dead";

/** 404/408/410 与 5xx 视为死链；401/403/405/429 等说明页面存在但有门槛，不判死。 */
const DEAD_HTTP_STATUSES = new Set([404, 408, 410]);
const DEFAULT_TIMEOUT_MS = 6000;
const DEFAULT_MAX_URLS = 16;
const DEFAULT_CONCURRENCY = 5;
const REQUEST_USER_AGENT =
  "Mozilla/5.0 (compatible; RedHerringGun/1.0; citation-liveness-check)";

type MinimalResponse = { status: number; body?: { cancel?: () => Promise<void> } | null };
type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<MinimalResponse>;

export type LivenessDeps = {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  maxUrls?: number;
  concurrency?: number;
  /** 直接给定探活结果（测试用）；跳过真实网络请求。 */
  liveness?: Map<string, LivenessStatus>;
};

export function classifyLivenessStatus(status: number): LivenessStatus {
  if (status < 400) return "alive";
  if (DEAD_HTTP_STATUSES.has(status) || status >= 500) return "dead";
  return "alive";
}

/** GET 到响应头即断开：不拉正文，也能覆盖禁用 HEAD 的站点。 */
export async function checkUrlLiveness(
  url: string,
  fetchImpl: FetchLike,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<LivenessStatus> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": REQUEST_USER_AGENT },
    });
    void Promise.resolve(res.body?.cancel?.()).catch(() => {});
    return classifyLivenessStatus(res.status);
  } catch {
    return "dead";
  } finally {
    clearTimeout(timer);
  }
}

export async function checkSourceLiveness(
  urls: string[],
  deps: LivenessDeps = {}
): Promise<Map<string, LivenessStatus>> {
  const fetchImpl = deps.fetchImpl ?? (globalThis.fetch as FetchLike);
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxUrls = deps.maxUrls ?? DEFAULT_MAX_URLS;
  const concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
  const unique = [...new Set(urls.filter((u) => /^https?:\/\//i.test(u)))].slice(0, maxUrls);

  const results = new Map<string, LivenessStatus>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, unique.length) }, async () => {
    while (cursor < unique.length) {
      const url = unique[cursor++];
      results.set(url, await checkUrlLiveness(url, fetchImpl, timeoutMs));
    }
  });
  await Promise.all(workers);
  return results;
}

export type PruneResult = {
  pruned: boolean;
  deadUrls: string[];
};

/**
 * 剔除 report 里的死链引用并重绑所有 [n] 标记：
 * subclaimVerdicts 的 evidence/supportingSources、claimItems 内嵌 verdict、
 * 全局 conclusion/citationSources、evidenceChain 的 sourceRefs 全部同步。
 */
export async function pruneDeadCitations(
  report: Record<string, unknown>,
  deps: LivenessDeps = {}
): Promise<PruneResult> {
  if (!report || typeof report !== "object") return { pruned: false, deadUrls: [] };
  const citationSources = Array.isArray(report.citationSources) ? report.citationSources : [];
  const verdictsIn = Array.isArray(report.subclaimVerdicts) ? report.subclaimVerdicts : [];
  // 收集范围要同时覆盖全局引用与 verdict 层来源：全局列表不含检索填充源，
  // 只按全局收集会把 aliveSet 缺口变成对填充源的误杀。
  const urls: string[] = [];
  for (const s of citationSources) {
    if (s && typeof s === "object") urls.push(String((s as Record<string, unknown>).url ?? ""));
  }
  for (const v of verdictsIn) {
    if (!v || typeof v !== "object") continue;
    const list = (v as Record<string, unknown>).supportingSources;
    if (!Array.isArray(list)) continue;
    for (const s of list) {
      if (s && typeof s === "object") urls.push(String((s as Record<string, unknown>).url ?? ""));
    }
  }
  const candidates = urls.filter(Boolean);
  if (candidates.length === 0) return { pruned: false, deadUrls: [] };

  const liveness = deps.liveness ?? (await checkSourceLiveness(candidates, deps));
  const deadUrls = [...new Set(candidates.filter((u) => liveness.get(u) === "dead"))];
  if (deadUrls.length === 0) return { pruned: false, deadUrls: [] };
  const aliveSet = new Set(candidates.filter((u) => liveness.get(u) !== "dead"));

  const prunedVerdicts = verdictsIn.map((raw) => {
    if (!raw || typeof raw !== "object") return raw;
    const v = raw as Record<string, unknown>;
    const { sources, remap } = filterSourcesWithRemap(v.supportingSources, aliveSet);
    if (v.sourcesRelatedOnly === true) {
      // 填充源的 evidence 已被 strip 标记，只需同步剔除死链来源。
      return { ...v, supportingSources: sources };
    }
    const evidence = typeof v.evidence === "string" ? v.evidence : "";
    return {
      ...v,
      evidence: clampMarkersToSources(remapCitationMarkers(evidence, remap), sources.length),
      supportingSources: sources,
    };
  });
  report.subclaimVerdicts = prunedVerdicts;

  // claimItems 内嵌 verdict 与 subclaimVerdicts 保持一致（与 normalizeReportCitations 同构）。
  if (Array.isArray(report.claimItems)) {
    const byAtom = new Map<string, Record<string, unknown>>();
    for (const v of prunedVerdicts) {
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

  const globalBound = bindGlobalConclusion(
    report.conclusion,
    prunedVerdicts as Array<{ supportingSources?: CiteSource[] }>
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
      const refsIn = Array.isArray(rec.sourceRefs)
        ? rec.sourceRefs.filter(
            (s): s is string => typeof s === "string" && aliveSet.has(s.trim())
          )
        : [];
      const bound = bindEvidenceChainLayer(rec.evidence, refsIn, titleByUrl);
      return {
        ...rec,
        evidence: bound.text,
        sourceRefs: bound.sourceRefs.length > 0 ? bound.sourceRefs : rec.sourceRefs,
        _citeSources: bound.sources,
      };
    });
  }

  return { pruned: true, deadUrls };
}
