import { faceWord } from '@rhg/core/publicCopy';
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell.js";

afterEach(() => {
  cleanup();
});

function renderShell(width: number) {
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
  return render(
    <AppShell
      cases={[{ caseId: "fx-done", text: "done", createdAt: "", updatedAt: "" }]}
      summary={{ face: faceWord("false"), score: 40, status: "已完成" }}
      panel={<p>面板</p>}
      onOpen={() => undefined}
      onHome={() => undefined}
    >
      <p>线程</p>
    </AppShell>,
  );
}

describe("AppShell", () => {
  it("桌面有 nav main aside", () => {
    renderShell(1280);
    expect(document.querySelector("nav")).toBeTruthy();
    expect(document.querySelector("main")).toBeTruthy();
    expect(document.querySelector("aside")).toBeTruthy();
  });

  it("375 下打开面板后 Escape 关闭", () => {
    const { container } = renderShell(375);
    expect(window.innerWidth).toBe(375);
    const shell = container.querySelector(".shell");
    expect(document.querySelector("aside")?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "打开面板" }));
    expect(document.querySelector("aside")?.hidden).toBe(false);
    expect(document.querySelector("aside")?.getAttribute("aria-expanded")).toBe("true");
    expect(shell?.getAttribute("data-panel-open")).toBe("true");
    fireEvent.keyDown(document, { key: "Escape", bubbles: true });
    expect(shell?.getAttribute("data-panel-open")).toBe("false");
    expect(document.querySelector("aside")?.hidden).toBe(true);
  });

  it("所有 button 有文本或 aria-label", () => {
    renderShell(1280);
    const buttons = [...document.querySelectorAll("button")];
    const bare = buttons.filter((button) => !button.textContent?.trim() && !button.getAttribute("aria-label"));
    expect(bare).toHaveLength(0);
  });

  it("摘要栏不含状态词，含 face 与分数", () => {
    for (const width of [375, 900]) {
      const { container, unmount } = renderShell(width);
      const bar = container.querySelector(".shell-summary");
      expect(bar?.textContent).toContain(faceWord("false"));
      expect(bar?.textContent).toContain("40");
      expect(bar?.textContent).not.toMatch(/已完成|正在/);
      expect(screen.getByRole("button", { name: "打开案件列表" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "打开面板" })).toBeTruthy();
      unmount();
    }
  });

  it("面板顶部无状态词", () => {
    const { container } = renderShell(1280);
    const aside = container.querySelector(".shell-aside");
    expect(aside?.querySelector(".status-line")).toBeNull();
    expect(aside?.textContent ?? "").not.toMatch(/已完成|正在/);
  });
});
