import { describe, expect, it } from "vitest";
import { APP_TITLE } from "./index.js";

describe("web smoke", () => {
  it("exports the product name", () => {
    expect(APP_TITLE).toBe("红鲱鱼与枪");
  });
});
