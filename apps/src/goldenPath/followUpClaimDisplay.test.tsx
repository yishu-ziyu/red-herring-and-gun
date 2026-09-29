/**
 * W3（契约 docs/evals/2026-09-12-evidence-base.md Part 0）：追问轮内部拼接段在四个显示点
 * 一律裁到用户自己写的部分——原句区、结论卡「待核查说法」、思考过程第一步、复制简报。
 * 裁切规则只有一份：lib/composeFollowUpClaim 的 displayFollowUpClaim。
 */
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { refutedComplete } from "./fixtures";
import { ThinkingDisclosure } from "./ThinkingDisclosure";
import { FollowUpSection } from "./FollowUpSection";
import { buildInvestigationSnapshot } from "../lib/investigation";
import { composeFollowUpClaim, FOLLOW_UP_MARKER } from "../lib/composeFollowUpClaim";

/** 用户自己写的追问，两行——内部拼接段的泄漏与「只留第一行」都会在这里露出来。 */
const USER_ASK = "第一行追问：隔夜菜冷藏后还能吃吗？\n第二行追问：必须吃的话，回热到什么温度才安全？";
const COMPOSED = composeFollowUpClaim({
  originalClaim: "https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？",
  previousAnswer: "公开材料不支持这条说法。仍缺关键依据：具体食材类别、储存条件。",
  followUp: USER_ASK,
});

const LEAKED = [FOLLOW_UP_MARKER, "原对象：", "上一轮回答：", "请直接回答这次追问"];

function expectOnlyUserAsk(shown: string) {
  expect(shown).toBe(USER_ASK);
  for (const leaked of LEAKED) {
    expect(shown).not.toContain(leaked);
  }
}

afterEach(cleanup);

describe("W3 四处统一裁切：追问只显示用户自己写的那一段", () => {
  it("1 原句区（InvestigationCanvas）", () => {
    render(
      <InvestigationCanvas
        snapshot={buildInvestigationSnapshot({ originalClaim: COMPOSED, phase: "received" })}
        live
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );

    expectOnlyUserAsk(document.querySelector<HTMLElement>(".gp-original-text")!.textContent!);
  });

  it("2 完成态原句不在结论卡重复，仍只显示用户追问", () => {
    const snapshot = refutedComplete();
    snapshot.originalClaim = COMPOSED;
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);

    const shown = document.querySelector<HTMLElement>(".gp-original-text")!;
    expectOnlyUserAsk(shown.textContent!);
    expect(document.querySelector("[data-gp-hero-query]")).toBeNull();
    for (const leaked of LEAKED) {
      expect(shown.textContent).not.toContain(leaked);
    }
  });

  it("3 思考过程不回声追问原文、不泄漏内部拼接", () => {
    render(
      <ThinkingDisclosure
        snapshot={buildInvestigationSnapshot({ originalClaim: COMPOSED, phase: "received" })}
        live
      />
    );

    const body = document.querySelector<HTMLElement>(".gp-thinking-body")!;
    expect(body.textContent).not.toContain(USER_ASK);
    expect(body.textContent).not.toContain(COMPOSED);
    for (const leaked of LEAKED) {
      expect(body.textContent).not.toContain(leaked);
    }
  });

  it("4 复制简报（FollowUpSection）", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    render(
      <FollowUpSection directAnswer="现有证据不支持「隔夜菜致癌」。" originalClaim={COMPOSED} />
    );
    fireEvent.click(
      Array.from(document.querySelectorAll<HTMLButtonElement>(".gp-action-btn")).find((btn) =>
        btn.textContent?.includes("复制结论简报")
      )!
    );

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const brief = String(writeText.mock.calls[0][0]);
    expect(brief).toContain(`原句：${USER_ASK}`);
    expect(brief).not.toContain("红鲱鱼与枪");
    for (const leaked of LEAKED) {
      expect(brief).not.toContain(leaked);
    }
  });

  it("非追问的原文在完成态不改写", () => {
    const plain = "隔夜菜会致癌，吃了等于吃毒药。";
    const snapshot = refutedComplete();
    snapshot.originalClaim = plain;
    render(<InvestigationCanvas snapshot={snapshot} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    expect(document.querySelector<HTMLElement>(".gp-original-text")!.textContent).toBe(plain);
  });
});
