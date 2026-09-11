import { describe, expect, it } from "vitest";
import { finalizeLoopReport } from "./gates";
import type { AgentLoopResult } from "./types";

function loop(partial: Partial<AgentLoopResult>): AgentLoopResult {
  return {
    messages: [],
    turns: 2,
    stopReason: "submit_verdict",
    toolTrace: [],
    lastText: "",
    ...partial,
  };
}

describe("finalizeLoopReport", () => {
  it("no URL cannot stay true or false", async () => {
    const report = await finalizeLoopReport({
      claim: "隔夜菜加热会致癌",
      loop: loop({
        terminalArgs: {
          verdictType: "false",
          conclusion: "不能信。",
          claimAtoms: ["隔夜菜加热会致癌"],
          subclaimVerdicts: [{ claimAtom: "隔夜菜加热会致癌", verdict: "false", evidence: "我觉得假" }],
        },
      }),
    });
    expect(report.verdictType).toBe("unverified");
    expect(String(report.faceVerdict)).toBe("还查不清");
  });

  it("no evidence is not false — incomplete loop stays 还查不清", async () => {
    const report = await finalizeLoopReport({
      claim: "隔夜菜加热会致癌",
      loop: loop({
        stopReason: "max_turns",
        terminalArgs: undefined,
        toolTrace: [
          {
            name: "web_search",
            arguments: { query: "隔夜菜" },
            result: { sources: [] },
          },
        ],
      }),
    });
    expect(report.verdictType).toBe("unverified");
    expect(String(report.conclusion)).toMatch(/没有收成判断/);
    expect(String(report.conclusion)).not.toMatch(/^(能信|不能信|只能信一部分|有真有假|部分成立|还查不清)/);
    expect(report._incomplete).toBe(true);
  });

  it("strips tool jargon from public copy", async () => {
    const report = await finalizeLoopReport({
      claim: "隔夜菜加热会致癌",
      loop: loop({
        terminalArgs: {
          verdictType: "unverified",
          conclusion: "还查不清。FactChecker 和 MiniMax 都没查清。",
          recommendation: "建议你先别转发。",
          claimAtoms: ["隔夜菜加热会致癌"],
          subclaimVerdicts: [{ claimAtom: "隔夜菜加热会致癌", verdict: "unverified", evidence: "无" }],
        },
      }),
    });
    expect(String(report.conclusion)).not.toMatch(/FactChecker|MiniMax|Agent/);
    expect(String(report.recommendation)).not.toMatch(/先别转发/);
    expect(String(report.recommendation)).not.toMatch(/先别转发/);
    expect(String(report.recommendation)).not.toMatch(/^(能信|不能信|只能信一部分|有真有假|部分成立|还查不清)/);
  });

  it("mixed sourced true+false becomes 有真有假", async () => {
    const urlTrue = "https://a.example/true";
    const urlFalse = "https://b.example/false";
    const report = await finalizeLoopReport({
      claim: "维生素C能预防感冒而且隔夜菜致癌",
      loop: loop({
        terminalArgs: {
          verdictType: "false",
          conclusion: "不能信。",
          claimAtoms: ["维生素C能预防感冒", "隔夜菜致癌"],
          claimAtomTypes: [
            { text: "维生素C能预防感冒", verifiable: true, type: "fact" },
            { text: "隔夜菜致癌", verifiable: true, type: "causal" },
          ],
          subclaimVerdicts: [
            {
              claimAtom: "维生素C能预防感冒",
              verdict: "true",
              evidence: "有出处",
              supportingSources: [{ url: urlTrue, title: "A" }],
            },
            {
              claimAtom: "隔夜菜致癌",
              verdict: "false",
              evidence: "有反驳",
              contradictingSources: [{ url: urlFalse, title: "B" }],
            },
          ],
        },
        toolTrace: [
          {
            name: "web_search",
            arguments: { query: "维生素C能预防感冒" },
            result: { sources: [{ url: urlTrue, title: "A", snippet: "s" }] },
          },
          {
            name: "web_search",
            arguments: { query: "隔夜菜致癌" },
            result: { sources: [{ url: urlFalse, title: "B", snippet: "s" }] },
          },
        ],
      }),
    });
    expect(report.verdictType).toBe("mixed_misleading");
    expect(String(report.faceVerdict)).toBe("有真有假");
  });

  it("keeps a research memo instead of clipping it to five sentences", async () => {
    const url = "https://www.who.int/food";
    const memo = [
      "## 核心结论",
      "",
      "**还查不清。** 这一判断分两层：",
      "",
      "1. **字面致癌：还查不清。** 未见国家级通报 [who.int](" + url + ")。",
      "2. **加热风险：部分成立。**",
      "",
      "## 一、已核对",
      "",
      "| 说法 | 判断 |",
      "| --- | --- |",
      "| 必然致癌 | 未见通报 |",
      "",
      "REFERENCES",
      "",
      "1. [WHO](" + url + ")",
    ].join("\n");
    const report = await finalizeLoopReport({
      claim: "隔夜菜加热会致癌",
      loop: loop({
        lastText: memo,
        terminalArgs: {
          verdictType: "unverified",
          conclusion: memo,
          claimAtoms: ["隔夜菜加热会致癌"],
          subclaimVerdicts: [
            {
              claimAtom: "隔夜菜加热会致癌",
              verdict: "unverified",
              evidence: "未见通报",
              supportingSources: [{ url, title: "WHO" }],
            },
          ],
        },
        toolTrace: [
          {
            name: "web_search",
            arguments: { query: "隔夜菜" },
            result: { sources: [{ url, title: "WHO", snippet: "s" }] },
          },
        ],
      }),
    });
    expect(String(report.conclusion)).toContain("## 核心结论");
    expect(String(report.conclusion)).toContain("| 说法 | 判断 |");
    expect(String(report.conclusion)).toContain("REFERENCES");
    expect(String(report.conclusion)).toContain("这一判断分两层");
    expect(String(report.conclusion)).not.toMatch(/## 核心结论\s+\*\*还查不清/);
    expect(String(report.conclusion)).not.toMatch(/FactChecker|先别转发|web_search/);
  });
});
