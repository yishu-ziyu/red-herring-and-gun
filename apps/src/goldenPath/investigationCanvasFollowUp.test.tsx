/**
 * 追问轮「你调查的说法」原句区（契约 docs/evals/2026-09-12-mainpath-p1.md Change F）。
 * 依据 P0 真实走查 docs/reports/2026-09-12-mainpath-p0/real-notes.md 摩擦 3：
 * real-12-followup-submit-300ms.png 里左栏显示的是 composeFollowUpClaim 拼出的整段，
 * 且那条长 URL 撑破左栏（scrollW 357 / clientW 298）。
 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { buildInvestigationSnapshot, type InvestigationSnapshotV1 } from "../lib/investigation";
import { composeFollowUpClaim, displayFollowUpClaim, FOLLOW_UP_MARKER } from "../lib/composeFollowUpClaim";

const FOLLOW_UP = "不同蔬菜（如叶菜 vs 根茎类）亚硝酸盐残留有何差异？";
const ORIGINAL = "https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？";
const PREVIOUS_ANSWER =
  "公开材料不支持这条说法。「隔夜菜亚硝酸盐含量会超标」尚未查清，未计入该判断。仍缺关键依据：具体食材类别、储存条件（温度、密封性、储存时长）。";

const COMPOSED = composeFollowUpClaim({
  originalClaim: ORIGINAL,
  previousAnswer: PREVIOUS_ANSWER,
  followUp: FOLLOW_UP,
});

const noopKey = (s: string) => s.replace(/\u3000/g, " ").trim();

/** 追问提交后的第一帧：追问已发出，还没有拆题结果（claims = 0）。 */
function followUpJustSubmitted(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot({ originalClaim: COMPOSED, phase: "received" }, { claimAtomKeyFn: noopKey });
}

/** 追问轮拆题到达（real-13-followup-claims-decomposed.png 那一帧）。 */
function followUpDecomposed(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: COMPOSED,
      phase: "investigating",
      claimAtoms: [FOLLOW_UP],
      atomSearchBundle: {
        atomsSearched: [FOLLOW_UP],
        byAtomKey: {
          [FOLLOW_UP]: [
            {
              url: "https://www.gov.cn/gb2762",
              title: "食品中污染物限量",
              snippet: "亚硝酸盐限量按食品类别分列。",
            },
          ],
        },
      },
    },
    { claimAtomKeyFn: noopKey }
  );
}

function renderCanvas(snapshot: InvestigationSnapshotV1) {
  return render(
    <InvestigationCanvas
      snapshot={snapshot}
      live
      finalReport={null}
      onReverify={() => {}}
      onBackHome={() => {}}
    />
  );
}

const originalText = () => document.querySelector<HTMLElement>(".gp-original-text")!;

afterEach(cleanup);

describe("displayFollowUpClaim：追问拼段只留用户那一段（原句区同一份规则）", () => {
  it("含追问标记时只返回标记之前的追问", () => {
    expect(displayFollowUpClaim(COMPOSED)).toBe(FOLLOW_UP);
  });

  it("不含追问标记的原文原样返回", () => {
    expect(displayFollowUpClaim(ORIGINAL)).toBe(ORIGINAL);
  });
});

const MULTI_LINE_FOLLOW_UP =
  "第一行：隔夜菜冷藏后还能吃吗？\n第二行：必须吃的话，回热到什么温度才安全？";

/** 多行追问提交后的挂载帧。 */
function multiLineFollowUpSnapshot(): InvestigationSnapshotV1 {
  return buildInvestigationSnapshot(
    {
      originalClaim: composeFollowUpClaim({
        originalClaim: ORIGINAL,
        previousAnswer: PREVIOUS_ANSWER,
        followUp: MULTI_LINE_FOLLOW_UP,
      }),
      phase: "received",
    },
    { claimAtomKeyFn: noopKey }
  );
}

describe("W2：多行追问整段留在原句区", () => {
  it("两行都要在，不只第一行", () => {
    renderCanvas(multiLineFollowUpSnapshot());
    expect(originalText().textContent).toBe(MULTI_LINE_FOLLOW_UP);
    expect(originalText().textContent).toContain("第二行：必须吃的话");
    expect(originalText().textContent).not.toContain(FOLLOW_UP_MARKER);
    expect(originalText().textContent).not.toContain("原对象：");
    expect(originalText().textContent).not.toContain("上一轮回答：");
  });
});

describe("F 真实时序：追问提交到拆题到达，原句区始终只是用户的问题", () => {
  it("挂载帧（还没有拆题结果）：显示追问原句，不显示拼接段", () => {
    const { rerender } = renderCanvas(followUpJustSubmitted());

    expect(originalText().textContent).toBe(FOLLOW_UP);
    expect(originalText().textContent).not.toContain(FOLLOW_UP_MARKER);
    expect(originalText().textContent).not.toContain("原对象：");
    expect(originalText().textContent).not.toContain("上一轮回答：");
    expect(originalText().textContent).not.toContain("请直接回答这次追问");

    rerender(
      <InvestigationCanvas
        snapshot={followUpDecomposed()}
        live
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );

    expect(originalText().textContent).toBe(FOLLOW_UP);
    expect(document.querySelector(".gp-claim-list")!.textContent).toContain("不同蔬菜");
  });

  it("拆题到达后，命题在追问原句里仍能回指高亮", () => {
    renderCanvas(followUpDecomposed());
    const mark = originalText().querySelector<HTMLElement>("[data-gp-trace-claim]")!;
    expect(mark.textContent).toBe(FOLLOW_UP);
  });

  it("非追问的原文不受影响：整句照旧显示", () => {
    renderCanvas(
      buildInvestigationSnapshot({ originalClaim: ORIGINAL, phase: "received" }, { claimAtomKeyFn: noopKey })
    );
    expect(originalText().textContent).toBe(ORIGINAL);
  });
});

describe("F 溢出：左栏文本按任意字符断行", () => {
  it("追问原句区带 overflow-wrap: anywhere", () => {
    renderCanvas(followUpJustSubmitted());
    expect(originalText().style.getPropertyValue("overflow-wrap")).toBe("anywhere");
  });
});

describe("D 追问结论必须答这句追问 / C 只贴链接", () => {
  it("结论第一句是 IARC 时改写成流行病学追问", () => {
    const claim = composeFollowUpClaim({
      originalClaim: "微波炉加热食物会致癌",
      previousAnswer: "站不住。",
      followUp: "这一说法在流行病学或临床医学中是否有可靠的实验数据支持？",
    });
    const snapshot = buildInvestigationSnapshot(
      {
        originalClaim: claim,
        phase: "complete",
        claimAtoms: ["IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估"],
        report: {
          verdictType: "unverified",
          conclusion: "「IARC对微波辐射的致癌性有独立于Group 2B射频字段的专项评估」站不住。",
        },
      },
      { claimAtomKeyFn: noopKey }
    );
    render(
      <InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />
    );
    const answer = document.querySelector("[data-gp-direct-answer]");
    expect(answer?.textContent).toContain("流行病学");
    expect(answer?.textContent).not.toContain("IARC");
  });

  it("只贴链接且 0 命题：结论说打不开，提示仍在", () => {
    const snapshot = buildInvestigationSnapshot(
      {
        originalClaim: "https://weibo.com/1749990115/P3bF9xY1z",
        phase: "complete",
        report: {
          verdictType: "unverified",
          conclusion: "公开材料还撑不住判断。",
        },
      },
      { claimAtomKeyFn: noopKey }
    );
    render(
      <InvestigationCanvas
        snapshot={snapshot}
        live={false}
        linkUnreachable
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    expect(document.body.textContent).toContain("链接打不开（可能需要登录）");
    expect(document.body.textContent).not.toContain("公开材料还撑不住判断");
  });
});
