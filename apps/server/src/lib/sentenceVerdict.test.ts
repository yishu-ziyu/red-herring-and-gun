import { describe, expect, it } from "vitest";
import { applySentenceVerdict, listAssessedClaims } from "./sentenceVerdict";

type Src = { url: string; title: string; snippet: string };
const src = (n: string): Src => ({ url: `https://example.gov.cn/${n}`, title: n, snippet: n });
const typed = (text: string, extra: Record<string, unknown> = {}) => ({ text, verifiable: true, type: "fact", ...extra });
const assess = (report: Record<string, unknown>, types: Array<Record<string, unknown>>, priority?: string[]) =>
  listAssessedClaims(report, { claimAtoms: types.map((t) => t.text), claimAtomTypes: types, priorityClaimAtoms: priority });

describe("每部分的角色与状态（listAssessedClaims）", () => {
  it("拆题标了角色就按角色；没标角色的部分算必要前提，没有主要主张时优先列表第一条当主要主张", () => {
    const report = { subclaimVerdicts: [] };
    const roles = assess(report, [typed("A", { role: "background" }), typed("B", { role: "main" }), typed("C")]);
    expect(roles.map((c) => [c.text, c.role])).toEqual([["A", "background"], ["B", "main"], ["C", "premise"]]);
    const none = assess(report, [typed("A"), typed("B")], ["B"]);
    expect(none.map((c) => [c.text, c.role])).toEqual([["A", "premise"], ["B", "main"]]);
  });

  it("状态只认方向一致、能点开的出处：无出处的 true / false 是没查清", () => {
    const report = {
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "true", supportingSources: [] },
        { claimAtom: "B", verdict: "false", supportingSources: [src("b")], contradictingSources: [] },
        { claimAtom: "C", verdict: "true", supportingSources: [src("c")] },
        { claimAtom: "D", verdict: "false", contradictingSources: [src("d")] },
      ],
    };
    const standings = assess(report, ["A", "B", "C", "D"].map((t) => typed(t))).map((c) => c.standing);
    expect(standings).toEqual(["unresolved", "unresolved", "supported", "refuted"]);
  });

  it("规则2：夸大（把个别说成普遍）按被反驳算", () => {
    const report = { subclaimVerdicts: [{ claimAtom: "A", verdict: "exaggerated", supportingSources: [src("a")] }] };
    expect(assess(report, [typed("A")]).map((c) => c.standing)).toEqual(["refuted"]);
  });

  it("部分成立（基准 v1：NEW-401/403/405/411 形状）：只有来源明确反驳了原句里某个具体要素、并逐字引出那个要素才算；其余一律按被证实", () => {
    const atom = "国家现在每个孩子每年发3600元育儿补贴，一直发到3岁";
    const supporting = [src("s")];
    const contradicting = [src("c")];
    const verdicts = (extra: Record<string, unknown>) => ({
      subclaimVerdicts: [{ claimAtom: atom, verdict: "partial", supportingSources: supporting, ...extra }],
    });
    const standing = (report: Record<string, unknown>) => assess(report, [typed(atom)])[0]?.standing;
    // 只有支持出处：补充的适用条件（户籍、审核、从某日起）不反驳原句 → 被证实
    expect(standing(verdicts({ contradictingSources: [] }))).toBe("supported");
    // 有反驳出处，但没有说被反驳的是哪个要素 → 被证实（不是部分成立）
    expect(standing(verdicts({ contradictingSources: contradicting }))).toBe("supported");
    // 说了要素，但要素不是原句里的话（模型自己编的说法）→ 被证实
    expect(standing(verdicts({ contradictingSources: contradicting, contradictedElement: "补贴金额每年5000元" }))).toBe("supported");
    // 逐字引用原句里的要素 + 有反驳出处 → 部分成立
    expect(standing(verdicts({ contradictingSources: contradicting, contradictedElement: "一直发到3岁" }))).toBe("partial");
    // 只有反驳、没有任何支持 → 不凭 partial 标签编出成立的一面
    expect(
      standing({ subclaimVerdicts: [{ claimAtom: atom, verdict: "partial", contradictingSources: contradicting }] })
    ).toBe("refuted");
    // 引用了要素却没有反驳出处 → 被证实（没有来源反驳它）
    expect(standing(verdicts({ contradictedElement: "一直发到3岁" }))).toBe("supported");
  });

  it("规则2：夸大只有反驳方向的出处（没有支持方向）也算被反驳；没有任何出处仍是没查清", () => {
    const report = {
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "exaggerated", contradictingSources: [src("a")] },
        { claimAtom: "B", verdict: "exaggerated" },
      ],
    };
    expect(assess(report, [typed("A"), typed("B")]).map((c) => c.standing)).toEqual(["refuted", "unresolved"]);
  });

  it("规则3：判「有争议」要两边都有能点开的出处，否则是没查清", () => {
    const report = {
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "disputed", supportingSources: [src("a1")], contradictingSources: [src("a2")] },
        { claimAtom: "B", verdict: "disputed", supportingSources: [src("b1")], contradictingSources: [] },
      ],
    };
    expect(assess(report, [typed("A"), typed("B")]).map((c) => c.standing)).toEqual(["conflicting", "unresolved"]);
  });

  it("规则1：标了「发文机关 / 出处」的部分被反驳、且另有内容被证实，带上 issuerMisattributed", () => {
    const report = {
      subclaimVerdicts: [
        { claimAtom: "A", verdict: "false", contradictingSources: [src("a")] },
        { claimAtom: "B", verdict: "true", supportingSources: [src("b")] },
      ],
    };
    const [issuerPart, contentPart] = assess(report, [typed("A", { issuer: true }), typed("B")]);
    expect(issuerPart).toMatchObject({ standing: "refuted", issuerMisattributed: true });
    expect(contentPart?.issuerMisattributed).toBeUndefined();
  });

  it("规则1：没有任何内容被证实时不带（RUMOR-006：模型把整条含内容的命题标成出处）", () => {
    const report = { subclaimVerdicts: [{ claimAtom: "A", verdict: "false", contradictingSources: [src("a")] }] };
    const [claim] = assess(report, [typed("A", { issuer: true })]);
    expect(claim).toMatchObject({ standing: "refuted" });
    expect(claim?.issuerMisattributed).toBeUndefined();
  });
});

describe("整句结论写回：首句、徽章类型、正文都读同一个决定（applySentenceVerdict）", () => {
  const TRUE_A = { claimAtom: "A", verdict: "true", evidence: "官方明确了这一点[1]。", supportingSources: [src("a")] };
  const REFUTED_B = { claimAtom: "B", verdict: "false", evidence: "官方明确否认了这一点[1]。", contradictingSources: [src("b")] };

  function run(report: Record<string, unknown>, types: Array<Record<string, unknown>>) {
    applySentenceVerdict(report, assess(report, types));
    return report;
  }

  it("NEW-409 形状：模型正文自相矛盾（首句说站不住、正文说吻合），整句只有支持 → 结论文字整体由决定重写", () => {
    const report = run(
      {
        verdictType: "mixed_misleading",
        conclusion: "这句话有站不住的部分。核对后与公开信息高度吻合[1]。",
        subclaimVerdicts: [TRUE_A],
      },
      [typed("A", { role: "main" })]
    );
    expect(report.verdictType).toBe("true");
    expect(String(report.conclusion)).toMatch(/^公开材料撑得住这条说法。/);
    expect(String(report.conclusion)).not.toMatch(/站不住的部分/);
    expect(report.summaryForPublic).toMatch(/^公开材料撑得住这条说法。/);
  });

  it("NEW-405 形状：只有支持、没有反驳，模型判了「有真有假」也改判能信", () => {
    const report = run({ verdictType: "unverified", conclusion: "能预防不等于 100%。", subclaimVerdicts: [TRUE_A] }, [typed("A", { role: "main" })]);
    expect(report.verdictType).toBe("true");
  });

  it("模型的整句判定与正文不算数：无论 draft 写什么，都由各部分推出", () => {
    for (const draft of ["true", "false", "mixed_misleading", "unverified"]) {
      const report = run({ verdictType: draft, conclusion: "随便", subclaimVerdicts: [REFUTED_B] }, [typed("B", { role: "main" })]);
      expect(report.verdictType).toBe("false");
      expect(String(report.conclusion)).toMatch(/^公开材料不支持这条说法。/);
    }
  });

  it("规则5：不能信时写明属实的那一截和站不住的那一截", () => {
    const report = run(
      { verdictType: "true", conclusion: "x", subclaimVerdicts: [TRUE_A, REFUTED_B] },
      [typed("A", { role: "background" }), typed("B", { role: "main" })]
    );
    expect(report.verdictType).toBe("false");
    const text = String(report.conclusion);
    expect(text).toContain("「B」站不住");
    expect(text).toContain("「A」站得住");
  });

  it("规则1：内容属实、只说错发文机关 → 能信，结论写出被反驳那处的正确说法（实际发文机关）", () => {
    const issuer = { claimAtom: "B", verdict: "false", evidence: "发文的是国家医保局，不是人社部[1]。", contradictingSources: [src("b")] };
    const report = run(
      { verdictType: "false", conclusion: "x", subclaimVerdicts: [TRUE_A, issuer] },
      [typed("A", { role: "main" }), typed("B", { role: "background", issuer: true })]
    );
    expect(report.verdictType).toBe("true");
    expect(String(report.conclusion)).toContain("国家医保局");
  });

  it("规则3：权威来源冲突 → 有争议，正文把两边说法都写出来", () => {
    const conflict = {
      claimAtom: "A",
      verdict: "disputed",
      evidence: "普通人群常规补充基本无效[1]，剧烈运动人群可能有用[2]。",
      supportingSources: [src("a1")],
      contradictingSources: [src("a2")],
    };
    const report = run({ verdictType: "true", conclusion: "x", subclaimVerdicts: [conflict] }, [typed("A", { role: "main" })]);
    expect(report.verdictType).toBe("disputed");
    expect(String(report.conclusion)).toMatch(/^权威来源之间说法不一致/);
    expect(String(report.conclusion)).toContain("普通人群常规补充基本无效");
    expect(String(report.conclusion)).toContain("剧烈运动人群可能有用");
  });

  it("规则4：查不到 → 证据不足，写出还缺什么、去哪核实，跳过「待补证」占位词", () => {
    const missing = {
      claimAtom: "A",
      verdict: "unverified",
      evidence: "",
      evidenceGaps: ["待补证", "公司名称与交易所公告；上市公司看交易所公告，其他看公司官方通知"],
    };
    const report = run({ verdictType: "false", conclusion: "x", subclaimVerdicts: [missing] }, [typed("A", { role: "main" })]);
    expect(report.verdictType).toBe("unverified");
    expect(String(report.conclusion)).toContain("交易所公告");
    expect(String(report.conclusion)).not.toContain("待补证");
  });

  it("系统自己写的缺口（待补证、关系没通过核验、定向检索无结果）不当成用户该去核实的东西写出来", () => {
    const missing = {
      claimAtom: "A",
      verdict: "unverified",
      evidence: "",
      evidenceGaps: ["来源与这条命题的方向关系尚未通过独立核验，暂不作为支持或反驳", "该原子定向检索无结果，待补证", "模型未覆盖，待补证"],
    };
    const report = run({ verdictType: "false", conclusion: "x", subclaimVerdicts: [missing] }, [typed("A", { role: "main" })]);
    expect(String(report.conclusion)).not.toContain("还缺");
  });

  it("长的判词说明截在句末，不把半句话和下一句拼在一起（2026-09-28 实机：「结论同样显「大剂量…」」）", () => {
    const first = "中国互联网联合辟谣平台2024年1月23日明确指出：对于维生素C摄入正常的健康人群来说，没有证据表明吃大剂量维生素C可以预防感冒。";
    const second = "2013年对29项随机试验共11306名参与者的荟萃分析结论同样显示常规补充不能降低普通人群感冒发生率，只在高强度运动人群中观察到预防效果。";
    const long = { claimAtom: "A", verdict: "false", evidence: first + second, contradictingSources: [src("long")] };
    const report = run({ verdictType: "x", conclusion: "x", subclaimVerdicts: [long] }, [typed("A", { role: "main" })]);
    expect(String(report.conclusion)).toContain(first);
    expect(String(report.conclusion)).not.toContain("2013年对29项");
  });

  it("立场型（没有可核查部分）不下真假结论，也不写成不能信", () => {
    const report: Record<string, unknown> = { verdictType: "false", conclusion: "x", subclaimVerdicts: [] };
    applySentenceVerdict(report, []);
    expect(report.verdictType).toBe("unverified");
  });

  it("部分成立：主要主张只成立一部分", () => {
    const partial = {
      claimAtom: "A",
      verdict: "partial",
      evidence: "只在小范围内成立[1]，超出的部分被否认[2]。",
      contradictedElement: "A",
      supportingSources: [src("a")],
      contradictingSources: [src("a2")],
    };
    const report = run({ verdictType: "true", conclusion: "x", subclaimVerdicts: [partial] }, [typed("A", { role: "main" })]);
    expect(report.verdictType).toBe("partial");
    expect(String(report.conclusion)).toMatch(/^这句话只在有限范围内成立。/);
  });

  it("原文只补充适用条件时，总答和逐条判断都采纳最终的支持判定", () => {
    const atom = "没有3C标识的充电宝不让带上飞机了";
    const evidence = "民航局通知禁止没有3C标识的充电宝乘坐境内航班。";
    const report = run({ subclaimVerdicts: [{
      claimAtom: atom, verdict: "partial", evidence,
      boundary: "原句暗示全部航班，因此夸大范围。",
      contradictedElement: "原句暗示全部航班",
      supportingSources: [src("notice")], contradictingSources: [],
    }] }, [typed(atom, { role: "main" })]);
    expect(report.verdictType).toBe("true");
    expect(report.subclaimVerdicts).toEqual([expect.objectContaining({ verdict: "true", evidence })]);
    const part = (report.subclaimVerdicts as Array<Record<string, unknown>>)[0];
    expect(part.boundary).toBeUndefined();
    expect(part.contradictedElement).toBeUndefined();
  });

  it("规则表决定写进报告便于回查", () => {
    const report = run({ verdictType: "x", conclusion: "x", subclaimVerdicts: [TRUE_A] }, [typed("A", { role: "main" })]);
    expect(report._verdictDecision).toMatchObject({ rule: "all-supported", verdict: "can-believe" });
  });
});
