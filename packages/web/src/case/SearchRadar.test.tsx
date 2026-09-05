import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SEARCH_LABEL, SEARCH_RUNNING } from "../lib/copy.js";
import { SearchRadar } from "./SearchRadar.js";

function mockMatchMedia(matches: boolean) {
  window.matchMedia = (media: string) => ({
    media,
    matches,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
    onchange: null,
  });
}

afterEach(() => {
  cleanup();
});

beforeEach(() => {
  mockMatchMedia(false);
});

describe("SearchRadar", () => {
  it("providers 为空不渲染", () => {
    const { container } = render(<SearchRadar providers={[]} phase="idle" />);
    expect(container.querySelector("[data-testid='search-radar']")).toBeNull();
  });

  it("检索中不写 0 条，完成才带条数", () => {
    render(
      <SearchRadar
        providers={[
          { id: "a", label: SEARCH_LABEL, status: "running", resultCount: 0 },
          { id: "b", label: "AnySearch", status: "completed", resultCount: 3 },
        ]}
        phase="progress"
      />,
    );
    expect(screen.getByTestId("radar-provider-a").textContent).toContain(SEARCH_RUNNING);
    expect(screen.getByTestId("radar-provider-a").textContent).not.toContain("0 条");
    expect(screen.getByTestId("radar-provider-b").textContent).toContain("3 条");
  });
});
