import { describe, expect, it } from "vitest";
import {
  formatPursuitDetail,
  hopsFromReport,
  hopsFromTools,
  isEvidencePursuitTool,
} from "./evidencePursuitUi";

describe("evidencePursuitUi", () => {
  it("does not treat pursuit hops as a search-engine tool", () => {
    expect(isEvidencePursuitTool({ toolName: "证据追索", title: "追索证据" })).toBe(true);
    expect(isEvidencePursuitTool({ toolName: "Evidence Loop" })).toBe(true);
    expect(isEvidencePursuitTool({ result: { kind: "evidence_pursuit" } })).toBe(true);
    expect(isEvidencePursuitTool({ toolName: "Atom Search", title: "检索公开材料" })).toBe(false);
  });

  it("formats hops as goal / query / kind / remaining gap", () => {
    expect(
      formatPursuitDetail({
        goal: "找原始发布",
        query: "某地地震 官方通报",
        resultKind: "repost",
        missingAfter: ["原始来源", "反证"],
      })
    ).toBe("目标：找原始发布 · 搜「某地地震 官方通报」 · 二手转载 · 还缺原始来源、反证");
  });

  it("reads hops from the report and from live tools", () => {
    const fromReport = hopsFromReport({
      evidencePursuit: {
        hops: [{ hop: 1, goal: "找原始发布", query: "q", resultKind: "primary", missingAfter: [] }],
      },
    });
    expect(fromReport).toHaveLength(1);
    expect(fromReport[0]?.resultKindLabel).toBe("原始来源");

    const fromTools = hopsFromTools([
      {
        toolName: "证据追索",
        query: "q2",
        status: "loading",
        result: { kind: "evidence_pursuit", goal: "找反证或辟谣", round: 2, missingEvidence: ["反证"] },
      },
    ]);
    expect(fromTools[0]?.status).toBe("loading");
    expect(fromTools[0]?.goal).toBe("找反证或辟谣");
  });
});
