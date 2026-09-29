/**
 * 契约 docs/evals/2026-09-15-presentation-issue-b.md
 * 完成态阅读顺序：原句 → 直答 → 逐条判断 → 其余材料/经历 → 追问。
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { FollowUpSection, generateFollowUpSuggestions } from "./FollowUpSection";
import { pickDecisiveEvidence } from "./snapshotUi";
import {
  mixedComplete,
  refutedComplete,
  supportedComplete,
  unresolvedComplete,
} from "./fixtures";
import { buildInvestigationSnapshot, type InvestigationSnapshotV1 } from "../lib/investigation";

afterEach(cleanup);

function renderCanvas(snapshot: InvestigationSnapshotV1) {
  return render(
    <InvestigationCanvas
      snapshot={snapshot}
      live={false}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />,
  );
}

function follows(earlier: Element, later: Element) {
  return Boolean(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("Issue B 完成态阅读顺序", () => {
  it("DOM 顺序：原句 → 直答 → 逐条判断 → 折叠材料 → 追问", () => {
    renderCanvas(mixedComplete());
    const query = document.querySelector(".gp-original")!;
    const answer = document.querySelector("[data-gp-direct-answer]")!;
    const boundary = document.querySelector("[data-gp-boundaries]");
    const claims = document.querySelector(".gp-claims")!;
    const followup = document.querySelector(".gp-followup")!;
    const more = document.querySelector("[data-gp-result-remainder]") as HTMLDetailsElement;

    expect(query).toBeTruthy();
    expect(answer).toBeTruthy();
    expect(follows(query, answer)).toBe(true);
    expect(follows(answer, claims)).toBe(true);
    expect(claims.querySelectorAll(".gp-result-claim")).toHaveLength(2);
    expect(follows(claims, more)).toBe(true);
    expect(more.open).toBe(false);
    expect(follows(claims, followup)).toBe(true);
    expect(document.querySelector("[data-gp-key-evidence]")).toBeNull();
    expect(document.querySelector("[data-gp-sources-strip]")).toBeNull();
    if (boundary) expect(follows(answer, boundary)).toBe(true);
    expect(document.body.textContent).not.toMatch(/能信|不能信|置信/);
  });

  it("无决定性证据时不把相关材料当依据，缺口在直答之后", () => {
    renderCanvas(unresolvedComplete());
    expect(document.querySelector("[data-gp-key-evidence]")).toBeNull();
    expect(document.querySelector("[data-gp-key-evidence-item]")).toBeNull();
    const answer = document.querySelector("[data-gp-direct-answer]")!;
    const gap = document.querySelector(".gp-result-claim .gp-result-gap")!;
    expect(gap.textContent).toContain("待补证");
    expect(follows(answer, gap)).toBe(true);
    expect(document.body.textContent).not.toContain("相关材料");
  });

  it("首条摘要材料在折叠区打开对应来源，claimId 对上", async () => {
    renderCanvas(refutedComplete());
    fireEvent.click(document.querySelector("[data-gp-result-remainder] summary")!);
    const item = document.querySelector('[data-gp-evidence-claim="claim-1"].gp-result-material-link') as HTMLButtonElement;
    expect(item).toBeTruthy();
    fireEvent.click(item);
    const drawer = await waitFor(() => {
      const el = document.querySelector(".gp-drawer--source") as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(drawer.getAttribute("data-gp-claim-id")).toBe("claim-1");
    expect(drawer.querySelector('a[href="https://piyao.org.cn/overnight-water"]')).toBeTruthy();
  });

  it("第二条摘要材料仍保留真实 claimId，不串到第一条", async () => {
    renderCanvas(mixedComplete());
    fireEvent.click(document.querySelector("[data-gp-result-remainder] summary")!);
    const second = document.querySelector('[data-gp-evidence-claim="claim-2"].gp-result-material-link') as HTMLButtonElement;
    expect(second).toBeTruthy();
    fireEvent.click(second);
    const drawer = await waitFor(() => {
      const el = document.querySelector(".gp-drawer--source") as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(drawer.getAttribute("data-gp-claim-id")).toBe("claim-2");
    expect(drawer.textContent).toContain("每次感冒都应当输液");
    expect(drawer.textContent).not.toContain("维生素C能治感冒");
  });
});

describe("Issue B 不把相关材料当关键依据", () => {
  it("只有 context-only 时关键依据为零", () => {
    const atom = "空气里有氮气";
    const snap = buildInvestigationSnapshot(
      {
        originalClaim: atom,
        phase: "complete",
        claimAtoms: [atom],
        atomSearchBundle: {
          atomsSearched: [atom],
          byAtomKey: {
            [atom]: [{ url: "https://related.example/n2", title: "背景科普", snippet: "空气成分介绍" }],
          },
        },
        subclaimVerdicts: [
          {
            claimAtom: atom,
            verdict: "unverified",
            evidence: "",
            supportingSources: [],
            contradictingSources: [],
            evidenceGaps: ["缺一手测量"],
          },
        ],
        report: { conclusion: "公开材料还撑不住。", verdictType: "unverified" },
      },
      { claimAtomKeyFn: (s: string) => s.trim() },
    );
    const related = snap.claims[0]!;
    related.evidence = related.evidence.map((link) => ({ ...link, role: "context-only" as const }));
    expect(pickDecisiveEvidence(snap.claims, snap.sources)).toEqual([]);
    renderCanvas(snap);
    expect(document.querySelector("[data-gp-key-evidence]")).toBeNull();
    expect(document.querySelector(".gp-result-claim .gp-result-gap")?.textContent).toContain("缺一手测量");
  });
});

describe("Issue B 追问不编双方", () => {
  it("无真实分歧的 fixture 不出现双方模板", () => {
    renderCanvas(supportedComplete());
    expect(document.body.textContent).not.toContain("支持与反驳双方的分歧");
    expect(document.body.textContent).not.toContain("支持与反驳双方的核心分歧");
    expect(document.querySelector(".gp-followup-chip")).toBeNull();
    expect(document.querySelector(".gp-followup-input")).toBeTruthy();
  });

  it("没有缺口、争点、未查原句时只留自由输入", () => {
    render(
      <FollowUpSection
        directAnswer="会。"
        originalClaim="空气中氧气约占体积的两成。"
        boundaries={[]}
        claims={supportedComplete().claims}
      />,
    );
    expect(document.querySelector(".gp-followup-chip")).toBeNull();
    expect(document.querySelector(".gp-followup-input")).toBeTruthy();
    expect(generateFollowUpSuggestions("空气中氧气约占体积的两成。", [], supportedComplete().claims)).toEqual([]);
  });
});
