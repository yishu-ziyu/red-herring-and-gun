import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { originCluster } from "./originCluster.js";
import { extractHtml } from "./webFetch.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function load(name: string): string {
  return readFileSync(join(fixtures, name), "utf8");
}

describe("originCluster", () => {
  it("两篇转载并簇且簇根为更早发布者", () => {
    const a = extractHtml(load("repost-a.html"), "https://mp.weixin.qq.com/s/repost-a");
    const b = extractHtml(load("repost-b.html"), "https://www.toutiao.com/article/repost-b");
    const map = originCluster([
      { id: "e-a", host: "mp.weixin.qq.com", text: a.text, publishedAt: a.publishedAt },
      { id: "e-b", host: "www.toutiao.com", text: b.text, publishedAt: b.publishedAt },
    ]);
    expect(map.get("e-a")).toBe("e-a");
    expect(map.get("e-b")).toBe("e-a");
  });

  it("gov 页与转载不并", () => {
    const gov = extractHtml(load("gov-notice.html"), "https://www.gov.cn/n");
    const a = extractHtml(load("repost-a.html"), "https://mp.weixin.qq.com/s/repost-a");
    const map = originCluster([
      { id: "e-gov", host: "www.gov.cn", text: gov.text, publishedAt: gov.publishedAt },
      { id: "e-a", host: "mp.weixin.qq.com", text: a.text, publishedAt: a.publishedAt },
    ]);
    expect(map.get("e-gov")).toBe("e-gov");
    expect(map.get("e-a")).toBe("e-a");
  });

  it("同 host 两页并簇", () => {
    const map = originCluster([
      { id: "w2", host: "weibo.com", text: "完全不同的短文乙" },
      { id: "w1", host: "weibo.com", text: "完全不同的短文甲" },
    ]);
    expect(map.get("w1")).toBe("w1");
    expect(map.get("w2")).toBe("w1");
  });
});
