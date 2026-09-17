import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SourceDrawer } from "./SourceDrawer";

afterEach(() => cleanup());

describe("SourceDrawer passage metadata", () => {
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
