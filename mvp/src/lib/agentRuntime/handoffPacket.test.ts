import { describe, expect, it } from "vitest";
import {
  buildHandoffPacket,
  buildHandoffPacketsFromSteps,
  type HandoffPacket,
} from "./handoffPacket";

const longAtom =
  "这是一条非常非常长的原子命题文本，用于验证 handoff packet 会对字符串做截断处理，" +
  "避免把整段分析原样塞进下游 agent 的上下文窗口。" +
  "继续填充到超过二百六十字：ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(4);

describe("buildHandoffPacket — route shapes", () => {
  it("rumor_detector → fact_checker: claimAtoms, neededEvidence, rumorTypes, severity", () => {
    const packet = buildHandoffPacket("rumor_detector", "fact_checker", {
      claimAtoms: ["原子A", "原子B"],
      neededEvidence: ["官方通报", "时间线"],
      rumorTypes: ["夸大因果"],
      severity: "high",
      analysis: "should not appear in packet",
      detectedPatterns: ["noise"],
    });

    expect(packet).not.toBeNull();
    expect(packet!.from).toBe("rumor_detector");
    expect(packet!.to).toBe("fact_checker");
    expect(Object.keys(packet!.payload).sort()).toEqual(
      ["claimAtoms", "neededEvidence", "rumorTypes", "severity"].sort()
    );
    expect(packet!.payload.claimAtoms).toEqual(["原子A", "原子B"]);
    expect(packet!.payload.neededEvidence).toEqual(["官方通报", "时间线"]);
    expect(packet!.payload.rumorTypes).toEqual(["夸大因果"]);
    expect(packet!.payload.severity).toBe("high");
    expect(packet!.payload).not.toHaveProperty("analysis");
  });

  it("rumor_detector → source_validator: claimAtoms, rumorIndicators, neededEvidence", () => {
    const packet = buildHandoffPacket("rumor_detector", "source_validator", {
      claimAtoms: ["命题1"],
      rumorIndicators: ["情绪化标题", "匿名信源"],
      neededEvidence: ["原始出处"],
      severity: "medium",
      rumorTypes: ["should not be in this route"],
    });

    expect(packet).not.toBeNull();
    expect(Object.keys(packet!.payload).sort()).toEqual(
      ["claimAtoms", "neededEvidence", "rumorIndicators"].sort()
    );
    expect(packet!.payload.rumorIndicators).toEqual(["情绪化标题", "匿名信源"]);
    expect(packet!.payload).not.toHaveProperty("severity");
    expect(packet!.payload).not.toHaveProperty("rumorTypes");
  });

  it("fact_checker → report_composer: factCheckResult, keyFindings, gaps, counterEvidence", () => {
    const packet = buildHandoffPacket("fact_checker", "report_composer", {
      factCheckResult: "partial",
      keyFindings: ["发现一", "发现二"],
      unresolvedEvidenceGaps: ["缺一手材料"],
      counterEvidence: ["反证链接"],
      sources: ["should not appear"],
      supportingEvidence: ["noise"],
    });

    expect(packet).not.toBeNull();
    expect(Object.keys(packet!.payload).sort()).toEqual(
      ["counterEvidence", "factCheckResult", "gaps", "keyFindings"].sort()
    );
    expect(packet!.payload.factCheckResult).toBe("partial");
    expect(packet!.payload.keyFindings).toEqual(["发现一", "发现二"]);
    expect(packet!.payload.gaps).toEqual(["缺一手材料"]);
    expect(packet!.payload.counterEvidence).toEqual(["反证链接"]);
    expect(packet!.payload).not.toHaveProperty("sources");
  });

  it("source_validator → report_composer: reliability, verified, questionable, missing", () => {
    const packet = buildHandoffPacket("source_validator", "report_composer", {
      sourceReliability: "medium",
      verifiedSources: ["https://example.com/a"],
      questionableSources: ["微博匿名"],
      missingSources: ["原始论文"],
      verificationNotes: "should not appear",
    });

    expect(packet).not.toBeNull();
    expect(Object.keys(packet!.payload).sort()).toEqual(
      ["missing", "questionable", "reliability", "verified"].sort()
    );
    expect(packet!.payload.reliability).toBe("medium");
    expect(packet!.payload.verified).toEqual(["https://example.com/a"]);
    expect(packet!.payload.questionable).toEqual(["微博匿名"]);
    expect(packet!.payload.missing).toEqual(["原始论文"]);
    expect(packet!.payload).not.toHaveProperty("verificationNotes");
  });

  it("returns null for unknown route", () => {
    expect(buildHandoffPacket("fact_checker", "source_validator", { factCheckResult: "true" })).toBeNull();
    expect(buildHandoffPacket("report_composer", "fact_checker", {})).toBeNull();
  });

  it("truncates long strings in arrays", () => {
    const packet = buildHandoffPacket("rumor_detector", "fact_checker", {
      claimAtoms: [longAtom],
      neededEvidence: [],
      rumorTypes: [],
      severity: "low",
    });
    expect(packet).not.toBeNull();
    const atoms = packet!.payload.claimAtoms as string[];
    expect(atoms).toHaveLength(1);
    expect(atoms[0].length).toBeLessThanOrEqual(181); // 180 + ellipsis
    expect(atoms[0].endsWith("…")).toBe(true);
  });

  it("defaults severity and empty arrays when output is missing fields", () => {
    const packet = buildHandoffPacket("rumor_detector", "fact_checker", {});
    expect(packet!.payload.severity).toBe("low");
    expect(packet!.payload.claimAtoms).toEqual([]);
    expect(packet!.payload.neededEvidence).toEqual([]);
    expect(packet!.payload.rumorTypes).toEqual([]);
  });
});

describe("buildHandoffPacketsFromSteps", () => {
  it("collects only completed steps with defined routes for toAgent", () => {
    const packets = buildHandoffPacketsFromSteps("report_composer", [
      {
        agent: "rumor_detector",
        status: "completed",
        output: {
          claimAtoms: ["a"],
          neededEvidence: ["e"],
          rumorTypes: ["t"],
          severity: "low",
        },
      },
      {
        agent: "fact_checker",
        status: "completed",
        output: {
          factCheckResult: "true",
          keyFindings: ["k"],
          unresolvedEvidenceGaps: [],
          counterEvidence: [],
        },
      },
      {
        agent: "source_validator",
        status: "failed",
        output: {
          sourceReliability: "high",
          verifiedSources: ["x"],
          questionableSources: [],
          missingSources: [],
        },
      },
      {
        agent: "source_validator",
        status: "completed",
        output: {
          sourceReliability: "low",
          verifiedSources: [],
          questionableSources: ["q"],
          missingSources: ["m"],
        },
      },
    ]);

    // rumor→report has no route; fact→report and source→report do
    expect(packets).toHaveLength(2);
    expect(packets.map((p: HandoffPacket) => p.from)).toEqual([
      "fact_checker",
      "source_validator",
    ]);
    expect(packets.every((p) => p.to === "report_composer")).toBe(true);
  });

  it("returns empty array when no previous steps", () => {
    expect(buildHandoffPacketsFromSteps("fact_checker", [])).toEqual([]);
    expect(buildHandoffPacketsFromSteps("fact_checker", null)).toEqual([]);
    expect(buildHandoffPacketsFromSteps("fact_checker", undefined)).toEqual([]);
  });

  it("builds fact_checker packet from rumor_detector step", () => {
    const packets = buildHandoffPacketsFromSteps("fact_checker", [
      {
        agent: "rumor_detector",
        status: "completed",
        output: {
          claimAtoms: ["原子"],
          neededEvidence: ["证据"],
          rumorTypes: ["类型"],
          severity: "medium",
        },
      },
    ]);
    expect(packets).toHaveLength(1);
    expect(packets[0].from).toBe("rumor_detector");
    expect(packets[0].payload.severity).toBe("medium");
  });
});
