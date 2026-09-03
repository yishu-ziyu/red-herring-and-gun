import { describe, expect, it } from "vitest";
import { PACKAGE } from "./index.js";

describe("eval smoke", () => {
  it("exports the package name", () => {
    expect(PACKAGE).toBe("@rhg/eval");
  });
});
