import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractPivots } from "./extractPivots.js";
import { extractHtml } from "./webFetch.js";
import type { Pivot } from "./types.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function load(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

function pivotsOf(file: string, host: string, baseUrl: string, id: string): Pivot[] {
  const extracted = extractHtml(load(file), baseUrl);
  return extractPivots(
    { id, host, text: extracted.text, links: extracted.links, images: extracted.images },
    1
  );
}

function byKind(pivots: Pivot[], kind: Pivot["kind"]): Pivot[] {
  return pivots.filter((p) => p.kind === kind);
}

describe("extractPivots", () => {
  it("gov-notice 抽出文号与日期", () => {
    const pivots = pivotsOf(
      "gov-notice.html",
      "www.gov.cn",
      "https://www.gov.cn/zhengce/content/2024-03/12/content_12.htm",
      "e-gov"
    );
    const docs = byKind(pivots, "doc_number");
    expect(docs.map((p) => p.value)).toContain("国办发〔2024〕12号");
    expect(docs[0]?.expectedValue).toBe(1);
    expect(byKind(pivots, "date").map((p) => p.value)).toContain("2024-03-12");
    expect(pivots.every((p) => p.fromEvidenceId === "e-gov" && p.depth === 1)).toBe(true);
    expect(pivots[0]?.id).toBe("e-gov:p0");
  });

  it("central-media 抽出被引机构与 A 级外链 expectedValue=3", () => {
    const pivots = pivotsOf(
      "central-media.html",
      "www.news.cn",
      "https://www.news.cn/politics/2024-03/13/c_123.htm",
      "e-xinhua"
    );
    const entities = byKind(pivots, "entity");
    expect(entities.map((p) => p.value)).toEqual(
      expect.arrayContaining(["人力资源社会保障部", "人社部"])
    );
    expect(entities.every((p) => p.expectedValue === 2)).toBe(true);
    const gov = byKind(pivots, "link").find((p) => p.value.includes("www.gov.cn"));
    expect(gov).toBeTruthy();
    expect(gov?.expectedValue).toBe(3);
    expect(byKind(pivots, "link").some((p) => p.value.includes("www.news.cn"))).toBe(false);
  });

  it("repost-a / repost-b 无文号且同值去重", () => {
    const a = pivotsOf("repost-a.html", "mp.weixin.qq.com", "https://mp.weixin.qq.com/s/repost-a", "e-a");
    const b = pivotsOf("repost-b.html", "www.toutiao.com", "https://www.toutiao.com/article/repost-b", "e-b");
    expect(byKind(a, "doc_number")).toEqual([]);
    expect(byKind(b, "doc_number")).toEqual([]);
    const values = a.map((p) => p.value);
    expect(new Set(values).size).toBe(values.length);
  });

  it("debunk-platform 抽出日期与 C 级外链 expectedValue=1", () => {
    const pivots = pivotsOf(
      "debunk-platform.html",
      "www.piyao.org.cn",
      "https://www.piyao.org.cn/2024-07/20/c_debunk.htm",
      "e-piyao"
    );
    expect(byKind(pivots, "date").map((p) => p.value)).toContain("2024-07-20");
    const weibo = byKind(pivots, "link").find((p) => p.value.includes("weibo.com"));
    expect(weibo?.expectedValue).toBe(1);
  });

  it("weibo-post 抽出图片且不超过上限", () => {
    const pivots = pivotsOf("weibo-post.html", "weibo.com", "https://weibo.com/u/1", "e-wb");
    const images = byKind(pivots, "image");
    expect(images.map((p) => p.value)).toEqual([
      "https://wx1.sinaimg.cn/large/fake1.jpg",
      "https://wx2.sinaimg.cn/large/fake2.jpg",
      "https://wx3.sinaimg.cn/large/fake3.jpg",
    ]);
    expect(images.every((p) => p.expectedValue === 1)).toBe(true);
    expect(images.length).toBeLessThanOrEqual(10);
  });
});
