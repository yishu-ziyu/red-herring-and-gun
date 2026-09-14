/**
 * runCasePipeline × 证据库（Part 1 · 收尾沉淀 + 降级补查 + 快照字段 + 观测）。
 *
 * 契约 docs/evals/2026-09-12-evidence-base.md：
 * - 命中且新鲜 → 注入证据、跳过联网、不占 6 个名额；
 * - 注入后 fact_checker 判 unverified/证据不足 → 走既有 evidenceLoop 自动降级联网补查；
 * - 调查 finalize 后沉淀（可核查且判词非 unverified 的 atom）；
 * - 快照证据条目带 provenance/originDate；观测写 knowledge-observations.jsonl。
 *
 * 用真库真文件（临时 DATA_DIR）+ 打桩模型/检索：记忆层的行为必须端到端成立。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCasePipeline, type PipelineStep } from "./runCasePipeline";
import { closeDatabase } from "../sqliteStore.js";
import {
  createKnowledgeMemory,
  knowledgeObservationPath,
  listKnowledgeEntries,
  __resetKnowledgeStoreForTests,
  type KnowledgeObservation,
} from "../knowledgeStore.js";

const DAY = 86_400_000;
/** 固定「现在」：run 1 沉淀 / run 2 在 2 天后命中（都远小于 30 天窗口）。 */
const NOW_RUN1 = Date.parse("2026-09-11T09:00:00.000Z");
const NOW_RUN2 = NOW_RUN1 + 2 * DAY;

const CLAIM_1 = "隔夜菜亚硝酸盐超标，吃了会中毒。";
const ATOM_A1 = "隔夜菜的亚硝酸盐含量会超标";
const ATOM_A2 = "吃了隔夜菜会导致中毒";

const CLAIM_2 = "隔夜菜放一晚亚硝酸盐会升高，吃剩菜会不会中毒？";
const ATOM_B1 = "隔夜菜放一晚亚硝酸盐会升高";
const ATOM_B2 = "吃剩菜会不会食物中毒";

let dir = "";
const previousDbFile = process.env.RHG_DB_FILE;
const previousDataDir = process.env.DATA_DIR;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rhg-knowledge-pipeline-"));
  process.env.DATA_DIR = dir;
  process.env.RHG_DB_FILE = join(dir, "rhg.sqlite");
  closeDatabase();
  __resetKnowledgeStoreForTests();
});

afterEach(() => {
  closeDatabase();
  __resetKnowledgeStoreForTests();
  rmSync(dir, { recursive: true, force: true });
  if (previousDbFile === undefined) delete process.env.RHG_DB_FILE;
  else process.env.RHG_DB_FILE = previousDbFile;
  if (previousDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = previousDataDir;
});

type VerdictSpec = {
  verdict: string;
  /** true = 引用本轮检索到的 URL（会被 bind 保留）；false = 不给来源 */
  cite?: boolean;
};

function searchUrlFor(atom: string): string {
  return `https://search.example/${encodeURIComponent(atom)}`;
}

/**
 * 一次调查的打桩编排：拆题固定、自证全留、fact_checker 按 spec 出判词、
 * report_composer 回抄判词。检索每条命题给一条真 URL（补查另给新 URL）。
 */
function makeHarness(options: {
  claim: string;
  atoms: string[];
  verdicts: Record<string, VerdictSpec>;
  searchOne: ReturnType<typeof vi.fn>;
}) {
  const runAgent = vi.fn(async (agentId: string): Promise<PipelineStep> => {
    if (agentId === "rumor_detector") {
      return {
        agent: "rumor_detector",
        output: {
          claimAtoms: options.atoms,
          claimAtomTypes: options.atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
        },
      };
    }
    if (agentId === "fact_checker") {
      return {
        agent: "fact_checker",
        output: {
          factCheckResult: "mixed_misleading",
          subclaimVerdicts: options.atoms.map((atom) => {
            const spec = options.verdicts[atom] ?? { verdict: "unverified" };
            return {
              claimAtom: atom,
              verdict: spec.verdict,
              evidence: spec.cite ? "按材料判定[1]" : "没有可绑定的材料",
              boundary: "以现有公开材料为准",
              supportingSources: spec.cite
                ? [{ url: searchUrlFor(atom), title: `${atom} 的回应`, snippet: "当事方回应" }]
                : [],
              contradictingSources: [],
            };
          }),
        },
      };
    }
    if (agentId === "source_validator") {
      return { agent: "source_validator", output: { sourceReliability: "medium" } };
    }
    if (agentId === "report_composer") {
      return {
        agent: "report_composer",
        output: {
          verdictType: "unverified",
          conclusion: "按目前材料，这条说法还判断不了。",
          subclaimVerdicts: options.atoms.map((atom) => {
            const spec = options.verdicts[atom] ?? { verdict: "unverified" };
            return {
              claimAtom: atom,
              verdict: spec.verdict,
              evidence: spec.cite ? "按材料判定[1]" : "没有可绑定的材料",
              boundary: "以现有公开材料为准",
              supportingSources: spec.cite
                ? [{ url: searchUrlFor(atom), title: `${atom} 的回应`, snippet: "当事方回应" }]
                : [],
              contradictingSources: [],
            };
          }),
        },
      };
    }
    throw new Error(`unexpected agent ${agentId}`);
  });

  const callSelfProofModel = async () => ({
    output: {
      results: options.atoms.map((atom) => ({ atom, supported: true, reason: "命题在句内" })),
    },
    model: "selfproof-m",
  });

  return { runAgent, callSelfProofModel };
}

function fakeSearchOne() {
  return vi.fn(async (query: string) => ({
    answer: query,
    model: "m",
    sources: [{ url: `https://search.example/${encodeURIComponent(query)}`, title: query, snippet: "检索摘要" }],
  }));
}

describe("证据库端到端：沉淀 → 命中注入 → 判词撑不住自动降级补查", () => {
  it("run1 沉淀；run2 近似改写命中、不检索、判 unverified 后证据循环补查；快照带两个字段", async () => {
    // ── run 1：命题一 false（有已绑定来源）→ 沉淀；命题二 unverified → 不沉淀
    const searchOne1 = fakeSearchOne();
    const harness1 = makeHarness({
      claim: CLAIM_1,
      atoms: [ATOM_A1, ATOM_A2],
      verdicts: { [ATOM_A1]: { verdict: "false", cite: true }, [ATOM_A2]: { verdict: "unverified" } },
      searchOne: searchOne1,
    });
    const knowledge1 = createKnowledgeMemory({ runId: "run-1", claim: CLAIM_1, now: () => NOW_RUN1 });
    await runCasePipeline({
      claim: CLAIM_1,
      runAgent: harness1.runAgent,
      callSelfProofModel: harness1.callSelfProofModel,
      searchOne: searchOne1,
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        harness1.runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: false,
      evidenceLoop: { maxRounds: 1, maxPasses: 1 },
      knowledgeBase: knowledge1,
      runId: "run-1",
    });

    const seeded = listKnowledgeEntries();
    expect(seeded.map((entry) => entry.atomText)).toEqual([ATOM_A1]);
    expect(seeded[0]!.verdict).toBe("false");
    expect(seeded[0]!.evidence.map((item) => item.url)).toEqual([searchUrlFor(ATOM_A1)]);
    expect(seeded[0]!.sourceRunId).toBe("run-1");

    // ── run 2：命题一换个说法 → 命中知识库；命题二没沉淀过 → 照常联网
    const searchOne2 = fakeSearchOne();
    const harness2 = makeHarness({
      claim: CLAIM_2,
      atoms: [ATOM_B1, ATOM_B2],
      // 注入来的证据撑不住这条命题 → 判 unverified → 触发降级补查
      verdicts: { [ATOM_B1]: { verdict: "unverified" }, [ATOM_B2]: { verdict: "unverified" } },
      searchOne: searchOne2,
    });
    const knowledge2 = createKnowledgeMemory({ runId: "run-2", claim: CLAIM_2, now: () => NOW_RUN2 });
    const knowledgeHits: Array<{ atom: string; originDate: string }> = [];
    const snapshots: unknown[] = [];
    await runCasePipeline({
      claim: CLAIM_2,
      runAgent: harness2.runAgent,
      callSelfProofModel: harness2.callSelfProofModel,
      searchOne: searchOne2,
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        harness2.runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: false,
      evidenceLoop: { maxRounds: 1, maxPasses: 1 },
      knowledgeBase: knowledge2,
      runId: "run-2",
      hooks: {
        onKnowledgeHit: (hit) => knowledgeHits.push({ atom: hit.atom, originDate: hit.originDate }),
        onInvestigationSnapshot: (snapshot) => snapshots.push(snapshot),
      },
    });

    // 1) 命中：不联网、给活动流回执（已核日期 = run1 的沉淀时刻）
    const searchedQueries = searchOne2.mock.calls.map((call) => call[0]);
    expect(searchedQueries).not.toContain(ATOM_B1);
    expect(knowledgeHits).toEqual([{ atom: ATOM_B1, originDate: "2026-09-11" }]);

    // 2) 降级补查：判 unverified → evidenceLoop 对该命题发一次联网补查
    const pursuitQueries = searchedQueries.filter((query) => query.includes(ATOM_B1) && query !== ATOM_B1);
    expect(pursuitQueries.length).toBeGreaterThanOrEqual(1);

    // 3) 快照证据条目带 provenance/originDate（证据区「知识库」标记的来源）
    const sources = snapshots.flatMap(
      (snapshot) => (snapshot as { sources?: Array<Record<string, unknown>> }).sources ?? []
    );
    const knowledgeSource = sources.find((source) => source.provenance === "knowledge");
    expect(knowledgeSource?.originDate).toBe("2026-09-11");
    expect(knowledgeSource?.url).toBe(searchUrlFor(ATOM_A1));
    const links = snapshots.flatMap((snapshot) =>
      ((snapshot as { claims?: Array<{ evidence?: Array<Record<string, unknown>> }> }).claims ?? []).flatMap(
        (claim) => claim.evidence ?? []
      )
    );
    expect(links.some((link) => link.provenance === "knowledge" && link.originDate === "2026-09-11")).toBe(true);

    // 4) 观测：hit → injected → downgraded 三次都落盘（不写原句）
    const outcomes = readFileSync(knowledgeObservationPath(dir), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as KnowledgeObservation);
    const forHit = outcomes.filter((rec) => rec.atomNorm === ATOM_B1);
    expect(forHit.map((rec) => rec.outcome)).toEqual(["hit", "injected", "reused_verdict", "downgraded", "deduped"]);
    expect(forHit.every((rec) => rec.runId === "run-2")).toBe(true);
    expect(readFileSync(knowledgeObservationPath(dir), "utf8")).not.toContain(CLAIM_2);

    // 5) 不命中的命题照常联网 + 记 miss
    expect(searchedQueries).toContain(ATOM_B2);
    expect(outcomes.some((rec) => rec.atomNorm === ATOM_B2 && rec.outcome === "miss")).toBe(true);
  });

  it("超龄条目不注入：照常联网，观测记 stale", async () => {
    const searchOne1 = fakeSearchOne();
    const harness1 = makeHarness({
      claim: CLAIM_1,
      atoms: [ATOM_A1],
      verdicts: { [ATOM_A1]: { verdict: "false", cite: true } },
      searchOne: searchOne1,
    });
    const knowledge1 = createKnowledgeMemory({ runId: "run-1", claim: CLAIM_1, now: () => NOW_RUN1 });
    await runCasePipeline({
      claim: CLAIM_1,
      runAgent: harness1.runAgent,
      callSelfProofModel: harness1.callSelfProofModel,
      searchOne: searchOne1,
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        harness1.runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      knowledgeBase: knowledge1,
      runId: "run-1",
    });
    expect(listKnowledgeEntries()).toHaveLength(1);

    // 40 天后再查同一条命题：超龄 → 不注入、照常联网
    const searchOne2 = fakeSearchOne();
    const harness2 = makeHarness({
      claim: CLAIM_2,
      atoms: [ATOM_A1],
      verdicts: { [ATOM_A1]: { verdict: "false", cite: true } },
      searchOne: searchOne2,
    });
    const staleRunId = "run-stale";
    const knowledge2 = createKnowledgeMemory({
      runId: staleRunId,
      claim: CLAIM_2,
      now: () => NOW_RUN1 + 40 * DAY,
    });
    const hits: unknown[] = [];
    await runCasePipeline({
      claim: CLAIM_2,
      runAgent: harness2.runAgent,
      callSelfProofModel: harness2.callSelfProofModel,
      searchOne: searchOne2,
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        harness2.runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      knowledgeBase: knowledge2,
      runId: staleRunId,
      hooks: { onKnowledgeHit: (hit) => hits.push(hit) },
    });
    expect(hits).toEqual([]);
    expect(searchOne2.mock.calls.map((call) => call[0])).toContain(ATOM_A1);
    const outcomes = readFileSync(knowledgeObservationPath(dir), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line).outcome as string);
    expect(outcomes).toContain("stale");
    expect(outcomes).not.toContain("injected");
  });

  it("run2 命中注入且判词站得住 → 不沉淀新行", async () => {
    const searchOne1 = fakeSearchOne();
    const harness1 = makeHarness({
      claim: CLAIM_1,
      atoms: [ATOM_A1],
      verdicts: { [ATOM_A1]: { verdict: "false", cite: true } },
      searchOne: searchOne1,
    });
    await runCasePipeline({
      claim: CLAIM_1,
      runAgent: harness1.runAgent,
      callSelfProofModel: harness1.callSelfProofModel,
      searchOne: searchOne1,
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        harness1.runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      knowledgeBase: createKnowledgeMemory({ runId: "run-1", claim: CLAIM_1, now: () => NOW_RUN1 }),
      runId: "run-1",
    });
    expect(listKnowledgeEntries()).toHaveLength(1);

    const searchOne2 = fakeSearchOne();
    const harness2 = makeHarness({
      claim: CLAIM_2,
      atoms: [ATOM_B1],
      verdicts: { [ATOM_B1]: { verdict: "false", cite: true } },
      searchOne: searchOne2,
    });
    await runCasePipeline({
      claim: CLAIM_2,
      runAgent: harness2.runAgent,
      callSelfProofModel: harness2.callSelfProofModel,
      searchOne: searchOne2,
      runReport: async ({ steps, search360Result, atomSearchBundle }) =>
        harness2.runAgent("report_composer", steps, search360Result, atomSearchBundle),
      citationLiveness: false,
      evidenceLoop: { enabled: false },
      knowledgeBase: createKnowledgeMemory({ runId: "run-2", claim: CLAIM_2, now: () => NOW_RUN2 }),
      runId: "run-2",
    });
    expect(listKnowledgeEntries()).toHaveLength(1);
    expect(listKnowledgeEntries()[0]!.atomText).toBe(ATOM_A1);
    const outcomes = readFileSync(knowledgeObservationPath(dir), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as KnowledgeObservation)
      .filter((rec) => rec.runId === "run-2")
      .map((rec) => rec.outcome);
    expect(outcomes).toContain("reused_verdict");
    expect(outcomes).toContain("deduped");
  });
});
