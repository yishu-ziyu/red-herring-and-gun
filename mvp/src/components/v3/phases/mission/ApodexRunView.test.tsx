import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import {
  adaptOrchestrateStreamToShell,
  FIXTURE_COMPLETE,
  FIXTURE_EARLY,
  FIXTURE_MID,
  FIXTURE_LOOP_PROGRESSIVE,
} from "../../../../lib/missionShell";
import { setUiLang, UI_LANG_KEY } from "../../../../lib/uiLang";
import { mapShellToApodexRun } from "./apodexRunMap";
import { ApodexRunView } from "./ApodexRunView";

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(UI_LANG_KEY);
  setUiLang("zh");
});

describe("ApodexRunView", () => {
  it("live: shows claim, compact thinking ticker, locked follow-up, Stop calls onStop", () => {
    const onStop = vi.fn();
    const model = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_EARLY));
    render(<ApodexRunView model={model} elapsedMs={4200} runStatus="running" onStop={onStop} />);

    expect(screen.getByTestId("apodex-run")).toHaveAttribute("data-live", "true");
    expect(screen.getByText("隔夜菜加热会致癌吗")).toBeInTheDocument();
    expect(screen.getByText("核查过程")).toBeInTheDocument();
    expect(screen.getByText(/思考中/)).toBeInTheDocument();
    expect(screen.queryByText("深入思考")).not.toBeInTheDocument();
    expect(screen.getByText("已创建任务板")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("核查进行中")).toBeDisabled();
    expect(screen.queryByText("核心结论")).not.toBeInTheDocument();
    expect(screen.queryByText(/美联储|Federal Reserve/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /停止/ }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("mid: Search web stays collapsed until clicked, then shows sources, not Fed", () => {
    const model = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_MID));
    render(<ApodexRunView model={model} onStop={() => undefined} />);

    expect(screen.getAllByText("隔夜菜 致癌 证据").length).toBeGreaterThan(0);
    expect(screen.queryByText(/who\.int|食品安全/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("检索网页"));
    expect(screen.getAllByText(/who\.int|食品安全/).length).toBeGreaterThan(0);
    expect(screen.queryByText("打开页面")).not.toBeInTheDocument();
    expect(screen.queryByText(/Federal Reserve/)).not.toBeInTheDocument();
  });

  it("live loop: 深入思考 sits between 检索网页 and 打开页面", () => {
    const model = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(FIXTURE_LOOP_PROGRESSIVE, { claim: "隔夜菜加热会致癌吗" })
    );
    render(<ApodexRunView model={model} elapsedMs={5600} runStatus="running" onStop={() => undefined} />);

    expect(screen.getByTestId("apodex-run")).toHaveAttribute("data-live", "true");
    expect(screen.getAllByText("深入思考").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("检索网页")).toBeInTheDocument();
    expect(screen.getAllByText("打开页面").length).toBeGreaterThanOrEqual(1);

    const text = screen.getByTestId("apodex-run").textContent ?? "";
    const searchAt = text.indexOf("检索网页");
    const visitAt = text.indexOf("打开页面");
    const thoughtBetween = text.indexOf("深入思考", searchAt);
    expect(searchAt).toBeGreaterThan(-1);
    expect(visitAt).toBeGreaterThan(searchAt);
    expect(thoughtBetween).toBeGreaterThan(searchAt);
    expect(thoughtBetween).toBeLessThan(visitAt);
  });

  it("English switch restores Apodex chrome without leaving Chinese process words", () => {
    const model = mapShellToApodexRun(
      adaptOrchestrateStreamToShell(FIXTURE_LOOP_PROGRESSIVE, { claim: "隔夜菜加热会致癌吗" })
    );
    render(<ApodexRunView model={model} elapsedMs={5600} runStatus="running" onStop={() => undefined} />);
    fireEvent.click(screen.getByRole("button", { name: "English" }));
    expect(screen.getByText("Run process")).toBeInTheDocument();
    expect(screen.getByText("Search web")).toBeInTheDocument();
    expect(screen.getAllByText("Thought deeply").length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText("核查过程")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "中文" }));
    expect(screen.getByText("核查过程")).toBeInTheDocument();
  });

  it("complete: 核心结论 answers the claim, process is folded, follow-up still cannot send", () => {
    const onStop = vi.fn();
    const model = mapShellToApodexRun(adaptOrchestrateStreamToShell(FIXTURE_COMPLETE));
    render(<ApodexRunView model={model} runStatus="completed" onStop={onStop} stopLabel="停止" />);

    expect(screen.getByLabelText("核心结论")).toBeInTheDocument();
    expect(screen.queryByText(/^\s*只能信一部分/)).not.toBeInTheDocument();
    expect(screen.getByText(/说法存在夸大/)).toBeInTheDocument();
    expect(screen.getByText("REFERENCES")).toBeInTheDocument();
    expect(screen.queryByText("检索网页")).not.toBeInTheDocument();
    expect(screen.queryByText(/美联储|Federal Reserve/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("核查过程"));
    expect(screen.getByText("检索网页")).toBeInTheDocument();

    const send = screen.getByLabelText("发送不可用");
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "再查一条" }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });
});
