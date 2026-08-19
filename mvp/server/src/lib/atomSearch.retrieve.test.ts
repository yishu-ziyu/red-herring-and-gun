import { describe, expect, it, vi } from "vitest";
import { retrieveForAtoms } from "./atomSearch";

describe("retrieveForAtoms", () => {
  it("只对可核查原子调用 searchOne，并打出 bundle", async () => {
    const searchOne = vi.fn(async (atom: string) => ({
      answer: `ans-${atom}`,
      model: "m",
      // ASCII path：筛选会 canonicalize（中文 path 会被 URL 编码）
      sources: [{ url: `https://x.test/${encodeURIComponent(atom)}`, title: atom, snippet: "s" }],
    }));

    const { atomsToSearch, atomSearchBundle } = await retrieveForAtoms({
      claimAtoms: ["事实1", "立场", "事实2"],
      claimAtomTypes: [
        { text: "事实1", verifiable: true, type: "fact" },
        { text: "立场", verifiable: false, type: "value" },
        { text: "事实2", verifiable: true, type: "fact" },
      ],
      searchOne,
    });

    expect(atomsToSearch).toEqual(["事实1", "事实2"]);
    expect(searchOne).toHaveBeenCalledTimes(2);
    expect(atomSearchBundle.atomsSearched).toEqual(["事实1", "事实2"]);
    expect(atomSearchBundle.byAtomKey["事实1"]?.[0]?.url).toBe(
      `https://x.test/${encodeURIComponent("事实1")}`
    );
    expect(atomSearchBundle.filterMeta?.totals.before).toBeGreaterThan(0);
    expect(atomSearchBundle.filterMeta?.totals.afterTopK).toBeLessThanOrEqual(
      atomSearchBundle.filterMeta?.totals.before ?? 0
    );
  });

  it("sequential 模式按序调用 hooks", async () => {
    const order: string[] = [];
    await retrieveForAtoms({
      claimAtoms: ["A", "B"],
      claimAtomTypes: [
        { text: "A", verifiable: true, type: "fact" },
        { text: "B", verifiable: true, type: "fact" },
      ],
      searchOne: async (atom) => {
        order.push(`search:${atom}`);
        return { sources: [] };
      },
      hooks: {
        mode: "sequential",
        onAtomStart: (a) => order.push(`start:${a}`),
        onAtomResult: (a) => order.push(`done:${a}`),
      },
    });
    expect(order).toEqual([
      "start:A",
      "search:A",
      "done:A",
      "start:B",
      "search:B",
      "done:B",
    ]);
  });

  it("7 条可核查、第 7 条含导致 → 检索 6 次且含第 7 条", async () => {
    const searchOne = vi.fn(async () => ({ sources: [] }));
    const atoms = [
      "背景一",
      "背景二",
      "背景三",
      "背景四",
      "背景五",
      "背景六",
      "隔夜菜导致癌症",
    ];
    const { atomsToSearch, atomSearchBundle } = await retrieveForAtoms({
      claimAtoms: atoms,
      claimAtomTypes: atoms.map((text) => ({ text, verifiable: true, type: "fact" })),
      searchOne,
    });
    expect(searchOne).toHaveBeenCalledTimes(6);
    expect(atomsToSearch).toHaveLength(6);
    expect(atomsToSearch).toContain("隔夜菜导致癌症");
    expect(atomSearchBundle.atomsSearched).toContain("隔夜菜导致癌症");
    expect(atomsToSearch).not.toContain("背景六");
  });

  it("立场条不进 searchOne", async () => {
    const searchOne = vi.fn(async () => ({ sources: [] }));
    await retrieveForAtoms({
      claimAtoms: ["隔夜菜含细菌", "不该吃隔夜菜"],
      claimAtomTypes: [
        { text: "隔夜菜含细菌", verifiable: true, type: "fact" },
        { text: "不该吃隔夜菜", verifiable: false, type: "value" },
      ],
      searchOne,
    });
    expect(searchOne).toHaveBeenCalledTimes(1);
    expect(searchOne).toHaveBeenCalledWith("隔夜菜含细菌");
  });
});
