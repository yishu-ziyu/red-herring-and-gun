import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ default: { lookup: mocks.lookup } }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));

import { fetchOriginalText } from "./originalEvidence.js";

describe("original page retrieval", () => {
  it("pins a validated DNS address and sets its family so Node does not request an invalid lookupAll result", async () => {
    mocks.lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    mocks.request.mockImplementation((_url, options, onResponse) => {
      expect(options.family).toBe(4);
      options.lookup("example.com", { family: 4 }, (_error: unknown, address: string, family: number) => {
        expect(address).toBe("93.184.216.34");
        expect(family).toBe(4);
      });
      const request = Object.assign(new EventEmitter(), { end: () => {
        const response = Object.assign(new PassThrough(), {
          statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" },
        });
        onResponse(response);
        response.end("<html><body>这是一篇已经取得的网页正文，包含足够长度供调查引用和逐字核对，不能把搜索摘要当成正文。</body></html>");
      } });
      return request;
    });
    const text = await fetchOriginalText("https://example.com/article");
    expect(text).toContain("逐字核对");
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
});
