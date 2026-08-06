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
  recommendation: "不要继续转发。",
  subclaimVerdicts: [
    {
      claimAtom: "隔夜菜会致癌",
      verdict: "false",
      evidence: "未见权威卫生机构支持该绝对化表述。",
      boundary: "不能推出所有剩菜都有毒。",
      supportingSources: [],
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
    expect(report).toHaveTextContent(/倾向不成立|谣言|92/);
    expect(screen.getByLabelText("转发建议")).toHaveTextContent("不要继续转发。");
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
});
