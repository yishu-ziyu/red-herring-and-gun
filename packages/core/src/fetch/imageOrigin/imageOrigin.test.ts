import { describe, expect, it } from "vitest";
import {
  IMAGE_ORIGIN_NOT_FOUND,
  IMAGE_ORIGIN_NOT_FOUND_ALT,
  applyImageOriginToReport,
  countOcrOnlyImageOriginCitations,
  countOcrOnlyImageOriginCitationsInReport,
  lookupImageOrigin,
  redactForLog,
  resolveImageOrigin,
  reverseImageVendorAvailable,
  visionHintsFromExtraction,
} from "./imageOrigin.js";

const SECOND_HAND = "https://weibo.com/second-hand-repost";
const EARLIER = "https://news.example.com/photo-2018";

function isGapLabel(label: string | undefined): boolean {
  return label === IMAGE_ORIGIN_NOT_FOUND || label === IMAGE_ORIGIN_NOT_FOUND_ALT;
}

describe("resolveImageOrigin gate", () => {
  it("OCR/text search 二手帖 + 以图搜图为空 → 原图没查到，不把二手帖当图源", () => {
    const origin = resolveImageOrigin({
      reverseImageHits: [],
      textSearchHits: [{ url: SECOND_HAND, title: "群里转发帖" }],
      reverseImageAvailable: true,
    });
    expect(isGapLabel(origin.label)).toBe(true);
    expect(origin.status).not.toBe("found");
    expect(origin.channel).toBe("none");
    expect(origin.url).toBeUndefined();
    expect(countOcrOnlyImageOriginCitations(origin, [SECOND_HAND])).toBe(0);
  });

  it("sourceHints 里的网址也不是这张图的来源", () => {
    const origin = resolveImageOrigin({
      reverseImageHits: [],
      textSearchHits: [{ url: "https://mp.weixin.qq.com/s/ocr-hint", title: "OCR 可见链接" }],
    });
    expect(origin.url).toBeUndefined();
    expect(isGapLabel(origin.label)).toBe(true);
  });

  it("同一 URL 若来自以图搜图，不算 OCR-only 出处", () => {
    const origin = resolveImageOrigin({
      reverseImageHits: [{ url: EARLIER, title: "现场照片" }],
      textSearchHits: [{ url: EARLIER, title: "文字也命中了同一页" }],
    });
    expect(origin.url).toBe(EARLIER);
    expect(countOcrOnlyImageOriginCitations(origin, [EARLIER])).toBe(0);
  });

  it("以图搜图返回更早 URL → 那条才是原图出处", () => {
    const origin = resolveImageOrigin({
      reverseImageHits: [{ url: EARLIER, title: "2018 年现场照片", snippet: "首发" }],
      textSearchHits: [{ url: SECOND_HAND, title: "今天的配文转发" }],
    });
    expect(origin.status).toBe("found");
    expect(origin.channel).toBe("reverse-image");
    expect(origin.url).toBe(EARLIER);
    expect(origin.url).not.toBe(SECOND_HAND);
    expect(countOcrOnlyImageOriginCitations(origin, [SECOND_HAND])).toBe(0);
  });

  it("无以图搜图供应商 → unavailable，仍写缺口，不编来源", () => {
    expect(reverseImageVendorAvailable({})).toBe(false);
    const origin = resolveImageOrigin({
      reverseImageHits: [],
      textSearchHits: [{ url: SECOND_HAND, title: "转发" }],
      reverseImageAvailable: false,
    });
    expect(origin.status).toBe("unavailable");
    expect(origin.url).toBeUndefined();
    expect(isGapLabel(origin.label)).toBe(true);
  });
});

describe("lookupImageOrigin", () => {
  it("只采 reverse-image 通道；文字检索命中再传入也被丢掉", async () => {
    const origin = await lookupImageOrigin({
      images: [{ dataUrl: "data:image/png;base64,SECRETBYTES" }],
      ocrTexts: ["某地地铁已经开通"],
      sourceHints: [SECOND_HAND],
      textSearchHits: [{ url: SECOND_HAND, title: "转发帖" }],
    });
    expect(origin.url).toBeUndefined();
    expect(isGapLabel(origin.label)).toBe(true);
    expect(countOcrOnlyImageOriginCitations(origin, [SECOND_HAND])).toBe(0);
  });

  it("注入的以图搜图命中成为出处", async () => {
    const origin = await lookupImageOrigin({
      images: [{ dataUrl: "data:image/png;base64,AAA" }],
      reverseImageSearch: async () => [{ url: EARLIER, title: "更早出处" }],
      textSearchHits: [{ url: SECOND_HAND, title: "转发" }],
    });
    expect(origin.url).toBe(EARLIER);
    expect(origin.channel).toBe("reverse-image");
  });

  it("以图搜图抛错 → 显式缺口，不回落到 OCR 帖", async () => {
    const origin = await lookupImageOrigin({
      images: [{ dataUrl: "data:image/png;base64,AAA" }],
      reverseImageSearch: async () => {
        throw new Error("vendor down");
      },
      textSearchHits: [{ url: SECOND_HAND, title: "转发" }],
    });
    expect(origin.status).toBe("unavailable");
    expect(origin.url).toBeUndefined();
    expect(isGapLabel(origin.label)).toBe(true);
  });
});

describe("applyImageOriginToReport", () => {
  it("报告 origin 字段写缺口，并剥掉把二手帖写成这张图的来源的句子", () => {
    const report: Record<string, unknown> = {
      conclusion: `这张图的来源是 ${SECOND_HAND}。配文说地铁已经开通。`,
      summaryForPublic: `image origin: ${SECOND_HAND}`,
      citationSources: [{ url: SECOND_HAND, title: "转发帖", snippet: "群里截图" }],
      whyHardToVerify: [],
      cannotSay: [],
    };
    const origin = resolveImageOrigin({
      reverseImageHits: [],
      textSearchHits: [{ url: SECOND_HAND, title: "转发帖" }],
    });
    applyImageOriginToReport(report, origin);
    expect(isGapLabel((report.imageOrigin as { label?: string }).label)).toBe(true);
    expect((report.imageOrigin as { url?: string }).url).toBeUndefined();
    expect(String(report.conclusion)).toContain(IMAGE_ORIGIN_NOT_FOUND);
    expect(String(report.conclusion)).not.toMatch(/这张图的来源/);
    expect(String(report.conclusion)).not.toContain(SECOND_HAND);
    expect(countOcrOnlyImageOriginCitationsInReport(report, [SECOND_HAND])).toBe(0);
  });

  it("以图搜图 URL 写入 origin 引用", () => {
    const report: Record<string, unknown> = {
      conclusion: "配文把旧图说成今天的事。",
      citationSources: [{ url: SECOND_HAND, title: "转发", snippet: "s" }],
    };
    applyImageOriginToReport(
      report,
      resolveImageOrigin({
        reverseImageHits: [{ url: EARLIER, title: "2018 首发" }],
        textSearchHits: [{ url: SECOND_HAND, title: "转发" }],
      })
    );
    expect(report.imageOrigin).toEqual(
      expect.objectContaining({ status: "found", channel: "reverse-image", url: EARLIER })
    );
    expect(String(report.conclusion)).toContain(EARLIER);
    expect(String(report.conclusion)).not.toContain(SECOND_HAND);
    expect(
      (report.citationSources as Array<{ url?: string }>).some((s) => s.url === EARLIER)
    ).toBe(true);
    expect(countOcrOnlyImageOriginCitationsInReport(report, [SECOND_HAND])).toBe(0);
  });
});

describe("redactForLog / vision hints", () => {
  it("日志脱敏去掉 data URL 和 base64，不保留图片字节", () => {
    const redacted = JSON.stringify(
      redactForLog({
        dataUrl: "data:image/png;base64,SECRETBYTES",
        ocrTexts: ["可见文字"],
        nested: { screenshot: "data:image/jpeg;base64,MORESECRET" },
      })
    );
    expect(redacted).not.toContain("SECRETBYTES");
    expect(redacted).not.toContain("MORESECRET");
    expect(redacted).not.toMatch(/data:image/);
    expect(redacted).toContain("可见文字");
  });

  it("vision 提取只收 ocrTexts / sourceHints 字符串，不把提示当出处", () => {
    const hints = visionHintsFromExtraction({
      ocrTexts: ["某地地铁已经开通", 12],
      sourceHints: [SECOND_HAND],
      extractedClaims: ["地铁开通"],
    });
    expect(hints.ocrTexts).toEqual(["某地地铁已经开通"]);
    expect(hints.sourceHints).toEqual([SECOND_HAND]);
  });
});
