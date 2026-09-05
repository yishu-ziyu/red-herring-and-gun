import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NEW_CASE, SUBMIT_HOME, VERDICT_SECTION } from "./lib/copy.js";

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
    expect(screen.getByRole("button", { name: NEW_CASE })).toBeTruthy();
    expect(document.querySelector("aside")).toBeNull();
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
    expect(document.querySelector(".source-chip")).toBeTruthy();
    const fold = document.querySelector(".instrument-fold");
    if (fold) expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".verdict-lede")?.textContent).toMatch(/生育津贴/);
    expect(document.querySelector(".verdict-score")).toBeNull();
    expect(document.querySelector(".verdict-face")).toBeNull();
  });

  it("追问案件过程条只出现一次", async () => {
    stubViewport(1280);
    go("/cases/fx-followup");
    render(<App />);
    await waitFor(() => {
      expect(document.querySelectorAll(".instrument").length).toBe(1);
    });
  });

  it("检索中案件有等待圈或检索仪器", async () => {
    stubViewport(1280);
    go("/cases/fx-retrieving");
    render(<App />);
    await waitFor(() => {
      expect(document.querySelector(".wait-ring, [data-testid='search-radar']")).toBeTruthy();
    });
  });
});
