import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaseLink } from "./caseIntake";
import { MIN_SCRAPE_CONTENT_CHARS, formatScrapedContent, scrapeFailureReason, scrapeLinks } from "./linkScraper";

const WEIBO_URL = "https://weibo.com/status/50891234";

/** 抓得到真东西的一页（明显超过下限字数）。 */
const ARTICLE = [
  "天津卫健委的实验数据：炒青菜在室温存放 18 小时后，亚硝酸盐含量比存放 6 小时增加 443%。",
  "同一实验里红烧鲫鱼增加 54%、韭菜炒蛋增加 47%、红烧肉变化不大。",
  "食药署说明：隔夜菜本身并不会致癌，亚硝酸盐要在胃酸环境下与胺类结合生成亚硝胺才有致癌性。",
  "多来源确认隔夜菜里的亚硝酸盐会随时间上升，但只有摄入量超过 500 毫克时才谈得上致癌。",
  "这份材料只说明含量随时间上升，不能推出「超标百倍」的计算依据；存放温度、菜品类型都会改变结果。",
  "可见的关键缺口是：没有给出与国家标准限值对照的检测数据，也就无法核实「百倍」这个倍数。",
].join("");

/** 微博登录墙：标题写着 Sina Visitor System，正文是空的。 */
const LOGIN_WALL_SHORT =
  "Title: Sina Visitor System\n\nURL Source: https://weibo.com/status/50891234\n\nMarkdown Content:";

/** 长一点的登录墙页面：正文很长，但通篇都是「登录后查看」。 */
const LOGIN_WALL_LONG =
  `Title: Sina Visitor System\n\nURL Source: https://weibo.com/status/50891234\n\nMarkdown Content:\n\n` +
  "登录后查看这条微博的全文。".repeat(30);

function caseLink(url = WEIBO_URL): CaseLink {
  return { id: `link-${url}`, url, hostname: "weibo.com" };
}

function stubScrape(body: string, status = 200) {
  const fetcher = vi.fn(async () => new Response(body, { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("scrapeFailureReason：三类返回都算抓取失败", () => {
  it("空内容", () => {
    expect(scrapeFailureReason("")).toContain("空");
    expect(scrapeFailureReason("   \n  ")).toContain("空");
  });

  it(`少于 ${MIN_SCRAPE_CONTENT_CHARS} 字的正文`, () => {
    const reason = scrapeFailureReason(LOGIN_WALL_SHORT);
    expect(reason).toContain("过短");
    expect(scrapeFailureReason("标题：某厂辟谣声明。")).toContain("过短");
  });

  it("长正文但命中登录墙关键词（Sina Visitor System）", () => {
    expect(LOGIN_WALL_LONG.length).toBeGreaterThan(MIN_SCRAPE_CONTENT_CHARS);
    expect(scrapeFailureReason(LOGIN_WALL_LONG)).toContain("登录墙");
  });

  it("长正文但命中 passport 类登录跳转", () => {
    const redirected = `${ARTICLE}\n\nURL Source: https://passport.weibo.com/visitor/visitor`;
    expect(scrapeFailureReason(redirected)).toContain("登录墙");
  });

  it("够长的真正文不算失败；讲护照的文章不会被 passport 一词误判", () => {
    expect(ARTICLE.length).toBeGreaterThanOrEqual(MIN_SCRAPE_CONTENT_CHARS);
    expect(scrapeFailureReason(ARTICLE)).toBeNull();
    const passportArticle = `${ARTICLE}\n\n办理普通护照（passport）需要准备的材料：身份证原件、照片回执。`;
    expect(scrapeFailureReason(passportArticle)).toBeNull();
  });
});

describe("scrapeLinks：判定落到链接上", () => {
  it("空正文 → scrapeFailed，正文不留登录墙残渣", async () => {
    stubScrape("   ");
    const [scraped] = await scrapeLinks([caseLink()]);

    expect(scraped!.scrapeFailed).toBe(true);
    expect(scraped!.scrapeStatus).toBe("error");
    expect(scraped!.scrapedContent).toBe("");
    expect(scraped!.scrapeError).toContain("空");
  });

  it("短文本（微博登录墙原样返回）→ scrapeFailed", async () => {
    stubScrape(LOGIN_WALL_SHORT);
    const [scraped] = await scrapeLinks([caseLink()]);

    expect(scraped!.scrapeFailed).toBe(true);
    expect(scraped!.scrapeStatus).toBe("error");
    expect(scraped!.scrapedContent).toBe("");
    expect(formatScrapedContent([scraped!])).toBe("");
  });

  it("登录墙 HTML → scrapeFailed", async () => {
    stubScrape(LOGIN_WALL_LONG);
    const [scraped] = await scrapeLinks([caseLink()]);

    expect(scraped!.scrapeFailed).toBe(true);
    expect(scraped!.scrapeError).toContain("登录墙");
  });

  it("HTTP 非 200 → scrapeFailed", async () => {
    stubScrape("Not Found", 404);
    const [scraped] = await scrapeLinks([caseLink()]);

    expect(scraped!.scrapeFailed).toBe(true);
    expect(scraped!.scrapeError).toContain("HTTP 404");
  });

  it("真正文 → success，不算失败", async () => {
    stubScrape(ARTICLE);
    const [scraped] = await scrapeLinks([caseLink()]);

    expect(scraped!.scrapeFailed).toBe(false);
    expect(scraped!.scrapeStatus).toBe("success");
    expect(scraped!.scrapedContent).toBe(ARTICLE);
  });
});

describe("formatScrapedContent：不产出空信封", () => {
  it("全部失败 → 空串（调用方就不会拼出「--- 链接 1 … --- 结束」）", async () => {
    stubScrape(LOGIN_WALL_SHORT);
    const scraped = await scrapeLinks([caseLink(), caseLink("https://weibo.com/status/1")]);

    expect(scraped.every((link) => link.scrapeFailed)).toBe(true);
    expect(formatScrapedContent(scraped)).toBe("");
    expect(formatScrapedContent(scraped)).not.toContain("链接 1");
  });

  it("一条失败一条成功 → 信封里只有成功那条", async () => {
    const ok = { ...caseLink("https://news.example.com/ok"), scrapeStatus: "success" as const, scrapedContent: ARTICLE, scrapedAt: 1, scrapeFailed: false };
    const bad = { ...caseLink(), scrapeStatus: "error" as const, scrapedContent: "", scrapedAt: 1, scrapeFailed: true };

    const text = formatScrapedContent([ok, bad]);

    expect(text).toContain("https://news.example.com/ok");
    expect(text).toContain(ARTICLE);
    expect(text).not.toContain(WEIBO_URL);
    expect(text).not.toContain("Sina Visitor System");
  });

  it("抓取成功但正文为空（旧数据）→ 仍然不产生信封", () => {
    const legacy = { ...caseLink(), scrapeStatus: "success" as const, scrapedContent: "", scrapedAt: 1, scrapeFailed: false };
    expect(formatScrapedContent([legacy])).toBe("");
  });
});
