import { describe, expect, it } from "vitest";
import { decideSentenceVerdict, type PartRole, type PartStanding, type SentencePart } from "./verdict";

const M: PartRole = "main";
const N: PartRole = "premise";
const B: PartRole = "background";
const part = (role: PartRole, standing: PartStanding, extra: Partial<SentencePart> = {}): SentencePart => ({
  text: `${role}-${standing}`,
  role,
  standing,
  ...extra,
});
const verdictOf = (...parts: SentencePart[]) => decideSentenceVerdict(parts).verdict;

describe("整句判定规则表（docs/evals/2026-09-28-judgment-refactor.md「判定规则」）：每行一条", () => {
  it("行1：任一主要主张被反驳 → 不能信，其余部分无论状态", () => {
    expect(verdictOf(part(M, "refuted"))).toBe("cannot-believe");
    expect(verdictOf(part(M, "refuted"), part(N, "supported"), part(B, "supported"))).toBe("cannot-believe");
    expect(verdictOf(part(M, "refuted"), part(N, "unresolved"), part(B, "refuted"))).toBe("cannot-believe");
  });

  it("行1（用户裁决 2）：并列主张一个被反驳、一个没查清 → 不能信", () => {
    expect(verdictOf(part(M, "refuted"), part(M, "unresolved"))).toBe("cannot-believe");
  });

  it("行2：并列主张一个被证实、一个被反驳 → 有真有假", () => {
    expect(verdictOf(part(M, "supported"), part(M, "refuted"))).toBe("part-true-part-false");
  });

  it("行3：主要主张与前提全部被证实、背景没有被反驳 → 能信（背景没查到不拖累）", () => {
    expect(verdictOf(part(M, "supported"))).toBe("can-believe");
    expect(verdictOf(part(M, "supported"), part(N, "supported"), part(B, "supported"))).toBe("can-believe");
    expect(verdictOf(part(M, "supported"), part(B, "unresolved"))).toBe("can-believe");
  });

  it("行4：主要主张与前提被证实、背景被反驳 → 部分成立", () => {
    expect(verdictOf(part(M, "supported"), part(N, "supported"), part(B, "refuted"))).toBe("partly-holds");
  });

  it("行5：主要主张被证实、前提被反驳 → 有真有假", () => {
    expect(verdictOf(part(M, "supported"), part(N, "refuted"), part(B, "refuted"))).toBe("part-true-part-false");
  });

  it("行6：主要主张被证实、前提没查清 → 证据不足", () => {
    expect(verdictOf(part(M, "supported"), part(N, "unresolved"))).toBe("not-enough-evidence");
  });

  it("行7：主要主张没查清 → 证据不足（没搜到不等于假）", () => {
    expect(verdictOf(part(M, "unresolved"))).toBe("not-enough-evidence");
    expect(verdictOf(part(M, "supported"), part(M, "unresolved"))).toBe("not-enough-evidence");
    expect(verdictOf(part(M, "unresolved"), part(N, "supported"), part(B, "refuted"))).toBe("not-enough-evidence");
  });

  it("行8：主要主张的权威来源互相冲突 → 有争议", () => {
    expect(verdictOf(part(M, "conflicting"))).toBe("disputed");
    expect(verdictOf(part(M, "conflicting"), part(N, "supported"))).toBe("disputed");
  });

  it("表内顺序：查不清列在证据冲突之前，两者并存 → 证据不足", () => {
    expect(verdictOf(part(M, "conflicting"), part(M, "unresolved"))).toBe("not-enough-evidence");
  });

  it("主要主张只有一部分成立 → 部分成立", () => {
    expect(verdictOf(part(M, "partial"))).toBe("partly-holds");
    expect(verdictOf(part(M, "supported"), part(M, "partial"))).toBe("partly-holds");
    expect(verdictOf(part(M, "supported"), part(N, "partial"))).toBe("partly-holds");
  });

  it("没有可核查的部分（全是立场）→ 不下真假结论", () => {
    expect(decideSentenceVerdict([])).toMatchObject({ verdict: "not-enough-evidence", rule: "no-checkable-claim" });
  });

  it("没有标出主要主张：全部部分一起当主要主张", () => {
    expect(verdictOf(part(N, "refuted"))).toBe("cannot-believe");
  });

  it("每个决定都带规则名，写进报告便于回查", () => {
    expect(decideSentenceVerdict([part(M, "refuted")]).rule).toBe("main-refuted");
    expect(decideSentenceVerdict([part(M, "supported")]).rule).toBe("all-supported");
  });

  it("边界说明：结论已定之后，其余没查清的部分只作边界", () => {
    const loose = part(N, "unresolved");
    expect(decideSentenceVerdict([part(M, "refuted"), loose]).boundaryParts).toEqual([loose]);
    expect(decideSentenceVerdict([part(M, "supported"), part(N, "unresolved")]).boundaryParts).toEqual([]);
  });
});

describe("评分规则 1–6（docs/evals/2026-09-29-answer-benchmark.md「评分规则」）", () => {
  it("规则1：内容属实、只说错发文机关或出处 → 能信；其他背景被反驳仍是部分成立", () => {
    expect(verdictOf(part(M, "supported"), part(B, "refuted", { issuerMisattributed: true }))).toBe("can-believe");
    expect(
      verdictOf(part(M, "supported"), part(B, "refuted", { issuerMisattributed: true }), part(B, "refuted"))
    ).toBe("partly-holds");
  });

  it("规则1只在「内容属实」时成立：没有任何一处内容被证实，说错出处的那一处就是原句本身站不住", () => {
    // RUMOR-006 形状：模型把「浙大研究发现……」整条标成出处，但内容也被反驳；不能借出处豁免把整句翻成有真有假。
    expect(verdictOf(part(M, "refuted", { issuerMisattributed: true }))).toBe("cannot-believe");
    expect(verdictOf(part(M, "refuted", { issuerMisattributed: true }), part(M, "refuted"))).toBe("cannot-believe");
    expect(verdictOf(part(M, "refuted", { issuerMisattributed: true }), part(B, "unresolved"))).toBe("cannot-believe");
  });

  it("规则2：把个别现象说成普遍（夸大）按被反驳算 → 不能信；属实的一截仍在其余部分里", () => {
    // 夸大在这里已经被映射成 refuted（映射见 sentenceVerdict.test.ts）。
    expect(verdictOf(part(M, "refuted"), part(B, "supported"))).toBe("cannot-believe");
  });

  it("规则3：权威来源互相矛盾 → 有争议", () => {
    expect(decideSentenceVerdict([part(M, "conflicting")])).toMatchObject({ verdict: "disputed", rule: "main-conflicting" });
  });

  it("规则4：按常理不会留下公开记录的传言 → 查不到 → 证据不足", () => {
    expect(verdictOf(part(M, "unresolved"))).toBe("not-enough-evidence");
  });

  it("规则5：一截属实（生效日期）、真正让人信的那一截被反驳 → 不能信", () => {
    expect(verdictOf(part(B, "supported"), part(M, "refuted"))).toBe("cannot-believe");
  });

  it("规则6：被反驳的主张 vs 只是没查到的主张走不同结论", () => {
    // 原句说「已证明」而权威说未证实 → 该截被反驳（映射在 sentenceVerdict / 提示词）；只说「有效果」而来源说未证实 → 查不到。
    expect(verdictOf(part(M, "refuted"))).toBe("cannot-believe");
    expect(verdictOf(part(M, "unresolved"))).toBe("not-enough-evidence");
  });
});
