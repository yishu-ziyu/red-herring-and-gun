import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import {
  adaptOrchestrateStreamToShell,
  FIXTURE_AGENT_ERROR,
  FIXTURE_COMPLETE,
  FIXTURE_DEBATE,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_REVIEW_FAIL,
  type MissionShellModel,
} from "../../../../lib/missionShell";
import { MissionProcessShell } from "./MissionProcessShell";

function ControlledShell({ model }: { model: MissionShellModel }) {
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  return (
    <MissionProcessShell
      model={model}
      selectedAgentId={selectedAgentId}
      onSelectAgent={(id) => setSelectedAgentId(id || null)}
    />
  );
}

describe("MissionProcessShell", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders FIXTURE_MID without crash", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector(".mps-root")).toBeTruthy();
    expect(container.querySelector('.mps-root[data-live="1"]')).toBeTruthy();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "协作角色" })).toBeInTheDocument();
    expect(screen.getByRole("list", { name: "过程动作" })).toBeInTheDocument();
  });

  it("renders FIXTURE_COMPLETE with verdict and data-live=0", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-live="0"]')).toBeTruthy();
    expect(screen.getByText("结论")).toBeInTheDocument();
    expect(screen.getByText("部分误导/夸大")).toBeInTheDocument();
    expect(screen.queryByText("mixed_misleading")).not.toBeInTheDocument();
    expect(screen.getAllByText(/报告审稿/).length).toBeGreaterThan(0);
    // Agent strip summaries are Chinese, not raw enums
    expect(screen.getByText("事实判定：部分成立")).toBeInTheDocument();
    expect(screen.queryByText(/事实判定：partial/i)).not.toBeInTheDocument();
    expect(screen.getByText("信源：中")).toBeInTheDocument();
    expect(screen.queryByText(/信源：medium/i)).not.toBeInTheDocument();
  });

  it("renders FIXTURE_ERROR with interrupted badge and alert", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_ERROR);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-live="0"]')).toBeTruthy();
    expect(container.querySelector('.mps-root[data-error="1"]')).toBeTruthy();
    expect(screen.getByText("已中断")).toBeInTheDocument();
    // phase header + error card label both say 过程中断
    expect(screen.getAllByText("过程中断").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("已完成")).not.toBeInTheDocument();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("过程中断");
    expect(alert).toHaveTextContent("核查失败：上游中断");
    expect(screen.queryByText("结论")).not.toBeInTheDocument();
  });

  it("renders FIXTURE_REVIEW_FAIL with 需补证 review banner", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_REVIEW_FAIL);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(screen.getByText("结论")).toBeInTheDocument();
    expect(screen.getByText("尚难核实")).toBeInTheDocument();
    expect(screen.getByText(/报告审稿 · 需补证 · 48/)).toBeInTheDocument();
    // Tool strip detail from adapter: passed=false → 需补证
    const tools = screen.getByRole("list", { name: "过程动作" });
    expect(within(tools).getByText(/需补证/)).toBeInTheDocument();
    const reviewIssues = container.querySelectorAll(".mps-review-issue");
    expect(reviewIssues.length).toBeGreaterThan(0);
    expect(reviewIssues.length).toBeLessThanOrEqual(3);
    // error severity → 「严重 · 」prefix; message body still visible
    const issueTexts = Array.from(reviewIssues).map((el) => el.textContent ?? "");
    expect(issueTexts.some((t) => t.includes("结论过强"))).toBe(true);
    expect(issueTexts.some((t) => t.includes("严重 ·") && t.includes("结论过强"))).toBe(true);
    // warn severity → 「注意 · 」prefix
    expect(issueTexts.some((t) => t.includes("注意 ·") && t.includes("证据链为空"))).toBe(true);
  });

  it("renders FIXTURE_AGENT_ERROR as live with failed agent chip", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_AGENT_ERROR);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-live="1"]')).toBeTruthy();
    expect(container.querySelector('.mps-root[data-error="0"]')).toBeTruthy();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("角色异常")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    const agents = screen.getByRole("list", { name: "协作角色" });
    expect(within(agents).getByText("失败")).toBeInTheDocument();
    expect(within(agents).getByText("立案分诊")).toBeInTheDocument();
  });

  it("renders FIXTURE_DEBATE with phase 冲突调解 and debate thought", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_DEBATE);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-live="1"]')).toBeTruthy();
    expect(screen.getByText("进行中")).toBeInTheDocument();
    expect(screen.getByText("冲突调解")).toBeInTheDocument();
    expect(screen.getByText("Agent 冲突调解室")).toBeInTheDocument();
    expect(screen.queryByText("结论")).not.toBeInTheDocument();
  });

  it("click 事实核查 chip filters thoughts; click 显示全部 restores", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const { container } = render(<ControlledShell model={model} />);

    const chain = () => container.querySelector(".mps-chain") as HTMLElement;
    const stepTitles = () =>
      Array.from(chain().querySelectorAll(".mps-step-title")).map((el) => el.textContent?.trim());

    // Unfiltered FIXTURE_MID: planner + tools + 3 agents
    expect(stepTitles()).toEqual([
      "理解命题与路径",
      "查阅历史案件",
      "立案分诊",
      "检索公开材料",
      "事实核查",
      "信源审计",
    ]);
    expect(screen.queryByText("已筛选角色过程")).not.toBeInTheDocument();

    const agents = screen.getByRole("list", { name: "协作角色" });
    // role=listitem on button yields empty accessible name in jsdom; click by chip label.
    const factChip = within(agents).getByText("事实核查").closest("button");
    expect(factChip).toBeTruthy();
    fireEvent.click(factChip!);

    expect(screen.getByText("已筛选角色过程")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "显示全部" })).toBeInTheDocument();
    // Filter keeps planner + matching agent; drops other agents/tools
    expect(stepTitles()).toEqual(["理解命题与路径", "事实核查"]);
    expect(within(chain()).queryByText("立案分诊")).not.toBeInTheDocument();
    expect(within(chain()).queryByText("信源审计")).not.toBeInTheDocument();
    expect(within(chain()).queryByText("查阅历史案件")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "显示全部" }));

    expect(screen.queryByText("已筛选角色过程")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "显示全部" })).not.toBeInTheDocument();
    expect(stepTitles()).toEqual([
      "理解命题与路径",
      "查阅历史案件",
      "立案分诊",
      "检索公开材料",
      "事实核查",
      "信源审计",
    ]);
  });
});
