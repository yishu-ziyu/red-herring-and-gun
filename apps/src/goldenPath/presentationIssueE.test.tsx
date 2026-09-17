/**
 * Issue E：真实用户路径。契约 docs/evals/2026-09-15-presentation-issue-e.md
 * 补 #54 机器项：断言命题 / 来源 / 结论 / 缺口对得上，不只检查某个词出现。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { requestOrchestrateStream } from "../lib/agentExpansion";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";
import { sharePreviewContent } from "./ShareControl";
import {
  INVESTIGATING_CLAIM,
  MIXED_ATOM_A,
  MIXED_ATOM_B,
  MIXED_CLAIM,
  SUPPORTED_ATOM,
  SUPPORTED_CLAIM,
  UNRESOLVED_CLAIM,
  investigatingUnassessed,
  interruptedPartial,
  mixedComplete,
  supportedComplete,
  unresolvedComplete,
} from "./fixtures";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return {
    ...actual,
    requestOrchestrateStream: vi.fn(async function* (): AsyncGenerator<OrchestrateStreamEvent> {}),
  };
});

const FAKE_MODELS = [{ provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "high" }];

const SHARE_TOKEN = "tok-e-revoked";
const SHARE_PREVIEW = {
  claim: MIXED_CLAIM,
  createdAt: 1_760_000_000_000,
  checkedAt: "2026-09-06T08:00:00.000Z",
  report: {
    conclusion: "只有前半截有依据且被夸大；后半截站不住。",
    investigation: {
      claims: [{ text: MIXED_ATOM_A }, { text: MIXED_ATOM_B }],
      sources: [
        { title: "维C与普通感冒病程研究", url: "https://journal.example/vc-cold" },
        { title: "输液指征说明", url: "https://health.gov.cn/iv-fact" },
      ],
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sse(events: object[]) {
  return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function formatSavedTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", { hour12: false });
}

function readAnonymousCases(): Array<{ timestamp: number; claim: string; finalReport?: Record<string, unknown> }> {
  const raw = window.localStorage.getItem("red-herring-knowledge-cases:v2:anonymous");
  if (!raw) return [];
  const parsed = JSON.parse(raw) as unknown;
  return Array.isArray(parsed) ? (parsed as Array<{ timestamp: number; claim: string; finalReport?: Record<string, unknown> }>) : [];
}

function stubFetch(options: { accountEmail?: string; caseId?: string; remaining?: number } = {}) {
  const remaining = options.remaining ?? 3;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    if (url.includes("/api/models/health")) return json({ status: "available", message: "" });
    if (url.includes("/api/models/list")) return json({ models: FAKE_MODELS });
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      if (!options.accountEmail) return json({ authenticated: false }, 401);
      return json({
        authenticated: true,
        email: options.accountEmail,
        displayName: "核对人",
        createdAt: 1757000000000,
        loginCount: 1,
        lastLoginAt: 1757000000000,
      });
    }
    if (url.includes("/api/checks/quota")) {
      return json({ remaining, total: remaining, used: 0, kind: options.accountEmail ? "user" : "guest" });
    }
    if (url.includes("share-preview")) return json({ preview: SHARE_PREVIEW });
    if (url.includes("/shares/") && method === "DELETE") return json({ revoked: true });
    if (url.includes("/shares") && method === "POST") {
      return json({ shareId: SHARE_TOKEN, url: `/s/${SHARE_TOKEN}` }, 201);
    }
    if (url.endsWith("/api/case") && method === "POST") {
      return options.caseId ? json({ caseId: options.caseId }) : json({ error: "nope" }, 404);
    }
    if (url.endsWith("/api/cases")) return json({ cases: [] });
    if (/^\/api\/case\/[^/]+$/.test(url)) return new Response("not-found", { status: 404 });
    if (url.includes("/api/investigations/") && url.includes("/events")) {
      return sse([
        { type: "investigation_snapshot", investigation: investigatingUnassessed() },
        { type: "run_state", status: "running" },
      ]);
    }
    return new Response("not-found", { status: 404 });
  });
}

function mockComplete(snapshot: ReturnType<typeof mixedComplete>) {
  vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
    yield { type: "investigation_snapshot", investigation: snapshot } as OrchestrateStreamEvent;
    yield {
      type: "complete",
      finalReport: {
        conclusion: snapshot.conclusion?.directAnswer,
        investigation: snapshot,
      },
    } as OrchestrateStreamEvent;
  });
}

async function submitClaim(text: string) {
  const editor = await screen.findByRole("textbox", { name: "要调查的说法" });
  await waitFor(() => expect(editor).toBeEnabled());
  const send = screen.getByRole("button", { name: /开始调查/ });
  editor.textContent = text;
  fireEvent.input(editor);
  await waitFor(() => expect(send).not.toBeDisabled());
  fireEvent.click(send);
}

function postedCase(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.some(([url, init]) => String(url) === "/api/case" && (init as RequestInit | undefined)?.method === "POST");
}

function resumeGets(fetchMock: ReturnType<typeof stubFetch>) {
  return fetchMock.mock.calls.filter(([url, init]) => {
    const href = String(url);
    const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return method === "GET" && href.includes("/api/investigations/") && href.includes("/events");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.pushState({}, "", "/");
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("提交 → 依据 → 保存 → 重开", () => {
  it("混合说法：命题、摘录、结论对得上；重开日期不变且不重查", async () => {
    const snap = mixedComplete();
    const claimTwo = snap.claims[1]!;
    const sourceTwo = snap.sources.find((source) => source.id === claimTwo.evidence[0]?.sourceId)!;
    mockComplete(snap);
    const fetchMock = stubFetch();
    const view = render(<App />);
    await submitClaim(MIXED_CLAIM);

    const hero = await screen.findByLabelText("调查结论");
    expect(hero.textContent).toContain("只有前半截有依据且被夸大；后半截站不住。");
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')?.textContent).toContain(MIXED_ATOM_A);
    expect(document.querySelector('[data-gp-claim-id="claim-2"]')?.textContent).toContain(MIXED_ATOM_B);
    expect(document.body.textContent).toContain("不覆盖重症");

    const keyTwo = document.querySelector(
      '[data-gp-key-evidence-item][data-gp-key-claim-id="claim-2"]',
    ) as HTMLButtonElement;
    expect(keyTwo).toBeTruthy();
    fireEvent.click(keyTwo);
    const drawer = await waitFor(() => {
      const el = document.querySelector(".gp-drawer--source") as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(drawer.getAttribute("data-gp-claim-id")).toBe(claimTwo.id);
    expect(drawer.textContent).toContain(claimTwo.text);
    expect(drawer.textContent).toContain(sourceTwo.excerpt);
    expect(drawer.querySelector(`a[href="${sourceTwo.url}"]`)).toBeTruthy();
    expect(drawer.textContent).not.toContain(MIXED_ATOM_A);
    expect(drawer.textContent).not.toContain("缩短病程约 8%");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(document.querySelector(".gp-drawer--source")).toBeNull());

    await waitFor(() => expect(document.querySelector('[data-gp-save-status="local"]')).toBeTruthy());
    const saved = readAnonymousCases();
    expect(saved).toHaveLength(1);
    expect(saved[0]!.claim).toBe(MIXED_CLAIM);
    expect((saved[0]!.finalReport?.investigation as { conclusion?: { directAnswer?: string } } | undefined)?.conclusion?.directAnswer).toContain(
      "只有前半截有依据且被夸大",
    );
    const savedAt = saved[0]!.timestamp;
    expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
    expect(postedCase(fetchMock)).toBe(false);

    view.unmount();
    const reopenFetch = stubFetch();
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /历史记录/ }));
    const historyItem = await waitFor(() => {
      const item = document.querySelector(".gp-history-item") as HTMLButtonElement | null;
      expect(item?.textContent).toContain(MIXED_CLAIM);
      return item!;
    });
    fireEvent.click(historyItem);
    const reopened = await screen.findByLabelText("调查结论");
    expect(reopened.textContent).toContain("只有前半截有依据且被夸大；后半截站不住。");
    expect(document.querySelector('[data-gp-claim-id="claim-2"]')?.textContent).toContain(MIXED_ATOM_B);
    expect(document.querySelector(".gp-original-time")?.textContent).toContain(formatSavedTime(savedAt));
    expect(requestOrchestrateStream).toHaveBeenCalledTimes(1);
    expect(postedCase(reopenFetch)).toBe(false);
    expect(readAnonymousCases()[0]!.timestamp).toBe(savedAt);
  });
});

describe("分享确认 / 撤销", () => {
  it("预览只来自脱敏投影；撤销后 /s/ 明确不可用", async () => {
    mockComplete(mixedComplete());
    stubFetch({ accountEmail: "alice@example.com", caseId: "case-e-share" });
    const view = render(<App />);
    await submitClaim(MIXED_CLAIM);
    await screen.findByLabelText("调查结论");
    fireEvent.click(await screen.findByText("创建分享链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-preview]")).toBeTruthy());

    const projected = sharePreviewContent(SHARE_PREVIEW);
    const preview = document.querySelector("[data-gp-share-preview]")!;
    expect(preview.textContent).toContain(projected.claim);
    expect(preview.textContent).toContain(projected.conclusion);
    expect(projected.claims).toEqual([MIXED_ATOM_A, MIXED_ATOM_B]);
    expect(preview.textContent).toContain(MIXED_ATOM_A);
    expect(preview.textContent).toContain(MIXED_ATOM_B);
    expect(screen.getByRole("link", { name: "维C与普通感冒病程研究" })).toHaveAttribute(
      "href",
      "https://journal.example/vc-cold",
    );
    expect(screen.getByRole("link", { name: "输液指征说明" })).toHaveAttribute("href", "https://health.gov.cn/iv-fact");
    expect(preview.textContent).not.toContain("alice@example.com");
    expect(document.body.textContent).toContain("不会公开：账号邮箱");
    expect(document.querySelector("[data-gp-share-url]")).toBeNull();

    fireEvent.click(screen.getByText("生成链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-url]")?.textContent).toContain(`/s/${SHARE_TOKEN}`));
    fireEvent.click(screen.getByText("撤销链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-revoked]")).toBeTruthy());
    expect(document.querySelector("[data-gp-share-revoked]")?.textContent).toContain("已经撤销");

    view.unmount();
    window.history.pushState({}, "", `/s/${SHARE_TOKEN}`);
    stubFetch();
    render(<App />);
    expect(await screen.findByRole("heading", { name: "分享链接不可用" })).toBeInTheDocument();
    expect(screen.getByText(/不存在、已被撤销/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "要调查的说法" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("调查结论")).not.toBeInTheDocument();
    expect(document.querySelector("[data-gp-share-preview]")).toBeNull();
  });
});

describe("刷新恢复", () => {
  it("进行中有指针则 resume GET，不重开、不扣额", async () => {
    window.localStorage.setItem(
      "rhg:active-run",
      JSON.stringify({
        runId: "run-e-resume",
        claim: INVESTIGATING_CLAIM,
        intake: { text: INVESTIGATING_CLAIM, links: [], images: [] },
        lastSeq: 4,
        at: 1_760_000_000_000,
      }),
    );
    const fetchMock = stubFetch({ remaining: 3 });
    render(<App />);

    await waitFor(() => expect(resumeGets(fetchMock).length).toBeGreaterThanOrEqual(1));
    const [resumeUrl, resumeInit] = resumeGets(fetchMock)[0]!;
    expect(String(resumeUrl)).toBe("/api/investigations/run-e-resume/events?after=4");
    expect(((resumeInit as RequestInit | undefined)?.method ?? "GET").toUpperCase()).toBe("GET");
    expect(requestOrchestrateStream).not.toHaveBeenCalled();
    expect(postedCase(fetchMock)).toBe(false);
    expect(
      fetchMock.mock.calls.some(([url, init]) => {
        const href = String(url);
        const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
        return href.includes("orchestrate") && method === "POST";
      }),
    ).toBe(false);
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes("/api/checks/quota")).every(([, init]) => {
        const method = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
        return method === "GET";
      }),
    ).toBe(true);

    await waitFor(() => {
      expect(document.querySelector(".gp-original-text")?.textContent).toBe(INVESTIGATING_CLAIM);
    });
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')?.textContent).toContain("某市下周将试点无人驾驶公交");
    expect(document.querySelector('[data-gp-phase="complete"]')).toBeNull();
    expect(screen.queryByLabelText("调查结论")).toBeNull();
  });
});

describe("五类输入里机器能覆盖的", () => {
  it("无实质争议：结论与来源对上该条事实，不编双方", async () => {
    const snap = supportedComplete();
    mockComplete(snap);
    stubFetch();
    render(<App />);
    await submitClaim(SUPPORTED_CLAIM);
    const hero = await screen.findByLabelText("调查结论");
    expect(hero.textContent).toContain("公开标准大气成分表显示氧气约占 20.9%");
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')?.textContent).toContain(SUPPORTED_ATOM);
    const key = document.querySelector("[data-gp-key-evidence-item]") as HTMLButtonElement;
    fireEvent.click(key);
    const drawer = await waitFor(() => {
      const el = document.querySelector(".gp-drawer--source") as HTMLElement | null;
      expect(el).toBeTruthy();
      return el!;
    });
    expect(drawer.textContent).toContain(SUPPORTED_ATOM);
    expect(drawer.textContent).toContain("氧气 20.9%");
    expect(drawer.querySelector('a[href="https://www.gov.cn/air-composition"]')).toBeTruthy();
    expect(document.body.textContent).not.toContain("支持与反驳双方的分歧");
    expect(document.querySelector(".gp-followup-chip")).toBeNull();
  });

  it("证据不足：无关键依据，缺口与结论对上", async () => {
    const snap = unresolvedComplete();
    mockComplete(snap);
    stubFetch();
    render(<App />);
    await submitClaim(UNRESOLVED_CLAIM);
    const hero = await screen.findByLabelText("调查结论");
    expect(hero.textContent).toContain("公开材料还撑不住这条说法，异味来源仍未查清。");
    expect(document.querySelector("[data-gp-key-evidence]")).toBeNull();
    expect(document.querySelector("[data-gp-gaps-lead]")?.textContent).toContain("待补证");
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')?.textContent).toContain(
      "某小区本月的自来水异味来自新增消毒工艺",
    );
    expect(document.body.textContent).not.toContain("相关材料");
  });

  it("中断：已获命题仍在，不编总判断", async () => {
    const snap = interruptedPartial();
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "investigation_snapshot", investigation: snap } as OrchestrateStreamEvent;
      yield { type: "error", message: "连接中断" } as OrchestrateStreamEvent;
    });
    stubFetch();
    render(<App />);
    await submitClaim(snap.originalClaim);
    expect(await screen.findByText("还没有写成总判断")).toBeInTheDocument();
    expect(document.querySelector("[data-gp-interrupted]")).toBeTruthy();
    expect(document.querySelector('[data-gp-phase="interrupted"]')).toBeTruthy();
    expect(document.querySelector('[data-gp-claim-id="claim-1"]')?.textContent).toContain("某地高铁昨因大风全线停运");
    expect(document.querySelector('[data-gp-claim-id="claim-2"]')?.textContent).toContain("全线停运持续三天");
    expect(screen.queryByLabelText("调查结论")).toBeNull();
    expect(document.body.textContent).not.toContain("只有前半截有依据且被夸大");
  });
});
