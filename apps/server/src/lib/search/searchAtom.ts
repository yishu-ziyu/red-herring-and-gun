import { buildAtomSearchQueries } from "../atomSearchQuery.js";
import type { ExecutionBudget } from "../executionBudget.js";
import { callProvider, configuredProviders, type ProviderResult, type SearchProvider, type SearchProviderId, type SearchSource } from "./providers.js";
import { mergeHits, rankSources, type Candidate, type Hit } from "./rank.js";

export type { SearchSource } from "./providers.js";

const TOP_K = 5;
const MAX_GAPS = 8;
const PROGRESS_SOURCE_LIMIT = 24;

/** 单 Provider 在产品侧的进度态（SSE search_progress 用，不含任何诊断/密钥/请求 ID）。 */
type SearchProviderProgress = {
  id: SearchProviderId;
  label: string;
  status: "pending" | "running" | "completed" | "partial" | "failed";
  resultCount: number;
};

/** 按命题发送的多路检索进度事件。 */
export type SearchProgressEvent = {
  type: "search_progress";
  atom: string;
  phase: "started" | "progress" | "completed";
  queryCount: number;
  providers: SearchProviderProgress[];
  stats?: {
    rawResultCount: number;
    uniqueSourceCount: number;
    sharedSourceCount: number;
    singleProviderSourceCount: number;
  };
  sources?: Array<{ title: string; url: string; providerOrigins: string[] }>;
  timestamp: number;
};

export type AtomSearchOutcome =
  | {
      ok: true;
      /** The final topK for this atom, best first. */
      sources: SearchSource[];
      answer: string;
      /** Provider and query failures that did not stop the search. */
      gaps: string[];
      traceText: string;
    }
  | { ok: false; reason: string };

type ProviderTally = { running: number; ok: number; failed: number; results: number };

function createProgress(
  atom: string,
  queryCount: number,
  providers: SearchProvider[],
  { onProgress, signal }: { onProgress?: (event: SearchProgressEvent) => void; signal?: AbortSignal },
) {
  const tallies = new Map<SearchProviderId, ProviderTally>(providers.map((p) => [p.id, { running: 0, ok: 0, failed: 0, results: 0 }]));
  const statusOf = (t: ProviderTally): SearchProviderProgress["status"] => {
    if (t.running > 0) return "running";
    if (t.ok + t.failed === 0) return "pending";
    if (t.ok === 0) return "failed";
    return t.failed > 0 ? "partial" : "completed";
  };
  const emit = (phase: SearchProgressEvent["phase"], extra?: Pick<SearchProgressEvent, "stats" | "sources">) => {
    if (!onProgress || signal?.aborted) return;
    onProgress({
      type: "search_progress",
      atom,
      phase,
      queryCount,
      providers: providers.map((p) => ({ id: p.id, label: p.label, status: statusOf(tallies.get(p.id)!), resultCount: tallies.get(p.id)!.results })),
      timestamp: Date.now(),
      ...extra,
    });
  };
  return {
    started: () => emit("started"),
    begin(id: SearchProviderId) {
      tallies.get(id)!.running += 1;
      emit("progress");
    },
    end(id: SearchProviderId, resultCount: number | null) {
      const t = tallies.get(id)!;
      t.running = Math.max(0, t.running - 1);
      if (resultCount === null) t.failed += 1;
      else {
        t.ok += 1;
        t.results += resultCount;
      }
      emit("progress");
    },
    completed(candidates: Candidate[]) {
      const rawResultCount = [...tallies.values()].reduce((n, t) => n + t.results, 0);
      emit("completed", {
        stats: {
          rawResultCount,
          uniqueSourceCount: candidates.length,
          sharedSourceCount: candidates.filter((c) => c.providerOrigins.length >= 2).length,
          singleProviderSourceCount: candidates.filter((c) => c.providerOrigins.length === 1).length,
        },
        sources: candidates.slice(0, PROGRESS_SOURCE_LIMIT).map((c) => ({ title: c.title.slice(0, 200), url: c.url, providerOrigins: [...c.providerOrigins] })),
      });
    },
  };
}

/**
 * Per-atom search: builds the atom's queries, asks every configured provider for each query, and
 * returns the topK pages after one dedupe by canonical URL, one off-topic filter and one ranking.
 */
export async function searchAtom(
  atom: string,
  options: ExecutionBudget & { env: Record<string, string>; onProgress?: (event: SearchProgressEvent) => void },
): Promise<AtomSearchOutcome> {
  const { env, signal } = options;
  signal?.throwIfAborted();
  const queries = buildAtomSearchQueries(atom);
  const providers = configuredProviders(env);
  const progress = createProgress(atom, queries.length, providers, options);
  const nobodyAnswered = providers.length === 0 ? "没有配置可用的搜索服务" : "所有搜索 Provider 均未返回真实结果";

  progress.started();
  const perQuery = await Promise.all(
    queries.map(async (query) => {
      const settled = await Promise.all(
        providers.map(async (provider): Promise<{ provider: SearchProvider; result?: ProviderResult; failure?: string }> => {
          progress.begin(provider.id);
          try {
            const result = await callProvider(provider, query, { env, signal, deadlineMs: options.deadlineMs });
            signal?.throwIfAborted();
            progress.end(provider.id, result.sources.length);
            return { provider, result };
          } catch (error) {
            signal?.throwIfAborted();
            progress.end(provider.id, null);
            const message = error instanceof Error ? error.message : `${provider.id} 未返回真实结果`;
            return { provider, failure: `${provider.label} 真实调用失败：${message}` };
          }
        }),
      );
      return {
        query,
        answered: settled.flatMap((s) => (s.result ? [{ provider: s.provider, ...s.result }] : [])),
        failures: settled.flatMap((s) => (s.failure ? [s.failure] : [])),
      };
    }),
  );
  signal?.throwIfAborted();

  const answeredQueries = perQuery.filter((q) => q.answered.length > 0);
  if (answeredQueries.length === 0) {
    progress.completed([]);
    const reasons = perQuery.map((q) => `${q.query}：${q.failures.join("；") || nobodyAnswered}`);
    return { ok: false, reason: reasons.join("；") || "检索未返回真实结果" };
  }

  const answered = answeredQueries.flatMap((q) => q.answered);
  const candidates = mergeHits(answeredQueries.map((q) => q.answered.map((a): Hit => ({ provider: a.provider.id, sources: a.sources }))));
  progress.completed(candidates);
  const sources = rankSources(atom, candidates, TOP_K);

  const failedQueries = perQuery.filter((q) => q.answered.length === 0).map((q) => `${q.query}：${q.failures.join("；") || nobodyAnswered}`);
  const gaps = [...new Set([...answeredQueries.flatMap((q) => q.failures), ...failedQueries])].slice(0, MAX_GAPS);
  // 答案原文交给核查模型；不标是哪家搜索服务给的，模型看到服务名就会把它写进思考和审核结论。
  const answer = answered
    .map((a) => a.answer || a.sources.map((s) => `【${s.title}】${s.snippet}`).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  return {
    ok: true,
    sources,
    answer: answer.slice(0, 2400),
    gaps,
    traceText: `按原子检索「${atom.slice(0, 40)}」共 ${queries.length} 路查询，聚合 ${candidates.length} 条去重来源，保留 ${sources.length} 条。`,
  };
}
