import { describe, expect, it } from "vitest";
import { readLiveShellQuery, resolveShellMode } from "./resolveShellMode";

describe("legacy query is not a product path", () => {
  it("maps ?shell=legacy and ?legacyStream=1 onto the enabled token shell", () => {
    expect(resolveShellMode(readLiveShellQuery("?shell=legacy"), undefined)).toEqual({
      enabled: true,
      variant: "token",
    });
    expect(resolveShellMode(readLiveShellQuery("?legacyStream=1"), undefined)).toEqual({
      enabled: true,
      variant: "token",
    });
    expect(resolveShellMode(readLiveShellQuery("?shell=legacy"), "off")).toEqual({
      enabled: true,
      variant: "token",
    });
  });
});
