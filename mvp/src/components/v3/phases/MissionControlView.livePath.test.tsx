/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ReasoningProvider } from "../../../store/reasoningStore";
import { MissionControlView } from "./MissionControlView";

function renderLiveCheck() {
  return render(
    <ReasoningProvider>
      <MissionControlView claim="隔夜菜会致癌" onCancel={() => undefined} previewMode />
    </ReasoningProvider>
  );
}

describe("MissionControlView live product path", () => {
  afterEach(() => {
    cleanup();
    window.history.pushState({}, "", "/");
  });

  it("always paints ApodexRunView, not MissionProcessShell or the legacy transcript", () => {
    const { container } = renderLiveCheck();

    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
    expect(container.querySelector(".mps-root")).toBeNull();
    expect(container.querySelector(".mission-topbar")).toBeNull();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("核查对象")).not.toBeInTheDocument();
  });

  it("?shell=legacy still shows ApodexRunView", () => {
    window.history.pushState({}, "", "/?shell=legacy");
    const { container } = renderLiveCheck();

    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
    expect(container.querySelector(".mps-root")).toBeNull();
    expect(container.querySelector(".mission-topbar")).toBeNull();
    expect(screen.queryByLabelText("活动过程时间线")).not.toBeInTheDocument();
  });

  it("?legacyStream=1 still shows ApodexRunView", () => {
    window.history.pushState({}, "", "/?legacyStream=1");
    const { container } = renderLiveCheck();

    expect(screen.getByTestId("apodex-run")).toBeInTheDocument();
    expect(container.querySelector(".mps-root")).toBeNull();
  });
});
