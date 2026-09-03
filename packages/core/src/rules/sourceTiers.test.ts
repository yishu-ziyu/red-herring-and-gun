import { describe, expect, it } from "vitest";
import { tierOf } from "./sourceTiers.js";

describe("sourceTiers", () => {
  it("前缀剥离与后缀匹配覆盖 ≥10 个 host", () => {
    expect(tierOf("www.gov.cn")).toBe("A");
    expect(tierOf("m.people.com.cn")).toBe("A");
    expect(tierOf("x.people.com.cn")).toBe("A");
    expect(tierOf("news.cn")).toBe("A");
    expect(tierOf("piyao.org.cn")).toBe("A");
    expect(tierOf("www.piyao.org.cn")).toBe("A");
    expect(tierOf("tsinghua.edu.cn")).toBe("A");
    expect(tierOf("mod.mil.cn")).toBe("A");
    expect(tierOf("xinhuanet.com")).toBe("A");
    expect(tierOf("thepaper.cn")).toBe("B");
    expect(tierOf("m.thepaper.cn")).toBe("B");
    expect(tierOf("news.sina.com.cn")).toBe("B");
    expect(tierOf("en.wikipedia.org")).toBe("B");
    expect(tierOf("qq.com")).toBe("B");
    expect(tierOf("weibo.com")).toBe("C");
    expect(tierOf("example.org")).toBe("C");
  });
});
