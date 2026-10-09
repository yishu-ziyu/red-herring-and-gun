import { describe, expect, it } from "vitest";
import { deriveLabel, type LabelPart } from "./answerBenchLabel";

const M = "主要主张" as const;
const N = "必要前提" as const;
const B = "背景细节" as const;
const p = (role: LabelPart["role"], status: LabelPart["status"], extra: Partial<LabelPart> = {}): LabelPart => ({ role, status, ...extra });

describe("deriveLabel: one test per row of the 判定规则 table", () => {
  it("row 1: any refuted main claim -> 不能信 regardless of the rest", () => {
    expect(deriveLabel([p(M, "被反驳")])).toBe("不能信");
    expect(deriveLabel([p(M, "被反驳"), p(N, "被支持"), p(B, "被支持")])).toBe("不能信");
    expect(deriveLabel([p(M, "被反驳"), p(N, "查不到"), p(B, "被反驳")])).toBe("不能信");
  });
  it("row 1 (ruling 2): parallel main claims, one refuted and one unverified -> 不能信", () => {
    expect(deriveLabel([p(M, "被反驳"), p(M, "查不到")])).toBe("不能信");
  });
  it("row 2: parallel main claims, one 被证实 and one 被反驳 -> 有真有假", () => {
    expect(deriveLabel([p(M, "被支持"), p(M, "被反驳")])).toBe("有真有假");
  });
  it("row 3: all main and premises 被证实, no refuted background -> 能信", () => {
    expect(deriveLabel([p(M, "被支持")])).toBe("能信");
    expect(deriveLabel([p(M, "被支持"), p(N, "被支持"), p(B, "被支持")])).toBe("能信");
    expect(deriveLabel([p(M, "被支持"), p(B, "查不到")])).toBe("能信");
  });
  it("row 4: all main and premises 被证实, background refuted -> 部分成立", () => {
    expect(deriveLabel([p(M, "被支持"), p(N, "被支持"), p(B, "被反驳")])).toBe("部分成立");
  });
  it("row 5: main 被证实, a premise refuted -> 有真有假", () => {
    expect(deriveLabel([p(M, "被支持"), p(N, "被反驳"), p(B, "被反驳")])).toBe("有真有假");
  });
  it("row 6: main 被证实, a premise unverified -> 证据不足", () => {
    expect(deriveLabel([p(M, "被支持"), p(N, "查不到")])).toBe("证据不足");
  });
  it("row 7: main unverified -> 证据不足", () => {
    expect(deriveLabel([p(M, "查不到")])).toBe("证据不足");
    expect(deriveLabel([p(M, "被支持"), p(M, "查不到")])).toBe("证据不足");
    expect(deriveLabel([p(M, "查不到"), p(N, "被支持"), p(B, "被反驳")])).toBe("证据不足");
  });
  it("row 8: main sources conflict -> 有争议", () => {
    expect(deriveLabel([p(M, "来源冲突")])).toBe("有争议");
    expect(deriveLabel([p(M, "来源冲突"), p(N, "被支持")])).toBe("有争议");
  });
  it("mixed 查不到 + 来源冲突 mains follow table order (row 7 before row 8) -> 证据不足", () => {
    expect(deriveLabel([p(M, "来源冲突"), p(M, "查不到")])).toBe("证据不足");
  });
  it("不适用 -> 立场型", () => {
    expect(deriveLabel([p(M, "不适用")])).toBe("立场型");
    expect(deriveLabel([p(M, "不适用"), p(B, "不适用")])).toBe("立场型");
    expect(deriveLabel([])).toBe("立场型");
  });
});

describe("deriveLabel: 2026-09-29 scoring rules", () => {
  it("rule 1: refuted issuer/source detail does not downgrade a true claim", () => {
    expect(deriveLabel([p(M, "被支持"), p(B, "被反驳", { issuerMisattributed: true })])).toBe("能信");
  });
  it("rule 1: other refuted background still gives 部分成立", () => {
    expect(deriveLabel([p(M, "被支持"), p(B, "被反驳", { issuerMisattributed: true }), p(B, "被反驳")])).toBe("部分成立");
  });
  it("rule 2: a main claim only partly true (individual case generalised) beside a refuted one -> 不能信", () => {
    expect(deriveLabel([p(M, "被反驳"), p(M, "部分支持")])).toBe("不能信");
  });
  it("a partly supported main claim on its own -> 部分成立", () => {
    expect(deriveLabel([p(M, "部分支持")])).toBe("部分成立");
    expect(deriveLabel([p(M, "被支持"), p(M, "部分支持")])).toBe("部分成立");
  });
  it("rule 4: a main claim with no public record -> 证据不足, not 不能信", () => {
    expect(deriveLabel([p(M, "查不到"), p(N, "查不到")])).toBe("证据不足");
  });
  it("a partly supported premise -> 部分成立", () => {
    expect(deriveLabel([p(M, "被支持"), p(N, "部分支持")])).toBe("部分成立");
  });
  it("falls back to all parts when no part is marked 主要主张", () => {
    expect(deriveLabel([p(N, "被反驳")])).toBe("不能信");
  });
});
