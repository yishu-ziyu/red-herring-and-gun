/**
 * 2026-09-28 错误分析：两个独立评审都指出结论卡里堆满「来源无法打开：……」和
 * 「补查后仍缺：当事方、地点」。前者把打不开的链接当成调查缺口，后者把检索流程的内部槽位
 * 挂在已经判定的命题下面。缺口只写「还缺什么才能下判断」。
 */
import { describe, expect, it } from "vitest";
import { buildInvestigationSnapshot } from "./build.js";

const ATOM = "上海车展上演全武行";
const ALIVE = "https://police.example/notice";
const DEAD = "https://dead.example/repost";

function snapshotWith(verdict: "false" | "unverified") {
  return buildInvestigationSnapshot(
    {
      originalClaim: "上海车展上演全武行，展台前有人打架",
      phase: "complete",
      claimAtoms: [ATOM],
      claimAtomTypes: [{ text: ATOM, verifiable: true, type: "fact" }],
      atomSearchBundle: {
        atomsSearched: [ATOM],
        byAtomKey: {
          [ATOM]: [
            { url: ALIVE, title: "警方通报：系编造", snippet: "造谣者已被行政拘留" },
            { url: DEAD, title: "转载：车展打架？", snippet: "网传视频" },
          ],
        },
      },
      subclaimVerdicts: [
        {
          claimAtom: ATOM,
          verdict,
          evidence: verdict === "false" ? "警方通报系编造。" : "",
          boundary: "",
          supportingSources: [],
          contradictingSources: verdict === "false" ? [{ url: ALIVE, title: "警方通报：系编造", snippet: "造谣者已被行政拘留" }] : [],
          evidenceGaps: [],
        },
      ],
      pursuitHops: [{ atom: ATOM, goal: "核对当事方", missingAfter: ["当事方", "地点"] }],
      reachability: { deadUrls: [DEAD] },
      report: { conclusion: "公开材料不支持这条说法。", verdictType: verdict },
    },
    { claimAtomKeyFn: (s) => s.trim() }
  );
}

describe("缺口只写还缺什么才能下判断", () => {
  it("打不开的链接不当缺口，也不列成这条命题的材料", () => {
    const claim = snapshotWith("false").claims[0]!;
    expect(claim.gaps.map((gap) => gap.description).join("")).not.toContain("来源无法打开");
    const snapshot = snapshotWith("false");
    const deadId = snapshot.sources.find((source) => source.url === DEAD)?.id;
    expect(claim.evidence.some((link) => link.sourceId === deadId)).toBe(false);
  });

  it("命题已经判定时，不挂检索流程的「补查后仍缺」", () => {
    const claim = snapshotWith("false").claims[0]!;
    expect(claim.judgment).toBe("refuted");
    expect(claim.gaps.map((gap) => gap.description).join("")).not.toContain("补查后仍缺");
  });

  it("命题还查不清时，补查后仍缺的内容照实写出", () => {
    const claim = snapshotWith("unverified").claims[0]!;
    expect(claim.gaps.map((gap) => gap.description).join("")).toContain("补查后仍缺：当事方、地点");
  });
});
