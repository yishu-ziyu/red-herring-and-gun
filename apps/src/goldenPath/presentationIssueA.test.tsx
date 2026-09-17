import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { conflictKnownReason, mixedComplete } from "./fixtures";
import type { InvestigationSnapshotV1 } from "../lib/investigation";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return { ...actual, requestOrchestrateStream: vi.fn() };
});

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

function stampExclusiveFindings(snapshot: InvestigationSnapshotV1): InvestigationSnapshotV1 {
  const next: InvestigationSnapshotV1 = {
    ...snapshot,
    claims: snapshot.claims.map((claim) => ({
      ...claim,
      evidence: claim.evidence.map((link) => ({ ...link })),
    })),
  };
  const claimA = next.claims[0]!;
  const claimB = next.claims[1]!;
  claimA.evidence[0] = {
    ...claimA.evidence[0]!,
    finding: "第一条发现：维C只缩短病程。",
    limitation: "第一条限度：不覆盖重症。",
  };
  claimB.evidence[0] = {
    ...claimB.evidence[0]!,
    finding: "第二条发现：普通感冒无输液指征。",
    limitation: "第二条限度：不讨论重症。",
  };
  return next;
}

async function expectDrawerIsClaimTwo() {
  const drawer = await waitFor(() => {
    const el = document.querySelector(".gp-drawer--source") as HTMLElement | null;
    expect(el).toBeTruthy();
    return el!;
  });
  expect(drawer.getAttribute("data-gp-claim-id")).toBe("claim-2");
  expect(drawer.textContent).toContain("每次感冒都应当输液");
  expect(drawer.textContent).toContain("第二条发现：普通感冒无输液指征。");
  expect(drawer.textContent).toContain("第二条限度：不讨论重症。");
  expect(drawer.textContent).not.toContain("维生素C能治感冒");
  expect(drawer.textContent).not.toContain("第一条发现：维C只缩短病程。");
  expect(drawer.textContent).toContain("打开原文");
  expect(drawer.textContent).not.toContain("前往官方原文核验");
  expect(drawer.textContent).not.toContain("已查验");
  return drawer;
}

describe("Issue A 完成态展示", () => {
  it("混合判断快照不由前端补出核心断言不能成立", () => {
    const snap = mixedComplete();
    snap.conclusion = {
      ...snap.conclusion!,
      directAnswer: "这句话里有站住的部分，也有没站住的部分。",
      verdictLead: "这句话里有站住的部分，也有没站住的部分。",
    };
    renderCanvas(snap);
    const answer = document.querySelector("[data-gp-direct-answer]")?.textContent ?? "";
    expect(answer).toContain("这句话里有站住的部分，也有没站住的部分。");
    expect(document.body.textContent).not.toContain("核心断言不能成立");
  });

  it("顶部入口打开第二条命题专属来源，对上第二条 finding/limitation", async () => {
    renderCanvas(stampExclusiveFindings(mixedComplete()));
    const claim2Key = document.querySelector(
      '[data-gp-key-evidence-item][data-gp-key-claim-id="claim-2"]',
    ) as HTMLButtonElement;
    expect(claim2Key).toBeTruthy();
    expect(claim2Key.textContent).not.toContain("维生素C能治感冒");
    fireEvent.click(claim2Key);
    await expectDrawerIsClaimTwo();
  });

  it("命题卡打开第二条命题专属来源，对上第二条 finding/limitation", async () => {
    renderCanvas(stampExclusiveFindings(mixedComplete()));
    const claimB = document.querySelector('.gp-claim[data-gp-claim-id="claim-2"]') as HTMLElement;
    fireEvent.click(claimB.querySelector(".gp-evidence-item") as HTMLButtonElement);
    await expectDrawerIsClaimTwo();
  });

  it("完成态案卷与页面无疾控、固定秒数、永久保留、无条件已查验", () => {
    renderCanvas(conflictKnownReason());
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/疾控|1\.4s|15\.2s|23\.4s|永久保留|权威材料|思考全链条|前往官方原文核验/);
    expect(text).toContain("收集到的来源");
    expect(text).not.toContain("已查验");
  });
});
