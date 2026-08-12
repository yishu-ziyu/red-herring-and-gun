import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  adaptOrchestrateStreamToShell,
  FIXTURE_AGENT_ERROR,
  FIXTURE_AGENT_THOUGHT,
  FIXTURE_COMPLETE,
  FIXTURE_DEBATE,
  FIXTURE_EARLY,
  FIXTURE_ERROR,
  FIXTURE_MID,
  FIXTURE_REVIEW_FAIL,
} from "../../../../lib/missionShell";
import { MissionProcessShell } from "./MissionProcessShell";

describe("MissionProcessShell narrative UI", () => {
  afterEach(() => {
    cleanup();
  });

  it("FIXTURE_MID: no tool strip, no agent cluster, no claim, one current step, activity chips", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const { container } = render(<MissionProcessShell model={model} claimInParent />);

    expect(container.querySelector(".mps-root")).toBeTruthy();
    expect(container.querySelector(".mps-header")).toBeNull();
    expect(container.querySelector(".mps-claim")).toBeNull();
    expect(container.querySelector(".mps-live")).toBeNull();
    expect(screen.queryByRole("list", { name: "协作角色" })).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "过程动作" })).not.toBeInTheDocument();

    // Claim text must not reappear as shell body chrome (parent has it)
    const root = container.querySelector(".mps-root") as HTMLElement;
    // model.claim is long; shell root text should not equal full claim as a dedicated block
    expect(root.querySelector(".mps-claim")).toBeNull();

    const currents = container.querySelectorAll('[aria-current="step"]');
    expect(currents.length).toBe(1);
    expect(container.querySelectorAll(".mps-step--current").length).toBe(1);

    // Investigation checklist mirrors stream progress
    const todos = container.querySelector('[data-testid="investigation-todos"]');
    expect(todos).toBeTruthy();
    expect(todos?.textContent || "").toMatch(/确认核查问题|检索公开材料|对照公开事实/);
    expect(todos?.querySelector('[data-status="done"]')).toBeTruthy();

    // Search tools render WebSearch strip; memory remains activity chips
    expect(container.querySelectorAll('[data-testid="web-search"]').length).toBeGreaterThan(0);
    expect(screen.getByText(/隔夜菜 致癌 证据/)).toBeInTheDocument();
    expect(screen.getByText(/食品安全与亚硝酸盐科普/)).toBeInTheDocument();
    const activities = screen.getAllByRole("list", { name: "步骤活动" });
    expect(activities.length).toBeGreaterThan(0);
    expect(activities[0].classList.contains("mps-activities--chips")).toBe(true);
    const activityText = activities.map((el) => el.textContent || "").join("\n");
    expect(activityText).toMatch(/历史|检索|公开材料/);

    // Primary titles should not be pure tool strip duplicates as both strip+primary
    // (no 过程动作 list at all)
    const body = root.textContent || "";
    expect(body).not.toMatch(/中控|派发|可行动线索|handoff|relay|tool result/i);
  });

  it("FIXTURE_EARLY: no pending wall of empty modules", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY);
    const { container } = render(<MissionProcessShell model={model} />);
    expect(container.querySelectorAll(".mps-step--pending").length).toBe(0);
    expect(screen.queryByText("等待")).not.toBeInTheDocument();
  });

  it("FIXTURE_COMPLETE: verdict primary; no live pill or agent parade", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_COMPLETE);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-live="0"]')).toBeTruthy();
    expect(screen.getByText("结论")).toBeInTheDocument();
    expect(screen.getByText("只能信一部分")).toBeInTheDocument();
    expect(screen.getByText(/加热不当可能产生有害物/)).toBeInTheDocument();
    expect(screen.queryByText("mixed_misleading")).not.toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "协作角色" })).not.toBeInTheDocument();
    expect(container.querySelector(".mps-live")).toBeNull();
    expect(container.querySelector(".mps-verdict--hero")).toBeTruthy();
    // Process folded by default
    expect(screen.getByRole("button", { name: /回看核查过程/ })).toBeInTheDocument();
  });

  it("FIXTURE_REVIEW_FAIL: 结论暂缓, not formal 结论 card; process folded", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_REVIEW_FAIL);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(screen.getByText(/结论暂缓/)).toBeInTheDocument();
    expect(screen.queryByText("结论")).not.toBeInTheDocument();
    expect(container.querySelector(".mps-verdict")).toBeNull();
    expect(container.querySelector(".mps-deferred")).toBeTruthy();
    expect(screen.getByRole("button", { name: /回看核查过程/ })).toBeInTheDocument();
    expect(container.querySelector(".mps-chain")).toBeNull();
    const issueTexts = Array.from(container.querySelectorAll(".mps-review-issue")).map(
      (el) => el.textContent || ""
    );
    expect(issueTexts.some((t) => t.includes("结论过强"))).toBe(true);
  });

  it("FIXTURE_ERROR: interruption alert, no tool strip", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_ERROR);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-error="1"]')).toBeTruthy();
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("过程中断");
    expect(alert).toHaveTextContent("核查失败：上游中断");
    expect(screen.queryByRole("list", { name: "过程动作" })).not.toBeInTheDocument();
    expect(screen.queryByText("结论")).not.toBeInTheDocument();
  });

  it("FIXTURE_AGENT_ERROR: local failure without full-page stream error", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_AGENT_ERROR);
    const { container } = render(<MissionProcessShell model={model} />);

    expect(container.querySelector('.mps-root[data-live="1"]')).toBeTruthy();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Failed step still visible in stream — semantic action, not role as primary title
    expect(container.querySelector(".mps-step--error")).toBeTruthy();
    const stepTitles = Array.from(container.querySelectorAll(".mps-step-title")).map(
      (el) => el.textContent?.trim()
    );
    expect(stepTitles).not.toContain("拆题");
    expect(stepTitles.some((t) => t === "确认核查切入点" || t === "确认核查问题")).toBe(true);
  });

  it("activity is static without onSelectTool; button when handler provided", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const { rerender } = render(<MissionProcessShell model={model} />);
    // Without handler: no clickable activity buttons
    expect(document.querySelectorAll(".mps-activity-btn").length).toBe(0);
    expect(document.querySelectorAll(".mps-activity-static").length).toBeGreaterThan(0);

    const onSelectTool = vi.fn();
    rerender(<MissionProcessShell model={model} onSelectTool={onSelectTool} />);
    const btns = document.querySelectorAll(".mps-activity-btn");
    expect(btns.length).toBeGreaterThan(0);
  });

  it("FIXTURE_DEBATE: shows mediation step without verdict", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_DEBATE);
    render(<MissionProcessShell model={model} />);
    expect(screen.getByText("冲突调解")).toBeInTheDocument();
    expect(screen.queryByText("结论")).not.toBeInTheDocument();
  });

  it("variant=antdx still renders token narrative (antdx frozen)", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    const { container } = render(<MissionProcessShell model={model} variant="antdx" />);
    expect(container.querySelector('.mps-root[data-variant="token"]')).toBeTruthy();
    expect(container.querySelector(".mps-root--antdx")).toBeNull();
    expect(container.querySelectorAll('[aria-current="step"]').length).toBe(1);
  });

  it("FIXTURE_AGENT_THOUGHT: ThinkingReasoning shows live sentences", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_AGENT_THOUGHT);
    const { container } = render(<MissionProcessShell model={model} claimInParent />);

    const tr = container.querySelector('[data-thinking="1"]') as HTMLElement | null;
    expect(tr).toBeTruthy();
    expect(screen.getByLabelText("模型推理进行中")).toBeInTheDocument();
    const body = container.textContent || "";
    expect(body).toMatch(/真实思考句一/);
    expect(body).toMatch(/真实思考句三/);
  });
});
