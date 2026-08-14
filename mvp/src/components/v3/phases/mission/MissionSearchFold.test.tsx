import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MissionSearchFold } from "./MissionSearchFold";
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
    expect(screen.queryByText("WHO 射频")).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("切换来源列表"));
    expect(screen.getByRole("link", { name: "WHO 射频" })).toHaveAttribute(
      "href",
      "https://www.who.int/a"
    );
    expect(screen.queryByText(/sourceCount/)).not.toBeInTheDocument();
  });

  it("hidden: render nothing", () => {
    const { container } = render(<MissionSearchFold status="hidden" sources={[]} />);
    expect(container.firstChild).toBeNull();
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
