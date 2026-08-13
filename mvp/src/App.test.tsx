import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { requestOrchestrateStream } from "./lib/agentExpansion";

vi.mock("./lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./lib/agentExpansion")>();

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
    render(<App />);

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开快捷操作" })).not.toBeInTheDocument();

    const settingsLink = screen.getByRole("link", { name: "模型设置" });
    expect(settingsLink).toHaveAttribute("href", "/settings/api-key");
  });

  it("renders a dedicated provider settings preview page with preset defaults", async () => {
    window.history.pushState({}, "", "/model-settings-preview");

    render(<App />);

    expect(await screen.findByText("模型服务商")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DeepSeek" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("API Key")).toHaveAttribute("type", "password");
    expect(screen.getByLabelText("API 代理地址")).toHaveValue("https://api.deepseek.com");
    expect(screen.getByLabelText("默认模型")).toHaveValue("deepseek-v4-pro");
  });

  it("updates provider presets without asking the user to configure every field", async () => {
    window.history.pushState({}, "", "/model-settings-preview");

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "360GPT" }));

    expect(screen.getByRole("button", { name: "360GPT" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("API 代理地址")).toHaveValue("https://api.360.cn/v1");
    expect(screen.getByLabelText("默认模型")).toHaveValue("360gpt-pro");
  });
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
    const editor = await screen.findByRole("textbox", { name: "待核查材料" });
    editor.textContent = text;
    fireEvent.input(editor);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /开始核查/ })).toBeEnabled();
    });
    return editor;
  }

  async function startRealAnalysis() {
    const rendered = render(<App />);

    await fillClaimInput("隔夜菜会致癌，吃了等于吃毒药");
    fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

    expect(await screen.findByLabelText("核查卷宗工作区")).toBeInTheDocument();
    return rendered;
  }

  it("uses the clean analysis shell for the real workspace too", async () => {
    const { container } = await startRealAnalysis();

    expect(container.querySelector(".case-workbench-view--clean")).not.toBeNull();
    expect(container.querySelector(".case-controller-panel")).not.toBeNull();
    expect(screen.queryByLabelText("执行画布缩略图")).not.toBeInTheDocument();
  });

  it("starts the real workspace from the stream-driven controller surface", async () => {
    const { container } = await startRealAnalysis();

    expect(await screen.findByLabelText("活动过程时间线")).toBeInTheDocument();
    expect(container.querySelector(".controller-proof-card")).toBeNull();
    expect(container.querySelector(".controller-prompt-dock")).toBeNull();
    expect(container.querySelector(".mission-agent-icon")).toBeNull();
    expect(screen.queryByText("Agent 思考树")).not.toBeInTheDocument();
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

    // 结果首屏：结论 + 能不能信
    const report = await screen.findByLabelText("最终核查判断");
    expect(within(report).getByText(/该说法没有可靠证据支持/)).toBeInTheDocument();
    expect(within(report).getByText("不能信。")).toBeInTheDocument();
    // 折叠区仍可展开看评分细节
    const more = within(report).queryByText("更多细节（评分与审计）");
    if (more) {
      fireEvent.click(more);
      expect(within(report).getByText(/判断置信度 95\/100|原信息可信度 5\/100/)).toBeInTheDocument();
    }
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

    // 基础设施错误不得出现在用户可见结论文案里
    const report = await screen.findByLabelText("最终核查判断");
    expect(within(report).getByText(/当前证据不足以直接确认原始说法/)).toBeInTheDocument();
    expect(within(report).getByText("还查不清。")).toBeInTheDocument();
    const visible = document.body.textContent || "";
    expect(visible).toMatch(/最终写作服务暂时不可用|证据不足|还查不清/);
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

    const report = await screen.findByLabelText("最终核查判断");
    expect(within(report).getAllByText(/https:\/\/example\.com\/news\/v1-release/).length).toBeGreaterThan(0);
    expect(screen.queryByText("最终写作服务暂时不可用，系统已改用保守兜底报告。")).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────
// Shared home fixtures (landing + model picker)
// ───────────────────────────────────────────────────────────────

function mockModelsList(models: Array<{ provider: string; model: string; label: string; tier: string; hint: string }>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : (input as URL | Request)?.toString?.() ?? "";
    if (url.includes("/api/models/list")) {
      return new Response(JSON.stringify({ models }), {
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
// Landing Version A — 产品叙事首页
// Hero 5s 故事 + 示例「立即核查」启动路径
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

  it("renders Version A storytelling blocks on the home dashboard", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    expect(await screen.findByText("溯源公开材料，核对是不是一手")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "红鲱鱼与枪" })).toBeInTheDocument();
    expect(screen.getByText("贴进来。追出处。告诉你能不能信。")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "它如何工作" })).toBeInTheDocument();
    expect(screen.getByText("交叉看")).toBeInTheDocument();
    expect(screen.getByText("查完大概长这样")).toBeInTheDocument();
    expect(screen.getByText("示例")).toBeInTheDocument();
    expect(screen.getByText("能不能信")).toBeInTheDocument();
    expect(screen.getByText("结论")).toBeInTheDocument();

    const verifyButtons = screen.getAllByRole("button", { name: /查这条/ });
    expect(verifyButtons).toHaveLength(3);
    expect(verifyButtons[0]).toHaveAccessibleName("查这条：隔夜菜会致癌，等于吃毒药");
    expect(verifyButtons[1]).toHaveAccessibleName(
      "查这条：某公司未来三年营收将增长十倍"
    );
    expect(verifyButtons[2]).toHaveAccessibleName(
      "查这条：某项政策已经正式确定并将立即实施"
    );
  });

  it("starts analysis with the demo claim when「查这条」is clicked", async () => {
    mockModelsList(FAKE_MODELS);

    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "complete", totalLatencyMs: 1, steps: [], finalReport: undefined as never };
    });

    const claim = "隔夜菜会致癌，等于吃毒药";
    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: `查这条：${claim}` }));

    expect(await screen.findByLabelText("核查卷宗工作区")).toBeInTheDocument();

    await waitFor(() => {
      expect(requestOrchestrateStream).toHaveBeenCalled();
    });

    const lastCall = vi.mocked(requestOrchestrateStream).mock.calls.at(-1);
    const streamInput = lastCall?.[0];
    if (typeof streamInput === "string") {
      expect(streamInput).toContain(claim);
    } else {
      expect(streamInput?.text).toBe(claim);
    }
  });

  it("Enter on empty material shows input error and does not start analysis", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    const editor = await screen.findByRole("textbox", { name: "待核查材料" });
    fireEvent.keyDown(editor, { key: "Enter", code: "Enter", shiftKey: false });

    expect(await screen.findByRole("alert")).toHaveTextContent("请先填写待核查材料");
    expect(requestOrchestrateStream).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("核查卷宗工作区")).not.toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────
// 模型选择（简化版 BYO-API-key）
// B6: picker 在 home 露出，preview 路由不露出
// B8: 点 "推荐组合" preset 自动填齐 4 个步骤
// B9: /api/models/list 返回 [] → picker 显示 "暂无可用模型"，启动按钮 disabled
// e2e: 选完 picker 后点启动，requestOrchestrateStream 收到正确的 modelChoice
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

  // B6: home 露出 picker；preview 路由不露出
  it("B6-a: home (Dashboard) shows the model picker, starting collapsed", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    const toggle = await screen.findByRole("button", { name: /模型选择/ });
    const picker = screen.getByLabelText("模型选择");
    const send = screen.getByRole("button", { name: /开始核查/ });
    expect(send.parentElement).toContainElement(picker);
    expect(picker).toHaveAttribute("data-expanded", "false");
    expect(picker.querySelector(".model-picker-presets")).toBeNull();
    expect(within(picker).queryByRole("button", { name: /推荐组合/ })).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(picker).toHaveAttribute("data-expanded", "true");
    expect(within(picker).getByRole("button", { name: /推荐组合/ })).toBeInTheDocument();
  });

  // B7: 折叠态摘要：没选模型时显示"默认（不指定模型…）"
  it("B7: collapsed picker shows a summary that reflects current selection", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    const picker = (await screen.findByRole("button", { name: /模型选择/ })).closest(
      '[aria-label="模型选择"]'
    ) as HTMLElement;
    expect(within(picker).getByText(/^默认$/)).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole("button", { name: /模型选择/ }));
    const rumorSelect = within(picker).getByLabelText(/识别信息结构/);
    fireEvent.change(rumorSelect, { target: { value: "deepseek:deepseek-v4-flash" } });

    // 折叠回去（再次点标题）
    fireEvent.click(within(picker).getByRole("button", { name: /模型选择/ }));
    // 摘要应该反映"已为 1/4 个步骤指定"
    expect(within(picker).getByText(/1\/4/)).toBeInTheDocument();
  });

  it("B6-b: /model-settings-preview does not show the model picker", async () => {
    mockModelsList(FAKE_MODELS);
    window.history.pushState({}, "", "/model-settings-preview");

    render(<App />);

    expect(await screen.findByText("模型服务商")).toBeInTheDocument();
    expect(screen.queryByLabelText("模型选择")).not.toBeInTheDocument();
  });

  // B8: 推荐组合 → 4 个 picker 都填上
  it("B8: clicking '推荐组合' preset auto-fills all 4 step pickers", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    const picker = (await screen.findByRole("button", { name: /模型选择/ })).closest(
      '[aria-label="模型选择"]'
    ) as HTMLElement;
    fireEvent.click(within(picker).getByRole("button", { name: /模型选择/ }));
    fireEvent.click(within(picker).getByRole("button", { name: /推荐组合/ }));

    expect(within(picker).getAllByText(/DeepSeek V4 Pro|DeepSeek V4 Flash/).length).toBeGreaterThanOrEqual(1);
    expect(within(picker).getByText(/识别信息结构/)).toBeTruthy();
  });

  // B9: /api/models/list 空 → 提示信息 + 启动按钮 disabled
  it("B9: empty /api/models/list shows fallback message and disables launch", async () => {
    mockModelsList([]);

    render(<App />);

    expect(await screen.findByText(/暂无可用模型|未配置任何 LLM/)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /开始核查/ });
    expect(submit).toBeDisabled();
  });

  // e2e: modelChoice 真的传到 requestOrchestrateStream
  it("e2e: chosen modelChoice flows through to requestOrchestrateStream", async () => {
    mockModelsList(FAKE_MODELS);

    // 让 stream 立刻结束，避免 MissionControlView 内部继续等待
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(async function* () {
      yield { type: "complete", totalLatencyMs: 1, steps: [], finalReport: undefined as never };
    });

    render(<App />);

    const picker = (await screen.findByRole("button", { name: /模型选择/ })).closest(
      '[aria-label="模型选择"]'
    ) as HTMLElement;
    fireEvent.click(within(picker).getByRole("button", { name: /模型选择/ }));
    fireEvent.click(within(picker).getByRole("button", { name: /推荐组合/ }));

    // 填入 claim 并启动
    const editor = await screen.findByRole("textbox", { name: "待核查材料" });
    editor.textContent = "测试 modelChoice 是否传递";
    fireEvent.input(editor);
    fireEvent.click(screen.getByRole("button", { name: /开始核查/ }));

    // 等待 requestOrchestrateStream 被调用
    await waitFor(() => {
      expect(requestOrchestrateStream).toHaveBeenCalled();
    });

    // 验证第三个参数是 modelChoice
    const calls = vi.mocked(requestOrchestrateStream).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall.length).toBeGreaterThanOrEqual(3);
    const modelChoice = lastCall[2] as Record<string, { provider: string; model: string }> | undefined;
    expect(modelChoice).toBeDefined();
    expect(Object.keys(modelChoice ?? {}).sort()).toEqual(
      ["fact_checker", "report_composer", "rumor_detector", "source_validator"].sort()
    );
    // 推荐组合应该都用 deepseek
    for (const entry of Object.values(modelChoice ?? {})) {
      expect(entry.provider).toBe("deepseek");
    }
  });
});
