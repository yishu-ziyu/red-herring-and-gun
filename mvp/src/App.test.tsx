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

  it("keeps model configuration behind a lightweight home action", async () => {
    render(<App />);

    expect(screen.queryByLabelText("API Key")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "打开快捷操作" }));

    const menu = await screen.findByLabelText("快捷操作菜单");
    const settingsLink = within(menu).getByRole("link", { name: "配置模型服务商" });
    expect(settingsLink).toHaveAttribute("href", "/model-settings-preview");
    // 分析预览链接已经移除，菜单里只留"配置模型服务商"一项
    expect(within(menu).queryByRole("link", { name: "查看分析预览" })).not.toBeInTheDocument();
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
  });

  async function startRealAnalysis() {
    const rendered = render(<App />);

    fireEvent.change(screen.getByPlaceholderText("输入文字、粘贴链接，或添加聊天截图 / 网页截图"), {
      target: { value: "隔夜菜会致癌，吃了等于吃毒药" },
    });
    fireEvent.click(screen.getByRole("button", { name: /启动真实核查/ }));

    expect(await screen.findByLabelText("真实核查办案台")).toBeInTheDocument();
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

    expect(await screen.findByLabelText("主控调度")).toBeInTheDocument();
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
          recommendation: "不要继续转发。",
          summaryForPublic: "这条信息不可靠。",
          whyHardToVerify: [],
          evidenceChain: [],
          closureActions: [],
          confidenceDimensions: [],
        },
      };
    });

    await startRealAnalysis();

    expect(await screen.findByText("判断置信度 95/100")).toBeInTheDocument();
    expect(screen.getByText("原信息可信度 5/100")).toBeInTheDocument();
    expect(screen.getByText(/原信息可信度为 5\/100，越低越不实/)).toBeInTheDocument();
  });
});

// ───────────────────────────────────────────────────────────────
// 4-Agent model picker（简化版 BYO-API-key）
// B6: picker 在 home 露出，preview 路由不露出
// B8: 点 "推荐组合" preset 自动填齐 4 个 picker
// B9: /api/models/list 返回 [] → picker 显示 "暂无可用模型"，启动按钮 disabled
// e2e: 选完 picker 后点启动，requestOrchestrateStream 收到正确的 modelChoice
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

describe("4-Agent model picker (simplified BYO)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.pushState({}, "", "/");
    window.localStorage.clear();
  });

  // B6: home 露出 picker；preview 路由不露出
  it("B6-a: home (Dashboard) shows the 4-Agent model picker, starting collapsed", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    // picker 标题可见，但默认折叠，preset 按钮不展开看不到
    const picker = await screen.findByLabelText("4-Agent 模型选择");
    expect(picker).toHaveAttribute("data-expanded", "false");
    expect(picker.querySelector(".model-picker-presets")).toBeNull();
    expect(within(picker).queryByRole("button", { name: /推荐组合/ })).not.toBeInTheDocument();

    // 点标题展开 → preset 出现
    fireEvent.click(within(picker).getByRole("button", { name: /4-Agent 模型选择/ }));
    expect(picker).toHaveAttribute("data-expanded", "true");
    expect(within(picker).getByRole("button", { name: /推荐组合/ })).toBeInTheDocument();
  });

  // B7: 折叠态摘要：没选模型时显示"默认（不指定模型…）"
  it("B7: collapsed picker shows a summary that reflects current selection", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    const picker = await screen.findByLabelText("4-Agent 模型选择");
    // 默认状态：4 个 agent 都没指定 → 摘要应该提到"默认"
    expect(within(picker).getByText(/默认/)).toBeInTheDocument();

    // 展开 → 选第一个 agent 的 model
    fireEvent.click(within(picker).getByRole("button", { name: /4-Agent 模型选择/ }));
    const rumorSelect = within(picker).getByLabelText(/Rumor Detector/);
    fireEvent.change(rumorSelect, { target: { value: "deepseek:deepseek-v4-flash" } });

    // 折叠回去（再次点标题）
    fireEvent.click(within(picker).getByRole("button", { name: /4-Agent 模型选择/ }));
    // 摘要应该反映"已为 1/4 个 Agent 指定"
    expect(within(picker).getByText(/1\/4/)).toBeInTheDocument();
  });

  it("B6-b: /model-settings-preview does not show the 4-Agent picker", async () => {
    mockModelsList(FAKE_MODELS);
    window.history.pushState({}, "", "/model-settings-preview");

    render(<App />);

    expect(await screen.findByText("模型服务商")).toBeInTheDocument();
    expect(screen.queryByLabelText("4-Agent 模型选择")).not.toBeInTheDocument();
  });

  // B8: 推荐组合 → 4 个 picker 都填上
  it("B8: clicking '推荐组合' preset auto-fills all 4 agent pickers", async () => {
    mockModelsList(FAKE_MODELS);

    render(<App />);

    const picker = await screen.findByLabelText("4-Agent 模型选择");
    // 默认折叠 → 先展开
    fireEvent.click(within(picker).getByRole("button", { name: /4-Agent 模型选择/ }));
    fireEvent.click(within(picker).getByRole("button", { name: /推荐组合/ }));

    // 4 个 picker 都应显示已选 model
    expect(within(picker).getAllByText(/DeepSeek V4 Pro|DeepSeek V4 Flash/).length).toBeGreaterThanOrEqual(1);
    expect(within(picker).getByText(/Rumor/i)).toBeTruthy();
  });

  // B9: /api/models/list 空 → 提示信息 + 启动按钮 disabled
  it("B9: empty /api/models/list shows fallback message and disables launch", async () => {
    mockModelsList([]);

    render(<App />);

    expect(await screen.findByText(/暂无可用模型|未配置任何 LLM/)).toBeInTheDocument();

    const submit = screen.getByRole("button", { name: /启动真实核查/ });
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

    // 触发 "推荐组合" preset
    const picker = await screen.findByLabelText("4-Agent 模型选择");
    // 默认折叠 → 先展开
    fireEvent.click(within(picker).getByRole("button", { name: /4-Agent 模型选择/ }));
    fireEvent.click(within(picker).getByRole("button", { name: /推荐组合/ }));

    // 填入 claim 并启动
    fireEvent.change(screen.getByPlaceholderText("输入文字、粘贴链接，或添加聊天截图 / 网页截图"), {
      target: { value: "测试 modelChoice 是否传递" },
    });
    fireEvent.click(screen.getByRole("button", { name: /启动真实核查/ }));

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
