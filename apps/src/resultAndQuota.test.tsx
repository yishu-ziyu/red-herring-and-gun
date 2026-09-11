/**
 * ACCEPTANCE A13 / A36。
 *
 * A13：从结果出发，两次点击内看到决定性依据的片段与来源。
 * A36：服务不可用 / 额度不足时不丢用户材料，不擅自新收费。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestigationCanvas } from "./goldenPath/InvestigationCanvas";
import { refutedComplete } from "./goldenPath/fixtures";
import App from "./App";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

describe("A13 两次点击内看到决定性依据", () => {
  it("一次点击材料行就打开来源，片段与出处都在里面", () => {
    render(
      <InvestigationCanvas
        snapshot={refutedComplete()}
        live={false}
        finalReport={null}
        onReverify={() => {}}
        onBackHome={() => {}}
      />
    );
    // 第 1 次点击：结果页上的材料行
    const row = document.querySelector<HTMLElement>(".gp-evidence-item")!;
    expect(row).toBeTruthy();
    fireEvent.click(row);
    const drawer = document.querySelector("[data-gp-source-layer]")!;
    expect(drawer).toBeTruthy();
    // 片段与出处都在抽屉里（不是只有标题）
    expect(drawer.textContent).toContain("官方声明未提及隔夜水致癌");
    expect(drawer.querySelector('a[href="https://piyao.org.cn/overnight-water"]')).toBeTruthy();
    // 结论本身在第一屏，不需要点
    expect(screen.getByLabelText("调查结论")).toBeTruthy();
  });
});

describe("A36 额度不足与服务不可用时保住材料", () => {
  function mockQuota(payload: Record<string, unknown>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : "";
      if (url.includes("/api/models/health")) {
        return new Response(JSON.stringify({ status: "available", message: "" }), { status: 200 });
      }
      if (url.includes("/api/models/list")) {
        // 必须有可用模型，否则会先落到「服务不可用」，测不到额度这一条
        return new Response(
          JSON.stringify({ models: [{ provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek", tier: "high" }] }),
          { status: 200 }
        );
      }
      if (url.includes("/api/checks/quota")) {
        return new Response(JSON.stringify(payload), { status: 200 });
      }
      if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
      }
      if (url.includes("/api/cases")) {
        return new Response(JSON.stringify({ cases: [] }), { status: 200 });
      }
      return new Response("{}", { status: 404 });
    });
  }

  it("访客额度用完：说明白了为什么不能提交，材料还在框里", async () => {
    mockQuota({ remaining: 0, total: 2, used: 2, kind: "guest", enforced: true });
    render(<App />);
    const editor = document.querySelector<HTMLElement>('#claim-input[contenteditable="true"]')!;
    editor.textContent = "这条说法额度用完了也别丢";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    // 点提交才知道额度用完：这时必须说清原因，并给登录入口
    fireEvent.click(await screen.findByText("开始调查"));
    await waitFor(() => expect(document.body.textContent).toContain("今天的免费核查用完了"));
    // 额度不足只是不能提交，材料本身照旧留着
    expect(document.querySelector('#claim-input[contenteditable="true"]')!.textContent).toBe("这条说法额度用完了也别丢");
    expect(document.body.textContent).toContain("登录后每天可查 3 条");
  });

  it("服务不可用：给出失败提示，不把材料清掉", async () => {
    mockQuota({ remaining: 2, total: 2, used: 0, kind: "guest", enforced: false });
    vi.mocked(globalThis.fetch).mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : "";
      if (url.includes("/api/models/health")) {
        return new Response(JSON.stringify({ status: "unavailable", message: "模型服务不可用" }), { status: 200 });
      }
      if (url.includes("/api/checks/quota")) {
        return new Response(JSON.stringify({ remaining: 2, total: 2, used: 0, kind: "guest" }), { status: 200 });
      }
      if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
        return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
      }
      if (url.includes("/api/cases")) return new Response(JSON.stringify({ cases: [] }), { status: 200 });
      if (url.includes("/api/models/list")) return new Response(JSON.stringify({ models: [] }), { status: 200 });
      return new Response("{}", { status: 404 });
    });
    render(<App />);
    const editor = document.querySelector<HTMLElement>('#claim-input[contenteditable="true"]')!;
    editor.textContent = "服务坏了也别丢我";
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    // 对用户说自己的话，不透传供应商文案：「模型服务不可用」这几个字不该出现
    await waitFor(() => expect(document.body.textContent).toContain("调查服务暂时不可用"));
    expect(document.body.textContent).not.toContain("模型服务不可用");
    expect(document.body.textContent).toContain("你的材料还没有提交");
    expect(document.querySelector('#claim-input[contenteditable="true"]')!.textContent).toBe("服务坏了也别丢我");
  });
});
