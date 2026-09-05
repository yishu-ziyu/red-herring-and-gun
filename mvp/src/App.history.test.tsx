import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { requestOrchestrateStream } from "./lib/agentExpansion";
import { createKnowledgeBase } from "./lib/knowledgeBase";
import { useReasoning } from "./store/reasoningStore";

function MemoryProbe() {
  const { state } = useReasoning();
  return <output data-testid="private-memory">{[...state.comments, ...state.followUps].map((entry) => entry.text).join(" / ")}</output>;
}

vi.mock("./components/v3/Dashboard", () => ({ Dashboard: ({ onStartAnalysis }: any) => <><button onClick={() => onStartAnalysis({ text: "同一句原话", links: [], images: [], createdAt: 1 }, {})}>提交原句</button>{["links", "images"].map((kind) => <button key={kind} onClick={() => onStartAnalysis({ text: "同一句原话", links: [], images: [], createdAt: 1, [kind]: [{ id: "new", url: "https://example.com/new", dataUrl: "data:image/png;base64,AA" }] }, {})}>附加{kind}</button>)}</> }));
vi.mock("./components/v3/AppShell", () => ({ AppShell: ({ cases, account, onSelectCase, onLogout, children }: any) => <div><MemoryProbe /><span>{account?.email ?? "匿名用户"}</span>{cases.map((item: any) => <button key={item.id} onClick={() => onSelectCase(item.id)}>历史：{item.claim}</button>)}<button onClick={onLogout}>退出账户</button>{children}</div> }));
vi.mock("./lib/agentExpansion", async (original) => ({ ...await original<typeof import("./lib/agentExpansion")>(), requestOrchestrateStream: vi.fn() }));
const report = { conclusion: "原调查的直接回答", verdictType: "uncertain", credibilityScore: 50, evidenceChain: [] };
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ authenticated: false }), { status: 200 })));
  vi.mocked(requestOrchestrateStream).mockImplementation(async function* () { yield { type: "complete", totalLatencyMs: 1, steps: [], finalReport: report }; });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function complete() {
  await waitFor(() => expect(screen.getByText("提交原句")).toBeEnabled());
  fireEvent.click(await screen.findByText("提交原句"));
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(1), { timeout: 5000 });
  await waitFor(() => expect(localStorage.getItem("red-herring-knowledge-cases:v2:anonymous")).toContain("原调查的直接回答"));
}
it("automatically retains anonymous results across remount and reopens without a new run", async () => {
  const view = render(<App />);
  await complete();
  view.unmount();
  render(<App />);
  fireEvent.click(await screen.findByText("历史：同一句原话"));
  expect(await screen.findByText(/本次未重新核查/)).toHaveTextContent("原调查时间");
  expect((await screen.findAllByText(/原调查的直接回答/)).length).toBeGreaterThan(0);
  expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
});
it("offers an explicit old investigation or new check choice for identical text", async () => {
  const view = render(<App />);
  await complete();
  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByText("提交原句")).toBeEnabled());
  fireEvent.click(await screen.findByText("提交原句"));
  expect(screen.getByRole("button", { name: "打开旧调查" })).toBeInTheDocument();
  expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "重新核查" }));
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(2));
});
it("shows persistence failure in the actual completed workspace", async () => {
  const setItem = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key.startsWith("red-herring-knowledge-cases")) throw new Error("quota");
    setItem.call(this, key, value);
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  render(<App />);
  await waitFor(() => expect(screen.getByText("提交原句")).toBeEnabled());
  fireEvent.click(await screen.findByText("提交原句"));
  expect(await screen.findByRole("alert")).toHaveTextContent("调查自动保存失败");
  vi.restoreAllMocks();
});

it("removes account history on logout and ignores a late report response", async () => {
  let resolveReport!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/email/me") return new Response(JSON.stringify({ authenticated: true, email: "alice@example.com" }));
    if (url === "/api/cases") return new Response(JSON.stringify({ cases: [{ caseId: "alice", claim: "账户私有原句", createdAt: 100 }] }));
    if (url === "/api/case/alice") return new Promise<Response>((resolve) => { resolveReport = resolve; });
    return new Response("{}");
  }));
  render(<App />);
  fireEvent.click(await screen.findByText("历史：账户私有原句"));
  fireEvent.click(screen.getByText("退出账户"));
  await screen.findByText("提交原句");
  resolveReport(new Response(JSON.stringify({ report: { conclusion: "账户私有回答" } })));
  await waitFor(() => expect(screen.queryByText("历史：账户私有原句")).not.toBeInTheDocument());
  expect(screen.queryByText(/账户私有回答/)).not.toBeInTheDocument();
  expect(requestOrchestrateStream).not.toHaveBeenCalled();
});

it("reopening saved account history does not post a fresh investigation", async () => {
  await createKnowledgeBase("alice@example.com").saveCase({ id: "saved", claim: "账户历史", rumorType: "健康", diagnosis: { mixedJudgments: [], ambiguousTerms: [], risk: "", whyNotDirectFactCheck: "" }, finalReport: report, handoffSteps: [], credibilityScore: 50, timestamp: 1000, tags: [] });
  const fetcher = vi.fn(async (url: string) => new Response(JSON.stringify(url === "/api/auth/email/me" ? { authenticated: true, email: "alice@example.com" } : { cases: [] })));
  vi.stubGlobal("fetch", fetcher);
  render(<App />);
  fireEvent.click(await screen.findByText("历史：账户历史"));
  await screen.findByLabelText("核心结论");
  expect(fetcher.mock.calls.some(([url]) => url === "/api/case")).toBe(false);
  expect(requestOrchestrateStream).not.toHaveBeenCalled();
});

it.each(["links", "images"])("checks new %s instead of offering an old text match", async (kind) => {
  const view = render(<App />);
  await complete();
  view.unmount();
  render(<App />);
  await waitFor(() => expect(screen.getByText(`附加${kind}`)).toBeEnabled());
  fireEvent.click(screen.getByText(`附加${kind}`));
  expect(screen.queryByText("打开旧调查")).not.toBeInTheDocument();
  await waitFor(() => expect(requestOrchestrateStream).toHaveBeenCalledTimes(2));
});

it.each(["http", "network"])("keeps the confirmed account when logout fails with %s, and allows retry", async (failure) => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/email/me") return new Response(JSON.stringify({ authenticated: true, email: "alice@example.com" }));
    if (url === "/api/auth/email/logout" && attempts++ === 0) {
      if (failure === "network") throw new Error("offline");
      return new Response("failed", { status: 500 });
    }
    return new Response(JSON.stringify({ cases: [] }));
  }));
  render(<App />);
  await screen.findByText("alice@example.com");
  fireEvent.click(screen.getByText("退出账户"));
  expect(await screen.findByRole("alert")).toHaveTextContent("退出失败");
  expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  expect(screen.queryByText("匿名用户")).not.toBeInTheDocument();
  fireEvent.click(screen.getByText("退出账户"));
  expect(await screen.findByText("匿名用户")).toBeInTheDocument();
});

it("ignores an older logout success after a newer account operation", async () => {
  let resolveOldLogout!: (value: Response) => void;
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/email/me") return new Response(JSON.stringify({ authenticated: true, email: "alice@example.com" }));
    if (url === "/api/auth/email/logout") {
      if (attempts++ === 0) return new Promise<Response>((resolve) => { resolveOldLogout = resolve; });
      return new Response("failed", { status: 500 });
    }
    return new Response(JSON.stringify({ cases: [] }));
  }));
  render(<App />);
  await screen.findByText("alice@example.com");
  fireEvent.click(screen.getByText("退出账户"));
  fireEvent.click(screen.getByText("退出账户"));
  await screen.findByRole("alert");
  await act(async () => { resolveOldLogout(new Response("{}")); });
  await waitFor(() => expect(screen.getByText("alice@example.com")).toBeInTheDocument());
  expect(screen.queryByText("匿名用户")).not.toBeInTheDocument();
});

it("hides private memory until identity resolves and restores the right scope after failed and successful logout", async () => {
  localStorage.setItem("reasoning-v3-comments:v2:account:alice%40example.com", JSON.stringify([{ id: "c", nodeId: "n", text: "Alice 私人评论", createdAt: 1 }]));
  localStorage.setItem("reasoning-v3-followups:v2:anonymous", JSON.stringify([{ id: "f", nodeId: "n", text: "访客追加", timestamp: 1 }]));
  let resolveMe!: (response: Response) => void;
  let resolveLogout!: (response: Response) => void;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/email/me") return new Promise<Response>((resolve) => { resolveMe = resolve; });
    if (url === "/api/auth/email/logout") return new Promise<Response>((resolve) => { resolveLogout = resolve; });
    return new Response(JSON.stringify({ cases: [] }));
  }));
  render(<App />);
  expect(screen.getByTestId("private-memory")).toBeEmptyDOMElement();
  await act(async () => { resolveMe(new Response(JSON.stringify({ authenticated: true, email: "alice@example.com" }))); });
  expect(screen.getByTestId("private-memory")).toHaveTextContent("Alice 私人评论");
  fireEvent.click(screen.getByText("退出账户"));
  expect(screen.getByTestId("private-memory")).toBeEmptyDOMElement();
  await act(async () => { resolveLogout(new Response("failed", { status: 500 })); });
  expect(screen.getByTestId("private-memory")).toHaveTextContent("Alice 私人评论");
  fireEvent.click(screen.getByText("退出账户"));
  await act(async () => { resolveLogout(new Response("{}")); });
  expect(screen.getByTestId("private-memory")).toHaveTextContent("访客追加");
  expect(screen.getByTestId("private-memory")).not.toHaveTextContent("Alice");
});
