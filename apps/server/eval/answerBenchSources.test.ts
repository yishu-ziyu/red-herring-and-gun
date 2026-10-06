import { describe, expect, it } from "vitest";
import { extractSources } from "./answerBenchSources";

const snapshot = {
  schemaVersion: 1,
  claims: [
    {
      evidence: [
        { sourceId: "a", role: "contradict", passage: "p" },
        { sourceId: "b", role: "context-only" },
        { sourceId: "c", role: "weird-new-role" },
      ],
    },
  ],
  sources: [
    { id: "a", url: "https://x.com/a", title: "A" },
    { id: "b", url: "https://x.com/b", title: "B" },
    { id: "c", url: "https://x.com/c", title: "C" },
  ],
};

describe("extractSources", () => {
  it("fallback: no snapshot -> cited sources are relation 'unknown', never 相关", () => {
    const r = extractSources({ citationSources: [{ url: "https://x.com/a", title: "A" }, { url: "https://x.com/b" }] });
    expect(r.snapshotBuilt).toBe(false);
    expect(r.evidenceSources).toEqual([]);
    expect(r.citedSources.map((s) => s.relation)).toEqual(["unknown", "unknown"]);
    expect(JSON.stringify(r)).not.toContain("相关");
  });
  it("empty report gives empty lists without throwing", () => {
    const r = extractSources({});
    expect(r).toEqual({ snapshotBuilt: false, evidenceSources: [], citedSources: [], searchedSources: [] });
  });
  it("snapshot roles map to the UI words; an unrecognised role is unknown, not 相关", () => {
    const r = extractSources({ investigation: snapshot });
    expect(r.snapshotBuilt).toBe(true);
    expect(r.evidenceSources.map((s) => s.relation)).toEqual(["反驳", "相关", "unknown"]);
  });
  it("cited sources inherit the snapshot role when the url matches; others stay unknown", () => {
    const r = extractSources({ investigation: snapshot, citationSources: [{ url: "https://x.com/a" }, { url: "https://y.com/z" }] });
    expect(r.citedSources.map((s) => s.relation)).toEqual(["反驳", "unknown"]);
  });
  it("searched sources come from the bundle, drop non-http and duplicates", () => {
    const r = extractSources({}, { aggregate: { sources: [{ url: "https://a.com/1" }, { url: "https://a.com/1" }, { url: "ftp://x" }, {}] } });
    expect(r.searchedSources.map((s) => s.url)).toEqual(["https://a.com/1"]);
  });
  it("searched sources fall back to forAgent[].sources", () => {
    const r = extractSources({}, { forAgent: [{ sources: [{ url: "https://b.com/2" }] }] });
    expect(r.searchedSources.length).toBe(1);
  });
});
