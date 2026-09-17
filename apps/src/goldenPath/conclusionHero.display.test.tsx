import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConclusionHero } from "./ConclusionHero";
import type { InvestigationClaim, InvestigationSource } from "../lib/investigation";

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
    expect(hero.querySelector("[data-gp-key-evidence]")).toBeNull();
    expect(strip.querySelector(".gp-hero-sources-list")).toBeNull();
    expect(strip.querySelector(".gp-hero-sources-toggle")?.getAttribute("aria-expanded")).toBe("false");
    expect(answer.textContent).toContain("微波炉可以加热食物");
  });

  it("S2：点「收集到的来源 N」能展开看到来源", () => {
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
    expect(toggle.textContent).toContain("收集到的来源 8");
    expect(toggle.textContent).not.toContain("已查验");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector(".gp-hero-sources-list")).toBeTruthy();
    expect(document.querySelector(".gp-hero-sources-list")?.textContent).toContain("相关材料 0");
    expect(document.querySelector(".gp-hero-sources-list")?.textContent).toContain("https://related.example/0");
  });

  it("混合判断原句原样，不由前端补出更顺口的结论", () => {
    render(
      <ConclusionHero
        directAnswer="这句话里有站住的部分，也有没站住的部分。"
        judgment="mixed"
        boundaries={[]}
        claimCount={2}
        sourceCount={0}
      />,
    );
    const answer = document.querySelector("[data-gp-direct-answer]")?.textContent ?? "";
    expect(answer).toContain("这句话里有站住的部分，也有没站住的部分。");
    expect(answer).not.toContain("核心断言不能成立");
    expect(answer).not.toContain("原句混淆了事实与推论");
  });

  it("顶部来源条用第二条命题的原始 link，不挂到第一条", () => {
    const sourceA: InvestigationSource = {
      id: "src-a",
      url: "https://a.example/one",
      title: "第一条材料",
    };
    const sourceB: InvestigationSource = {
      id: "src-b",
      url: "https://b.example/two",
      title: "第二条材料",
    };
    const claims: InvestigationClaim[] = [
      {
        id: "claim-1",
        text: "第一条命题",
        order: 0,
        checkability: "checkable",
        progress: "complete",
        judgment: "supported",
        evidence: [
          {
            sourceId: "src-a",
            role: "support",
            finding: "第一条发现",
            limitation: "第一条限度",
          },
        ],
        gaps: [],
      },
      {
        id: "claim-2",
        text: "第二条命题",
        order: 1,
        checkability: "checkable",
        progress: "complete",
        judgment: "refuted",
        evidence: [
          {
            sourceId: "src-b",
            role: "contradict",
            finding: "第二条发现",
            limitation: "第二条限度",
          },
        ],
        gaps: [],
      },
    ];
    const onSelectSource = vi.fn();
    render(
      <ConclusionHero
        directAnswer="这句话里有站住的部分，也有没站住的部分。"
        judgment="mixed"
        boundaries={[]}
        claimCount={2}
        sourceCount={2}
        sources={[sourceA, sourceB]}
        claims={claims}
        onSelectSource={onSelectSource}
      />,
    );
    fireEvent.click(document.querySelector(".gp-hero-sources-toggle") as HTMLButtonElement);
    const rowB = document.querySelector('[data-gp-hero-source="src-b"]') as HTMLElement;
    expect(rowB.textContent).toContain("关联命题：第二条命题");
    expect(rowB.textContent).not.toContain("第一条命题");
    fireEvent.click(rowB.querySelector("button") as HTMLButtonElement);
    expect(onSelectSource).toHaveBeenCalledTimes(1);
    const [link, source, claimId] = onSelectSource.mock.calls[0]!;
    expect(claimId).toBe("claim-2");
    expect(source.id).toBe("src-b");
    expect(link.finding).toBe("第二条发现");
    expect(link.limitation).toBe("第二条限度");
    expect(link.sourceId).toBe("src-b");
  });

  it("没有挂命题的来源不伪造关联", () => {
    render(
      <ConclusionHero
        directAnswer="公开材料撑得住。"
        judgment="supported"
        boundaries={[]}
        claimCount={1}
        sourceCount={1}
        sources={[{ id: "orphan", url: "https://orphan.example/", title: "未挂命题的来源" }]}
        claims={[
          {
            id: "claim-1",
            text: "有命题但没挂这条来源",
            order: 0,
            checkability: "checkable",
            progress: "complete",
            judgment: "supported",
            evidence: [],
            gaps: [],
          },
        ]}
      />,
    );
    fireEvent.click(document.querySelector(".gp-hero-sources-toggle") as HTMLButtonElement);
    const row = document.querySelector('[data-gp-hero-source="orphan"]') as HTMLElement;
    expect(row.textContent).toContain("未挂命题的来源");
    expect(row.querySelector("[data-gp-source-claims]")).toBeNull();
    expect(row.textContent).not.toContain("关联命题");
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
