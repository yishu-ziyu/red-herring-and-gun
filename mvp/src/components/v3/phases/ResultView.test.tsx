import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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
    expect(report.querySelector(".mission-final-conclusion > span")).toHaveTextContent("结论");
    expect(report).not.toHaveTextContent("一句话结论");
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

  it("renders interrupted judgment without padded composer copy", () => {
    render(
      <ResultView
        claim="房屋养老金要从工资里扣"
        finalReport={{
          verdictType: "unverified",
          credibilityLabel: "未能判断",
          credibilityScore: 30,
          conclusion: "本次核查未能完成最终判断：模型服务暂时不可用。",
          recommendation: "请稍后重试，或检查模型配置后重新发起核查。",
          citationSources: [{ title: "央行公开说明", url: "https://example.com/pboc" }],
          evidenceChain: [
            {
              layer: "证据",
              finding: "审核器补全：前序输出未提供完整证据链",
              evidence: "（审稿补全，非新增外部事实）",
              sourceRefs: [],
            },
          ],
          _source: "error-boundary",
        }}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    const report = screen.getByLabelText("最终核查判断");
    expect(within(report).getByText("这次没查完")).toBeInTheDocument();
    expect(within(report).getByRole("button", { name: "再查一次" })).toBeInTheDocument();
    expect(within(report).getByRole("link", { name: "央行公开说明" })).toHaveAttribute(
      "href",
      "https://example.com/pboc"
    );
    expect(within(report).queryByText(/审核器补全/)).not.toBeInTheDocument();
    expect(within(report).queryByText(/模型服务暂时不可用/)).not.toBeInTheDocument();
  });

  it("dossier variant drops page chrome and process footprint", () => {
    render(
      <ResultView
        variant="dossier"
        claim="隔夜菜会致癌，吃了等于吃毒药"
        finalReport={SAMPLE_REPORT}
        onBack={() => {}}
        onReverify={() => {}}
      />
    );

    expect(screen.queryByText("返回")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /核查足迹/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重新核查" })).toBeInTheDocument();
    expect(screen.getByLabelText("最终核查判断")).toHaveTextContent(/该说法没有可靠证据支持/);
  });
});
