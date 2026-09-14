/**
 * ClaimSection 过程渲染（Change D）与完成态内容补齐（Change E）。
 * 两件都按真实时序验：命题卡在 decomposed 拍就挂载（进度 pending、内容为空），
 * 判词与争点、缺口要到后续快照才补齐。
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildInvestigationSnapshot,
  createActivityLog,
  type InvestigationSnapshotV1,
} from "../lib/investigation";
import { InvestigationCanvas } from "./InvestigationCanvas";

afterEach(() => {
  cleanup();
});

const src = (url: string, title: string, snippet: string) => ({ url, title, snippet });
const noopKey = (s: string) => s.replace(/\u3000/g, " ").trim();

const CLAIM = "隔夜菜会致癌，吃了等于吃毒药。";
const ATOM = "隔夜菜会致癌";
const UNJUDGED_ATOM = "只要冷藏保存，隔夜菜就一定安全";
const SUPPORT_URL = "https://cdc.example.cn/storage-safety";
const CONTRA_URL = "https://course.example.org/poison-terms";
const SUPPORT_SRC = src(SUPPORT_URL, "疾控中心：家庭食品储存与致病菌预防", "不当储存可能滋生致病菌");
const CONTRA_SRC = src(CONTRA_URL, "科普：什么是「毒药」——剂量决定毒性", "脱离剂量的毒性表述不成立");
const GAP = "缺少对常温存放 24 小时以上样本的定向检测数据";
const UNASSESSED_SRC = src(
  "https://diet.example.cn/leftover-guide",
  "膳食指南：隔夜菜冷藏期限与回热建议",
  "冷藏超过 3 天或反复回热仍有风险"
);

const VERDICT = {
  claimAtom: ATOM,
  verdict: "exaggerated",
  evidence: "不当储存确实可能产生有害物质，但「等于吃毒药」夸大了常规食用风险。",
  boundary: "",
  supportingSources: [SUPPORT_SRC],
  contradictingSources: [CONTRA_SRC],
  evidenceGaps: [GAP],
};

function snapshot(input: Record<string, unknown>): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(input as Parameters<typeof buildInvestigationSnapshot>[0], {
    claimAtomKeyFn: noopKey,
  });
}

/** 挂载拍：decomposed——命题已在，内容还是空的（progress=pending）。 */
function mountSnapshot(): InvestigationSnapshotV1 {
  return snapshot({
    originalClaim: CLAIM,
    phase: "decomposed",
    claimAtoms: [ATOM, UNJUDGED_ATOM],
    claimAtomTypes: [
      { text: ATOM, verifiable: true, type: "fact" },
      { text: UNJUDGED_ATOM, verifiable: true, type: "fact" },
    ],
  });
}

/** judging 拍：判词落地，争点与缺口成形，但整页还没完成。 */
function judgingSnapshot(): InvestigationSnapshotV1 {
  return snapshot({
    originalClaim: CLAIM,
    phase: "judging",
    claimAtoms: [ATOM, UNJUDGED_ATOM],
    claimAtomTypes: [
      { text: ATOM, verifiable: true, type: "fact" },
      { text: UNJUDGED_ATOM, verifiable: true, type: "fact" },
    ],
    atomSearchBundle: {
      atomsSearched: [ATOM, UNJUDGED_ATOM],
      byAtomKey: {
        [ATOM]: [SUPPORT_SRC, CONTRA_SRC],
        [UNJUDGED_ATOM]: [UNASSESSED_SRC],
      },
    },
    subclaimVerdicts: [VERDICT],
  });
}

/** complete 拍：claim id 与挂载拍相同，内容补齐。 */
function completeSnapshot(): InvestigationSnapshotV1 {
  return snapshot({
    originalClaim: CLAIM,
    phase: "complete",
    claimAtoms: [ATOM, UNJUDGED_ATOM],
    claimAtomTypes: [
      { text: ATOM, verifiable: true, type: "fact" },
      { text: UNJUDGED_ATOM, verifiable: true, type: "fact" },
    ],
    atomSearchBundle: {
      atomsSearched: [ATOM],
      byAtomKey: { [ATOM]: [SUPPORT_SRC, CONTRA_SRC] },
    },
    subclaimVerdicts: [VERDICT],
    report: {
      conclusion: "现有证据不支持「隔夜菜会致癌，吃了等于吃毒药」。",
      verdictType: "mixed_misleading",
      citationSources: [SUPPORT_SRC, CONTRA_SRC],
    },
  });
}

function canvas(snapshotValue: InvestigationSnapshotV1, live = false) {
  return (
    <InvestigationCanvas
      snapshot={snapshotValue}
      live={live}
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

describe("Change D：调查过程中渲染争点与「尚缺」", () => {
  it("judging 拍争点两侧与缺口行都在 DOM，活动流点分歧在过程中有落点", () => {
    const work = judgingSnapshot();
    const activities = createActivityLog({ runId: "claim-section-d" }).project(null, work);
    expect(activities.some((item) => item.kind === "conflict_detected")).toBe(true);

    render(
      <InvestigationCanvas
        snapshot={work}
        live
        activities={activities}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );

    const conflict = document.querySelector<HTMLElement>('[data-gp-claim-id="claim-1"] .gp-conflict');
    expect(conflict).toBeTruthy();
    expect(document.querySelectorAll('[data-gp-conflict-side="support"]').length).toBe(1);
    expect(document.querySelectorAll('[data-gp-conflict-side="contradict"]').length).toBe(1);

    const gaps = document.querySelector('[data-gp-claim-id="claim-1"] .gp-gaps');
    expect(gaps).toBeTruthy();
    expect(gaps!.textContent).toContain(GAP);

    // 过程里点「发现分歧」：活动流按钮跳转的落点必须真的含有争点块（不再无处可跳）。
    const jump = document.querySelector<HTMLElement>(".gp-activity-line.is-jump");
    expect(jump).toBeTruthy();
    fireEvent.click(jump!);
    const landed = document.querySelector<HTMLElement>(".is-target-highlight");
    expect(landed).toBeTruthy();
    expect(landed!.contains(conflict!)).toBe(true);
  });

  it("decomposed 拍挂载、judging 拍补齐：过程中点开命题卡就能看到争点与缺口", () => {
    const view = render(canvas(mountSnapshot(), true));
    // 挂载拍内容还是空的：争点与缺口都还没有对象。
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-conflict')).toBeNull();
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-gaps')).toBeNull();

    const work = judgingSnapshot();
    const activities = createActivityLog({ runId: "claim-section-d-realtime" }).project(null, work);
    view.rerender(
      <InvestigationCanvas
        snapshot={work}
        live
        activities={activities}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );

    // 真实走查第 4 步的动作：用户在调查中点开命题卡。
    const head = document.querySelector<HTMLElement>('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-conflict')).toBeTruthy();
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-gaps')!.textContent).toContain(GAP);
  });

  it("完成态争点与缺口不回退：都还在，只是换成完成态措辞", () => {
    render(canvas(completeSnapshot()));
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-conflict')).toBeTruthy();
    expect(document.querySelector('[data-gp-claim-id="claim-1"] .gp-gaps')).toBeTruthy();
  });
});

describe("Change E：完成态内容补齐后展开生效", () => {
  it("decomposed 拍挂载（内容空、未展开），complete 拍补齐后同一张卡展开", () => {
    const view = render(canvas(mountSnapshot()));
    const mounted = document.querySelector<HTMLElement>('[data-gp-claim-id="claim-1"]')!;
    expect(mounted.querySelector(".gp-claim-head")!.getAttribute("aria-expanded")).toBe("false");
    expect(mounted.querySelector(".gp-claim-detail")).toBeNull();

    view.rerender(canvas(completeSnapshot()));
    const after = document.querySelector<HTMLElement>('[data-gp-claim-id="claim-1"]')!;
    expect(after).toBe(mounted);
    expect(after.querySelector(".gp-claim-head")!.getAttribute("aria-expanded")).toBe("true");
    expect(after.querySelector(".gp-claim-detail")).toBeTruthy();
    expect(after.querySelector('[data-gp-role="support"]')).toBeTruthy();
    expect(after.querySelector(".gp-gaps")!.textContent).toContain(GAP);
  });

  it("过程里手动收起的卡，完成态补齐内容后按完成态默认展开（明细可达优先）", () => {
    const view = render(canvas(judgingSnapshot(), true));
    const head = document.querySelector<HTMLElement>('[data-gp-claim-id="claim-1"] .gp-claim-head')!;
    expect(head.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(head);
    expect(head.getAttribute("aria-expanded")).toBe("false");

    view.rerender(canvas(completeSnapshot()));
    expect(
      document.querySelector('[data-gp-claim-id="claim-1"] .gp-claim-head')!.getAttribute("aria-expanded")
    ).toBe("true");
  });

  it("完成态：多主张都尚未查清时标签不是证据反驳，空壳折进一条尚缺", () => {
    const a = "长城是古代军事防御工程";
    const b = "长城能从太空用肉眼看到";
    const c = "蜿蜒于中国北方的群山之间";
    const snap = snapshot({
      originalClaim: `${a}。${b}。${c}。`,
      phase: "complete",
      claimAtoms: [a, b, c],
      claimAtomTypes: [
        { text: a, verifiable: true, type: "fact" },
        { text: b, verifiable: true, type: "fact" },
        { text: c, verifiable: true, type: "fact" },
      ],
      subclaimVerdicts: [
        { claimAtom: a, verdict: "unverified", evidence: "", boundary: "", supportingSources: [], contradictingSources: [], evidenceGaps: ["检索预算未覆盖"] },
        { claimAtom: b, verdict: "unverified", evidence: "", boundary: "模型未覆盖，待补证", supportingSources: [], contradictingSources: [], evidenceGaps: [] },
        { claimAtom: c, verdict: "unverified", evidence: "", boundary: "", supportingSources: [], contradictingSources: [], evidenceGaps: ["检索预算未覆盖"] },
      ],
      report: {
        conclusion: "公开材料不支持这条说法。「长城是古代军事防御工程」尚未查清，未计入该判断。",
        verdictType: "false",
      },
    });
    render(canvas(snap));
    expect(document.querySelector("[data-gp-conclusion-judgment]")?.getAttribute("data-gp-conclusion-judgment")).toBe(
      "unresolved"
    );
    expect(document.body.textContent).not.toContain("证据反驳");
    expect(document.querySelectorAll("[data-gp-claim-id]").length).toBe(0);
    expect(document.querySelectorAll(".gp-claim-empty").length).toBe(0);
    const leftover = document.querySelector("[data-gp-leftover-gap]");
    expect(leftover).toBeTruthy();
    expect(leftover!.textContent).toContain("结论没有拿它们当依据");
    expect(leftover!.textContent).not.toContain("检索预算未覆盖");
    expect(leftover!.textContent).not.toContain("模型未覆盖");
  });

  it("完成态正当的证据不足卡还在，不跟空尾巴一起藏", () => {
    const atom = "某小区本月的自来水异味来自新增消毒工艺";
    const leftover = "蜿蜒于中国北方的群山之间";
    const snap = snapshot({
      originalClaim: `${atom}。${leftover}。`,
      phase: "complete",
      claimAtoms: [atom, leftover],
      claimAtomTypes: [
        { text: atom, verifiable: true, type: "causal" },
        { text: leftover, verifiable: true, type: "fact" },
      ],
      atomSearchBundle: { atomsSearched: [atom], byAtomKey: { [atom]: [] } },
      subclaimVerdicts: [
        {
          claimAtom: atom,
          verdict: "unverified",
          evidence: "",
          boundary: "",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: ["该原子定向检索无结果，待补证"],
        },
        {
          claimAtom: leftover,
          verdict: "unverified",
          evidence: "",
          boundary: "",
          supportingSources: [],
          contradictingSources: [],
          evidenceGaps: ["检索预算未覆盖"],
        },
      ],
      report: { conclusion: "公开材料还撑不住这条说法，异味来源仍未查清。", verdictType: "unverified" },
    });
    render(canvas(snap));
    const kept = document.querySelector('[data-gp-claim-id="claim-1"]')!;
    expect(kept).toBeTruthy();
    expect(kept.textContent).toContain("证据不足");
    expect(kept.textContent).toContain("定向检索无结果");
    expect(document.querySelector('[data-gp-claim-id="claim-2"]')).toBeNull();
    expect(document.querySelector("[data-gp-leftover-gap]")!.textContent).toContain(leftover);
  });

  it("背景事实站住 + 流传说法站不住：结论按条说，标签是有对有错", () => {
    const stand = "长城是古代军事防御工程";
    const rumor = "长城能从太空用肉眼看到";
    const supportUrl = "https://ncha.example/wall";
    const contraUrl = "https://nasa.example/visibility";
    const snap = snapshot({
      originalClaim: `${stand}。${rumor}。`,
      phase: "complete",
      claimAtoms: [stand, rumor],
      claimAtomTypes: [
        { text: stand, verifiable: true, type: "fact" },
        { text: rumor, verifiable: true, type: "fact" },
      ],
      atomSearchBundle: {
        atomsSearched: [stand, rumor],
        byAtomKey: {
          [stand]: [src(supportUrl, "文物局", "古代军事防御")],
          [rumor]: [src(contraUrl, "航天观测", "肉眼不可见")],
        },
      },
      subclaimVerdicts: [
        {
          claimAtom: stand,
          verdict: "true",
          evidence: "文物局确认其为古代军事防御工程。",
          boundary: "",
          supportingSources: [src(supportUrl, "文物局", "古代军事防御")],
          contradictingSources: [],
          evidenceGaps: [],
        },
        {
          claimAtom: rumor,
          verdict: "false",
          evidence: "航天观测不支持肉眼可见。",
          boundary: "",
          supportingSources: [],
          contradictingSources: [src(contraUrl, "航天观测", "肉眼不可见")],
          evidenceGaps: [],
        },
      ],
      report: {
        conclusion: "「长城是古代军事防御工程」站得住；「长城能从太空用肉眼看到」站不住。",
        verdictType: "false",
        citationSources: [src(supportUrl, "文物局", ""), src(contraUrl, "航天观测", "")],
      },
    });
    render(canvas(snap));
    const hero = document.querySelector("[data-gp-conclusion-judgment]");
    expect(hero?.getAttribute("data-gp-conclusion-judgment")).toBe("mixed");
    expect(hero?.textContent).toContain("站得住");
    expect(hero?.textContent).toContain("站不住");
    expect(hero?.textContent).not.toContain("公开材料不支持这条说法");
    expect(hero?.textContent).toContain("有对有错");
    expect(hero?.textContent).not.toContain("证据反驳");
  });
});
