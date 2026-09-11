import { describe, expect, it } from "vitest";
import { extractLinks } from "./caseIntake";

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
});
