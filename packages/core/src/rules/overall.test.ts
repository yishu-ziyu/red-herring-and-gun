import { describe, expect, it } from "vitest";
import type { ClaimVerdict } from "../casefile/schema.js";
import { overall } from "./overall.js";

const AT = "2026-09-03T08:00:00.000Z";

function v(claimId: string, verdict: ClaimVerdict["verdict"]): ClaimVerdict {
  return { claimId, verdict, basis: [], rule: verdict, updatedAt: AT };
}

describe("overall", () => {
  it("真 + 假 → mixed_misleading", () => {
    expect(overall([v("c1", "true"), v("c2", "false")])).toEqual({
      verdictType: "mixed_misleading",
      contested: false,
    });
  });

  it("全 unverified → unverified", () => {
    expect(overall([v("c1", "unverified"), v("c2", "unverified")])).toEqual({
      verdictType: "unverified",
      contested: false,
    });
  });

  it("任一 contested 标记 contested: true", () => {
    expect(overall([v("c1", "true"), v("c2", "contested")]).contested).toBe(true);
  });

  it("全 true → true", () => {
    expect(overall([v("c1", "true"), v("c2", "true")])).toEqual({
      verdictType: "true",
      contested: false,
    });
  });

  it("全 false → false", () => {
    expect(overall([v("c1", "false")])).toEqual({ verdictType: "false", contested: false });
  });

  it("有 partial → mixed_misleading", () => {
    expect(overall([v("c1", "true"), v("c2", "partial")]).verdictType).toBe("mixed_misleading");
  });

  it("true 占多数的 true+unverified → true", () => {
    expect(overall([v("c1", "true"), v("c2", "true"), v("c3", "unverified")])).toEqual({
      verdictType: "true",
      contested: false,
    });
  });

  it("unverified 占多数的 true+unverified → unverified", () => {
    expect(overall([v("c1", "true"), v("c2", "unverified"), v("c3", "unverified")])).toEqual({
      verdictType: "unverified",
      contested: false,
    });
  });

  it("全 contested → mixed_misleading 且 contested", () => {
    expect(overall([v("c1", "contested"), v("c2", "contested")])).toEqual({
      verdictType: "mixed_misleading",
      contested: true,
    });
  });

  it("空列表 → unverified", () => {
    expect(overall([])).toEqual({ verdictType: "unverified", contested: false });
  });

  it("true 与 unverified 平票 → unverified", () => {
    expect(overall([v("c1", "true"), v("c2", "unverified")]).verdictType).toBe("unverified");
  });
});
