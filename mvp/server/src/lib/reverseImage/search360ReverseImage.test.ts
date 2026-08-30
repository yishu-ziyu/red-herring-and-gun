import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readdirSync, existsSync, rmSync } from "node:fs";
import {
  makeSearch360ReverseImage,
  parse360ReverseHits,
  resolveUploadDir,
  uploadImageForReverseSearch,
} from "./search360ReverseImage.js";

const ENV = {
  QIHOO_360_API_KEY: "test-key",
  PUBLIC_BASE_URL: "https://gun.yishuziyu.cn",
  RHG_DATA_DIR: tmpdir(),
};

describe("parse360ReverseHits — 宽容解析", () => {
  it("深度遍历收集含 http(s) url 的命中", () => {
    const hits = parse360ReverseHits({
      code: 0,
      result: {
        items: [
          { title: "原帖链接", url: "https://example.com/a" },
          { pic: { title: "微博", imgUrl: "https://weibo.com/pic/1" } },
        ],
      },
    });
    expect(hits.length).toBeGreaterThanOrEqual(2);
    expect(hits[0].url).toBe("https://example.com/a");
    expect(hits.some((h) => h.url === "https://weibo.com/pic/1")).toBe(true);
  });

  it("字符串 JSON 也可解析；无 url 返回空", () => {
    expect(parse360ReverseHits('{"items":[{"title":"x","url":"https://a.b"}]}')).toHaveLength(1);
    expect(parse360ReverseHits({ code: 1 })).toEqual([]);
    expect(parse360ReverseHits("not json")).toEqual([]);
  });
});

describe("uploadImageForReverseSearch — 临时图床", () => {
  const dir = resolveUploadDir(ENV);
  beforeAll(() => { rmSync(dir, { recursive: true, force: true }); });
  afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

  it("dataUrl → 公网 URL + 落盘", async () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const url = await uploadImageForReverseSearch(ENV, png);
    expect(url).toMatch(/^https:\/\/gun\.yishuziyu\.cn\/uploads\/rhg-\d+-[a-f0-9]+\.png$/);
    const name = url.split("/").pop();
    expect(existsSync(join(dir, name))).toBe(true);
  });

  it("无 PUBLIC_BASE_URL / 非法 dataUrl → undefined", async () => {
    expect(await uploadImageForReverseSearch({}, "data:image/png;base64,xxx")).toBeUndefined();
    expect(await uploadImageForReverseSearch({}, "not a data url")).toBeUndefined();
    expect(await uploadImageForReverseSearch(ENV, "not a data url")).toBeUndefined();
  });
});

describe("makeSearch360ReverseImage", () => {
  it("缺 key / 缺 base URL → undefined（不可用）", () => {
    expect(makeSearch360ReverseImage({})).toBeUndefined();
    expect(makeSearch360ReverseImage({ QIHOO_360_API_KEY: "k" })).toBeUndefined();
  });

  it("有 key + base → 调用 vendor，失败那张跳过不阻断", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ items: [{ title: "图源", url: "https://src.example.com/1" }] }), { status: 200 })
      );
    try {
      const fn = makeSearch360ReverseImage(ENV)!;
      expect(fn).toBeTypeOf("function");
      const hits = await fn({ images: [{ dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }], ocrTexts: [], sourceHints: [] });
      expect(hits[0].url).toBe("https://src.example.com/1");
    } finally {
      fetchMock.mockRestore();
    }
  });
});