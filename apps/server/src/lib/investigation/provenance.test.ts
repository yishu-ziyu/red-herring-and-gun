/**
 * 快照证据条目的两个新增可选字段（Part 1 · 注入层）：
 * `provenance: "knowledge"` / `originDate: YYYY-MM-DD` 只从注入来源透传到来源条目与证据条目；
 * 老快照（没有这两个字段）照常构建、照常通过 schema 校验。
 */
import { describe, expect, it } from "vitest";
import { buildInvestigationSnapshot } from "./build.js";
import { validateInvestigationSnapshot } from "./schema.js";

const ATOM = "隔夜菜的亚硝酸盐含量会超标";
const SEARCHED_URL = "https://search.example/nitrite";
const KB_URL = "https://kb.example/nitrite";

function snapshotWith(sources: Array<Record<string, unknown>>) {
  return buildInvestigationSnapshot(
    {
      originalClaim: "隔夜菜亚硝酸盐超标，吃了会中毒。",
      phase: "complete",
      claimAtoms: [ATOM],
      claimAtomTypes: [{ text: ATOM, verifiable: true, type: "fact" }],
      atomSearchBundle: { atomsSearched: [ATOM], byAtomKey: { [ATOM]: sources } },
      subclaimVerdicts: [
        {
          claimAtom: ATOM,
          verdict: "false",
          evidence: "辟谣材料[1]",
          boundary: "",
          supportingSources: [],
          contradictingSources: [{ url: SEARCHED_URL, title: "科普", snippet: "远低于限值" }],
          evidenceGaps: [],
        },
      ],
      report: { conclusion: "超标说法不成立。", verdictType: "false" },
    },
    { claimAtomKeyFn: (s) => s.trim() }
  );
}

describe("快照透传 provenance / originDate", () => {
  it("知识库来源：来源条目与证据条目都带两个字段", () => {
    const snapshot = snapshotWith([
      { url: KB_URL, title: "知识库条目", snippet: "已核证据", provenance: "knowledge", originDate: "2026-09-11" },
      { url: SEARCHED_URL, title: "科普", snippet: "远低于限值" },
    ]);
    const kbSource = snapshot.sources.find((source) => source.url === KB_URL);
    expect(kbSource?.provenance).toBe("knowledge");
    expect(kbSource?.originDate).toBe("2026-09-11");
    const searched = snapshot.sources.find((source) => source.url === SEARCHED_URL);
    expect(searched?.provenance).toBeUndefined();
    expect(searched?.originDate).toBeUndefined();

    const link = snapshot.claims[0]!.evidence.find(
      (item) => item.sourceId === kbSource!.id
    );
    expect(link?.provenance).toBe("knowledge");
    expect(link?.originDate).toBe("2026-09-11");
  });

  it("同一 URL 先被 verdict 来源登记时也不丢标记（字段从注入来源那一份取）", () => {
    const snapshot = snapshotWith([
      // verdict 桶里的那份没有字段（模型引用形状），bundle 里的那份有
      { url: SEARCHED_URL, title: "科普", snippet: "远低于限值" },
      { url: SEARCHED_URL, title: "科普", snippet: "远低于限值", provenance: "knowledge", originDate: "2026-09-11" },
    ]);
    const source = snapshot.sources.find((item) => item.url === SEARCHED_URL);
    expect(source?.provenance).toBe("knowledge");
    expect(source?.originDate).toBe("2026-09-11");
    expect(snapshot.sources).toHaveLength(1);
  });

  it("老数据（没有这两个字段）照常构建、照常过 schema 校验", () => {
    const snapshot = snapshotWith([{ url: SEARCHED_URL, title: "科普", snippet: "远低于限值" }]);
    expect(() => validateInvestigationSnapshot(snapshot)).not.toThrow();
    expect(snapshot.sources.every((source) => source.provenance === undefined)).toBe(true);
  });

  it("非契约 provenance 值不透传（只认 knowledge 与 prior-round）", () => {
    const snapshot = snapshotWith([
      { url: KB_URL, title: "t", snippet: "s", provenance: "cache", originDate: "2026-09-11" },
    ]);
    const source = snapshot.sources.find((item) => item.url === KB_URL);
    expect(source?.provenance).toBeUndefined();
    expect(source?.originDate).toBeUndefined();
  });

  it("同一案上一轮来源：来源条目与证据条目带 provenance=prior-round", () => {
    const snapshot = snapshotWith([
      { url: KB_URL, title: "上一轮出处", snippet: "已核证据", provenance: "prior-round", originDate: "2026-09-12" },
    ]);
    const source = snapshot.sources.find((item) => item.url === KB_URL);
    expect(source?.provenance).toBe("prior-round");
    expect(source?.originDate).toBe("2026-09-12");
    const link = snapshot.claims[0]!.evidence.find((item) => item.sourceId === source!.id);
    expect(link?.provenance).toBe("prior-round");
    expect(() => validateInvestigationSnapshot(snapshot)).not.toThrow();
  });
});
