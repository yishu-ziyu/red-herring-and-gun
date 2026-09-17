/**
 * App.history.test — 生产 Golden Path 的历史/留存行为（Issue #52 第七节）。
 * 旧三栏壳的同类测试在 legacy/LegacyDesk.test.tsx；本文件驱动真实 ProductShell / InputStage / 画布。
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { requestOrchestrateStream } from "./lib/agentExpansion";
import { createKnowledgeBase } from "./lib/knowledgeBase";
import type { OrchestrateStreamEvent } from "./lib/agentExpansion";

vi.mock("./lib/agentExpansion", async (importOriginal) => ({
  ...await importOriginal<typeof import("./lib/agentExpansion")>(),
  requestOrchestrateStream: vi.fn(async function* (): AsyncGenerator<OrchestrateStreamEvent> {}),
}));

const report = { conclusion: "原调查的直接回答", verdictType: "uncertain", credibilityScore: 50, evidenceChain: [] };

let fetcher: ReturnType<typeof vi.fn>;
let logoutAttempt = 0;

function stubFetch(overrides: {
  authenticated?: boolean;
  cases?: unknown[];
  /** 让 GET /api/cases 永不返回，用来模拟历史加载卡住。 */
  casesHang?: boolean;
  /** GET /api/case/:id 的响应体；传函数可自定义（含挂起 / 拒绝）。 */
  caseDetail?: unknown | (() => Response | Promise<Response>);
  logout?: (attempt: number) => Response | Promise<Response>;
} = {}) {
  logoutAttempt = 0;
  fetcher = vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u === "/api/models/health") {
      return new Response(JSON.stringify({ status: "available", message: "" }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u === "/api/models/list") {
      return new Response(JSON.stringify({ models: [{ provider: "deepseek", model: "deepseek-v4-pro" }] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u === "/api/auth/email/me") {
      return new Response(JSON.stringify(overrides.authenticated ? { authenticated: true, email: "alice@example.com" } : { authenticated: false }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (u === "/api/auth/email/logout") {
      logoutAttempt += 1;
      const out = overrides.logout?.(logoutAttempt);
      if (out) return out;
      return new Response("{}", { status: 200 });
    }
    if (u === "/api/cases") {
      if (overrides.casesHang) return new Promise<Response>(() => {});
      return new Response(JSON.stringify({ cases: overrides.cases ?? [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (/^\/api\/case\/[^/]+$/.test(u)) {
      if (typeof overrides.caseDetail === "function") return (overrides.caseDetail as () => Response | Promise<Response>)();
      if (overrides.caseDetail !== undefined) return new Response(JSON.stringify(overrides.caseDetail), { status: 200, headers: { "Content-Type": "application/json" } });
      return new Response("not-found", { status: 404 });
    }
    return new Response(JSON.stringify({ remaining: 3, total: 3, used: 0, kind: "guest" }), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}

async function submitClaim(text: string) {
  const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
  await waitFor(() => expect(editor).toBeEnabled());
  editor.textContent = text;
  fireEvent.input(editor);
  fireEvent.click(screen.getByRole("button", { name: /开始调查/ }));
}

async function completeFirstRun() {
  await submitClaim("同一句原话");
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(1), { timeout: 5000 });
  await waitFor(() => expect(localStorage.getItem("red-herring-knowledge-cases:v2:anonymous") ?? "").toContain("原调查的直接回答"));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
  vi.mocked(requestOrchestrateStream).mockImplementation(async function* () {
    yield { type: "complete", totalLatencyMs: 1, steps: [], finalReport: report } as OrchestrateStreamEvent;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("匿名结果自动留存；重新打开不重新核查", async () => {
  stubFetch();
  const view = render(<App />);
  await completeFirstRun();

  view.unmount();
  stubFetch();
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("同一句原话"));
  const hero = await screen.findByLabelText("调查结论");
  expect(hero.textContent).toContain("原调查的直接回答");
  expect(screen.getByText(/原调查时间/)).toBeInTheDocument();
  expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls.some(([url, init]) => String(url) === "/api/case" && (init as RequestInit | undefined)?.method === "POST")).toBe(false);
});

it("同一句原话：先问打开旧调查还是重新核查", async () => {
  stubFetch();
  const view = render(<App />);
  await completeFirstRun();

  view.unmount();
  stubFetch();
  render(<App />);
  await submitClaim("同一句原话");
  expect(await screen.findByRole("button", { name: "打开旧调查" })).toBeInTheDocument();
  expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重新核查" }));
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(2));
});

it("本地留存失败必须可见，不静默", async () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith("red-herring-knowledge-cases")) throw new Error("quota");
    setItem.call(this, key, value);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  stubFetch();
  render(<App />);
  await submitClaim("同一句原话");
  expect(await screen.findByRole("alert")).toHaveTextContent("调查自动保存失败");
});

it("退出后移除账户历史；迟到的旧报告响应不渲染", async () => {
  let resolveReport!: (value: Response) => void;
  stubFetch({
    authenticated: true,
    cases: [{ caseId: "alice", claim: "账户私有原句", createdAt: 100 }],
    caseDetail: () => new Promise<Response>((resolve) => { resolveReport = resolve; }),
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("账户私有原句"));
  // /api/case/alice 仍在途时退出账户
  fireEvent.click(await screen.findByRole("button", { name: "我的" }));
  fireEvent.click(await screen.findByText("退出"));
  await screen.findByText("登录");
  await act(async () => {
    resolveReport(new Response(JSON.stringify({ report: { conclusion: "账户私有回答" } }), { status: 200, headers: { "Content-Type": "application/json" } }));
  });
  await waitFor(() => expect(screen.queryByText("账户私有原句")).not.toBeInTheDocument());
  expect(screen.queryByText(/账户私有回答/)).not.toBeInTheDocument();
  expect(requestOrchestrateStream).not.toHaveBeenCalled();
  // 迟到的响应属于上一段账户会话：不提示、不渲染（Change G 只治真正的打开失败）。
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("打开返回 404 的历史条目：给出可见失败提示，条目状态保持原样", async () => {
  stubFetch({ authenticated: true, cases: [{ caseId: "gone", claim: "打不开的历史", status: "done", createdAt: 100 }] });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("打不开的历史"));

  expect(await screen.findByRole("alert")).toHaveTextContent("这条历史暂时打不开");
  expect(requestOrchestrateStream).not.toHaveBeenCalled();

  // 条目状态保持原样：历史抽屉里还在，还是完成态，没有被改写成没查完。
  fireEvent.click(screen.getByRole("button", { name: /历史记录/ }));
  const reopened = await screen.findByText("打不开的历史");
  expect(reopened.closest("button")?.querySelector("[data-gp-case-status]")?.getAttribute("data-gp-case-status")).toBe("done");
});

it("退出账户后迟到的打开失败不提示", async () => {
  let resolveDetail!: (value: Response) => void;
  stubFetch({
    authenticated: true,
    cases: [{ caseId: "alice-gone", claim: "退出前的历史", createdAt: 100 }],
    caseDetail: () => new Promise<Response>((resolve) => { resolveDetail = resolve; }),
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("退出前的历史"));
  // 这一条 /api/case 还在途时退出账户：失败属于上一段会话，不对新会话喊话。
  fireEvent.click(await screen.findByRole("button", { name: "我的" }));
  fireEvent.click(await screen.findByText("退出"));
  await screen.findByText("登录");
  await act(async () => {
    resolveDetail(new Response("not-found", { status: 404 }));
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("打开历史时网络中断：同样给提示，不静默返回", async () => {
  stubFetch({
    authenticated: true,
    cases: [{ caseId: "offline", claim: "断网时的历史", createdAt: 100 }],
    caseDetail: () => Promise.reject(new Error("offline")),
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("断网时的历史"));

  expect(await screen.findByRole("alert")).toHaveTextContent("这条历史暂时打不开");
  // 没打开就不装作打开了：人还停在首页输入。
  expect(screen.getByRole("textbox", { name: "要调查的说法" })).toBeInTheDocument();
});

it("服务端记录读不出可用快照：提示可见，不伪造内容", async () => {
  stubFetch({
    authenticated: true,
    cases: [{ caseId: "broken", claim: "读不出的历史", createdAt: 100 }],
    caseDetail: { claim: "读不出的历史", investigation: { garbage: true } },
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("读不出的历史"));

  expect(await screen.findByRole("alert")).toHaveTextContent("这条历史暂时打不开");
  expect(screen.queryByLabelText("调查结论")).not.toBeInTheDocument();
});

it("打开已留存的账户历史不发起新调查、不重复落库", async () => {
  await createKnowledgeBase("alice@example.com").saveCase({
    id: "saved",
    claim: "账户历史",
    rumorType: "健康",
    diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" },
    finalReport: report,
    handoffSteps: [],
    credibilityScore: 50,
    timestamp: 1000,
    tags: [],
  });
  stubFetch({ authenticated: true, cases: [] });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
  fireEvent.click(await screen.findByText("账户历史"));
  const hero = await screen.findByLabelText("调查结论");
  expect(hero.textContent).toContain("原调查的直接回答");
  expect(document.querySelector(".gp-original-time")?.textContent).toContain(
    new Date(1000).toLocaleString("zh-CN", { hour12: false })
  );
  expect(fetcher.mock.calls.some(([url]) => String(url) === "/api/case")).toBe(false);
  expect(fetcher.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toBe(false);
  expect(requestOrchestrateStream).not.toHaveBeenCalled();
});

it("历史 API 未返回时，非空提交仍发起一次调查，不静默返回", async () => {
  stubFetch({ casesHang: true });
  render(<App />);
  const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
  await waitFor(() => expect(editor).toBeEnabled());
  expect(screen.getByText("正在读取调查历史…")).toBeInTheDocument();
  editor.textContent = "历史还在加载时交来的新说法";
  fireEvent.input(editor);
  await waitFor(() => expect(screen.getByRole("button", { name: /开始调查/ })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: /开始调查/ }));
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(1));
  expect(document.querySelector(".gp-original-text")?.textContent).toBe("历史还在加载时交来的新说法");
});

it("带新链接的提交不做同句继承，直接开始新调查", async () => {
  stubFetch();
  const view = render(<App />);
  await completeFirstRun();

  view.unmount();
  stubFetch();
  render(<App />);
  await submitClaim("同一句原话 https://example.com/new");
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(2), { timeout: 5000 });
  expect(screen.queryByRole("button", { name: "打开旧调查" })).not.toBeInTheDocument();
});

it.each(["http", "network"] as const)("退出失败（%s）保留账户并允许重试", async (failure) => {
  stubFetch({
    authenticated: true,
    logout: (attempt) => {
      if (attempt === 1) {
        if (failure === "network") return Promise.reject(new Error("offline"));
        return new Response("failed", { status: 500 });
      }
      return new Response("{}", { status: 200 });
    },
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "我的" }));
  fireEvent.click(await screen.findByText("退出"));
  expect(await screen.findByRole("alert")).toHaveTextContent("退出失败");
  expect(screen.getByText("alice")).toBeInTheDocument();
  fireEvent.click(screen.getByText("退出"));
  await screen.findByText("登录");
});

it("不存在的分享链接不静默回首页", async () => {
  stubFetch();
  window.history.pushState({}, "", "/s/missing-token");
  render(<App />);
  expect(await screen.findByRole("heading", { name: "分享链接不可用" })).toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: "要调查的说法" })).not.toBeInTheDocument();
});

it("迟到的旧退出成功不覆盖更新的账户操作", async () => {
  let resolveOldLogout!: (value: Response) => void;
  stubFetch({
    authenticated: true,
    logout: (attempt) => {
      if (attempt === 1) return new Promise<Response>((resolve) => { resolveOldLogout = resolve; });
      return new Response("failed", { status: 500 });
    },
  });
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: "我的" }));
  await act(async () => {
    fireEvent.click(await screen.findByText("退出"));
  });
  fireEvent.click(await screen.findByText("退出"));
  await screen.findByRole("alert");
  await act(async () => {
    resolveOldLogout(new Response("{}", { status: 200 }));
  });
  await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
  expect(screen.queryByText("登录")).not.toBeInTheDocument();
});
