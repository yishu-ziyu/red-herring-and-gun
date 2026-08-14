import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InlineCitations, toCiteRefs, toCiteRefsFromStrings, hostFromUrl } from "./InlineCitations";

afterEach(() => {
  cleanup();
});

describe("toCiteRefs", () => {
  it("numbers sources 1-based and extracts host", () => {
    const refs = toCiteRefs([
      { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762" },
      { title: "Survey", url: "https://www.arxiv.org/abs/2009.06732" },
    ]);
    expect(refs.map((r) => ({ n: r.n, host: r.host, url: r.url }))).toEqual([
      { n: 1, host: "arxiv.org", url: "https://arxiv.org/abs/1706.03762" },
      { n: 2, host: "arxiv.org", url: "https://www.arxiv.org/abs/2009.06732" },
    ]);
  });

  it("dedupes by URL", () => {
    const refs = toCiteRefs([
      { title: "A", url: "https://example.com/a" },
      { title: "A again", url: "https://example.com/a" },
    ]);
    expect(refs).toHaveLength(1);
  });
});

describe("toCiteRefsFromStrings / hostFromUrl", () => {
  it("keeps only http(s) URLs", () => {
    const refs = toCiteRefsFromStrings(["https://who.int/a", "某媒体", "http://example.com/x"]);
    expect(refs.map((r) => r.url)).toEqual(["https://who.int/a", "http://example.com/x"]);
  });
  it("strips www", () => {
    expect(hostFromUrl("https://www.example.com/path")).toBe("example.com");
  });
});

describe("InlineCitations", () => {
  const sources = [
    { title: "Attention Is All You Need", url: "https://arxiv.org/abs/1706.03762", snippet: "Transformer paper." },
    { title: "Efficient Transformers", url: "https://arxiv.org/abs/2009.06732" },
  ];

  it("turns [n] into chips bound to sources[n-1] and lists footer", () => {
    render(
      <InlineCitations
        text="Transformers scale well[1], though attention is quadratic[2]."
        sources={sources}
      />
    );

    const chip1 = screen.getByRole("link", { name: /来源 1/ });
    expect(chip1).toHaveAttribute("href", "https://arxiv.org/abs/1706.03762");
    expect(screen.getByRole("link", { name: /来源 2/ })).toHaveAttribute(
      "href",
      "https://arxiv.org/abs/2009.06732"
    );
    expect(screen.getAllByText("Attention Is All You Need").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/引用与来源|来源/)).toBeInTheDocument();
  });

  it("clicking chip highlights footer row and expands snippet", () => {
    render(
      <InlineCitations text="依据[1]。" sources={[sources[0]]} />
    );
    // Chip click focuses footer and expands snippet when present.
    fireEvent.click(screen.getByRole("link", { name: /来源 1：/ }));
    expect(screen.getByText("Transformer paper.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起摘要" })).toBeInTheDocument();
  });

  it("relatedOnly strips markers and labels footer as 相关检索", () => {
    render(
      <InlineCitations text="模型写了[1]。" sources={[sources[0]]} relatedOnly />
    );
    expect(screen.queryByRole("link", { name: /来源 1：/ })).not.toBeInTheDocument();
    expect(screen.getByText(/相关检索/)).toBeInTheDocument();
    expect(screen.getByText("模型写了。")).toBeInTheDocument();
  });

  it("still shows footer when text has no markers", () => {
    render(<InlineCitations text="未见权威机构支持该绝对化表述。" sources={[sources[0]]} />);
    expect(screen.getByText("未见权威机构支持该绝对化表述。")).toBeInTheDocument();
    expect(screen.getAllByText("Attention Is All You Need").length).toBeGreaterThanOrEqual(1);
  });
});
