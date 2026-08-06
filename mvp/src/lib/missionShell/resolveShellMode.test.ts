import { describe, expect, it } from "vitest";
import { resolveShellMode } from "./resolveShellMode";

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

  it("opts out to legacy", () => {
    expect(resolveShellMode("legacy", undefined)).toEqual({ enabled: false, variant: "token" });
    expect(resolveShellMode(null, "legacy")).toEqual({ enabled: false, variant: "token" });
    expect(resolveShellMode(null, "off")).toEqual({ enabled: false, variant: "token" });
    expect(resolveShellMode("false", undefined)).toEqual({ enabled: false, variant: "token" });
  });
});
