import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { requestOrchestrateStream } from "./lib/agentExpansion";
import { refutedComplete, investigatingUnassessed, REFUTED_CLAIM } from "./goldenPath/fixtures";
import type { OrchestrateStreamEvent } from "./lib/agentExpansion";

vi.mock("./lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/agentExpansion")>();
  return {
    ...actual,
    requestOrchestrateStream: vi.fn(async function* (): AsyncGenerator<OrchestrateStreamEvent> {}),
  };
});

const FAKE_MODELS = [
  { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "high", hint: "强推理" },
];

function mockFetch(options: { cases?: unknown[]; caseDetail?: unknown; accountEmail?: string } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
    if (url.includes("/api/models/health")) {
      return new Response(JSON.stringify({ status: "available", message: "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models: FAKE_MODELS }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      if (options.accountEmail) {
        return new Response(
          JSON.stringify({
            authenticated: true,
            email: options.accountEmail,
            displayName: "核对人",
            createdAt: 1757000000000,
            loginCount: 2,
            lastLoginAt: 1757000000000,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ authenticated: false }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/checks/quota")) {
      return new Response(JSON.stringify({ remaining: 1, total: 1, used: 0, kind: "guest" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/cases")) {
      return new Response(JSON.stringify({ cases: options.cases ?? [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.match(/\/api\/case\/[^/]+$/)) {
      if (!options.caseDetail) return new Response("not-found", { status: 404 });
      return new Response(JSON.stringify(options.caseDetail), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response("not-found", { status: 404 });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe("生产首页（输入态）", () => {
  it("5 秒理解路径：主输入 + 开始调查 + 示例；无模型配置字段", async () => {
    mockFetch();
    render(<App />);
    expect(await screen.findByRole("textbox", { name: "要调查的说法" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /这句话.*站得住吗/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /开始调查/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(document.querySelector("[data-gp-roles=home]")).toBeTruthy();
    expect(screen.getByText("拆问题")).toBeInTheDocument();
    expect(screen.getByText("找出处")).toBeInTheDocument();
    expect(screen.getByText("核语境")).toBeInTheDocument();
    expect(screen.getByText("作判断")).toBeInTheDocument();
  });

  it("首页默认无 AI Ping 品牌、无 BatchChecker、无 provider 控制（E3）", async () => {
    mockFetch();
    render(<App />);
    await screen.findByRole("textbox", { name: "要调查的说法" });
    expect(screen.queryByText(/AI Ping/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/批量核查/)).not.toBeInTheDocument();
    const html = document.body.textContent ?? "";
    expect(html).not.toMatch(/RumorDetector|FactChecker|SourceValidator|ReportComposer/);
    expect(html).not.toMatch(/\bprovider\b/i);
    expect(html).not.toMatch(/\bAgent\b/);
  });

  it("登出态进门只留登录入口，不摆模型设置，不挡首次 Golden Path", async () => {
    mockFetch();
    render(<App />);
    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
    // 进门第一眼不出现模型设置（登录后由账号菜单进入 /settings/api-key）。
    expect(screen.queryByRole("link", { name: "模型设置" })).toBeNull();
    expect(screen.queryByText("模型设置")).toBeNull();
  });

  it("登录后账号菜单里仍能进模型设置：进门不摆，但入口不丢", async () => {
    mockFetch({ accountEmail: "checked@example.com" });
    render(<App />);
    const chip = await screen.findByRole("button", { name: "我的" });
    fireEvent.click(chip);
    const settings = await screen.findByRole("menuitem", { name: "模型设置" });
    expect(settings).toHaveAttribute("href", "/settings/api-key");
  });

  it("进门没有重复的「新调查」入口：空白输入态品牌只是名字，不是按钮", async () => {
    mockFetch();
    render(<App />);
    await screen.findByRole("textbox", { name: "要调查的说法" });
    expect(screen.queryByRole("button", { name: /新调查|新查一条/ })).toBeNull();
    // 品牌仍在，但静态渲染。
    expect(document.querySelector(".gp-brand")).toBeTruthy();
    expect(document.querySelector("button.gp-brand")).toBeNull();
  });

  it("进门能看到「查完大概长这样」示意：一句回答 + 帮/拆关系 + 片段，并写明是示意", async () => {    mockFetch();
    render(<App />);
    await screen.findByRole("textbox", { name: "要调查的说法" });
    const preview = document.querySelector("[data-gp-result-preview]") as HTMLElement | null;
    expect(preview).toBeTruthy();
    const text = preview!.textContent ?? "";
    expect(text).toContain("示意");
    expect(text).toContain("不是真结果");
    // 一句直接回答
    expect(text).toContain("不会。维生素 C");
    // 关系可分辨：支持 / 反驳
    expect(preview!.querySelector('[data-gp-preview-relation="support"]')?.textContent).toContain("支持");
    expect(preview!.querySelector('[data-gp-preview-relation="contradict"]')?.textContent).toContain("反驳");
    // 片段沿用诚实口径，不写成逐字原文
    expect(text).toContain("检索片段（非逐字原文）");
    expect(preview!.textContent).not.toContain("原文摘录");
  });

  it("未知路径回落到生产首页", async () => {
    window.history.pushState({}, "", "/dem-o");
    mockFetch();
    render(<App />);
    expect(await screen.findByRole("textbox", { name: "要调查的说法" })).toBeInTheDocument();
  });
});

describe("调查态与完成态（同画布）", () => {
  it("从输入到完成不换壳：investigation_snapshot 出命题，complete 出直接回答", async () => {
    mockFetch();
    const complete = refutedComplete();
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "investigation_snapshot", investigation: investigatingUnassessed() } as OrchestrateStreamEvent;
      yield { type: "investigation_snapshot", investigation: complete } as OrchestrateStreamEvent;
      yield {
        type: "complete",
        finalReport: { conclusion: "原句站不住。", investigation: complete },
      } as OrchestrateStreamEvent;
    });

    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
    editor.textContent = REFUTED_CLAIM;
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: /开始调查/ }));

    // 调查态：原始说法在场 + 命题出现（原句可能被 Claim Trace 分段，按整段 textContent 认）
    await waitFor(() => {
      expect(document.querySelector(".gp-original-text")?.textContent).toBe(REFUTED_CLAIM);
    });
    await waitFor(() => {
      expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy();
    });
    // 完成态第一视觉层级：directAnswer
    const hero = screen.getByLabelText("调查结论");
    expect(hero.textContent).toContain("原句站不住");
    // 仍在同一画布（没换壳）：原始说法卡还在
    expect(document.querySelector(".gp-original-text")?.textContent).toBe(REFUTED_CLAIM);
    expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
  });

  it("完成态仍能回到空白输入：品牌变回可点，点击后回到输入态（首页不放这颗按钮）", async () => {
    mockFetch();
    const complete = refutedComplete();
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "investigation_snapshot", investigation: investigatingUnassessed() } as OrchestrateStreamEvent;
      yield { type: "investigation_snapshot", investigation: complete } as OrchestrateStreamEvent;
      yield {
        type: "complete",
        finalReport: { conclusion: "原句站不住。", investigation: complete },
      } as OrchestrateStreamEvent;
    });

    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
    editor.textContent = REFUTED_CLAIM;
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: /开始调查/ }));

    await waitFor(() => {
      expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy();
    });
    // 结果态才出现「回空白输入」的入口。
    const backHome = await screen.findByRole("button", { name: "新调查" });
    fireEvent.click(backHome);
    expect(await screen.findByRole("textbox", { name: "要调查的说法" })).toBeInTheDocument();
    expect(document.querySelector('[data-gp-phase="complete"]')).toBeNull();
  });

  it("流中断：保留已获命题、无伪结论、可重试", async () => {
    mockFetch();
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "investigation_snapshot", investigation: investigatingUnassessed() } as OrchestrateStreamEvent;
      yield { type: "error", message: "连接中断" } as OrchestrateStreamEvent;
    });

    render(<App />);
    const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
    editor.textContent = "某市下周将试点无人驾驶公交。";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: /开始调查/ }));

    expect(await screen.findByText("这次调查没有完成")).toBeInTheDocument();
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')).toBeTruthy();
    expect(screen.queryByLabelText("调查结论")).toBeNull();
  });
});

describe("历史打开（不重新核查）", () => {
  it("从历史 drawer 打开旧调查：用落库快照渲染同一画布，零 orchestrate 请求", async () => {
    const detail = {
      caseId: "abc12345",
      claim: REFUTED_CLAIM,
      report: { conclusion: "旧报告", investigation: refutedComplete() },
      investigation: refutedComplete(),
      createdAt: 1757000000000,
    };
    mockFetch({ cases: [{ caseId: "abc12345", claim: REFUTED_CLAIM, status: "done", createdAt: 1757000000000 }], caseDetail: detail });

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
    fireEvent.click(await screen.findByText(REFUTED_CLAIM));

    expect(await screen.findByLabelText("调查结论")).toBeTruthy();
    expect(document.querySelector(".gp-original-text")?.textContent).toBe(REFUTED_CLAIM);
    expect(screen.getByText(/原调查时间/)).toBeInTheDocument();
    // 历史打开绝不重新核查
    expect(requestOrchestrateStream).not.toHaveBeenCalled();
  });
});
