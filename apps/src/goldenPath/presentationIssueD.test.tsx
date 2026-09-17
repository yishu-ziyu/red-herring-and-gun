/**
 * Issue D：首页真实案例、复制简报、历史重开、分享预览。
 * 契约 docs/evals/2026-09-15-presentation-issue-d.md
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { requestOrchestrateStream } from "../lib/agentExpansion";
import type { OrchestrateStreamEvent } from "../lib/agentExpansion";
import { FollowUpSection, buildConclusionBrief } from "./FollowUpSection";
import { InputStage } from "./InputStage";
import { ProductShell } from "./ProductShell";
import { ShareControl, sharePreviewContent } from "./ShareControl";
import { mixedComplete } from "./fixtures";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();
  return {
    ...actual,
    requestOrchestrateStream: vi.fn(async function* (): AsyncGenerator<OrchestrateStreamEvent> {}),
  };
});

function mockFetch() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/models/health")) {
      return new Response(JSON.stringify({ status: "available" }), { status: 200 });
    }
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models: [{ provider: "deepseek", model: "deepseek-v4-pro" }] }), { status: 200 });
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ authenticated: false }), { status: 401 });
    }
    if (url.includes("/api/checks/quota")) {
      return new Response(JSON.stringify({ remaining: 0, total: 1, used: 1, kind: "guest", enforced: true }), { status: 200 });
    }
    if (url.includes("/api/cases")) {
      return new Response(JSON.stringify({ cases: [] }), { status: 200 });
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
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("首页真实案例", () => {
  it("案例卡有原说法、发现、日期和明确标记", () => {
    render(<InputStage onSubmit={vi.fn()} />);
    expect(screen.getByText("生产 fixture · 混合说法")).toBeInTheDocument();
    expect(screen.getByText("生产 fixture · 语境错位")).toBeInTheDocument();
    expect(screen.getByText("生产 fixture · 证据不足")).toBeInTheDocument();
    expect(screen.getByText("维生素C能治感冒，而且每次感冒都应当输液。")).toBeInTheDocument();
    expect(screen.getByText("只有前半截有依据且被夸大；后半截站不住。")).toBeInTheDocument();
    expect(screen.getAllByText(/调查日期/).length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole("button", { name: "查看这次调查" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "用同一说法重新查" })).toHaveLength(3);
  });

  it("查看这次调查不走 onSubmit，例子按钮仍只填输入框", () => {
    const onSubmit = vi.fn();
    const onView = vi.fn();
    const onRecheck = vi.fn();
    render(<InputStage onSubmit={onSubmit} onViewHomeCase={onView} onRecheckHomeCase={onRecheck} />);
    fireEvent.click(screen.getAllByRole("button", { name: "查看这次调查" })[0]);
    expect(onView).toHaveBeenCalledWith("mixed");
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(document.querySelectorAll<HTMLButtonElement>(".gp-example")[0]);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("查看首页案例：无 orchestrate-stream / 模型调用 / 扣额，同一套结果渲染", async () => {
    const fetchMock = mockFetch();
    render(<App />);
    await screen.findByRole("textbox", { name: "要调查的说法" });
    fireEvent.click(screen.getAllByRole("button", { name: "查看这次调查" })[0]);
    const hero = await screen.findByLabelText("调查结论");
    expect(hero.textContent).toContain("只有前半截有依据且被夸大");
    expect(screen.getByText(/原调查时间/)).toBeInTheDocument();
    expect(screen.getByText(/完成于/)).toBeInTheDocument();
    expect(requestOrchestrateStream).not.toHaveBeenCalled();
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).includes("orchestrate-stream"))
    ).toBe(false);
    expect(document.querySelector("[data-gp-phase]")?.getAttribute("data-gp-phase")).toBe("complete");
    expect(document.querySelector("[data-gp-live], .gp-live-pill")).toBeNull();
  });
});

describe("复制简报", () => {
  it("含原句、判断、边界、日期与来源 URL，不用产品署名当证据", () => {
    const brief = buildConclusionBrief({
      originalClaim: mixedComplete().originalClaim,
      directAnswer: "只有前半截有依据且被夸大；后半截站不住。",
      boundaries: ["不覆盖重症"],
      checkedAt: "2026-09-06T08:00:00.000Z",
      sourceUrls: ["https://journal.example/vc-cold", "https://health.gov.cn/iv-fact"],
    });
    expect(brief).toContain("原句：维生素C能治感冒，而且每次感冒都应当输液。");
    expect(brief).toContain("判断：只有前半截有依据且被夸大；后半截站不住。");
    expect(brief).toContain("必要边界：不覆盖重症");
    expect(brief).toContain("核查日期：");
    expect(brief).toContain("https://journal.example/vc-cold");
    expect(brief).toContain("https://health.gov.cn/iv-fact");
    expect(brief).not.toContain("红鲱鱼与枪");
  });

  it("剪贴板失败有可见提示", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      configurable: true,
    });
    render(
      <FollowUpSection
        directAnswer="只有前半截有依据且被夸大；后半截站不住。"
        originalClaim="维生素C能治感冒，而且每次感冒都应当输液。"
        checkedAt="2026-09-06T08:00:00.000Z"
        sourceUrls={["https://journal.example/vc-cold"]}
      />
    );
    fireEvent.click(screen.getByText("复制结论简报"));
    expect(await screen.findByRole("alert")).toHaveTextContent("没能复制到剪贴板");
    expect(screen.queryByText("已复制简报")).not.toBeInTheDocument();
  });
});

describe("分享预览", () => {
  const preview = {
    claim: "隔夜菜会致癌",
    createdAt: 1_760_000_000_000,
    checkedAt: "2026-09-11T10:00:00.000Z",
    report: {
      conclusion: "原句过强。",
      investigation: {
        claims: [{ text: "隔夜菜会直接致癌" }],
        sources: [{ title: "辟谣平台", url: "https://example.org/a" }],
      },
    },
  };

  it("预览字段与 GET 公开投影一致", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url.includes("share-preview")) {
        return new Response(JSON.stringify({ preview }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("{}", { status: 404 });
    });
    render(<ShareControl caseId="case-1" />);
    fireEvent.click(screen.getByText("创建分享链接"));
    await waitFor(() => expect(document.querySelector("[data-gp-share-preview]")).toBeTruthy());
    const view = sharePreviewContent(preview);
    expect(screen.getByText(view.claim)).toBeInTheDocument();
    expect(screen.getByText(view.conclusion)).toBeInTheDocument();
    expect(screen.getByText(view.claims[0]!)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "辟谣平台" })).toHaveAttribute("href", "https://example.org/a");
    expect(document.querySelector("[data-gp-share-url]")).toBeNull();
  });
});

describe("历史范围", () => {
  it("未登录说明本机留存", () => {
    render(
      <ProductShell
        cases={[]}
        activeCaseId={null}
        historyReady
        onNewCase={() => undefined}
        onSelectCase={() => undefined}
        account={null}
        onLoginClick={() => undefined}
        onAccountClick={() => undefined}
        onLogout={() => undefined}
        viewingInvestigation={false}
      >
        <p>child</p>
      </ProductShell>
    );
    fireEvent.click(screen.getByRole("button", { name: /历史记录/ }));
    expect(document.querySelector("[data-gp-history-scope]")?.getAttribute("data-gp-history-scope")).toBe("local");
    expect(screen.getByText(/只留在这台设备的这个浏览器里/)).toBeInTheDocument();
  });
});
