import { describe, expect, it } from "vitest";
import { evidenceTitle } from "./snapshotUi";

// 2026-09-28 错误分析 NEW-003：辟谣合集《长期戴眼镜会变金鱼眼?未见得》里命中了「喝气泡水可以降尿酸」一节，
// 列表只显示合集标题，两个评审都以为系统拿错了材料。
describe("出处标题：命中小节优先", () => {
  const source = { id: "s1", url: "https://cnr.example/roundup", title: "长期戴眼镜会变金鱼眼?未见得" };

  it("有命中小节时先写小节，合集标题作为出处", () => {
    expect(evidenceTitle({ sectionTitle: "喝气泡水可以降尿酸" }, source)).toBe(
      "喝气泡水可以降尿酸（出自《长期戴眼镜会变金鱼眼?未见得》）"
    );
  });

  it("没有小节、或小节就是页面标题时，照旧显示页面标题", () => {
    expect(evidenceTitle({}, source)).toBe("长期戴眼镜会变金鱼眼?未见得");
    expect(evidenceTitle({ sectionTitle: "长期戴眼镜会变金鱼眼?未见得" }, source)).toBe("长期戴眼镜会变金鱼眼?未见得");
  });

  it("没有标题时退回网址", () => {
    expect(evidenceTitle({}, { id: "s2", url: "https://a.example/x", title: "" })).toBe("https://a.example/x");
  });
});
