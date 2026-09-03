import { describe, expect, it } from "vitest";
import { searchAll, type SearchProgress } from "./searchAll.js";

const SHARED = "https://shared.example/doc";
const ONLY_A = "https://a.example/only";
const ONLY_B = "https://b.example/only";

describe("searchAll", () => {
  it("一源抛错不阻断且其余结果保留", async () => {
    async function keep() {
      return [{ url: ONLY_A, title: "ok", snippet: "kept" }];
    }
    async function boom() {
      throw new Error("provider down");
    }

    const result = await searchAll({}, "查询", { providers: [keep, boom] });
    expect(result).toHaveLength(1);
    expect(result[0]?.url).toBe(ONLY_A);
    expect(result[0]?.id).toBe("e1");
  });

  it("RRF 顺序：两源都排前的 URL 在最前", async () => {
    async function first() {
      return [
        { url: SHARED, title: "shared" },
        { url: ONLY_A, title: "a-only" },
      ];
    }
    async function second() {
      return [
        { url: SHARED, title: "shared" },
        { url: ONLY_B, title: "b-only" },
      ];
    }

    const result = await searchAll({}, "查询", { providers: [first, second] });
    expect(result[0]?.canonicalUrl).toBe(SHARED);
    expect(result.map((e) => e.canonicalUrl)).toEqual([SHARED, ONLY_A, ONLY_B]);
  });

  it("去重后无重复 canonicalUrl", async () => {
    async function noisy() {
      return [
        { url: "https://www.example.com/a/?utm_source=x#frag", snippet: "one" },
        { url: "https://example.com/a", snippet: "two" },
      ];
    }

    const result = await searchAll({}, "查询", { providers: [noisy] });
    const urls = result.map((e) => e.canonicalUrl);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toEqual(["https://example.com/a"]);
    expect(result[0]?.url).toBe("https://www.example.com/a/?utm_source=x#frag");
  });

  it("progress 事件顺序：started 全部先于 finished/failed，merged 最后", async () => {
    async function keep() {
      return [{ url: ONLY_A, snippet: "ok" }];
    }
    async function boom() {
      throw new Error("provider down");
    }

    const events: SearchProgress[] = [];
    await searchAll({}, "查询", {
      providers: [keep, boom],
      onProgress: (p) => events.push(p),
    });

    const kinds = events.map((e) => e.kind);
    expect(kinds.filter((k) => k === "provider.started")).toHaveLength(2);
    expect(kinds[0]).toBe("provider.started");
    expect(kinds[1]).toBe("provider.started");
    expect(kinds.slice(0, 2).every((k) => k === "provider.started")).toBe(true);
    expect(kinds.slice(2, -1).every((k) => k === "provider.finished" || k === "provider.failed")).toBe(
      true
    );
    expect(kinds.at(-1)).toBe("merged");
    expect(events.some((e) => e.kind === "provider.failed" && e.error === "provider down")).toBe(true);
    expect(events.some((e) => e.kind === "provider.finished" && e.count === 1)).toBe(true);
  });

  it("id 为 e1..eN 连续", async () => {
    async function two() {
      return [
        { url: ONLY_A, snippet: "a" },
        { url: ONLY_B, snippet: "b" },
      ];
    }

    const result = await searchAll({}, "查询", { providers: [two] });
    expect(result.map((e) => e.id)).toEqual(["e1", "e2"]);
  });

  it("abort 后不等在飞 provider 返回即收口", async () => {
    const controller = new AbortController();
    async function slow() {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return [{ url: ONLY_A, snippet: "late" }];
    }

    const started = Date.now();
    const pending = searchAll({}, "查询", { providers: [slow], signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    const result = await pending;
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result).toEqual([]);
  });
});
