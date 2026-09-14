/**
 * 契约 docs/evals/2026-09-14-investigation-reading-order.md
 * 空等可读、秒数不进标题；命题只在主列出现一次。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { decomposedOnly, investigatingUnassessed, mixedComplete, receivedOnly } from "./fixtures";
import { buildInvestigationSnapshot, type InvestigationSnapshotV1, type PublicActivity } from "../lib/investigation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function canvas(snapshot: InvestigationSnapshotV1, activities: PublicActivity[] = [], live = true) {
  return (
    <InvestigationCanvas
      snapshot={snapshot}
      live={live}
      activities={activities}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

function decomposedActivity(text: string, id: string): PublicActivity {
  return {
    version: 1,
    id,
    runId: "run-read",
    seq: 1,
    occurredAt: "2026-09-14T14:00:00.000Z",
    kind: "claim_decomposed",
    role: "question",
    claimIds: ["claim-1"],
    sourceIds: [],
    snapshotRevision: 1,
    payload: { claimText: text },
  };
}

describe("调查中阅读顺序", () => {
  it("received 空等：思考展开、标题无已等、有阶段说明和灰槽、无准备开始、无假三步", () => {
    vi.useFakeTimers();
    const snapshot = receivedOnly();
    render(canvas(snapshot));
    const box = document.querySelector<HTMLElement>(".gp-thinking-box")!;
    expect(box.classList.contains("is-open")).toBe(true);
    expect(document.querySelector(".gp-thinking-title")!.textContent).toBe(
      "正在把这句话拆成可以单独核对的问题",
    );
    expect(document.querySelector(".gp-thinking-title")!.textContent).not.toContain("已等");
    expect(document.querySelector(".gp-thinking-timer")!.textContent).toMatch(/已等 \d+ 秒/);
    expect(box.textContent).toContain("会按条拆开");
    expect(document.querySelectorAll(".gp-thinking-slots span")).toHaveLength(3);
    expect(box.textContent).not.toContain("结构解析");
    expect(box.textContent).not.toContain("证伪边界");
    expect(box.textContent).not.toContain("确立议程");
    expect(document.querySelector(".gp-thinking-body")!.textContent).not.toContain(snapshot.originalClaim);
    expect(screen.queryByText("已收到这个说法，准备开始。")).toBeNull();
    expect(screen.getByText("拆分问题中")).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(document.querySelector(".gp-thinking-title")!.textContent).toBe(
      "正在把这句话拆成可以单独核对的问题",
    );
    expect(document.querySelector(".gp-thinking-timer")!.textContent).toMatch(/已等 [2-9] 秒/);
  });

  it("checking：标题与角色改成核对，不是拆分问题中", () => {
    render(canvas({ ...receivedOnly(), preClaimWork: "checking" }));
    expect(document.querySelector(".gp-thinking-title")!.textContent).toBe(
      "正在核对刚拆出的说法站不站得住",
    );
    expect(screen.getByText("核对拆出的说法")).toBeTruthy();
    expect(screen.queryByText("拆分问题中")).toBeNull();
    expect(document.querySelector('[data-gp-role="question"]')?.getAttribute("data-gp-role-work")).toBe(
      "checking",
    );
    expect(document.querySelector(".gp-thinking-body")!.textContent).toContain("刚拆出的句子正在过一遍");
  });

  it("命题出来后思考折叠，主列只出现一次，活动流不复述拆题", () => {
    const snapshot = decomposedOnly();
    const atom = snapshot.claims[0]!.text;
    render(
      canvas(snapshot, [
        decomposedActivity(atom, "run-read:1"),
        {
          ...decomposedActivity("开始查找占位", "run-read:2"),
          kind: "search_started",
          role: "source",
          payload: { query: atom },
        },
      ]),
    );

    expect(document.querySelector(".gp-thinking-box")!.classList.contains("is-closed")).toBe(true);
    expect(document.querySelector(".gp-thinking-title")!.textContent).toContain("已拆出 3 个待查问题");
    expect(document.querySelector(".gp-claims .gp-section-label")!.textContent).toBe(
      "这句话被拆成了这些命题",
    );

    const claimNodes = document.querySelectorAll(".gp-claims .gp-claim");
    expect(claimNodes.length).toBe(3);
    const inClaims = document.querySelector(".gp-claims")!.textContent ?? "";
    expect(inClaims.split(atom).length - 1).toBe(1);
    expect(screen.queryByText(`拆出问题：${atom}`)).toBeNull();
    expect(screen.getByText(`开始查找：${atom}`)).toBeTruthy();

    fireEvent.click(document.querySelector<HTMLElement>(".gp-thinking-head")!);
    expect(document.querySelector(".gp-thinking-body")!.textContent).not.toContain(atom);
  });

  it("调查中已开始查找、尚无材料时写正在查找", () => {
    const base = decomposedOnly();
    const snapshot: InvestigationSnapshotV1 = {
      ...base,
      phase: "investigating",
      claims: base.claims.map((claim) => ({ ...claim, progress: "searching" })),
    };
    render(canvas(snapshot));
    expect(screen.getAllByText("正在查找这一条的出处。").length).toBeGreaterThan(0);
    expect(screen.queryByText("还没有可展示的材料。")).toBeNull();
  });

  it("investigating：活动流与原句同列，原句不跨行盖住活动", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");
    expect(css).not.toMatch(/grid-row:\s*1\s*\/\s*span\s*8/);
    expect(css).toMatch(
      /\.gp-canvas\[data-gp-phase="investigating"\] \.gp-activity[\s\S]{0,280}grid-column:\s*1/,
    );
    expect(css).toMatch(/\.gp-canvas\[data-gp-phase="judging"\] \.gp-activity[\s\S]{0,280}grid-column:\s*1/);

    const snapshot = { ...investigatingUnassessed(), phase: "investigating" as const };
    render(
      canvas(snapshot, [
        {
          version: 1,
          id: "run-read:search",
          runId: "run-read",
          seq: 2,
          occurredAt: "2026-09-14T14:00:01.000Z",
          kind: "search_started",
          role: "source",
          claimIds: [snapshot.claims[0]!.id],
          sourceIds: [],
          snapshotRevision: 1,
          payload: { query: snapshot.claims[0]!.text },
        },
      ]),
    );
    const original = document.querySelector(".gp-original");
    const activity = document.querySelector(".gp-activity");
    expect(original).toBeTruthy();
    expect(activity).toBeTruthy();
    expect(original!.compareDocumentPosition(activity!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("原句没进命题的尚缺与过头之处", () => {
  const saltOriginal =
    "中国人人均每天吃盐约10克。高钠是高血压最主要的危险因素。新英格兰医学杂志的试验表明换低钠盐能减少中风。高血压全是吃盐造成的。换成低钠盐就能预防中风。对肾功能完全适用。每天不超过5克。";
  const saltAtoms = [
    "高血压全是吃盐造成的",
    "换成低钠盐就能预防中风",
    "对肾功能完全适用",
    "每天不超过5克",
  ];

  function saltSnap(phase: "complete" | "interrupted"): InvestigationSnapshotV1 {
    const refute = { url: "https://example.org/salt", title: "控盐说明", snippet: "不是全是吃盐" };
    return buildInvestigationSnapshot(
      {
        originalClaim: saltOriginal,
        phase,
        claimAtoms: saltAtoms,
        claimAtomTypes: saltAtoms.map((text) => ({ text, verifiable: true, type: "causal" as const })),
        atomSearchBundle: {
          atomsSearched: saltAtoms,
          byAtomKey: Object.fromEntries(saltAtoms.map((atom) => [atom, [refute]])),
        },
        subclaimVerdicts: saltAtoms.map((claimAtom, index) => ({
          claimAtom,
          verdict: index === 3 ? "true" : "false",
          evidence: "分条材料。",
          boundary: "",
          supportingSources: index === 3 ? [refute] : [],
          contradictingSources: index === 3 ? [] : [refute],
          evidenceGaps: [],
        })),
        report:
          phase === "complete"
            ? { conclusion: "有对有错：5 克那截站住，全是吃盐站不住。", verdictType: "partial" }
            : undefined,
      },
      { claimAtomKeyFn: (s: string) => s.trim() },
    );
  }

  it("中断和完成都交代原句里没查的 10 克、试验", () => {
    for (const phase of ["interrupted", "complete"] as const) {
      const view = render(canvas(saltSnap(phase), [], false));
      const leftover = document.querySelector("[data-gp-leftover-gap]");
      expect(leftover).toBeTruthy();
      expect(leftover!.textContent).toContain("这些这次没查");
      expect(leftover!.textContent).toContain("10克");
      expect(leftover!.textContent).toMatch(/新英格兰|试验/);
      expect(leftover!.textContent).toContain("结论没有拿它们当依据");
      view.unmount();
    }
  });

  it("mixed 无反驳时过头之处在命题卡正文", () => {
    render(canvas(mixedComplete(), [], false));
    const card = document.querySelector('[data-gp-claim-id="claim-1"]');
    expect(card).toBeTruthy();
    const overclaim = card!.querySelector("[data-gp-overclaim]");
    expect(overclaim).toBeTruthy();
    expect(overclaim!.textContent).toContain("过头之处");
    expect(overclaim!.textContent).toContain("不覆盖重症");
    expect(card!.querySelector(".gp-boundary")).toBeNull();
  });
});

describe("相关材料默认收起", () => {
  it("支持和反驳可见，context-only 默认不在主列", () => {
    const atom = "高钠摄入是高血压最主要的危险因素";
    const support = { url: "https://kpzg.people.com.cn/n1/a", title: "只控盐≠控钠", snippet: "重要危险因素" };
    const related = { url: "https://www.yishui.gov.cn/info/1", title: "减盐防控高血压", snippet: "科普" };
    const snapshot = buildInvestigationSnapshot(
      {
        originalClaim: atom,
        phase: "investigating",
        claimAtoms: [atom],
        atomSearchBundle: {
          atomsSearched: [atom],
          byAtomKey: { [atom]: [support, related] },
        },
        subclaimVerdicts: [
          {
            claimAtom: atom,
            verdict: "mixed",
            evidence: "高钠是重要危险因素之一。",
            supportingSources: [support],
            contradictingSources: [],
            evidenceGaps: [],
          },
        ],
      },
      { claimAtomKeyFn: (s: string) => s.trim() },
    );
    render(canvas(snapshot, [], true));
    const head = document.querySelector<HTMLButtonElement>("[data-gp-claim-id] .gp-claim-head");
    if (head?.getAttribute("aria-expanded") === "false") fireEvent.click(head);
    expect(screen.getAllByText("只控盐≠控钠").length).toBeGreaterThan(0);
    expect(document.querySelector("[data-gp-related-collapsed]")).toBeTruthy();
    expect(screen.getByText(/相关材料 1/)).toBeTruthy();
    fireEvent.click(screen.getByText(/相关材料 1/));
    expect(document.querySelector("[data-gp-related-collapsed]")).toBeNull();
    expect(screen.getAllByText("减盐防控高血压").length).toBeGreaterThan(0);
  });
});
