/**
 * atomSearch × 知识库（Part 1 · 注入层）。
 * 契约 docs/evals/2026-09-12-evidence-base.md Evaluator 2：
 * 命中注入且跳过检索、不占 6 个名额、超龄/判词不可注入不注入、不命中零变化。
 */
import { describe, expect, it, vi } from "vitest";
import { MAX_ATOM_SEARCHES, retrieveForAtoms, type KnowledgeInjection } from "./atomSearch";

/** 8 条可核查命题：用来验证「命中的原子不占 6 个检索名额，名额让给后面的原子」。 */
const ATOMS = ["命题一", "命题二", "命题三", "命题四", "命题五", "命题六", "命题七", "命题八"];

const TYPES = ATOMS.map((text) => ({ text, verifiable: true, type: "fact" }));

function fakeSearchOne() {
  return vi.fn(async (atom: string) => ({
    answer: atom,
    model: "m",
    sources: [{ url: `https://search.example/${encodeURIComponent(atom)}`, title: atom, snippet: "检索摘要" }],
  }));
}

const INJECTION: KnowledgeInjection = {
  originDate: "2026-09-11",
  priorVerdict: "false",
  evidence: [
    { url: "https://kb.example/nitrite", title: "知识库条目：隔夜菜与亚硝酸盐", snippet: "冷藏 24 小时内的亚硝酸盐远低于致癌剂量" },
  ],
};

describe("命中知识库 → 注入证据、跳过联网、不占名额", () => {
  it("命中原子不发起检索、证据带 provenance/originDate、名额让给下一条命题", async () => {
    const searchOne = fakeSearchOne();
    const hits: Array<{ atom: string; originDate: string }> = [];
    const { atomsToSearch, atomSearchBundle, knowledgeHits } = await retrieveForAtoms({
      claimAtoms: ATOMS,
      claimAtomTypes: TYPES,
      searchOne,
      knowledge: {
        lookup: (atom) => (atom === ATOMS[0] ? INJECTION : null),
        onInjected: (hit) => hits.push({ atom: hit.atom, originDate: hit.originDate }),
      },
    });

    // 命中的原子没有联网请求
    const searched = searchOne.mock.calls.map((call) => call[0]);
    expect(searched).not.toContain(ATOMS[0]);
    // 名额没被占：联网检索仍是 6 条，第六个名额让给了第七条命题（没有命中时它是第七条以外）
    expect(searched).toHaveLength(MAX_ATOM_SEARCHES);
    expect(searched).toEqual([...ATOMS.slice(1, 7)]);
    expect(atomsToSearch).toEqual([...ATOMS.slice(1, 7)]);
    // 但命中原子也算「这次有材料」：判词不会被「检索预算未覆盖」压回 unverified
    expect(atomSearchBundle.atomsSearched).toContain(ATOMS[0]);
    expect(atomSearchBundle.atomsSearched).toHaveLength(MAX_ATOM_SEARCHES + 1);
    // 注入证据进 byAtomKey + forAgent + 聚合来源（聚合来源是模型引用 URL 的白名单）
    const key = ATOMS[0];
    const injected = atomSearchBundle.byAtomKey[key] ?? [];
    expect(injected.map((s) => s.url)).toEqual(["https://kb.example/nitrite"]);
    expect(injected[0]).toMatchObject({ provenance: "knowledge", originDate: "2026-09-11" });
    expect(atomSearchBundle.forAgent.find((item) => item.claimAtom === ATOMS[0])?.sources).toEqual(injected);
    expect(
      atomSearchBundle.aggregate.sources.some((s) => (s as { url?: string }).url === "https://kb.example/nitrite")
    ).toBe(true);
    // 命中回执（活动流用）
    expect(knowledgeHits).toEqual([{ atom: ATOMS[0], originDate: "2026-09-11", sourceCount: 1 }]);
    expect(hits).toEqual([{ atom: ATOMS[0], originDate: "2026-09-11" }]);
    expect(atomSearchBundle.knowledgeDrafts).toEqual([
      {
        claimAtom: ATOMS[0],
        originDate: "2026-09-11",
        priorVerdict: "false",
        evidence: [{ url: "https://kb.example/nitrite", title: "知识库条目：隔夜菜与亚硝酸盐", snippet: "冷藏 24 小时内的亚硝酸盐远低于致癌剂量" }],
      },
    ]);
  });

  it("attachKnowledgeDrafts 把初稿写进判定拍输入", async () => {
    const { attachKnowledgeDrafts } = await import("./atomSearch");
    const input: Record<string, unknown> = { claim: "x" };
    attachKnowledgeDrafts(input, {
      knowledgeDrafts: [{ claimAtom: "命题一", originDate: "2026-09-11", priorVerdict: "false", evidence: [] }],
    });
    expect(input.knowledgeDrafts).toEqual([
      { claimAtom: "命题一", originDate: "2026-09-11", priorVerdict: "false", evidence: [] },
    ]);
  });

  it("命中证据没有真实 URL → 不算命中，该原子照常联网", async () => {
    const searchOne = fakeSearchOne();
    const onInjected = vi.fn();
    const { atomSearchBundle, knowledgeHits } = await retrieveForAtoms({
      claimAtoms: ATOMS.slice(0, 2),
      claimAtomTypes: TYPES.slice(0, 2),
      searchOne,
      knowledge: {
        lookup: () => ({ originDate: "2026-09-11", evidence: [{ url: "not-a-url", title: "t", snippet: "s" }] }),
        onInjected,
      },
    });
    expect(searchOne.mock.calls.map((call) => call[0])).toEqual(ATOMS.slice(0, 2));
    expect(knowledgeHits).toEqual([]);
    expect(onInjected).not.toHaveBeenCalled();
    expect((atomSearchBundle.byAtomKey[ATOMS[0]!] ?? [])[0]).not.toHaveProperty("provenance");
  });
});

describe("不命中 / 超龄 / 判词不可注入 → 零变化", () => {
  it("lookup 全 null 时与没有记忆层逐字等价", async () => {
    const withoutMemory = await retrieveForAtoms({
      claimAtoms: ATOMS,
      claimAtomTypes: TYPES,
      searchOne: fakeSearchOne(),
    });
    const withMisses = await retrieveForAtoms({
      claimAtoms: ATOMS,
      claimAtomTypes: TYPES,
      searchOne: fakeSearchOne(),
      knowledge: { lookup: () => null },
    });
    expect(withMisses.atomsToSearch).toEqual(withoutMemory.atomsToSearch);
    expect(withMisses.atomSearchBundle).toEqual(withoutMemory.atomSearchBundle);
    expect(withMisses.knowledgeHits).toEqual([]);
  });

  it("只有命中的原子退出候选；其余原子排序与名额与无记忆层一致", async () => {
    const withoutMemory = await retrieveForAtoms({
      claimAtoms: ATOMS,
      claimAtomTypes: TYPES,
      searchOne: fakeSearchOne(),
    });
    const withHit = await retrieveForAtoms({
      claimAtoms: ATOMS,
      claimAtomTypes: TYPES,
      searchOne: fakeSearchOne(),
      knowledge: { lookup: (atom) => (atom === ATOMS[3] ? INJECTION : null) },
    });
    // 无记忆时第六条是命题六；第四条命中让出名额后，命题七补进来
    expect(withoutMemory.atomsToSearch).toEqual([...ATOMS.slice(0, 6)]);
    expect(withHit.atomsToSearch).toEqual([...ATOMS.slice(0, 3), ...ATOMS.slice(4, 7)]);
    expect(withHit.knowledgeHits.map((hit) => hit.atom)).toEqual([ATOMS[3]]);
  });

  it("查库抛错不阻断检索（记忆层故障不得改变调查行为）", async () => {
    const searchOne = fakeSearchOne();
    const { atomsToSearch, knowledgeHits } = await retrieveForAtoms({
      claimAtoms: ATOMS,
      claimAtomTypes: TYPES,
      searchOne,
      knowledge: {
        lookup: () => {
          throw new Error("knowledge store down");
        },
      },
    });
    expect(atomsToSearch).toEqual([...ATOMS.slice(0, MAX_ATOM_SEARCHES)]);
    expect(searchOne).toHaveBeenCalledTimes(MAX_ATOM_SEARCHES);
    expect(knowledgeHits).toEqual([]);
  });

  it("同一案上一轮：已核命题不检索，新问题只搜新的，来源标 prior-round", async () => {
    const searchOne = fakeSearchOne();
    const priorHits: string[] = [];
    const { atomsToSearch, atomSearchBundle, priorRoundHits } = await retrieveForAtoms({
      claimAtoms: [ATOMS[0], ATOMS[1], "那隔夜海鲜呢"],
      claimAtomTypes: [
        { text: ATOMS[0], verifiable: true, type: "fact" },
        { text: ATOMS[1], verifiable: true, type: "fact" },
        { text: "那隔夜海鲜呢", verifiable: true, type: "fact" },
      ],
      searchOne,
      priorRound: {
        lookup: (atom) => (atom === ATOMS[0] || atom === ATOMS[1] ? INJECTION : null),
        onInjected: (hit) => priorHits.push(hit.atom),
      },
    });

    const searched = searchOne.mock.calls.map((call) => call[0]);
    expect(searched).toEqual(["那隔夜海鲜呢"]);
    expect(atomsToSearch).toEqual(["那隔夜海鲜呢"]);
    expect(priorRoundHits.map((hit) => hit.atom)).toEqual([ATOMS[0], ATOMS[1]]);
    expect(priorHits).toEqual([ATOMS[0], ATOMS[1]]);
    expect(atomSearchBundle.byAtomKey[ATOMS[0]!]![0]).toMatchObject({
      provenance: "prior-round",
      originDate: "2026-09-11",
    });
    expect((atomSearchBundle.byAtomKey["那隔夜海鲜呢"] ?? [])[0]).not.toHaveProperty("provenance");
  });
});
