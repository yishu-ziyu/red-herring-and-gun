/**
 * 每一截的搜索计划（#144 P1）：拆题模型在同一次回答里为每一截写最多 2 条搜索词，每条写明要找哪类材料。
 * goal 只决定去哪搜，不决定搜到的来源算支持还是反驳；方向仍由来源核验判。
 * 模型写坏或没写时返回空，搜索退回旧模板。
 */

export type EvidenceGoal = "exact_claim" | "primary_source" | "independent_evidence" | "counter_evidence" | "template";

export type PlannedQuery = { query: string; goal: EvidenceGoal };

const MODEL_GOALS = new Set<EvidenceGoal>(["primary_source", "independent_evidence", "counter_evidence"]);
const MAX_MODEL_QUERIES = 2;
const MAX_QUERY_CHARS = 60;

type PlanEntry = { atom: string; queries: PlannedQuery[] };

function sanitizeQueries(raw: unknown): PlannedQuery[] {
  if (!Array.isArray(raw)) return [];
  const out: PlannedQuery[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const goal = String(rec.goal ?? "").trim() as EvidenceGoal;
    const query = String(rec.query ?? "").replace(/\s+/g, " ").trim();
    if (!MODEL_GOALS.has(goal) || !query || query.length > MAX_QUERY_CHARS) continue;
    if (out.some((q) => q.query === query)) continue;
    out.push({ query, goal });
    if (out.length >= MAX_MODEL_QUERIES) break;
  }
  return out;
}

function bigrams(s: string): Set<string> {
  const t = s.replace(/[\s，。、；：！？,.;:!?「」“”"'（）()]/g, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i += 1) out.add(t.slice(i, i + 2));
  return out;
}

function overlap(a: string, b: string): number {
  const x = bigrams(a);
  const y = bigrams(b);
  if (x.size === 0 || y.size === 0) return 0;
  let n = 0;
  for (const g of x) if (y.has(g)) n += 1;
  return n / Math.min(x.size, y.size);
}

/**
 * 拆题后处理会改写、合并、换回原话，最终的一截和模型写计划时的那一截不一定一字不差：
 * 先找一字不差的，再找互相包含的，再找字面最接近的（至少一半两字片段相同）。
 */
export function searchPlanLookup(raw: unknown): (atom: string) => PlannedQuery[] | undefined {
  const entries: PlanEntry[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const rec = item as Record<string, unknown>;
      const atom = String(rec.atom ?? "").trim();
      const queries = sanitizeQueries(rec.queries);
      if (atom && queries.length > 0) entries.push({ atom, queries });
    }
  }
  return (atom: string) => {
    if (entries.length === 0) return undefined;
    const t = atom.trim();
    const exact = entries.find((e) => e.atom === t);
    if (exact) return exact.queries;
    const contained = entries.find((e) => e.atom.includes(t) || t.includes(e.atom));
    if (contained) return contained.queries;
    let best: PlanEntry | undefined;
    let bestScore = 0.5;
    for (const e of entries) {
      const score = overlap(e.atom, t);
      if (score >= bestScore) {
        best = e;
        bestScore = score;
      }
    }
    return best?.queries;
  };
}
