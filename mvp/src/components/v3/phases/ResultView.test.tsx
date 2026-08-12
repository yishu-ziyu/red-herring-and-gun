import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultView } from "./ResultView";

afterEach(() => {
  cleanup();
});

const SAMPLE_REPORT: Record<string, unknown> = {
  verdictType: "false",
  credibilityLabel: "谣言",
  credibilityScore: 92,
  conclusion: "该说法没有可靠证据支持，属于不实信息。",
  recommendation: "不能信。",
  subclaimVerdicts: [
    {
      claimAtom: "隔夜菜会致癌",
      verdict: "false",
      evidence: "未见权威卫生机构支持该绝对化表述[1]。",
      boundary: "不能推出所有剩菜都有毒。",
      supportingSources: [
        {
          title: "WHO 食品安全",
          url: "https://www.who.int/news-room/fact-sheets/detail/food-safety",
          snippet: "食品安全要点摘要",
        },
      ],
      contradictingSources: [],
      evidenceGaps: [],
    },
  ],
};

describe("ResultView", () => {
  it("renders formal verdict text from finalReport", () => {
    render(
      <ResultView
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const report = screen.getByLabelText("最终核查判断");
    expect(report).toHaveTextContent(/该说法没有可靠证据支持/);
    expect(report).toHaveTextContent(/不能信|谣言|92/);
    expect(screen.getByLabelText("能不能信")).toHaveTextContent("不能信。");
  });

  it("shows reverify button and invokes callback", () => {
    const onReverify = vi.fn();
    render(
      <ResultView
        claim="测试说法"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={onReverify}
      />
    );

    const button = screen.getByRole("button", { name: "重新核查" });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onReverify).toHaveBeenCalledTimes(1);
  });

  it("renders numbered citation footer from supportingSources under conclusion and claim detail", () => {
    render(
      <ResultView
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    // Top conclusion aggregates unique supporting sources as numbered footer.
    expect(screen.getAllByText("WHO 食品安全").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("who.int").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("note")).toHaveTextContent(/句内编号对应下方来源/);

    // Expand claim detail: evidence markers become linked chips bound to source 1.
    fireEvent.click(screen.getByRole("button", { name: /隔夜菜会致癌/ }));
    const chipLinks = screen.getAllByRole("link", { name: /来源 1/ });
    expect(chipLinks.length).toBeGreaterThanOrEqual(1);
    expect(chipLinks[0]).toHaveAttribute(
      "href",
      "https://www.who.int/news-room/fact-sheets/detail/food-safety"
    );
    // Open snippet from claim-detail footer (may also appear under conclusion).
    const toggles = screen.getAllByRole("button", { name: "查看摘要" });
    fireEvent.click(toggles[toggles.length - 1]);
    expect(screen.getByText("食品安全要点摘要")).toBeInTheDocument();
  });

  it("process footprint expands with claim → atoms → sources → verdict summary", () => {
    render(
      <ResultView
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /核查足迹/ }));
    const footprint = screen.getByLabelText("本页可核对的核查足迹");
    expect(footprint).toHaveTextContent("隔夜菜会致癌");
    expect(footprint).toHaveTextContent(/1 条/);
    expect(footprint).toHaveTextContent(/已绑定来源|支撑来源/);
  });
});
