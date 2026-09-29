import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { mixedComplete } from "./fixtures";
import type { PublicActivity } from "../lib/investigation";

afterEach(cleanup);

function result() {
  const snapshot = mixedComplete();
  const first = snapshot.claims[0]!;
  const second = snapshot.claims[1]!;
  const firstSource = snapshot.sources.find((source) => source.id === first.evidence[0]?.sourceId)!;
  const secondSource = snapshot.sources.find((source) => source.id === second.evidence[0]?.sourceId)!;
  firstSource.publishedAt = "2025-06-27";
  secondSource.excerpt = "只有搜索结果摘要，尚未核对原网页。";
  first.evidence[0] = { ...first.evidence[0]!, passage: "第一条命题的已核网页原句。", quoteVerified: true };
  second.evidence[0] = { ...second.evidence[0]!, passage: "第二条的相关搜索摘要。", quoteVerified: false };
  return { snapshot, first, second, firstSource, secondSource };
}

describe("完成态按原句逐条读出处", () => {
  it("原句、总答、逐条标题和已核原文顺序可见，摘要只在折叠区", () => {
    const { snapshot, first, second } = result();
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    const original = document.querySelector(".gp-original")!;
    const answer = document.querySelector("[data-gp-direct-answer]")!;
    const claims = document.querySelector(".gp-claims")!;
    expect(original.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(answer.compareDocumentPosition(claims) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(claims.querySelectorAll(".gp-result-claim")).toHaveLength(2);
    expect(claims.textContent).toContain(first.text);
    expect(claims.textContent).toContain(second.text);
    expect(claims.textContent).toContain("第一条命题的已核网页原句。");
    expect(claims.textContent).not.toContain("第二条的相关搜索摘要。");
    const more = document.querySelector("[data-gp-result-remainder]") as HTMLDetailsElement;
    expect(more.open).toBe(false);
    fireEvent.click(more.querySelector("summary")!);
    expect(more.textContent).toContain("材料摘录：第二条的相关搜索摘要。");
    expect(document.querySelector("[data-gp-key-evidence]")).toBeNull();
    expect(document.querySelector("[data-gp-sources-strip]")).toBeNull();
  });

  it("已核原文与实际发表日期同列，打开的是该 claim 的原始 link 与文字定位 URL", async () => {
    const { snapshot, first, firstSource } = result();
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    const row = document.querySelector(`[data-gp-claim-id="${first.id}"] [data-gp-verified-quote]`)!;
    expect(row.textContent).toContain("2025-06-27");
    const url = row.querySelector("a")!.getAttribute("href")!;
    expect(url).toContain(":~:text=");
    expect(decodeURIComponent(url)).toContain("第一条命题的已核网页原句。");
    fireEvent.click(row.querySelector("button")!);
    const drawer = await waitFor(() => document.querySelector(".gp-drawer--source") as HTMLElement);
    expect(drawer.getAttribute("data-gp-claim-id")).toBe(first.id);
    expect(drawer.getAttribute("data-gp-source-id")).toBe(firstSource.id);
    expect(drawer.textContent).toContain("第一条命题的已核网页原句。");
  });

  it("没有已核原文时不显示原文，也不从未核 finding 写肯定解释", () => {
    const { snapshot, second } = result();
    second.evidence[0]!.finding = "搜索摘要说这是真的。";
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    const claim = document.querySelector(`[data-gp-claim-id="${second.id}"]`)!;
    expect(claim.querySelector("[data-gp-verified-quote]")).toBeNull();
    expect(claim.textContent).toContain("这份记录没有保存可核对的原文。");
    expect(claim.textContent).not.toContain("搜索摘要说这是真的");
  });

  it("同一 URL 给第一条已核、第二条仅相关时，折叠区仍能点第二条的关系", async () => {
    const { snapshot, first, second, firstSource } = result();
    second.evidence.push({ sourceId: first.evidence[0]!.sourceId, role: "context-only", passage: "第二条只有相关材料。", quoteVerified: false });
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    const more = document.querySelector("[data-gp-result-remainder]")!;
    fireEvent.click(more.querySelector("summary")!);
    const row = more.querySelector(`[data-gp-evidence-claim="${second.id}"][data-gp-source-id="${firstSource.id}"]`) as HTMLButtonElement;
    expect(row).toBeTruthy();
    expect(row.closest("li")?.textContent).toContain("材料摘录：第二条只有相关材料。");
    fireEvent.click(row);
    const drawer = await waitFor(() => document.querySelector(".gp-drawer--source") as HTMLElement);
    expect(drawer.getAttribute("data-gp-claim-id")).toBe(second.id);
    expect(drawer.getAttribute("data-gp-source-id")).toBe(firstSource.id);
    expect(drawer.textContent).toContain("第二条只有相关材料。");
    expect(drawer.textContent).not.toContain("第一条命题的已核网页原句。");
  });

  it("调查经历只在有公共活动时出现在同一折叠区", () => {
    const { snapshot } = result();
    const activity = {
      version: 1, id: "run:1", runId: "run", seq: 1, occurredAt: "2026-09-11T10:00:00.000Z",
      kind: "search_started", role: "source", claimIds: [], sourceIds: [], snapshotRevision: 1,
      payload: { query: "查询" },
    } as PublicActivity;
    render(<InvestigationCanvas snapshot={snapshot} live={false} activities={[activity]} onReverify={() => {}} onBackHome={() => {}} />);
    expect(document.querySelector("[data-gp-result-remainder] [aria-label='调查经历']")).toBeTruthy();
    expect(document.querySelector("[data-gp-result-remainder]")?.textContent).not.toMatch(/疾控|固定秒数|永久保留|思考全链条/);
  });

  it("没有其余材料、分歧和活动时不显示空折叠栏", () => {
    const { snapshot, firstSource } = result();
    snapshot.sources = [firstSource];
    snapshot.claims[1]!.evidence = [];
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    expect(document.querySelector("[data-gp-result-remainder]")).toBeNull();
  });
});
