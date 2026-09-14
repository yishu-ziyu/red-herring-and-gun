/**
 * W1（契约 docs/evals/2026-09-12-evidence-base.md Part 0）：活动流点「发现分歧」的落点
 * 必须先落在争点块本身，争点块不在 DOM 时才回退命题卡。
 * 逗号选择器 `[data-gp-claim-id="X"] .gp-conflict, [data-gp-claim-id="X"]` 做不到这件事：
 * 命题卡是争点块的祖先，文档序里先命中卡片，`.gp-conflict.is-target-highlight` 的脉冲动画
 * 永不触发（golden-path.css:1253）。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { buildInvestigationSnapshot, createActivityLog, type InvestigationSnapshotV1 } from "../lib/investigation";

const CLAIM = "隔夜菜会致癌，吃了等于吃毒药。";
const ATOM = "隔夜菜会致癌";
const SUPPORT_SRC = {
  url: "https://cdc.example.cn/storage-safety",
  title: "疾控中心：家庭食品储存与致病菌预防",
  snippet: "不当储存可能滋生致病菌",
};
const CONTRA_SRC = {
  url: "https://course.example.org/poison-terms",
  title: "科普：什么是「毒药」——剂量决定毒性",
  snippet: "脱离剂量的毒性表述不成立",
};

/** judging 拍：判词落地、争点成形，但整页还没完成（争点块就在 DOM 里）。 */
function judgingSnapshot(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: CLAIM,
      phase: "judging",
      claimAtoms: [ATOM],
      claimAtomTypes: [{ text: ATOM, verifiable: true, type: "fact" }],
      atomSearchBundle: { atomsSearched: [ATOM], byAtomKey: { [ATOM]: [SUPPORT_SRC, CONTRA_SRC] } },
      subclaimVerdicts: [
        {
          claimAtom: ATOM,
          verdict: "exaggerated",
          evidence: "不当储存确实可能产生有害物质，但「等于吃毒药」夸大了常规食用风险。",
          boundary: "",
          supportingSources: [SUPPORT_SRC],
          contradictingSources: [CONTRA_SRC],
          evidenceGaps: [],
        },
      ],
    },
    { claimAtomKeyFn: (s) => s.trim() }
  );
}

function renderJudging() {
  const snapshot = judgingSnapshot();
  const activities = createActivityLog({ runId: "w1-conflict-jump" }).project(null, snapshot);
  expect(activities.some((item) => item.kind === "conflict_detected")).toBe(true);
  render(
    <InvestigationCanvas
      snapshot={snapshot}
      live
      activities={activities}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

const card = () => document.querySelector<HTMLElement>('[data-gp-claim-id="claim-1"]')!;
const conflictOf = (element: HTMLElement) => element.querySelector<HTMLElement>(".gp-conflict");
const jumpLine = () => document.querySelector<HTMLElement>(".gp-activity-line.is-jump")!;

afterEach(cleanup);

describe("W1 活动流跳转争点的落点", () => {
  it("争点块在 DOM 时，高亮落在争点块本身而不是整张命题卡", () => {
    renderJudging();
    const conflict = conflictOf(card())!;
    expect(conflict).toBeTruthy();

    fireEvent.click(jumpLine());

    expect(conflict.classList.contains("is-target-highlight")).toBe(true);
    expect(card().classList.contains("is-target-highlight")).toBe(false);
  });

  it("争点块不在 DOM（卡片收起）时，回退到命题卡", () => {
    renderJudging();
    // 真实路径：用户先把命题卡收起来，争点块随之卸载，再去点活动流那一行。
    fireEvent.click(card().querySelector<HTMLElement>(".gp-claim-head")!);
    expect(conflictOf(card())).toBeNull();

    fireEvent.click(jumpLine());

    expect(card().classList.contains("is-target-highlight")).toBe(true);
  });
});
