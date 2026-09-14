import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { InvestigationDossier } from "./InvestigationDossier";
import { refutedComplete } from "./fixtures";

describe("InvestigationDossier", () => {
  afterEach(() => {
    cleanup();
  });
  it("renders closed by default with 5 milestone capsules", () => {
    const fixture = refutedComplete();
    render(<InvestigationDossier snapshot={fixture} />);

    expect(screen.getByText("调查全案卷与时空回溯")).toBeInTheDocument();
    expect(screen.getByText("0.0s")).toBeInTheDocument();
    expect(screen.getByText("1.4s")).toBeInTheDocument();
    expect(screen.getByText("2.1s")).toBeInTheDocument();
    expect(screen.getByText("15.2s")).toBeInTheDocument();
    expect(screen.getByText("23.4s")).toBeInTheDocument();
    expect(screen.queryByText(/深度思考过程与边界推导/)).toBeNull();
  });

  it("expands on toggle click and reveals thinking and activity sections", () => {
    const fixture = refutedComplete();
    render(<InvestigationDossier snapshot={fixture} />);

    const toggleBtn = screen.getByText(/展开慢动作与思考全链条/);
    fireEvent.click(toggleBtn);

    expect(screen.getByText(/深度思考过程与边界推导/)).toBeInTheDocument();
    expect(screen.getByText(/实时活动流与事实检索凭据/)).toBeInTheDocument();
  });

  it("selects a specific milestone on milestone capsule click", () => {
    const fixture = refutedComplete();
    render(<InvestigationDossier snapshot={fixture} />);

    const m2Btn = screen.getByText("1.4s");
    fireEvent.click(m2Btn);

    expect(screen.getByText("核查节点 02")).toBeInTheDocument();
    expect(screen.getByText(/锁定核查边界，排除二传二改噪音/)).toBeInTheDocument();
  });
});
