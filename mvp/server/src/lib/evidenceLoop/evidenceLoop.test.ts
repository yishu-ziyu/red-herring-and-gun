import { describe, expect, it, vi } from "vitest";
import {
  buildRewriteUserContent,
  fallbackRewriteQueries,
  findLoopTargets,
  makeRewriteQueryCall,
  mergeSourcesIntoBundle,
  parseRewriteQueries,
  runEvidenceLoop,
  type EvidenceLoopStopReason,
} from "./evidenceLoop";
import type { AtomSearchBundle, AtomSearchSource } from "../atomSearch";
import { claimAtomKey } from "../claimAtom/index.js";

function mkBundle(atoms: string[], byAtomKey: Record<string, AtomSearchSource[]>): AtomSearchBundle {
  return {
    atomsSearched: atoms,
    byAtomKey,
    aggregate: {
      answer: "",
      sources: Object.values(byAtomKey).flat().map((s) => ({ url: s.url, title: s.title })),
      relatedQuestions: [],
      model: "m",
      traceText: "",
      _source: "test",
      supportingEvidence: [],
      contradictingEvidence: [],
      unresolvedEvidenceGaps: [],
    },
    forAgent: atoms.map((a) => ({ claimAtom: a, sources: byAtomKey[claimAtomKey(a)] ?? [] })),
  };
}

describe("findLoopTargets", () => {
  const atom = "某地明天发生 7 级地震";
  const key = claimAtomKey(atom);

  it("无判词 → unverified 触发", () => {
    const targets = findLoopTargets({ atomsSearched: [atom], verdicts: [], claimAtomKeyFn: claimAtomKey });
    expect(targets).toEqual([{ atom, atomKey: key, trigger: "unverified" }]);
  });

  it("判词状态为 unverified 类 → unverified 触发；正向判词不带来源也不触发", () => {
    const triggers = findLoopTargets({
      atomsSearched: [atom],
      verdicts: [{ claimAtom: atom, verdict: "unverified" }],
      claimAtomKeyFn: claimAtomKey,
    });
    expect(triggers[0]?.trigger).toBe("unverified");

    // fact 阶段的判词是模型原始输出，URL 绑定在报告组装时才发生；
    // 「来源为空」不是未证实信号，不得触发
    const noTrigger = findLoopTargets({
      atomsSearched: [atom],
      verdicts: [
        { claimAtom: atom, verdict: "true", supportingSources: [], contradictingSources: [] },
      ],
      claimAtomKeyFn: claimAtomKey,
    });
    expect(noTrigger).toEqual([]);
  });

  it("支撑反证同时非空 → conflict 触发", () => {
    const targets = findLoopTargets({
      atomsSearched: [atom],
      verdicts: [
        {
          claimAtom: atom,
          verdict: "partial",
          supportingSources: [{ url: "https://a/1" }],
          contradictingSources: [{ url: "https://b/1" }],
        },
      ],
      claimAtomKeyFn: claimAtomKey,
    });
    expect(targets[0]?.trigger).toBe("conflict");
  });

  it("已有结论且有单侧来源 → 不触发", () => {
    const targets = findLoopTargets({
      atomsSearched: [atom],
      verdicts: [
        { claimAtom: atom, verdict: "true", supportingSources: [{ url: "https://a/1" }] },
      ],
      claimAtomKeyFn: claimAtomKey,
    });
    expect(targets).toEqual([]);
  });

  it("上限 maxTargets 截断，保持原句顺序", () => {
    const atoms = ["原子一", "原子二", "原子三", "原子四"];
    const targets = findLoopTargets({
      atomsSearched: atoms,
      verdicts: [],
      claimAtomKeyFn: claimAtomKey,
      maxTargets: 3,
    });
    expect(targets.map((t) => t.atom)).toEqual(["原子一", "原子二", "原子三"]);
  });

  it("4 条候选、前 3 unverified、第 4 conflict → 先收 conflict，长度 3", () => {
    const atoms = ["未证一", "未证二", "未证三", "打架四"];
    const targets = findLoopTargets({
      atomsSearched: atoms,
      verdicts: [
        { claimAtom: "未证一", verdict: "unverified" },
        { claimAtom: "未证二", verdict: "unverified" },
        { claimAtom: "未证三", verdict: "unverified" },
        {
          claimAtom: "打架四",
          verdict: "partial",
          supportingSources: [{ url: "https://a/1" }],
          contradictingSources: [{ url: "https://b/1" }],
        },
      ],
      claimAtomKeyFn: claimAtomKey,
      maxTargets: 3,
    });
    expect(targets).toHaveLength(3);
    expect(targets[0]).toMatchObject({ atom: "打架四", trigger: "conflict" });
    expect(targets.slice(1).map((row) => row.atom)).toEqual(["未证一", "未证二"]);
  });
});

describe("mergeSourcesIntoBundle", () => {
  it("按 URL 去重，只有新 URL 计入新增", () => {
    const atom = "原子A";
    const key = claimAtomKey(atom);
    const existing: AtomSearchSource[] = [{ url: "https://x/1", title: "t", snippet: "s" }];
    const bundle = mkBundle([atom], { [key]: existing });
    const added = mergeSourcesIntoBundle(
      bundle,
      key,
      [
        { url: "https://x/1", title: "dup", snippet: "dup" },
        { url: "https://x/2", title: "new", snippet: "n" },
      ],
      claimAtomKey
    );
    expect(added).toBe(1);
    expect(bundle.byAtomKey[key]).toHaveLength(2);
    expect(bundle.aggregate.sources).toHaveLength(2);
    expect(bundle.forAgent.find((f) => f.claimAtom === atom)?.sources).toHaveLength(2);
  });
});

describe("runEvidenceLoop", () => {
  const atom = "某食品含有害添加剂";
  const key = claimAtomKey(atom);

  function loopBundle(): AtomSearchBundle {
    return mkBundle([atom], { [key]: [{ url: "https://init/1", title: "i", snippet: "s" }] });
  }

  it("第一轮拿到新证据 → evidence-found，重跑 fact_checker", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn(async (q: string) => ({
      sources: [{ url: "https://gov/notice", title: q, snippet: "官方通报" }],
    }));
    const onAtomStopped = vi.fn();
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [{ claimAtom: atom, verdict: "unverified" }],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
      hooks: { onAtomStopped },
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.atoms[0]?.stopReason).toBe("evidence-found");
    expect(outcome.totalNewSources).toBe(1);
    expect(outcome.recheckFactChecker).toBe(true);
    expect(bundle.byAtomKey[key].some((s) => s.url === "https://gov/notice")).toBe(true);
    expect(searchOne).toHaveBeenCalledTimes(1);
    expect(searchOne.mock.calls[0][0]).toContain(atom);
    expect(onAtomStopped).toHaveBeenCalledWith({ atom, rounds: 1, reason: "evidence-found" });
  });

  it("两轮策略全零新增 → no-new-evidence，不重跑", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn(async () => ({
      sources: [{ url: "https://init/1", title: "dup", snippet: "dup" }],
    }));
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
    });
    expect(outcome.atoms[0]?.stopReason).toBe("no-new-evidence");
    expect(outcome.recheckFactChecker).toBe(false);
    // 2 轮 × 每轮 2 条模板 query = 4 次补查封顶
    expect(searchOne).toHaveBeenCalledTimes(4);
  });

  it("第一轮零新增，第二轮换策略命中 → evidence-found", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn(async (q: string) =>
      q.includes("原文")
        ? { sources: [{ url: "https://orig/text", title: "原文", snippet: "语境" }] }
        : { sources: [] }
    );
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [{ claimAtom: atom, verdict: "unverified" }],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
    });
    expect(outcome.atoms[0]?.stopReason).toBe("evidence-found");
    expect(outcome.atoms[0]?.rounds).toHaveLength(3); // 轮1两条 + 轮2首条命中
    expect(outcome.totalNewSources).toBe(1);
  });

  it("检索抛错 → search-failed，不阻断", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn(async () => {
      throw new Error("all providers dead");
    });
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
    });
    expect(outcome.atoms[0]?.stopReason).toBe("search-failed");
    expect(outcome.recheckFactChecker).toBe(false);
  });

  it("LLM 改写失败回退模板，不阻断循环", async () => {
    const bundle = loopBundle();
    const callRewriteModel = vi.fn(async () => {
      throw new Error("quota");
    });
    const searchOne = vi.fn(async () => ({ sources: [] }));
    await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
      callRewriteModel,
    });
    expect(callRewriteModel).toHaveBeenCalled();
    expect(searchOne).toHaveBeenCalled();
    expect(searchOne.mock.calls[0][0]).toContain("官方通报");
  });

  it("无触发原子 → ran=false 零检索", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn();
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [
        { claimAtom: atom, verdict: "true", supportingSources: [{ url: "https://init/1" }] },
      ],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
    });
    expect(outcome).toEqual({ ran: false, atoms: [], totalNewSources: 0, recheckFactChecker: false });
    expect(searchOne).not.toHaveBeenCalled();
  });

  it("同站转载不计入有效增益，继续下一问而不是立刻停", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn(async (q: string) =>
      q.includes("辟谣")
        ? { sources: [{ url: "https://www.gov.cn/notice", title: "官方通报", snippet: "不实" }] }
        : { sources: [{ url: "https://init/2", title: "i", snippet: "s" }] }
    );
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [{ claimAtom: atom, verdict: "unverified" }],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
    });
    expect(searchOne.mock.calls.length).toBeGreaterThan(1);
    expect(outcome.atoms[0]?.stopReason).toBe("evidence-found");
    expect(outcome.recheckFactChecker).toBe(true);
    expect(outcome.pursuitHops?.some((h) => h.resultKind === "repost")).toBe(true);
    expect(outcome.pursuitHops?.some((h) => h.action === "stop" && h.resultKind === "primary")).toBe(true);
    expect(outcome.pursuitHops?.at(-1)?.atom).toBe(atom);
    expect(outcome.pursuitHops?.at(-1)?.stopReason).toBe("evidence-found");
  });

  it("hooks 透出 round 事件（SSE 消费）", async () => {
    const bundle = loopBundle();
    const onRoundStart = vi.fn();
    const onRoundResult = vi.fn();
    await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [],
      searchOne: async () => ({
        sources: [{ url: "https://n/1", title: "n", snippet: "n" }],
      }),
      claimAtomKeyFn: claimAtomKey,
      hooks: { onRoundStart, onRoundResult },
    });
    expect(onRoundStart).toHaveBeenCalledWith(
      expect.objectContaining({ atom, round: 1, trigger: "unverified" })
    );
    expect(onRoundResult).toHaveBeenCalledWith(
      expect.objectContaining({ newSourceCount: 1, sourceCount: 1 })
    );
  });

  it("翻案续期 pass2：startRound=3 走当事方策略，seed 查询不重复", async () => {
    const bundle = loopBundle();
    const searchOne = vi.fn(async (q: string) =>
      q.includes("当事方")
        ? { sources: [{ url: "https://party/1", title: "当事方回应", snippet: "回应" }] }
        : { sources: [] }
    );
    const outcome = await runEvidenceLoop({
      claim: "原句",
      bundle,
      factVerdicts: [{ claimAtom: atom, verdict: "unverified" }],
      searchOne,
      claimAtomKeyFn: claimAtomKey,
      startRound: 3,
      seedQueriesByAtomKey: { [key]: [`${atom} 官方通报`, `${atom} 辟谣`] },
    });
    expect(outcome.atoms[0]?.stopReason).toBe("evidence-found");
    // 轮号从 3 起，SSE 上能看到续期轮次
    expect(outcome.atoms[0]?.rounds[0]?.round).toBe(3);
    // seed 过的官方词不再搜，首轮即当事方策略命中
    const queries = searchOne.mock.calls.map((c) => c[0] as string);
    expect(queries.some((q) => q.includes("官方通报"))).toBe(false);
    expect(queries[0]).toContain("当事方");
  });
});

describe("fallbackRewriteQueries", () => {
  it("round1 官方来源词，round2 原文语境，round3+ 当事方与原始数据（续期策略）", () => {
    expect(fallbackRewriteQueries("某地地震", 1)[0]).toContain("官方通报");
    expect(fallbackRewriteQueries("某地地震", 2)[0]).toContain("原文");
    expect(fallbackRewriteQueries("某地地震", 3)[0]).toContain("当事方");
    expect(fallbackRewriteQueries("某地地震", 4)[0]).toContain("当事方");
  });
});

describe("buildRewriteUserContent", () => {
  it("带原句、原子、策略和已试查询", () => {
    const content = buildRewriteUserContent({
      claim: "原句",
      atom: "原子",
      round: 2,
      priorQueries: ["原子 官方通报"],
      strategy: "原文语境",
    });
    expect(content).toContain("原句：原句");
    expect(content).toContain("待补查判断：原子");
    expect(content).toContain("第 2 轮");
    expect(content).toContain("- 原子 官方通报");
  });

  it("首轮无已试查询时占位", () => {
    const content = buildRewriteUserContent({
      claim: "c",
      atom: "a",
      round: 1,
      priorQueries: [],
      strategy: "官方来源词",
    });
    expect(content).toContain("（首轮）");
  });
});

describe("parseRewriteQueries", () => {
  it("剥引号、压空白、丢超长、去重、截 2 条", () => {
    const queries = parseRewriteQueries({
      queries: [' "电动自行车 被偷 通报" ', "电动自行车 被偷 通报", "", "x".repeat(61), "第三条"],
    });
    expect(queries).toEqual(["电动自行车 被偷 通报", "第三条"]);
  });

  it("非数组输出返回空", () => {
    expect(parseRewriteQueries(undefined)).toEqual([]);
    expect(parseRewriteQueries({ queries: "not-array" })).toEqual([]);
  });
});

describe("makeRewriteQueryCall", () => {
  it("透传 prompt/schema，返回解析后的 queries", async () => {
    const callRaw = vi.fn(async (input: { systemPrompt: string; userContent: string }) => ({
      output: { queries: ["「某地 地震局 辟谣」"] },
      model: "rewriter-m",
    }));
    const call = makeRewriteQueryCall(callRaw);
    const out = await call({
      claim: "c",
      atom: "a",
      round: 1,
      priorQueries: [],
      strategy: "官方来源词",
    });
    expect(out).toEqual({ queries: ["某地 地震局 辟谣"], model: "rewriter-m" });
    expect(callRaw.mock.calls[0][0].systemPrompt).toContain("改写");
    expect(callRaw.mock.calls[0][0].userContent).toContain("待补查判断：a");
    expect(callRaw.mock.calls[0][0].maxTokens).toBeLessThanOrEqual(300);
  });

  it("裸调用抛错时向上抛（由 evidenceLoop 回退模板）", async () => {
    const call = makeRewriteQueryCall(async () => {
      throw new Error("quota");
    });
    await expect(
      call({ claim: "c", atom: "a", round: 1, priorQueries: [], strategy: "s" })
    ).rejects.toThrow("quota");
  });
});

describe("stop reasons 覆盖", () => {
  it("所有停止原因都属于显式枚举", () => {
    const reasons: EvidenceLoopStopReason[] = [
      "evidence-found",
      "no-new-evidence",
      "rewrite-empty",
      "search-failed",
    ];
    expect(reasons).toHaveLength(4);
  });
});
