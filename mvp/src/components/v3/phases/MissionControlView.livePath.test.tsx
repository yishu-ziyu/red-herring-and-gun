/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOrchestrateStream, type OrchestrateStreamEvent } from "../../../lib/agentExpansion";
import { ReasoningProvider } from "../../../store/reasoningStore";
import { MissionControlView } from "./MissionControlView";

vi.mock("../../../lib/agentExpansion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/agentExpansion")>();
  return {
    ...actual,
    requestOrchestrateStream: vi.fn(async function* () {
      yield { type: "error", message: "test stream stopped" };
    }),
  };
});

function renderLiveCheck() {
  return render(
    <ReasoningProvider>
      <MissionControlView claim="隔夜菜会致癌" onCancel={() => undefined} />
    </ReasoningProvider>
  );
}

describe("MissionControlView live product path", () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
  });

  it("always paints ApodexRunView, not the legacy process transcript", () => {
    const { container } = renderLiveCheck();

    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
    expect(container.querySelector(".mission-topbar")).toBeNull();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("核查对象")).not.toBeInTheDocument();
  });

  it("?shell=legacy still shows ApodexRunView", () => {
    window.history.pushState({}, "", "/?shell=legacy");
    const { container } = renderLiveCheck();

    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
    expect(container.querySelector(".mission-topbar")).toBeNull();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
  });

  it("?legacyStream=1 still shows ApodexRunView", () => {
    window.history.pushState({}, "", "/?legacyStream=1");
    renderLiveCheck();

    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
  });

  // 回归：complete 事件携带服务端原始 PipelineStep（缺 model / status / timestamp）时，
  // 曾把全链路成功的核查误判为「这次核查没能完成」。
  it("settles as success when complete event steps omit model and status", async () => {
    const onComplete = vi.fn();
    const finalReport = {
      conclusion: "原子命题均不成立",
      credibilityLabel: "不可信",
      verdictType: "false",
      credibilityScore: 12,
    };
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(
      async function* () {
        // 故意用服务端真实宽松形状（steps 缺 model/status）：HandoffStep 类型比线上数据更严
        yield {
          type: "complete",
          claim: "隔夜菜会致癌，等于吃毒药",
          steps: [
            { agent: "cross_examiner", agentName: "CrossExaminer", output: { kind: "cross_exam" } },
            { agent: "report_composer", agentName: "ReportComposer", output: { kind: "report" } },
          ],
          finalReport,
          memoryCandidates: [],
          totalLatencyMs: 1000,
        } as unknown as OrchestrateStreamEvent;
      },
    );

    render(
      <ReasoningProvider>
        <MissionControlView claim="隔夜菜会致癌，等于吃毒药" onComplete={onComplete} onCancel={() => undefined} />
      </ReasoningProvider>,
    );

    await waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(screen.queryByText("这次核查没能完成，请稍后重试。")).not.toBeInTheDocument();
  });

  // 回归（F1）：流正常结束但既无 complete 也无 error 时，不得永远停在「核查中」
  it("falls back to a retryable failure when the stream ends without a terminal event", async () => {
    vi.mocked(requestOrchestrateStream).mockImplementationOnce(
      async function* () {
        // 什么都不产出：模拟代理断流后生成器干净收尾
      },
    );

    render(
      <ReasoningProvider>
        <MissionControlView claim="5G信号塔辐射导致头晕失眠" onCancel={() => undefined} />
      </ReasoningProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText("连接中断了，这次核查没有走完。可以重新核查一次。")).toBeInTheDocument(),
    );
    // 失败态必须给出重试出口，而不是无限转圈
    await waitFor(() => expect(screen.getByText("重新核查")).toBeInTheDocument());
  });
});
