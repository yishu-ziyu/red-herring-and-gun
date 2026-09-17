/**
 * 追问区与结论页立体呈现测试
 * 对应验收标准 docs/evals/2026-09-12-conclusion-and-followup.md
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { FollowUpSection } from "./FollowUpSection";
import { InvestigationCanvas } from "./InvestigationCanvas";
import { refutedComplete } from "./fixtures";

afterEach(() => {
  cleanup();
});

describe("FollowUpSection 追问组件", () => {
  it("E2: 渲染追问输入框与推荐追问建议胶囊", () => {
    render(
      <FollowUpSection
        directAnswer="现有证据不支持隔夜菜致癌。"
        originalClaim="隔夜菜会致癌，吃了等于吃毒药。"
        boundaries={["冷藏超过三天仍应丢弃"]}
      />
    );

    expect(screen.getByRole("region", { name: "针对结论追问" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/针对此结论追问/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "发送追问" })).toBeInTheDocument();

    const chips = screen.getAllByRole("button").filter((btn) => btn.className.includes("gp-followup-chip"));
    expect(chips.length).toBeGreaterThan(0);
    expect(chips[0]?.textContent).toMatch(/蔬菜|冷藏|加热|限量/);
  });

  it("E3: 追问输入框支持键入并通过点击追问按钮触发回调", () => {
    const handleFollowUp = vi.fn();
    render(
      <FollowUpSection
        onFollowUp={handleFollowUp}
        directAnswer="现有证据不支持隔夜菜致癌。"
        originalClaim="隔夜菜会致癌，吃了等于吃毒药。"
      />
    );

    const input = screen.getByPlaceholderText(/针对此结论追问/);
    fireEvent.change(input, { target: { value: "孕妇可以吃隔夜菜吗？" } });

    const sendBtn = screen.getByRole("button", { name: "发送追问" });
    expect(sendBtn).not.toBeDisabled();
    fireEvent.click(sendBtn);

    expect(handleFollowUp).toHaveBeenCalledWith("孕妇可以吃隔夜菜吗？");
  });

  it("E3-Enter: 追问输入框支持 Enter 快捷键发送", () => {
    const handleFollowUp = vi.fn();
    render(
      <FollowUpSection
        onFollowUp={handleFollowUp}
        directAnswer="现有证据不支持隔夜菜致癌。"
        originalClaim="隔夜菜会致癌，吃了等于吃毒药。"
      />
    );

    const input = screen.getByPlaceholderText(/针对此结论追问/);
    fireEvent.change(input, { target: { value: "二次微波加热是否安全？" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    expect(handleFollowUp).toHaveBeenCalledWith("二次微波加热是否安全？");
  });

  it("E4: 点击推荐追问胶囊先填入输入框，确认后才发送", () => {
    const handleFollowUp = vi.fn();
    render(
      <FollowUpSection
        onFollowUp={handleFollowUp}
        directAnswer="现有证据不支持隔夜菜致癌。"
        originalClaim="隔夜菜会致癌，吃了等于吃毒药。"
        leftoverTexts={["冷藏隔夜菜还能放多久"]}
      />
    );

    const chips = screen.getAllByRole("button").filter((btn) => btn.className.includes("gp-followup-chip"));
    expect(chips.length).toBeGreaterThan(0);
    const question = chips[0]!.querySelector(".gp-followup-chip-text")!.textContent!.trim();
    expect(chips[0]!.getAttribute("aria-label")).toBe(`将「${question}」填入追问输入框`);

    // 点胶囊：只填入输入框并把焦点交给它，不发出追问。
    fireEvent.click(chips[0]!);
    const input = screen.getByPlaceholderText(/针对此结论追问/) as HTMLTextAreaElement;
    expect(input.value).toBe(question);
    expect(document.activeElement).toBe(input);
    expect(handleFollowUp).not.toHaveBeenCalled();

    // 确认（Enter）后才发出，且发的是胶囊里那个问题。
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    expect(handleFollowUp).toHaveBeenCalledTimes(1);
    expect(handleFollowUp).toHaveBeenCalledWith(question);
  });

  it("元问句不是事实缺口：『真的假的』不能生成新的检索追问", () => {
    render(
      <FollowUpSection
        directAnswer="原句有真有假。"
        originalClaim="隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？"
        leftoverTexts={["真的假的"]}
      />
    );

    const chips = screen.queryAllByRole("button").filter((btn) => btn.className.includes("gp-followup-chip"));
    expect(chips).toHaveLength(0);
    expect(document.body.textContent).not.toContain("『真的假的』站得住吗");
    expect(document.body.textContent).not.toContain("「真的假的」站得住吗");
  });
});

describe("P2-1: 窄屏追问占位整段可见", () => {
  it("375px 下 placeholder 折两行：框高给到两行，字号/行高/边框不动", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const css = readFileSync(join(process.cwd(), "src", "goldenPath", "golden-path.css"), "utf8");

    // jsdom 不排版，这里守 CSS 契约；真实数字由浏览器实测：修前 375px clientHeight 30 / scrollHeight 48
    // （placeholder 折两行被切一行），修后 48 / 48。高度 = 2 行 × 1.5em 行高（14px→21px）+ 上下各 3px padding。
    expect(css).toMatch(
      /@media\s*\(max-width:\s*600px\)\s*\{\s*\.gp-followup-input\s*\{[^}]*min-height:\s*calc\(2 \* 1\.5em \+ 6px\)/
    );

    const base = css.match(/\.gp-followup-input\s*\{([^}]*)\}/)![1]!;
    expect(base).toContain("font-size: 14px");
    expect(base).toContain("line-height: 1.5");
  });
});

describe("InvestigationCanvas 结论页整合", () => {
  it("文字重合推测的未覆盖片段不能自动生成 URL 或整段原句追问", () => {
    const snap = refutedComplete();
    // Paraphrased claims do not prove that the unmatched original sentence was never checked.
    snap.originalClaim = "https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？";
    snap.claims = snap.claims.map((claim) => ({ ...claim, text: "存放食物中的成分变化是否构成确定风险" }));
    render(<InvestigationCanvas snapshot={snap} live={false} onReverify={() => {}} onBackHome={() => {}} />);
    const suggestions = [...document.querySelectorAll(".gp-followup-chip")].map((node) => node.textContent ?? "");
    expect(suggestions.length).toBeGreaterThan(0);
    expect(suggestions.join("\n")).not.toMatch(/https?:|weibo|原句里还没查|「真的假的」/);
  });

  it("E1: 完成态正确挂载 ConclusionHero 与 FollowUpSection", () => {
    const snap = refutedComplete();
    const handleFollowUp = vi.fn();
    const handleReverify = vi.fn();

    render(
      <InvestigationCanvas
        snapshot={snap}
        live={false}
        onReverify={handleReverify}
        onBackHome={() => {}}
        onFollowUp={handleFollowUp}
      />
    );

    // 结论卡存在且内容完整
    expect(screen.getByLabelText("调查结论")).toBeInTheDocument();
    expect(screen.getByText(/原句站不住/)).toBeInTheDocument();

    // 追问区存在
    expect(screen.getByRole("region", { name: "针对结论追问" })).toBeInTheDocument();

    // 推荐追问存在
    const chips = screen.getAllByRole("button").filter((btn) => btn.className.includes("gp-followup-chip"));
    expect(chips.length).toBeGreaterThan(0);
  });
});
