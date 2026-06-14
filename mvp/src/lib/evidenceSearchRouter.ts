/**
 * evidenceSearchRouter.ts — 证据搜索路由器
 *
 * 搜索引擎调度：只接纳真实工具返回，未接入的 provider 直接失败。
 */

import type { MultiSearchJob, SearchTask, SearchProviderResult, Search360Source } from "./schemas";
import { requestProviderSearch } from "./search360";

const PROVIDERS = ["360_search", "any_search", "metaso_search", "tavily_search", "exa_search"] as const;

export interface SearchRouterConfig {
  providers?: typeof PROVIDERS[number][];
  timeoutMs?: number;
  enableCounterSearch?: boolean;
}

/**
 * 为每个原子命题生成搜索任务
 */
export function buildSearchJobs(
  propositionTexts: string[],
  config: SearchRouterConfig = {}
): MultiSearchJob[] {
  const providers = config.providers ?? [...PROVIDERS];

  return propositionTexts.map((text, index) => {
    const jobId = `job-prop-${String.fromCharCode(97 + index)}`;
    const propositionId = `prop-${String.fromCharCode(97 + index)}`;

    const searchTasks: SearchTask[] = providers.map((provider) => ({
      provider,
      query: text,
      status: "pending",
    }));

    return {
      jobId,
      propositionId,
      propositionText: text,
      searchTasks,
    };
  });
}

/**
 * 执行单个搜索任务。禁止生成模拟搜索结果。
 */
export async function executeSearchTask(
  task: SearchTask,
  _config?: SearchRouterConfig
): Promise<SearchProviderResult> {
  const startedAt = performance.now();
  const result = await requestProviderSearch(task.provider, {
    query: task.query,
    claim: task.query,
    refProm: "aiso-max",
  });

  return {
    provider: task.provider,
    query: task.query,
    latencyMs: Math.round(performance.now() - startedAt),
    answer: result.answer,
    sources: result.sources.map((source, index) => map360Source(source, index, task.provider)),
  };
}

/**
 * 批量执行搜索任务，支持并发控制
 */
export async function executeSearchJobs(
  jobs: MultiSearchJob[],
  config: SearchRouterConfig = {},
  onTaskUpdate?: (jobId: string, provider: string, result: SearchProviderResult | null, error?: string) => void
): Promise<MultiSearchJob[]> {
  const concurrencyLimit = 3;
  const updatedJobs: MultiSearchJob[] = [];

  for (const job of jobs) {
    const updatedTasks: SearchTask[] = [];

    // 按并发限制分批执行
    for (let i = 0; i < job.searchTasks.length; i += concurrencyLimit) {
      const batch = job.searchTasks.slice(i, i + concurrencyLimit);

      const results = await Promise.allSettled(
        batch.map(async (task) => {
          try {
            const result = await executeSearchTask(task, config);
            onTaskUpdate?.(job.jobId, task.provider, result);
            return { ...task, status: "completed" as const, result };
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "搜索失败";
            onTaskUpdate?.(job.jobId, task.provider, null, errorMsg);
            return { ...task, status: "failed" as const };
          }
        })
      );

      updatedTasks.push(...results.map((r) => (r.status === "fulfilled" ? r.value : {
        ...batch[results.indexOf(r)],
        status: "failed" as const,
      })));
    }

    updatedJobs.push({ ...job, searchTasks: updatedTasks });
  }

  return updatedJobs;
}

// ── 内部辅助 ────────────────────────────────────────────────────

function map360Source(source: Search360Source, index: number, provider: string) {
  return {
    id: source.id ?? `${provider}-src-${index + 1}`,
    title: source.title,
    url: source.url,
    snippet: source.snippet,
    domain: source.domain ?? getDomain(source.url),
    publishedAt: source.publishedAt,
    sourceType: source.sourceType ?? "聚合搜索",
    credibilityScore: source.credibilityScore,
    sourceTier: source.sourceTier,
    freshnessScore: source.freshnessScore,
    evidenceRole: source.evidenceRole,
  };
}

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}
