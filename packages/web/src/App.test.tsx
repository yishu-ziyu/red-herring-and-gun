import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SUBMIT_HOME, VERDICT_SECTION } from "./lib/copy.js";

vi.mock("./lib/api.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/api.js")>();
  return {
    ...actual,
    listCases: vi.fn(async () => []),
  };
});

import { App } from "./App.js";

function stubViewport(width: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  window.matchMedia = (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    const matches = min ? width >= Number(min[1]) : false;
    return {
      matches,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
      onchange: null,
    };
  };
}

function go(path: string) {
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

afterEach(() => {
  cleanup();
  go("/");
});

describe("App routes", () => {
  it("首页没有案件壳", async () => {
    stubViewport(1280);
    go("/");
    render(<App />);
    expect(await screen.findByRole("button", { name: SUBMIT_HOME })).toBeTruthy();
    expect(document.querySelector("aside")).toBeNull();
    expect(document.querySelector("nav")).toBeNull();
    expect(screen.queryByText(VERDICT_SECTION)).toBeNull();
  });

  it("案件页仍是三栏壳", async () => {
    stubViewport(1280);
    go("/cases/fx-done");
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector("nav")).toBeTruthy();
      expect(document.querySelector("main")).toBeTruthy();
      expect(document.querySelector("aside")).toBeTruthy();
    });
    expect(screen.getByText(VERDICT_SECTION)).toBeTruthy();
  });
});
