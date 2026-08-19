import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MissionSearchFold } from "./MissionSearchFold";
import { MissionPursuitFold } from "./MissionPursuitFold";
import { MissionThreadAnswer } from "./MissionThreadAnswer";

describe("MissionSearchFold", () => {
  afterEach(() => cleanup());

  it("searching: one quiet line, not expandable", () => {
    render(<MissionSearchFold status="searching" sources={[]} />);
    expect(screen.getByLabelText("正在检索公开来源")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("ready: collapsed titles, expand shows links only", () => {
    render(
      <MissionSearchFold
        status="ready"
        sources={[
          { title: "WHO 射频", url: "https://www.who.int/a" },
          { title: "ICNIRP", url: "https://www.icnirp.org/" },
        ]}
      />
    );
    expect(screen.getByText("查了 2 处来源")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "WHO 射频" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("切换来源列表"));
    expect(screen.getByRole("link", { name: "WHO 射频" })).toHaveAttribute(
      "href",
      "https://www.who.int/a"
    );
    expect(screen.queryByText(/sourceCount/)).not.toBeInTheDocument();
  });

  it("searching: first source live, later sources stay pending", () => {
    render(
      <MissionSearchFold
        status="searching"
        query="隔夜菜 致癌"
        sources={[
          { title: "食品安全与亚硝酸盐科普", url: "https://www.who.int/a" },
          { title: "ICNIRP", url: "https://www.icnirp.org/" },
          { title: "CDC", url: "https://www.cdc.gov/" },
        ]}
      />
    );
    expect(screen.getByText(/隔夜菜 致癌/)).toBeInTheDocument();
    const rows = document.querySelectorAll("li [data-state]");
    expect(rows[0]).toHaveAttribute("data-state", "loading");
    expect(rows[1]).toHaveAttribute("data-state", "pending");
    expect(rows[2]).toHaveAttribute("data-state", "pending");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("hidden: render nothing", () => {
    const { container } = render(<MissionSearchFold status="hidden" sources={[]} />);
    expect(container.firstChild).toBeNull();
  });
});

describe("MissionPursuitFold", () => {
  afterEach(() => cleanup());
  it("stays quiet until hops exist, then folds the cognitive trail", () => {
    const { container } = render(<MissionPursuitFold hops={[]} />);
    expect(container.firstChild).toBeNull();

    render(
      <MissionPursuitFold
        hops={[
          {
            hop: 1,
            goal: "找原始发布",
            query: "某地地震 官方通报",
            resultKind: "repost",
            resultKindLabel: "二手转载",
            missingAfter: ["原始来源"],
            status: "success",
          },
        ]}
      />
    );
    expect(screen.getByText("追索了 1 跳")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("切换证据追索"));
    expect(screen.getByText("找原始发布")).toBeInTheDocument();
    expect(screen.getByText(/二手转载/)).toBeInTheDocument();
    expect(screen.queryByText(/Google|Search Agent/i)).not.toBeInTheDocument();
  });
});

describe("MissionThreadAnswer", () => {
  afterEach(() => cleanup());

  it("verdict sits outside thinking: 不能信 + lede", () => {
    render(
      <MissionThreadAnswer
        finalReport={{
          verdictType: "false",
          conclusion: "公开材料不支持这句话。",
        }}
        sources={[{ title: "WHO", url: "https://www.who.int/a" }]}
      />
    );
    const answer = screen.getByLabelText("判断");
    expect(answer).toHaveTextContent("不能信");
    expect(answer).toHaveTextContent("公开材料不支持这句话。");
    expect(screen.getByRole("link", { name: "who.int" })).toBeInTheDocument();
  });

  it("interrupted copy, not 还查不清", () => {
    render(
      <MissionThreadAnswer finalReport={{ _source: "error-boundary" }} />
    );
    expect(screen.getByLabelText("判断")).toHaveTextContent("这次没查完");
    expect(screen.queryByText("还查不清")).not.toBeInTheDocument();
  });
});
