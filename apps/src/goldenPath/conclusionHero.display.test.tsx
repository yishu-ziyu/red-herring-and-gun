import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConclusionHero } from "./ConclusionHero";
import type { InvestigationSource } from "../lib/investigation";

afterEach(cleanup);

const SOURCES: InvestigationSource[] = Array.from({ length: 8 }, (_, i) => ({
  id: `src-${i}`,
  url: `https://related.example/${i}`,
  title: `相关材料 ${i}`,
  excerpt: "占位摘要",
}));

describe("完成态来源条不压结论", () => {
  it("S1：结论第一句在来源胶囊列表之前，默认不展开墙", () => {
    render(
      <ConclusionHero
        directAnswer="「微波炉可以加热食物」站得住；「微波炉加热食物会致癌」站不住。"
        judgment="mixed"
        boundaries={[]}
        claimCount={2}
        sourceCount={8}
        sources={SOURCES}
      />,
    );
    const hero = document.querySelector(".gp-hero") as HTMLElement;
    const answer = hero.querySelector("[data-gp-direct-answer]") as HTMLElement;
    const strip = hero.querySelector("[data-gp-sources-strip]") as HTMLElement;
    expect(answer).toBeTruthy();
    expect(strip).toBeTruthy();
    expect(answer.compareDocumentPosition(strip) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(strip.querySelector(".gp-hero-sources-list")).toBeNull();
    expect(strip.querySelector(".gp-hero-sources-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(answer.textContent).toContain("微波炉可以加热食物");
  });

  it("S2：点「已查验 N 个信息来源」能展开看到来源", () => {
    render(
      <ConclusionHero
        directAnswer="「微波炉可以加热食物」站得住。"
        judgment="supported"
        boundaries={[]}
        claimCount={1}
        sourceCount={8}
        sources={SOURCES}
      />,
    );
    const toggle = document.querySelector(".gp-hero-sources-toggle") as HTMLButtonElement;
    expect(toggle.textContent).toContain("已查验 8 个信息来源");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".gp-hero-sources-list")).toBeTruthy();
    expect(document.querySelector(".gp-hero-sources-list")?.textContent).toContain("related.example");
  });

  it("解释里的 claim中 / 半截 IA 不上屏", () => {
    render(
      <ConclusionHero
        directAnswer="「长城总长度超过两万公里」站得住。"
        verdictLead="「长城总长度超过两万公里」站得住。"
        rationale="课文已删。claim中「这句话曾被写进无数教科书与科普读物」尚未查清。IA「「微波炉加热食物会致癌」尚未查清，未计入该判断。"
        judgment="mixed"
        boundaries={[]}
        claimCount={1}
        sourceCount={0}
      />,
    );
    const rationale = document.querySelector("[data-gp-rationale]")?.textContent ?? "";
    expect(rationale).not.toMatch(/claim/i);
    expect(rationale).not.toContain("IA「");
    expect(rationale).not.toContain("「「");
    expect(rationale).toContain("尚未查清");
  });
});
