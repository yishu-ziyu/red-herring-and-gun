/**
 * LegacyDesk 回归测试：旧三栏壳（Dashboard + MissionControl + ResultView）退出默认路径后，
 * 经 /?legacy=1 仍需完整可用——本文件整体承接原 App.test.tsx。
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LegacyDesk from "./LegacyDesk";
import { requestOrchestrateStream } from "../lib/agentExpansion";

vi.mock("../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/agentExpansion")>();

  return {
    ...actual,
    requestOrchestrateStream: vi.fn(async function* () {
      yield {
        type: "error",
        message: "test stream stopped",
      };
    }),
  };
});

vi.mock("react-resizable-panels", () => ({
  Group: ({ children }: { children?: unknown }) => <div data-testid="desk-shell">{children as never}</div>,
  Panel: ({ children }: { children?: unknown }) => <div>{children as never}</div>,
  Separator: () => null,
  usePanelRef: () => ({ current: { collapse() {}, expand() {}, isCollapsed: () => false } }),
}));

describe("model settings preview", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("keeps model configuration off the home page", () => {
    render(<LegacyDesk />);

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开快捷操作" })).not.toBeInTheDocument();

    const settingsLink = screen.getByRole("link", { name: "模型设置" });
    expect(settingsLink).toHaveAttribute("href", "/settings/api-key");
  });

  it("renders a dedicated provider settings preview page with preset defaults", async () => {
    window.history.pushState({}, "", "/model-settings-preview");

    render(<LegacyDesk />);

    expect(await screen.findByText("模型服务商")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("API 代理地址")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("默认模型")).toHaveValue("deepseek-v4-pro");
  });

  it("updates provider presets without asking the user to configure every field", async () => {
    window.history.pushState({}, "", "/model-settings-preview");

    render(<LegacyDesk />);

    fireEvent.click(await screen.findByRole("button", { name: "360GPT" }));

    expect(screen.getByRole("button", { name: "360GPT" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("API 代理地址")).toHaveValue("https://api.360.cn/v1");
    expect(screen.getByLabelText("默认模型")).toHaveValue("360gpt-pro");
  });
});

describe("removed preview routes", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    mockModelsList(FAKE_MODELS);
  });

  const legacyRoute = (suffix: string) => `/${suffix}`;
  const legacyRouteCases = [
    ["dem", "o"],
    ["shell-", "preview"],
    ["process-", "preview"],
    ["result-", "preview"],
  ].map(([prefix, suffix]) => legacyRoute(prefix + suffix));

  it.each(legacyRouteCases as string[])(
    "%s falls through to the landing desk",
    async (pathname) => {
      window.history.pushState({}, "", pathname);

      render(<LegacyDesk />);

      expect(await screen.findByText("把你想核查的句子、链接或截图放进来")).toBeInTheDocument();
      expect(screen.getByRole("textbox", { name: "你想核查什么？" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "隔夜菜会致癌，等于吃毒药" })).toBeInTheDocument();
      expect(screen.queryByLabelText("核心结论")).not.toBeInTheDocument();
    }
  );
});

describe("real analysis workspace", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
    // Keep launch enabled: PromptInput send is gated on available models.
    mockModelsList([
      { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "high", hint: "强推理" },
      { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "mid", hint: "推荐" },
    ]);
  });

  async function fillClaimInput(text: string) {
    const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
    editor.textContent = text;
    fireEvent.input(editor);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /开始核查/ })).toBeEnabled();
    });
    return editor;
  }

  async function startRealAnalysis() {
    const rendered = render(<LegacyDesk />);

    await fillClaimInput("隔夜菜会致癌，吃了等于吃毒药");
    fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

    expect(await screen.findByTestId("apodex-run")).toBeInTheDocument();
    return rendered;
  }

  it("uses the clean analysis shell for the real workspace too", async () => {
    const { container } = await startRealAnalysis();

    expect(container.querySelector(".case-workbench-view--clean")).not.toBeNull();
    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
    expect(container.querySelector(".case-controller-panel")).toBeNull();
    expect(screen.queryByLabelText("执行画布缩略图")).not.toBeInTheDocument();
  });

  it("starts the real workspace from the stream-driven controller surface", async () => {
    const { container } = await startRealAnalysis();

    expect(await screen.findByTestId("apodex-run")).toBeInTheDocument();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
    expect(container.querySelector(".controller-proof-card")).toBeNull();
    expect(container.querySelector(".controller-prompt-dock")).toBeNull();
    expect(container.querySelector(".mission-agent-icon")).toBeNull();
    expect(screen.queryByText("Agent 思考树")).not.toBeInTheDocument();
  });

  it("shows a compact search line outside thinking, then the verdict below", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "tool_start",
        toolId: "search360",
        toolName: "360 Search",
        query: "隔夜菜 致癌",
      };
      yield {
        type: "tool_result",
        toolId: "search360",
        toolName: "360 Search",
        query: "隔夜菜 致癌",
        result: {
          sourceCount: 2,
          sources: [
            { title: "食品安全与亚硝酸盐科普", url: "https://www.who.int/food" },
            { title: "隔夜菜风险条件说明", url: "https://www.cdc.gov/foodsafety/" },
          ],
        },
      };
      yield {
        type: "complete",
        totalLatencyMs: 800,
        steps: [],
        finalReport: {
          verdictType: "false",
          credibilityLabel: "谣言",
          credibilityScore: 90,
          conclusion: "公开材料不支持整句。",
          recommendation: "不能信。",
          summaryForPublic: "不可靠。",
          whyHardToVerify: [],
          evidenceChain: [],
          closureActions: [],
          confidenceDimensions: [],
        },
      };
    });

    await startRealAnalysis();

    const report = await screen.findByLabelText("核心结论");
    expect(report).toHaveTextContent("公开材料不支持整句");
    expect(report).not.toHaveTextContent("不能信");
    expect(screen.queryByText("sourceCount")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("核查过程"));
    fireEvent.click(screen.getByText("检索网页"));
    expect(screen.getAllByRole("link", { name: "食品安全与亚硝酸盐科普" }).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
  });

  it("keeps 正在检索 as its own line while the stream is still running", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "tool_start",
        toolId: "search360",
        toolName: "360 Search",
        query: "隔夜菜 致癌",
      };
      // F1 语义：流若「结束」而无终态事件会被判为断流失败；
      // 本用例要的是流仍开着——挂起生成器，永不返回
      await new Promise(() => {});
    });

    await startRealAnalysis();

    expect(await screen.findByText("正在检索")).toBeInTheDocument();
    expect(screen.queryByLabelText("核心结论")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /停止/ })).toBeInTheDocument();
  });

  it("separates false-claim confidence from original information credibility", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "complete",
        totalLatencyMs: 1200,
        steps: [],
        finalReport: {
          verdictType: "false",
          credibilityLabel: "谣言",
          credibilityScore: 95,
          conclusion: "该说法没有可靠证据支持，属于不实信息。",
          recommendation: "不能信。",
          summaryForPublic: "这条信息不可靠。",
          whyHardToVerify: [],
          evidenceChain: [],
          closureActions: [],
          confidenceDimensions: [],
        },
      };
    });

    await startRealAnalysis();

    const report = await screen.findByLabelText("核心结论");
    expect(within(report).queryByText(/不能信/)).not.toBeInTheDocument();
    expect(within(report).getByText(/该说法没有可靠证据支持/)).toBeInTheDocument();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "再查一条" })).toBeInTheDocument();
  });

  it("keeps deterministic report fallback visible instead of rejecting the final report", async () => {
    const fallbackStep = {
      agent: "report_composer",
      agentName: "写结论",
      agentIcon: "📝",
      systemPrompt: "test",
      input: {},
      output: {
        fallbackReason: "最终写作模型超时，已用结构化证据生成确定性报告。",
      },
      model: "fallback:deterministic-report",
      latencyMs: 90000,
      timestamp: Date.now(),
      status: "completed" as const,
    };

    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "agent_complete",
        agent: "report_composer",
        agentName: "写结论",
        agentIcon: "📝",
        output: fallbackStep.output,
        model: fallbackStep.model,
        latencyMs: fallbackStep.latencyMs,
      };
      yield {
        type: "complete",
        totalLatencyMs: fallbackStep.latencyMs,
        steps: [fallbackStep],
        finalReport: {
          verdictType: "uncertain",
          credibilityLabel: "存疑",
          credibilityScore: 54,
          conclusion: "已用确定性结论，证据还撑不住这句话。",
          recommendation: "还查不清。",
          summaryForPublic: "当前证据链不足。",
          whyHardToVerify: [],
          evidenceChain: [],
          closureActions: [],
          confidenceDimensions: [],
        },
      };
    });

    await startRealAnalysis();

    expect(await screen.findByText(/写结论使用确定性兜底/)).toBeInTheDocument();
    expect((await screen.findAllByText(/已用确定性结论/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/拒绝展示非真实结论/)).not.toBeInTheDocument();
  });

  it("sanitizes provider errors from the mission score explanation", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "complete",
        totalLatencyMs: 1200,
        steps: [],
        finalReport: {
          verdictType: "unverified",
          credibilityLabel: "存疑",
          credibilityScore: 36,
          conclusion: "当前证据不足以直接确认原始说法。",
          recommendation: "还查不清。",
          summaryForPublic: "当前证据链不足。",
          whyHardToVerify: [
            "ReportComposer all providers failed: API error quota exceeded at https://internal.example.com/v1/messages",
          ],
          evidenceChain: [],
          closureActions: [],
          confidenceDimensions: [
            {
              dimension: "source_reliability",
              label: "来源可靠性",
              score: 42,
              threshold: 70,
              passed: false,
              reason: "API error quota exceeded at https://internal.example.com/v1/messages",
            },
          ],
        },
      };
    });

    await startRealAnalysis();

    const report = await screen.findByLabelText("核心结论");
    expect(within(report).getByText(/当前证据不足以直接确认原始说法/)).toBeInTheDocument();
    expect(within(report).queryByText(/还查不清/)).not.toBeInTheDocument();
    const visible = document.body.textContent || "";
    expect(visible).toMatch(/当前证据不足以直接确认原始说法/);
    expect(visible).not.toMatch(/ReportComposer all providers failed|quota exceeded at https:\/\/internal\.example\.com/);
  });

  it("keeps blank report fields and legitimate source URLs out of the fallback warning", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "complete",
        totalLatencyMs: 1200,
        steps: [],
        finalReport: {
          verdictType: "unverified",
          credibilityLabel: "",
          credibilityScore: 36,
          conclusion: "当前证据见官方说明 https://example.com/news/v1-release。",
          recommendation: "可打开官方说明核对。",
          summaryForPublic: "",
          whyHardToVerify: [""],
          evidenceChain: [
            {
              layer: "来源",
              finding: "官方页面可访问",
              evidence: "官方说明见 https://example.com/news/v1-release",
              boundary: "该链接只能证明页面存在，不能证明更强因果结论。",
              sourceRefs: ["https://example.com/news/v1-release"],
            },
          ],
          closureActions: [],
          confidenceDimensions: [],
        },
      };
    });

    await startRealAnalysis();

    const report = await screen.findByLabelText("核心结论");
    expect(within(report).getAllByText(/example\.com|v1-release/).length).toBeGreaterThan(0);
    expect(screen.queryByText("最终写作服务暂时不可用，系统已改用保守兜底报告。")).not.toBeInTheDocument();
  });

  it("shows an interrupted check instead of a padded unfinished dossier", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield {
        type: "complete",
        totalLatencyMs: 900,
        steps: [],
        finalReport: {
          verdictType: "unverified",
          credibilityLabel: "未能判断",
          credibilityScore: 30,
          conclusion: "本次核查未能完成最终判断：模型服务暂时不可用，系统保留了本次检索到的公开材料。",
          recommendation: "请稍后重试，或检查模型配置后重新发起核查。",
          citationSources: [{ title: "央行公开说明", url: "https://example.com/pboc" }],
          evidenceChain: [
            {
              layer: "证据",
              finding: "审核器补全：前序输出未提供完整证据链",
              evidence: "（审稿补全，非新增外部事实）",
              boundary: "不得据此推出比材料更强的结论",
              sourceRefs: [],
            },
          ],
          _source: "error-boundary",
        },
      };
    });

    await startRealAnalysis();

    const report = await screen.findByLabelText("核心结论");
    expect(within(report).getByText(/这一轮没有收成判断/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新核查" })).toBeInTheDocument();
    expect(within(report).getByRole("link")).toHaveAttribute("href", "https://example.com/pboc");
    expect(within(report).queryByText("未证实")).not.toBeInTheDocument();
    expect(within(report).queryByText(/判断置信度/)).not.toBeInTheDocument();
    expect(within(report).queryByText(/审核器补全/)).not.toBeInTheDocument();
    expect(within(report).queryByText(/模型服务暂时不可用/)).not.toBeInTheDocument();
    expect(within(report).queryByText(/检查模型配置/)).not.toBeInTheDocument();
    expect(screen.queryByText("正在核查")).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────
// Shared home fixtures (landing + model picker)
// ───────────────────────────────────────────────────────────────

function mockModelsList(models: Array<{ provider: string; model: string; label: string; tier: string; hint: string }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
    if (url.includes("/api/models/health")) {
      return new Response(JSON.stringify({ status: "available", message: "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me")) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/api/checks/quota")) {
      return new Response(JSON.stringify({ remaining: 1, total: 1, used: 0, kind: "guest" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not-found", { status: 404 });
  });
}

const FAKE_MODELS = [
  { provider: "deepseek", model: "deepseek-v4-pro",   label: "DeepSeek V4 Pro",   tier: "high", hint: "强推理" },
  { provider: "deepseek", model: "deepseek-v4-flash", label: "DeepSeek V4 Flash", tier: "mid",  hint: "推荐" },
  { provider: "stepfun",  model: "step-1-8k",         label: "StepFun Step-1 8K", tier: "low",  hint: "便宜" },
];

// ───────────────────────────────────────────────────────────────
// Landing — quiet desk + representative rumor chips
// ───────────────────────────────────────────────────────────────

describe("landing Version A storytelling", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("renders a quiet desk: name, one line, input, representative examples", async () => {
    mockModelsList(FAKE_MODELS);

    render(<LegacyDesk />);

    expect(screen.getByRole("heading", { name: "红鲱鱼与枪" })).toBeInTheDocument();
    expect(screen.getByLabelText("历史卷宗")).toBeInTheDocument();
    expect(screen.getByLabelText("核查卷宗")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "新查一条" })).toBeInTheDocument();
    const landingMission = document.querySelector(".landing-mission");
    expect(landingMission).toHaveTextContent("把你想核查的句子、链接或截图放进来");
    expect(landingMission).not.toHaveTextContent("能不能信");
    expect(screen.getByText("告诉你这条说法是否可靠，问题在哪里，来源能点开。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "你想核查什么？" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "隔夜菜会致癌，等于吃毒药" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "5G信号塔辐射导致周边居民头晕失眠" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "人民币即将大幅贬值，赶紧换美元" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "它如何工作" })).not.toBeInTheDocument();
    expect(screen.queryByText("某公司未来三年营收将增长十倍")).not.toBeInTheDocument();
    expect(await screen.findByText("今天还能免费查 1 条")).toBeInTheDocument();
  });

  it("offers optional email login without blocking the desk", async () => {
    mockModelsList(FAKE_MODELS);

    render(<LegacyDesk />);

    expect(await screen.findByRole("button", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "你想核查什么？" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "登录" }));

    expect(screen.getByRole("heading", { name: "登录" })).toBeInTheDocument();
    expect(screen.getByText("登录后，最近核查可以在别的设备接着看。不登录也能查。")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "你想核查什么？" })).toBeInTheDocument();
  });

  it("shows the development code on the login panel instead of claiming email delivery", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
      if (url.includes("/api/auth/email/request")) {
        return new Response(
          JSON.stringify({
            ok: true,
            delivery: "dev-panel",
            devCode: "482917",
            message: "还没配发信。开发环境验证码显示在面板上。",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/models/list")) {
        return new Response(JSON.stringify({ models: FAKE_MODELS }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me") || url.includes("/api/models/health")) {
        return new Response(JSON.stringify({ authenticated: false, status: "available" }), {
          status: url.includes("/api/models/health") ? 200 : 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not-found", { status: 404 });
    });

    render(<LegacyDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "yishuziyu@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(await screen.findByText("还没配发信。开发环境用下面这个验证码。")).toBeInTheDocument();
    expect(screen.getByText("482917")).toBeInTheDocument();
    expect(screen.getByLabelText("6 位验证码")).toHaveValue("482917");
  });

  it("asks the user to copy the code from email when delivery is configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
      if (url.includes("/api/auth/email/request")) {
        return new Response(
          JSON.stringify({
            ok: true,
            delivery: "email",
            message: "验证码已发送",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/models/list")) {
        return new Response(JSON.stringify({ models: FAKE_MODELS }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/api/auth/email/me") || url.includes("/api/auth/me") || url.includes("/api/models/health")) {
        return new Response(JSON.stringify({ authenticated: false, status: "available" }), {
          status: url.includes("/api/models/health") ? 200 : 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not-found", { status: 404 });
    });

    render(<LegacyDesk />);
    fireEvent.click(await screen.findByRole("button", { name: "登录" }));
    fireEvent.change(screen.getByLabelText("邮箱"), { target: { value: "yishuziyu@gmail.com" } });
    fireEvent.click(screen.getByRole("button", { name: "发送验证码" }));

    expect(await screen.findByText("验证码已发到 yishuziyu@gmail.com")).toBeInTheDocument();
    expect(screen.queryByText("开发验证码")).not.toBeInTheDocument();
    expect(screen.getByLabelText("6 位验证码")).toHaveValue("");
  });

  it("blocks a doomed run and explains model-service unavailability without provider details", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
      if (url.includes("/api/models/health")) {
        return new Response(
          JSON.stringify({
            status: "unavailable",
            message: "模型服务暂时不可用。这次可能给不出最终判断，但仍会尽量检索公开材料。",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      if (url.includes("/api/models/list")) {
        return new Response(JSON.stringify({ models: FAKE_MODELS }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("not-found", { status: 404 });
    });

    render(<LegacyDesk />);

    const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
    expect(editor).toHaveAttribute("contenteditable", "true");
    expect(await screen.findByText("核查服务暂时不可用。你的材料还没有提交，请稍后重试。")).toBeInTheDocument();
    fireEvent.input(editor, { target: { textContent: "测试材料" } });
    expect(screen.getByRole("button", { name: /开始核查/ })).toBeDisabled();
    expect(document.body.textContent).not.toMatch(/DeepSeek|MiniMax|API Key|quota|余额|密钥/i);
  });

  it("fills the claim when a representative example is clicked, then starts on 开始核查", async () => {
    mockModelsList(FAKE_MODELS);

    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "complete", totalLatencyMs: 1, steps: [], finalReport: undefined as never };
    });

    const claim = "隔夜菜会致癌，等于吃毒药";
    render(<LegacyDesk />);

    fireEvent.click(await screen.findByRole("button", { name: claim }));
    const editor = screen.getByRole("textbox", { name: "你想核查什么？" });
    expect(editor).toHaveTextContent(claim);

    fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

    expect(await screen.findByTestId("apodex-run")).toBeInTheDocument();

    await waitFor(() => {
      expect(requestOrchestrateStream).toHaveBeenCalled();
    });

    const calls = vi.mocked(requestOrchestrateStream).mock.calls;
    const lastCall = calls[calls.length - 1];
    const streamInput = lastCall?.[0];
    if (typeof streamInput === "string") {
      expect(streamInput).toContain(claim);
    } else {
      expect(streamInput?.text).toBe(claim);
    }
  });

  it("Enter on empty material shows input error and does not start analysis", async () => {
    mockModelsList(FAKE_MODELS);

    render(<LegacyDesk />);

    const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter", shiftKey: false });

    expect(await screen.findByRole("alert")).toHaveTextContent("请先填写待核查材料");
    expect(requestOrchestrateStream).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("思考中")).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────
// 模型：落地页不放 picker；设置在 /settings/api-key
// B9: /api/models/list 返回 [] → 启动按钮 disabled
// ───────────────────────────────────────────────────────────────

describe("model picker (simplified BYO)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  it("keeps the inline model picker off the landing desk", async () => {
    mockModelsList(FAKE_MODELS);

    render(<LegacyDesk />);

    expect(await screen.findByRole("textbox", { name: "你想核查什么？" })).toBeInTheDocument();
    expect(screen.queryByLabelText("模型选择")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "模型设置" })).toHaveAttribute("href", "/settings/api-key");
  });

  it("B6-b: /model-settings-preview does not show the model picker", async () => {
    mockModelsList(FAKE_MODELS);
    window.history.pushState({}, "", "/model-settings-preview");

    render(<LegacyDesk />);

    expect(await screen.findByText("模型服务商")).toBeInTheDocument();
    expect(screen.queryByLabelText("模型选择")).not.toBeInTheDocument();
  });

  it("B9: empty /api/models/list disables launch", async () => {
    mockModelsList([]);

    render(<LegacyDesk />);

    const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
    editor.textContent = "隔夜菜会致癌，等于吃毒药";
    fireEvent.input(editor);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /开始核查/ })).toBeDisabled();
    });
  });

  it("starts analysis with an empty modelChoice map from the landing desk", async () => {
    mockModelsList(FAKE_MODELS);

    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "complete", totalLatencyMs: 1, steps: [], finalReport: undefined as never };
    });

    render(<LegacyDesk />);

    const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
    editor.textContent = "测试默认模型链路";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

    await waitFor(() => {
      expect(requestOrchestrateStream).toHaveBeenCalled();
    });

    const lastCall = vi.mocked(requestOrchestrateStream).mock.calls.at(-1);
    const modelChoice = lastCall?.[2] as Record<string, unknown> | undefined;
    expect(modelChoice).toEqual({});
  });
});

describe("same-thread follow-up", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
    mockModelsList([
      { provider: "deepseek", model: "deepseek-v4-pro", label: "DeepSeek V4 Pro", tier: "high", hint: "强推理" },
    ]);
  });

  it("sends a follow-up on the same thread without going home", async () => {
    const firstReport = {
      verdictType: "false",
      credibilityLabel: "谣言",
      credibilityScore: 90,
      conclusion: "公开材料不支持整句。",
      recommendation: "不能信。",
      summaryForPublic: "不可靠。",
      whyHardToVerify: [],
      evidenceChain: [],
      closureActions: [],
      confidenceDimensions: [],
    };
    vi.mocked(requestOrchestrateStream)
      .mockImplementationOnce(async function* () {
        yield {
          type: "complete",
          totalLatencyMs: 20,
          steps: [],
          finalReport: firstReport,
        };
      })
      .mockImplementationOnce(async function* () {
        yield {
          type: "complete",
          totalLatencyMs: 20,
          steps: [],
          finalReport: {
            ...firstReport,
            conclusion: "微波炉加热同样不能等同致癌。",
          },
        };
      });

    render(<LegacyDesk />);
    const editor = await screen.findByRole("textbox", { name: "你想核查什么？" });
    editor.textContent = "隔夜菜会致癌，吃了等于吃毒药";
    fireEvent.input(editor);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /开始核查/ })).toBeEnabled();
    });
    fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

    const report = await screen.findByLabelText("核心结论");
    expect(report).toHaveTextContent("公开材料不支持整句");

    const box = screen.getByPlaceholderText("再问一句…");
    expect(box).toBeEnabled();
    fireEvent.change(box, { target: { value: "那微波炉加热呢" } });
    fireEvent.click(screen.getByRole("button", { name: "发送" }));

    expect(await screen.findByText("那微波炉加热呢")).toBeInTheDocument();
    const bubbles = screen.getAllByTestId("claim-bubble");
    expect(bubbles.map((el) => el.textContent)).toEqual([
      "隔夜菜会致癌，吃了等于吃毒药",
      "那微波炉加热呢",
    ]);
    expect(screen.queryByRole("textbox", { name: "你想核查什么？" })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(requestOrchestrateStream).toHaveBeenCalledTimes(2);
    });
    const second = vi.mocked(requestOrchestrateStream).mock.calls[1]?.[0];
    const payload = typeof second === "string" ? second : second?.text;
    expect(payload).toBeTruthy();
    expect(payload?.startsWith("那微波炉加热呢")).toBe(true);
    expect(payload).toContain("隔夜菜会致癌，吃了等于吃毒药");
    expect(payload).toContain("同一条核查的追问");
    expect(payload).toContain("公开材料不支持整句");

    expect((await screen.findAllByText(/微波炉加热同样不能等同致癌/)).length).toBeGreaterThan(0);
  });
});

// ───────────────────────────────────────────────────────────────
// 私有记忆作用域（ReasoningProvider）：旧壳 MissionControl 经 useReasoning 消费；
// 生产 Golden Path 不读取私有记忆，此处直接测 Provider 的作用域纪律。
// ───────────────────────────────────────────────────────────────
import { ReasoningProvider, useReasoning } from "../store/reasoningStore";

function MemoryScopeProbe() {
  const { state, setMemoryScope } = useReasoning();
  return (
    <div>
      <output data-testid="private-memory">{[...state.comments, ...state.followUps].map((entry) => entry.text).join(" / ")}</output>
      <button onClick={() => setMemoryScope("alice@example.com")}>scope-alice</button>
      <button onClick={() => setMemoryScope(null)}>scope-anon</button>
    </div>
  );
}

describe("private memory scoping", () => {
  afterEach(() => cleanup());

  it("identity 解析前隐藏；scope 切换正确隔离 alice 与匿名", async () => {
    localStorage.setItem("reasoning-v3-comments:v2:account:alice%40example.com", JSON.stringify([{ id: "c", nodeId: "n", text: "Alice 私人评论", createdAt: 1 }]));
    localStorage.setItem("reasoning-v3-followups:v2:anonymous", JSON.stringify([{ id: "f", nodeId: "n", text: "访客追加", timestamp: 1 }]));
    render(<ReasoningProvider><MemoryScopeProbe /></ReasoningProvider>);
    expect(screen.getByTestId("private-memory")).toBeEmptyDOMElement();
    fireEvent.click(screen.getByText("scope-alice"));
    await waitFor(() => expect(screen.getByTestId("private-memory")).toHaveTextContent("Alice 私人评论"));
    expect(screen.getByTestId("private-memory")).not.toHaveTextContent("访客追加");
    fireEvent.click(screen.getByText("scope-anon"));
    await waitFor(() => expect(screen.getByTestId("private-memory")).toHaveTextContent("访客追加"));
    expect(screen.getByTestId("private-memory")).not.toHaveTextContent("Alice");
    localStorage.removeItem("reasoning-v3-comments:v2:account:alice%40example.com");
    localStorage.removeItem("reasoning-v3-followups:v2:anonymous");
  });
});
