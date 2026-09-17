import { describe, expect, it } from "vitest";
import { buildInvestigationSnapshot } from "./build.js";

const URL = "https://news.cnr.cn/native/gd/20230502/t20230502_526238031.shtml";
const PAGE_TITLE = "长期戴眼镜会变金鱼眼？未见得";
const SNIPPET = [
  "长期戴眼镜会变金鱼眼？未见得。前一节讨论颈肩部肌肉锻炼。",
  "流言 喝气泡水可以降尿酸 真相 气泡水经饮用后，所含二氧化碳进入人体会产生碳酸氢根离子，碳酸氢根属于弱碱性离子，具有一定的中和尿酸的作用，这也是流传说法的主要依据。",
  "但是面对强大的人体系统，气泡水的酸碱中和能力实在是杯水车薪，根本无法引起人体的酸碱变化，更实现不了降尿酸的治疗作用。",
].join(" ");

describe("evidence passage metadata", () => {
  it("keeps canonical page title while attaching the matched subsection and full limiting context", () => {
    const snapshot = buildInvestigationSnapshot({
      originalClaim: "喝气泡水可以降尿酸",
      phase: "judging",
      claimAtoms: ["喝气泡水可以降尿酸"],
      claimAtomTypes: [{ text: "喝气泡水可以降尿酸", verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: ["喝气泡水可以降尿酸"],
        byAtomKey: {
          "喝气泡水可以降尿酸": [{ url: URL, title: PAGE_TITLE, snippet: SNIPPET }],
        },
      },
      subclaimVerdicts: [{
        claimAtom: "喝气泡水可以降尿酸",
        verdict: "false",
        evidence: "原文最终不支持治疗作用[1]。",
        boundary: "",
        // Deliberately model-polluted metadata: builder must ignore it in favour of the bundle.
        supportingSources: [],
        contradictingSources: [{ url: URL, title: "喝气泡水可以降尿酸？真相来了", snippet: "碳酸氢根有一定作用" }],
        evidenceGaps: [],
      }],
      sourceRelationAudits: [{
        claimAtom: "喝气泡水可以降尿酸",
        url: URL,
        relation: "contradict",
        reason: "原文先解释有限机制，随后明确否定实际治疗效果",
      }],
    }, { claimAtomKeyFn: (value) => value });

    expect(snapshot.sources).toHaveLength(1);
    expect(snapshot.sources[0]!.title).toBe(PAGE_TITLE);
    expect(snapshot.sources[0]!.title).not.toContain("真相来了");
    const link = snapshot.claims[0]!.evidence.find((item) => item.sourceId === snapshot.sources[0]!.id)!;
    expect(link.role).toBe("contradict");
    expect(link.sectionTitle).toBe("喝气泡水可以降尿酸");
    expect(link.passage).toContain("具有一定的中和尿酸的作用");
    expect(link.passage).toContain("杯水车薪");
    expect(link.passage).toContain("无法引起人体的酸碱变化");
    expect(link.relationReason).toContain("明确否定实际治疗效果");
  });
});
