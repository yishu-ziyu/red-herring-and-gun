import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConclusionHero } from "./ConclusionHero";

afterEach(cleanup);

describe("完成态总答", () => {
  it("总答保持原判词，来源目录和关键依据不再重复逐条材料", () => {
    render(<ConclusionHero directAnswer="这句话里有站住的部分，也有没站住的部分。" judgment="mixed" boundaries={[]} />);
    const hero = document.querySelector(".gp-hero")!;
    expect(hero.querySelector("[data-gp-direct-answer]")?.textContent).toBe("这句话里有站住的部分，也有没站住的部分。");
    expect(hero.querySelector("[data-gp-sources-strip]")).toBeNull();
    expect(hero.querySelector("[data-gp-key-evidence]")).toBeNull();
  });

  it("有判断句和解释时分两层，解释中的模型残留词不上屏", () => {
    render(<ConclusionHero directAnswer="这句话还需要核对。" verdictLead="这句话还需要核对。" rationale="claim中「另一段」尚未查清。" judgment="unresolved" boundaries={[]} />);
    expect(document.querySelector("[data-gp-direct-answer]")?.textContent).toBe("这句话还需要核对。");
    expect(document.querySelector("[data-gp-rationale]")?.textContent).not.toMatch(/claim/i);
    expect(document.querySelector("[data-gp-uncertainty]")?.textContent).toContain("证据还不够");
  });

  it("缺少独立判断句时仍展示 directAnswer，真实边界紧随总答", () => {
    render(<ConclusionHero directAnswer="公开材料支持这条说法。" judgment="supported" boundaries={["只适用于境内航班。"]} />);
    const answer = document.querySelector("[data-gp-direct-answer]")!;
    const boundary = document.querySelector("[data-gp-boundaries]")!;
    expect(answer.textContent).toBe("公开材料支持这条说法。");
    expect(answer.compareDocumentPosition(boundary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
