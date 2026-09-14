/**
 * 「看不看得懂」机器可检部分（契约 docs/evals/2026-09-13-comprehension.md）。
 * 人评（真人访谈）不在这里。
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { mixedComplete, refutedComplete, supportedComplete } from "./fixtures";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return { ...actual, requestOrchestrateStream: vi.fn() };
});

afterEach(() => {
  cleanup();
});

const FOUR_HATS = /^(能信|不能信|只能信一部分|还查不清)/;

function renderComplete(snapshot: ReturnType<typeof refutedComplete>) {
  return render(
    <InvestigationCanvas
      snapshot={snapshot}
      live={false}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

function leadText(): string {
  return (document.querySelector("[data-gp-direct-answer]")?.textContent ?? "").trim();
}

describe("看不看得懂 · 机器可检", () => {
  it("E1：结论第一句直答原句，不以四个内部词起句", () => {
    renderComplete(refutedComplete());
    const lead = leadText();
    expect(lead.length).toBeGreaterThan(0);
    expect(lead).toMatch(/原句站不住|没有发布过|世界卫生组织/);
    expect(lead).not.toMatch(FOUR_HATS);
    const query = document.querySelector("[data-gp-hero-query]");
    expect(query?.textContent).toContain("世界卫生组织已经宣布喝隔夜水会致癌");
  });

  it("E1：支持态与半真半假也不用四个内部词当第一句", () => {
    renderComplete(supportedComplete());
    expect(leadText()).not.toMatch(FOUR_HATS);
    cleanup();
    renderComplete(mixedComplete());
    expect(leadText()).not.toMatch(FOUR_HATS);
  });

  it("E2：原句可见，解释或问题点可见", () => {
    renderComplete(refutedComplete());
    expect(document.querySelector("[data-gp-hero-query]")?.textContent).toContain("隔夜水");
    const rationale = document.querySelector("[data-gp-rationale]");
    const claim = document.querySelector("[data-gp-claim-id]");
    expect(Boolean(rationale?.textContent?.trim()) || Boolean(claim?.textContent?.trim())).toBe(true);
  });

  it("E3：来源可点开，抽屉里有指向真实网址的链接", () => {
    renderComplete(refutedComplete());
    const hero = screen.getByLabelText("调查结论");
    expect(within(hero).getByText(/原句站不住/)).toBeTruthy();
    const claim = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    const contradictGroup = claim.querySelector('[data-gp-role="contradict"]')!;
    fireEvent.click(within(contradictGroup as HTMLElement).getByText("世卫组织辟谣平台：无此结论"));
    const drawer = document.querySelector(".gp-drawer--source")!;
    const link = drawer.querySelector('a[href="https://piyao.org.cn/overnight-water"]');
    expect(link).toBeTruthy();
    expect(link?.getAttribute("href")).toMatch(/^https?:\/\//);
  });
});
