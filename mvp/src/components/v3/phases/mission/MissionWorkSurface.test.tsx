import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import {
  adaptOrchestrateStreamToShell,
  FIXTURE_EARLY,
  FIXTURE_MID,
} from "../../../../lib/missionShell";
import { MissionWorkSurface } from "./MissionWorkSurface";

describe("MissionWorkSurface", () => {
  afterEach(() => {
    cleanup();
  });

  it("FIXTURE_EARLY: waits for atoms, names the causal check", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY);
    render(<MissionWorkSurface model={model} />);

    expect(screen.getByLabelText("核对台")).toBeTruthy();
    expect(screen.getByText("这是因果推断")).toBeInTheDocument();
    expect(screen.queryByText("核对台")).not.toBeInTheDocument();
    expect(screen.getByText("拆完会出现条目。")).toBeInTheDocument();
    expect(screen.queryByText("点选左侧")).not.toBeInTheDocument();
    expect(screen.queryByText("整理推理…")).not.toBeInTheDocument();
  });

  it("FIXTURE_MID: auto pane is sources once materials are back", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    render(<MissionWorkSurface model={model} />);

    expect(screen.getByText("食品安全与亚硝酸盐科普")).toBeInTheDocument();
    expect(screen.getByText(/不当储存可能升高风险/)).toBeInTheDocument();
    expect(screen.queryByText("隔夜菜加热产生致癌物")).not.toBeInTheDocument();
  });

  it("FIXTURE_MID: click triage title shows atoms only", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    render(<MissionWorkSurface model={model} selectedTitle="已经拆开要核对的部分" />);

    expect(screen.getByText("隔夜菜加热产生致癌物")).toBeInTheDocument();
    expect(screen.queryByText("食品安全与亚硝酸盐科普")).not.toBeInTheDocument();
  });
});
