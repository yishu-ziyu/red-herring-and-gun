import { describe, expect, it } from "vitest";
import { readLiveShellQuery, resolveShellMode } from "./resolveShellMode";

describe("resolveShellMode", () => {
  it("defaults to enabled token shell", () => {
    expect(resolveShellMode(null, undefined)).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode("", "")).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode("1", undefined)).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode("token", undefined)).toEqual({ enabled: true, variant: "token" });
  });

  it("opts into antdx", () => {
    expect(resolveShellMode("antdx", undefined)).toEqual({ enabled: true, variant: "antdx" });
    expect(resolveShellMode(null, "antdx")).toEqual({ enabled: true, variant: "antdx" });
  });

  it("legacy query and env still resolve to the product shell", () => {
    expect(resolveShellMode("legacy", undefined)).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode(null, "legacy")).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode(null, "off")).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode("false", undefined)).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode("0", undefined)).toEqual({ enabled: true, variant: "token" });
    expect(resolveShellMode(null, "no")).toEqual({ enabled: true, variant: "token" });
  });

  it("?shell=legacy and ?legacyStream=1 still resolve to the product shell", () => {
    expect(resolveShellMode(readLiveShellQuery("?shell=legacy"), undefined)).toEqual({
      enabled: true,
      variant: "token",
    });
    expect(resolveShellMode(readLiveShellQuery("?legacyStream=1"), "legacy")).toEqual({
      enabled: true,
      variant: "token",
    });
    expect(resolveShellMode(readLiveShellQuery(new URLSearchParams("legacyStream=1")), undefined)).toEqual({
      enabled: true,
      variant: "token",
    });
  });
});

describe("readLiveShellQuery", () => {
  it("prefers shell over legacyStream", () => {
    expect(readLiveShellQuery("?shell=token&legacyStream=1")).toBe("token");
    expect(readLiveShellQuery("?shell=legacy")).toBe("legacy");
    expect(readLiveShellQuery("?legacyStream=1")).toBe("legacy");
    expect(readLiveShellQuery("")).toBeNull();
    expect(readLiveShellQuery(null)).toBeNull();
  });
});
