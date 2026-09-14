import { describe, expect, it } from "vitest";
import { caseIntakeFailedLinks, extractLinks, isUrlOnlyClaim } from "./caseIntake";

describe("case intake link extraction", () => {
  it("normalizes explicit, www, and bare-domain links", () => {
    const links = extractLinks("看这个 https://news.example.com/a?x=1，和 www.gov.cn 以及 metaso.cn/search");

    expect(links.map((link) => link.url)).toEqual([
      "https://news.example.com/a?x=1",
      "https://www.gov.cn/",
      "https://metaso.cn/search",
    ]);
    expect(links.map((link) => link.hostname)).toEqual(["news.example.com", "gov.cn", "metaso.cn"]);
  });

  it("deduplicates equivalent links after protocol normalization", () => {
    const links = extractLinks("www.example.com https://www.example.com/");

    expect(links).toHaveLength(1);
    expect(links[0].url).toBe("https://www.example.com/");
  });

  it("只挑出标记了 scrapeFailed 的链接", () => {
    const [ok, bad] = extractLinks("https://news.example.com/a https://weibo.com/b");
    const links = [
      { ...ok!, scrapeFailed: false },
      { ...bad!, scrapeFailed: true },
    ];

    expect(caseIntakeFailedLinks({ links }).map((link) => link.url)).toEqual(["https://weibo.com/b"]);
    expect(caseIntakeFailedLinks({ links: [ok!] })).toEqual([]);
    expect(caseIntakeFailedLinks({ links: [] })).toEqual([]);
    expect(caseIntakeFailedLinks(undefined)).toEqual([]);
    expect(caseIntakeFailedLinks(null)).toEqual([]);
  });

  it("只贴 URL 时判定为只贴链接", () => {
    expect(isUrlOnlyClaim("https://weibo.com/1749990115/P3bF9xY1z")).toBe(true);
    expect(isUrlOnlyClaim("请核查链接内容：https://weibo.com/a")).toBe(true);
    expect(isUrlOnlyClaim("https://weibo.com/a 隔夜菜会致癌吗")).toBe(false);
  });
});
