import type { Case, Claim } from "@rhg/core/casefile";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SYSTEM_PENDING } from "../lib/copy.js";
import { ReportCard } from "./ReportCard.js";

const AT = "2026-09-05T00:00:00.000Z";

function claim(id: string, text: string, over: Partial<Claim> = {}): Claim {
  return { id, text, type: "fact", checkable: true, order: 0, ...over };
}

function current(over: Partial<Case> = {}): Case {
  return {
    id: "c",
    text: "",
    createdAt: AT,
    seq: 1,
    claims: [],
    evidence: [],
    stances: [],
    verdicts: [],
    cites: [],
    frontier: [],
    consumedPivotIds: [],
    investigatorSteps: [],
    investigatorStops: [],
    llmCalls: [],
    stages: [],
    turns: [],
    messages: [],
    errors: [],
    droppedClaims: [],
    ...over,
  };
}

afterEach(() => {
  cleanup();
});

describe("ReportCard 句内三层墨", () => {
  it("先给结论，原句仍是一句，精确命题落在字上，出处就近，不把间隔当推断", () => {
    const source = "某地推广该保健品后癌症死亡率下降，证明该保健品能防癌";
    const p1 = "癌症死亡率下降";
    const p2 = "该保健品能防癌";
    render(
      <ReportCard
        current={current({
          text: source,
          claims: [
            claim("c1", p1, { span: { start: source.indexOf(p1), end: source.indexOf(p1) + p1.length } }),
            claim("c2", p2, { type: "causal", order: 1, span: { start: source.indexOf(p2), end: source.indexOf(p2) + p2.length } }),
          ],
          evidence: [
            {
              id: "e1",
              url: "https://www.example.gov/report",
              canonicalUrl: "https://www.example.gov/report",
              host: "example.gov",
              title: "某疾控年报",
              excerpt: "死亡率下降",
              retrievedAt: AT,
              tier: "A",
              provenance: { kind: "search", query: p1, claimId: "c1" },
            },
          ],
          report: {
            conclusion: "死亡率下降有材料可核；「因此能防癌」推不出来。",
            claimItems: [
              { claimId: "c1", line: `${p1}[1]`, citations: [1] },
              { claimId: "c2", line: p2, citations: [] },
            ],
            citations: [{ n: 1, evidenceId: "e1" }],
            finalizedAt: AT,
          },
        })}
        running={false}
      />,
    );
    expect(document.querySelector(".conclusion")?.textContent).toContain("死亡率下降有材料可核");
    const origin = document.querySelector(".origin-sentence");
    expect(origin?.textContent).toContain("某地推广该保健品后");
    expect(origin?.textContent).toContain(p1);
    expect(origin?.textContent).toContain("证明");
    expect(origin?.textContent).toContain(p2);
    expect(origin?.querySelector(".origin-mark")?.textContent).toContain(p1);
    expect(origin?.querySelector(".origin-glue")).toBeNull();
    expect(origin?.textContent).not.toContain("系统还要核");
    expect(document.querySelector(".origin-sys")).toBeNull();
    expect(document.body.textContent).not.toContain(SYSTEM_PENDING);
    expect(document.querySelector(".origin-ink a.cite")?.textContent).toBe("[1]");
    expect(origin?.querySelector(".origin-mark")?.className).toContain("origin-mark");
    expect(origin?.querySelector(".origin-mark")?.className).not.toMatch(/true|false|verdict/);
    expect(document.querySelector(".report-claims")).toBeNull();
  });

  it("多轮案件用后续完整用户消息作原句，不用这个靠谱吗", () => {
    const source = "人社部发文说生育津贴直接打到个人卡里了";
    render(
      <ReportCard
        current={current({
          text: "这个靠谱吗？",
          claims: [claim("c1", source)],
          messages: [
            { id: "m1", role: "user", text: "这个靠谱吗？", at: AT, route: "new_claim" },
            { id: "m2", role: "assistant", text: "把那句话发过来。", at: AT },
            { id: "m3", role: "user", text: source, at: AT, route: "new_claim" },
          ],
          report: {
            conclusion: "公开材料还撑不住判断。",
            claimItems: [{ claimId: "c1", line: source, citations: [] }],
            citations: [],
            finalizedAt: AT,
          },
        })}
        running={false}
      />,
    );
    expect(document.querySelector(".origin-sentence")?.textContent).toBe(source);
    expect(document.querySelector(".origin-sentence")?.textContent).not.toContain("这个靠谱吗");
    expect(document.querySelector(".report-claims")).toBeNull();
  });

  it("命题分落两条消息时不涂原句，退回命题列表", () => {
    render(
      <ReportCard
        current={current({
          text: "这个靠谱吗？",
          claims: [claim("c1", "甲公司去年营收增长"), claim("c2", "乙公司去年营收增长", { order: 1 })],
          messages: [
            { id: "m1", role: "user", text: "甲公司去年营收增长", at: AT, route: "new_claim" },
            { id: "m2", role: "user", text: "乙公司去年营收增长", at: AT, route: "ask_case" },
          ],
          report: {
            conclusion: "两件事要分开核。",
            claimItems: [
              { claimId: "c1", line: "甲公司去年营收增长", citations: [] },
              { claimId: "c2", line: "乙公司去年营收增长", citations: [] },
            ],
            citations: [],
            finalizedAt: AT,
          },
        })}
        running={false}
      />,
    );
    expect(document.querySelector(".origin-ink")).toBeNull();
    expect(document.querySelector(".report-claims")?.textContent).toContain("甲公司去年营收增长");
    expect(document.querySelector(".report-claims")?.textContent).toContain("乙公司去年营收增长");
  });

  it("单一事实保留完整原句，不编系统待核", () => {
    const source = "人社部发文说生育津贴直接打到个人卡里了";
    render(
      <ReportCard
        current={current({
          text: source,
          claims: [claim("c1", source)],
          report: {
            conclusion: "公开材料还撑不住判断。",
            claimItems: [{ claimId: "c1", line: source, citations: [] }],
            citations: [],
            finalizedAt: AT,
          },
        })}
        running={false}
      />,
    );
    expect(document.querySelector(".origin-sentence")?.textContent).toBe(source);
    expect(document.querySelector(".origin-sys")).toBeNull();
  });
});
