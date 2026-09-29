import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceDrawer, type SourceDrawerView } from "./SourceDrawer";
import { PromptKitSource } from "./PromptKitSource";

afterEach(() => cleanup());

describe("SourceDrawer passage metadata", () => {
  const quote = "苏打水的作用有限，不能替代治疗。";
  const view: SourceDrawerView = {
    claimId: "claim-1", claimIndex: 0, claimText: "喝苏打水就够了",
    source: { id: "src-1", url: "https://example.com/article#section", title: "说明", excerpt: "搜索摘要" },
    link: { sourceId: "src-1", role: "contradict", passage: quote, quoteVerified: true },
  };

  it("labels a verified quote as original text and links to that exact passage", () => {
    render(<SourceDrawer view={view} onClose={() => {}} />);
    expect(screen.getByText("原文摘录")).toBeInTheDocument();
    expect(screen.getByText(quote)).toBeInTheDocument();
    const url = new URL(screen.getByRole("link", { name: /打开原文/ }).getAttribute("href")!);
    expect(url.origin + url.pathname).toBe("https://example.com/article");
    expect(decodeURIComponent(url.hash)).toBe(`#section:~:text=${quote}`);
  });

  it("does not call a search excerpt original text or add a quote locator", () => {
    render(<SourceDrawer view={{ ...view, link: { sourceId: "src-1", role: "context-only" } }} onClose={() => {}} />);
    expect(screen.getByText("材料摘录")).toBeInTheDocument();
    expect(screen.queryByText("原文摘录")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /打开原文/ })).toHaveAttribute("href", view.source.url);
  });

  it("shows the same claim-specific quote in the source preview and drawer", () => {
    render(<PromptKitSource link={view.link} source={view.source} claimId={view.claimId} onSelect={() => {}} />);
    expect(screen.getByText(quote)).toBeInTheDocument();
    expect(screen.queryByText("搜索摘要")).not.toBeInTheDocument();
  });

  it("shows the real page title separately from the matched subsection and uses passage over page excerpt", () => {
    render(
      <SourceDrawer
        onClose={() => {}}
        view={{
          claimId: "claim-1",
          claimIndex: 0,
          claimText: "喝气泡水可以降尿酸",
          source: {
            id: "src-1",
            url: "https://news.cnr.cn/native/gd/20230502/t20230502_526238031.shtml",
            title: "长期戴眼镜会变金鱼眼？未见得",
            excerpt: "页面开头讲眼镜和颈肩问题。",
          },
          link: {
            sourceId: "src-1",
            role: "contradict",
            sectionTitle: "喝气泡水可以降尿酸",
            passage: "碳酸氢根具有一定中和尿酸作用，但是面对人体系统杯水车薪，无法引起人体酸碱变化，更实现不了治疗作用。",
            relationReason: "完整段落最终否定实际治疗效果。",
          },
          relatedSources: [],
        }}
      />,
    );

    expect(screen.getByText("长期戴眼镜会变金鱼眼？未见得")).toBeInTheDocument();
    expect(screen.getByText(/命中小节：喝气泡水可以降尿酸/)).toBeInTheDocument();
    expect(screen.getByText(/杯水车薪/)).toBeInTheDocument();
    expect(screen.queryByText("页面开头讲眼镜和颈肩问题。")).not.toBeInTheDocument();
    expect(screen.getByText(/为什么是这个关系：完整段落最终否定实际治疗效果/)).toBeInTheDocument();
  });
});
