import { describe, expect, it } from "vitest";
import type { ArchiveRecord } from "./extract";
import { buildIndex, extractDifferences } from "./index";

function rec(over: Partial<ArchiveRecord> & { title: string; statements: string[] }): ArchiveRecord {
  return {
    url: `https://www.piyao.org.cn/20260101/${Math.abs(hash(over.title)).toString(16).padStart(32, "0")}/c.html`,
    publishDate: "2026-01-01",
    originalPublisher: "测试来源",
    verdict: "网传内容不实",
    keySentences: ["经核实，该说法不实。"],
    fullText: "",
    kind: "single",
    source: "piyao",
    items: over.statements.map((s) => ({ statement: s, keySentences: ["经核实，该说法不实。"] })),
    ...over,
  };
}
function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

const ARCHIVE = [
  rec({ title: "网传“四川绵阳越王楼将被拆除”？谣言！", statements: ["四川绵阳越王楼将被拆除"] }),
  rec({ title: "哺乳期妈妈吃纯素可以提高母乳质量？谣言！", statements: ["哺乳期妈妈吃纯素可以提高母乳质量"] }),
  rec({ title: "上海化工园区发生大爆炸？警方通报", statements: ["上海化工园区发生大爆炸"] }),
  rec({ title: "2025年北京地铁将全面涨价到10元？", statements: ["2025年北京地铁将全面涨价到10元"] }),
  rec({ title: "社保卡没有有效期、奶茶等于准毒品、微信好友数量过多会被封号……必须澄清！", statements: ["社保卡没有有效期", "奶茶等于准毒品", "微信好友数量过多会被封号"], kind: "roundup" }),
  rec({ title: "食物发霉变质，切掉坏的部分就能吃吗？", statements: ["食物发霉变质，切掉坏的部分就能吃"] }),
];
const idx = buildIndex(ARCHIVE);

describe("lookupArchive ranking", () => {
  it("ranks the same claim first even when phrased as a question", () => {
    const r = idx.lookup("四川绵阳的越王楼要被拆除是真的吗？");
    expect(r[0].title).toContain("越王楼");
    expect(r[0].matchedStatement).toBe("四川绵阳越王楼将被拆除");
    expect(r[0].publisher).toBe("测试来源");
    expect(r[0].keySentences).toEqual(["经核实，该说法不实。"]);
  });

  it("finds one statement inside a roundup and does not use the roundup title as its text", () => {
    const r = idx.lookup("奶茶等于准毒品");
    expect(r[0].matchedStatement).toBe("奶茶等于准毒品");
    expect(r[0].kind).toBe("roundup");
    // the roundup headline mentions 社保卡, but the item is only about milk tea
    const social = idx.lookup("社保卡没有有效期").find((x) => x.matchedStatement === "奶茶等于准毒品");
    expect(social).toBeUndefined();
  });

  it("returns nothing for an unrelated claim", () => {
    expect(idx.lookup("量子计算机已经破解全部比特币私钥")).toEqual([]);
  });

  it("orders results by descending score and honours limit", () => {
    const r = idx.lookup("上海化工园区发生爆炸", { limit: 2 });
    expect(r.length).toBeLessThanOrEqual(2);
    for (let i = 1; i < r.length; i++) expect(r[i - 1].score).toBeGreaterThanOrEqual(r[i].score);
    expect(r[0].matchedStatement).toContain("上海化工园区");
  });
});

describe("differsOn: similar but different claims", () => {
  it("flags a changed place and lowers the score against the exact claim", () => {
    const exact = idx.lookup("上海化工园区发生大爆炸")[0];
    const changed = idx.lookup("北京化工园区发生大爆炸").find((x) => x.matchedStatement.startsWith("上海"));
    expect(exact.differsOn).toEqual([]);
    expect(changed).toBeDefined();
    expect(changed!.differsOn).toContain("北京");
    expect(changed!.score).toBeLessThan(exact.score);
  });

  it("flags a changed number and a changed year", () => {
    const changed = idx.lookup("2024年北京地铁将全面涨价到8元")[0];
    expect(changed.matchedStatement).toContain("北京地铁");
    expect(changed.differsOn).toEqual(expect.arrayContaining(["2024年", "8元"]));
    const exact = idx.lookup("2025年北京地铁将全面涨价到10元")[0];
    expect(exact.differsOn).toEqual([]);
    expect(changed.score).toBeLessThan(exact.score);
  });
});

describe("extractDifferences", () => {
  it("lists numbers, dates and places present in the query but not in the text", () => {
    expect(extractDifferences("3月12日杭州发生地震，造成5人死亡", "杭州发生地震，造成5人死亡")).toEqual(["3月", "12日"]);
    expect(extractDifferences("四川绵阳越王楼将被拆除", "四川绵阳越王楼将被拆除")).toEqual([]);
    expect(extractDifferences("广州地铁站发生砍人事件", "嘉禾望岗站发生砍人事件")).toEqual(["广州"]);
  });
});

describe("speed", () => {
  it("answers a query over a 20k-item archive in under 50ms", () => {
    const words = "的一是不了人我在有他这中大来上国个到说们为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意进把法此实回二理美点月明其种声全工已话儿者向情部正名定女问力机给等几很业最间新什打便位因重被走电四第门相次东政海口使教西再平真听世气信北少关并内加化由却代军产入先山无";
    const rnd = (() => {
      let s = 42;
      return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
    })();
    const recs: ArchiveRecord[] = [];
    for (let i = 0; i < 20000; i++) {
      let t = "";
      for (let k = 0; k < 16; k++) t += words[Math.floor(rnd() * words.length)];
      recs.push(rec({ title: t + i, statements: [t] }));
    }
    const big = buildIndex(recs);
    let worst = 0;
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      big.lookup("网传" + recs[i * 37].statements[0].slice(0, 12) + "是真的吗？");
      worst = Math.max(worst, performance.now() - t0);
    }
    expect(worst).toBeLessThan(50);
  });
});
