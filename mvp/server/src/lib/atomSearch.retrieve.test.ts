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
});
