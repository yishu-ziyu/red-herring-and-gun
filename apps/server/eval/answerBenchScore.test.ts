import { describe, expect, it } from "vitest";
import {
  mapToBenchLabel,
  scoreCase,
  summarize,
  normalizeUrlKey,
  sourceType,
  type BenchCase,
  type PipelineResult,
  type ScoredRow,
} from "./answerBenchScore";

const bc = (over: Partial<BenchCase> = {}): BenchCase => ({
  id: "T-1",
  claim: "c",
  derivedLabel: "不能信",
  boundary: false,
  parts: [{ quotes: [{ url: "https://www.piyao.org.cn/2024/a.html" }] }],
  ...over,
});
const res = (over: Partial<PipelineResult> = {}): PipelineResult => ({
  label: "不能信",
  rawVerdict: "false",
  lead: "",
  answerText: "",
  evidenceSources: [],
  citedSources: [],
  searchedSources: [],
  snapshotBuilt: true,
  fallbackUsed: false,
  timings: { totalMs: 5000 },
  calls: { model: 3, search: 4 },
  ...over,
});

describe("mapToBenchLabel", () => {
  it("maps every production badge word, including 有争议", () => {
    for (const word of ["能信", "不能信", "有真有假", "部分成立", "有争议"] as const) {
      expect(mapToBenchLabel({ face: word })).toBe(word);
    }
    expect(mapToBenchLabel({ face: "还查不清" })).toBe("证据不足");
  });
});

describe("mapToBenchLabel failure modes", () => {
  it("unknown / empty verdicts map to 证据不足 like the UI's 还查不清, never to a hard label", () => {
    expect(mapToBenchLabel({ face: "", judgment: undefined })).toBe("证据不足");
    expect(mapToBenchLabel({ face: "乱写", judgment: undefined })).toBe("证据不足");
    expect(mapToBenchLabel({ face: undefined, judgment: undefined })).toBe("证据不足");
  });
  it("还查不清 -> 证据不足; 有真有假/部分成立/能信/不能信 pass through", () => {
    expect(mapToBenchLabel({ face: "还查不清" })).toBe("证据不足");
    expect(mapToBenchLabel({ face: "有真有假" })).toBe("有真有假");
    expect(mapToBenchLabel({ face: "部分成立" })).toBe("部分成立");
    expect(mapToBenchLabel({ face: "能信" })).toBe("能信");
    expect(mapToBenchLabel({ face: "不能信" })).toBe("不能信");
  });
  it("snapshot judgment not-applicable overrides the face word -> 立场型", () => {
    expect(mapToBenchLabel({ face: "还查不清", judgment: "not-applicable" })).toBe("立场型");
  });
});

describe("normalizeUrlKey failure modes", () => {
  it("garbage input does not throw", () => {
    expect(normalizeUrlKey("not a url")).toBeNull();
    expect(normalizeUrlKey("")).toBeNull();
  });
  it("ignores www, scheme, query, hash, trailing slash", () => {
    expect(normalizeUrlKey("http://www.a.com/x/?q=1#h")).toEqual({ host: "a.com", hostPath: "a.com/x" });
  });
});

describe("scoreCase", () => {
  it("wrong label is not correct; matching label is", () => {
    expect(scoreCase(bc(), res({ label: "证据不足" })).labelCorrect).toBe(false);
    expect(scoreCase(bc(), res()).labelCorrect).toBe(true);
  });
  it("boundary case: labelCorrect is null and needsHuman is true, label still recorded", () => {
    const s = scoreCase(bc({ derivedLabel: null, boundary: true }), res({ label: "有真有假" }));
    expect(s.labelCorrect).toBeNull();
    expect(s.needsHuman).toBe(true);
    expect(s.label).toBe("有真有假");
    expect(s.trueToFalse).toBe(false);
    expect(s.shouldJudgeButDidnt).toBe(false);
  });
  it("pipeline error counts as wrong, not as null", () => {
    const s = scoreCase(bc(), res({ label: "错误", error: "boom" }));
    expect(s.labelCorrect).toBe(false);
    expect(s.error).toBe("boom");
  });
  it("把真话判假 only for derived 能信 judged 不能信", () => {
    expect(scoreCase(bc({ derivedLabel: "能信" }), res({ label: "不能信" })).trueToFalse).toBe(true);
    expect(scoreCase(bc({ derivedLabel: "能信" }), res({ label: "证据不足" })).trueToFalse).toBe(false);
    expect(scoreCase(bc({ derivedLabel: "不能信" }), res({ label: "不能信" })).trueToFalse).toBe(false);
  });
  it("该判不判 for derived 不能信 or 能信 judged 证据不足, not for 证据不足 expected", () => {
    expect(scoreCase(bc({ derivedLabel: "不能信" }), res({ label: "证据不足" })).shouldJudgeButDidnt).toBe(true);
    expect(scoreCase(bc({ derivedLabel: "能信" }), res({ label: "证据不足" })).shouldJudgeButDidnt).toBe(true);
    expect(scoreCase(bc({ derivedLabel: "证据不足" }), res({ label: "证据不足" })).shouldJudgeButDidnt).toBe(false);
    expect(scoreCase(bc({ derivedLabel: "有真有假" }), res({ label: "证据不足" })).shouldJudgeButDidnt).toBe(false);
  });
  it("错标支持 counts 支持 sources only when derived 不能信", () => {
    const sources = [
      { url: "https://a.com/1", title: "", relation: "支持" },
      { url: "https://a.com/2", title: "", relation: "反驳" },
      { url: "https://a.com/3", title: "", relation: "支持" },
    ];
    expect(scoreCase(bc(), res({ evidenceSources: sources })).wrongSupport).toBe(2);
    expect(scoreCase(bc({ derivedLabel: "能信" }), res({ evidenceSources: sources })).wrongSupport).toBe(0);
  });
  it("key source: no sources -> no hit; different host -> no hit", () => {
    const s0 = scoreCase(bc(), res());
    expect([s0.keyInSearch, s0.keyInCited]).toEqual([false, false]);
    const other = [{ url: "https://other.com/x", title: "", relation: "反驳" }];
    const s = scoreCase(bc(), res({ searchedSources: other, citedSources: other }));
    expect([s.keyInSearch, s.keyInCited]).toEqual([false, false]);
  });
  it("key source: same host different path is a host hit but not exact", () => {
    const l = [{ url: "https://piyao.org.cn/other", title: "", relation: "相关" }];
    const s = scoreCase(bc(), res({ searchedSources: l }));
    expect(s.keyInSearch).toBe(true);
    expect(s.keyInSearchExact).toBe(false);
  });
  it("key source: same host+path (www/query/slash differences) is exact", () => {
    const l = [{ url: "http://piyao.org.cn/2024/a.html/?x=1", title: "", relation: "反驳" }];
    expect(scoreCase(bc(), res({ searchedSources: l })).keyInSearchExact).toBe(true);
  });
  it("key source found in search results but not cited is reported separately", () => {
    const l = [{ url: "https://www.piyao.org.cn/2024/a.html", title: "", relation: "unknown" }];
    const s = scoreCase(bc(), res({ searchedSources: l }));
    expect([s.keyInSearchExact, s.keyInCited]).toEqual([true, false]);
  });
  it("key source in evidence counts as cited", () => {
    const l = [{ url: "https://www.piyao.org.cn/2024/a.html", title: "", relation: "反驳" }];
    expect(scoreCase(bc(), res({ evidenceSources: l })).keyInCitedExact).toBe(true);
  });
  it("unknown-relation sources are never counted as 错标支持", () => {
    const l = [{ url: "https://a.com/1", title: "", relation: "unknown" }];
    expect(scoreCase(bc(), res({ evidenceSources: l, citedSources: l })).wrongSupport).toBe(0);
  });
  it("case with no parts/quotes gives no key hit without throwing", () => {
    const l = [{ url: "https://a.com/1", title: "", relation: "unknown" }];
    expect(scoreCase(bc({ parts: [] }), res({ searchedSources: l })).keyInSearch).toBe(false);
  });
  it("carries seconds, calls and fallback", () => {
    const s = scoreCase(bc(), res({ fallbackUsed: true, timings: { totalMs: 12500 } }));
    expect(s.seconds).toBe(12.5);
    expect(s.fallbackUsed).toBe(true);
    expect(s.modelCalls).toBe(3);
    expect(s.searchCalls).toBe(4);
  });
});

describe("summarize", () => {
  const row = (over: Partial<ScoredRow> = {}): ScoredRow => ({
    id: "x", derivedLabel: "不能信", label: "不能信", labelCorrect: true, needsHuman: false, trueToFalse: false,
    shouldJudgeButDidnt: false, wrongSupport: 0, keyInSearch: true, keyInSearchExact: false, keyInCited: true, keyInCitedExact: false, usedReliablePrimary: true, fallbackUsed: false,
    seconds: 10, modelCalls: 2, searchCalls: 3, ...over,
  });
  it("empty input does not divide by zero", () => {
    const s = summarize([]);
    expect(s.cases).toBe(0);
    expect(s.accuracy).toBeNull();
    expect(s.secondsMedian).toBeNull();
  });
  it("boundary rows are excluded from the accuracy denominator", () => {
    const s = summarize([row(), row({ labelCorrect: false }), row({ labelCorrect: null, derivedLabel: null, needsHuman: true })]);
    expect(s.scored).toBe(2);
    expect(s.correct).toBe(1);
    expect(s.accuracy).toBe(0.5);
    expect(s.boundary).toBe(1);
  });
  it("per-label accuracy is split by derivedLabel", () => {
    const s = summarize([row(), row({ derivedLabel: "能信", labelCorrect: false, label: "不能信", trueToFalse: true })]);
    expect(s.byLabel["不能信"]).toEqual({ n: 1, correct: 1 });
    expect(s.byLabel["能信"]).toEqual({ n: 1, correct: 0 });
    expect(s.trueToFalse).toBe(1);
  });
  it("median and max of seconds; even count median averages", () => {
    const s = summarize([row({ seconds: 10 }), row({ seconds: 30 }), row({ seconds: 20 }), row({ seconds: 100 })]);
    expect(s.secondsMedian).toBe(25);
    expect(s.secondsMax).toBe(100);
  });
  it("counts fallback, shouldJudgeButDidnt, wrongSupport total, key source hits, call means", () => {
    const s = summarize([
      row({ fallbackUsed: true, shouldJudgeButDidnt: true, wrongSupport: 2, keyInCited: false, modelCalls: 4, searchCalls: 0 }),
      row({ modelCalls: 2, searchCalls: 6 }),
    ]);
    expect(s.fallbackUsed).toBe(1);
    expect(s.shouldJudgeButDidnt).toBe(1);
    expect(s.wrongSupport).toBe(2);
    expect(s.keyInCited).toBe(1);
    expect(s.modelCallsMean).toBe(3);
    expect(s.searchCallsMean).toBe(3);
  });
});

describe("sourceType / usedReliablePrimary", () => {
  it("classifies by host suffix, not by substring", () => {
    expect(sourceType("https://www.piyao.org.cn/2024/a.html")).toBe("debunk");
    expect(sourceType("https://www.nhsa.gov.cn/x")).toBe("official");
    expect(sourceType("https://m.gmw.cn/toutiao/x")).toBe("media");
    expect(sourceType("https://news.cn/x")).toBe("media");
    expect(sourceType("https://fakegov.cn.evil.com/x")).toBe("other");
    expect(sourceType("https://notgmw.cn/x")).toBe("other");
    expect(sourceType("https://m.toutiao.com/a1")).toBe("other");
    expect(sourceType("garbage")).toBe("other");
  });
  it("true when any cited or evidence source is reliable; false for only self-media; false for none", () => {
    const rel = [{ url: "https://www.gov.cn/a", title: "", relation: "unknown" }];
    const junk = [{ url: "https://m.toutiao.com/a", title: "", relation: "unknown" }];
    expect(scoreCase(bc(), res({ citedSources: rel })).usedReliablePrimary).toBe(true);
    expect(scoreCase(bc(), res({ evidenceSources: rel })).usedReliablePrimary).toBe(true);
    expect(scoreCase(bc(), res({ citedSources: junk })).usedReliablePrimary).toBe(false);
    expect(scoreCase(bc(), res()).usedReliablePrimary).toBe(false);
  });
  it("a reliable source that was only searched, not cited, does not count", () => {
    const rel = [{ url: "https://www.gov.cn/a", title: "", relation: "unknown" }];
    expect(scoreCase(bc(), res({ searchedSources: rel })).usedReliablePrimary).toBe(false);
  });
});
