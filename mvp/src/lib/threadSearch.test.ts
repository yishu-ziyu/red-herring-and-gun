import { describe, expect, it } from "vitest";
import { adaptOrchestrateStreamToShell } from "./missionShell";
import { FIXTURE_EARLY, FIXTURE_MID } from "./missionShell/fixtures";
import {
  collectThreadSources,
  isSearchTool,
  sourceDisplayUrl,
  threadSearchQuery,
  threadSearchStatus,
} from "./threadSearch";

describe("threadSearch", () => {
  it("ignores memory / reviewer tools", () => {
    expect(isSearchTool({ toolId: "memory_search", title: "查阅历史案件" })).toBe(false);
    expect(isSearchTool({ toolId: "report_reviewer", toolName: "Report Reviewer" })).toBe(false);
    expect(isSearchTool({ toolName: "证据追索", title: "追索证据" })).toBe(false);
    expect(isSearchTool({ toolId: "search360", title: "检索公开材料" })).toBe(true);
  });

  it("FIXTURE_EARLY: no public search line", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_EARLY);
    expect(threadSearchStatus(model.tools)).toBe("hidden");
    expect(collectThreadSources(model.tools)).toEqual([]);
  });

  it("reads the live search query from the search tool", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    expect(threadSearchQuery(model.tools)).toBe("隔夜菜 致癌 证据");
    expect(sourceDisplayUrl("https://www.who.int/food")).toBe("who.int/food");
  });

  it("FIXTURE_MID: titles from search result, not JSON", () => {
    const model = adaptOrchestrateStreamToShell(FIXTURE_MID);
    expect(threadSearchStatus(model.tools)).toBe("ready");
    const sources = collectThreadSources(model.tools);
    expect(sources.map((s) => s.title)).toEqual([
      "食品安全与亚硝酸盐科普",
      "隔夜菜风险条件说明",
      "科普中国：隔夜菜致癌说法辨析",
    ]);
    expect(JSON.stringify(sources)).not.toMatch(/sourceCount/);
  });

  it("searching while a search tool is loading", () => {
    expect(
      threadSearchStatus([{ toolId: "search360", title: "检索公开材料", status: "loading" }])
    ).toBe("searching");
  });

  it("ready from report sources even without live tools", () => {
    const sources = collectThreadSources([], {
      citationSources: [{ title: "WHO", url: "https://www.who.int/a" }],
    });
    expect(sources).toEqual([{ title: "WHO", url: "https://www.who.int/a" }]);
    expect(threadSearchStatus([], { citationSources: sources })).toBe("ready");
  });
});
