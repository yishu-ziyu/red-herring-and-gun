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

function mockFetch(options: { cases?: unknown[]; caseDetail?: unknown } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
    if (url.includes("/api/models/health")) {
      return new Response(JSON.stringify({ status: "available", message: "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models: FAKE_MODELS }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
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
    expect(screen.getByRole("button", { name: /开始调查/ })).toBeInTheDocument();
    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
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

  it("登出态保留设置入口与登录入口，不挡首次 Golden Path", async () => {
    mockFetch();
    render(<App />);
    const settings = await screen.findByRole("link", { name: "模型设置" });
    expect(settings).toHaveAttribute("href", "/settings/api-key");
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

    // 调查态：原始说法在场 + 命题出现
    expect(await screen.findByText(REFUTED_CLAIM)).toBeInTheDocument();
    await waitFor(() => {
      expect(document.querySelector('[data-gp-phase="complete"]')).toBeTruthy();
    });
    // 完成态第一视觉层级：directAnswer
    const hero = screen.getByLabelText("调查结论");
    expect(hero.textContent).toContain("原句站不住");
    // 仍在同一画布（没换壳）：原始说法卡还在
    expect(screen.getByText(REFUTED_CLAIM)).toBeInTheDocument();
    expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
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
    expect(screen.getByText(REFUTED_CLAIM)).toBeInTheDocument();
    expect(screen.getByText(/原调查时间/)).toBeInTheDocument();
    // 历史打开绝不重新核查
    expect(requestOrchestrateStream).not.toHaveBeenCalled();
  });
});
