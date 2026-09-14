import { describe, expect, it } from "vitest";
import { buildReportEvidenceInputs, compactSearchResultForAgent } from "./searchProviders";

const searchResult = {
  sources: [
    {
      id: "S1",
      title: "咖啡与茶的千年战争",
      url: "https://digitaling.com/a",
      domain: "digitaling.com",
      snippet: "文化较量",
    },
    { id: "S2", name: "腾讯新闻", url: "https://new.qq.com/b" },
  ],
};

describe("写作输入不带来源序号", () => {
  it("compactSearchResultForAgent 不把 S1 交给模型", () => {
    const compact = compactSearchResultForAgent(searchResult);
    const blob = JSON.stringify(compact);
    expect(blob).not.toMatch(/"S\d+"/);
    expect(compact.sources[0]).not.toHaveProperty("id");
    expect(compact.sources[0]).not.toHaveProperty("ref");
    expect(compact.sources[0]!.title).toBe("咖啡与茶的千年战争");
    expect(compact.sources[0]!.url).toBe("https://digitaling.com/a");
  });

  it("buildReportEvidenceInputs 同样不带 S1", () => {
    const inputs = buildReportEvidenceInputs([], searchResult);
    const blob = JSON.stringify(inputs.searchSummary.sources);
    expect(blob).not.toMatch(/"S\d+"/);
    expect(inputs.searchSummary.sources[0]).not.toHaveProperty("ref");
    expect(inputs.searchSummary.sources[0]!.title).toBe("咖啡与茶的千年战争");
  });
});
