/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
