/**
 * 根据各部分的角色与证据状态推导整句结论。显示标签由 domain/labels 映射。
 */

/** 部分在原句里的角色：原句真正想让人信的（可并列多条）、要让主张成立必须为真的前提、可有可无的背景。 */
export type PartRole = "main" | "premise" | "background";

/**
 * 一部分的证据状态。只有能点开、方向一致的出处才算 supported / refuted。
 * partial：只有一部分成立；conflicting：权威来源之间互相矛盾。
 */
export type PartStanding = "supported" | "refuted" | "partial" | "unresolved" | "conflicting";

export type SentencePart = {
  text: string;
  role: PartRole;
  standing: PartStanding;
  /** 旧报告的出处归属标记；保留读取兼容，不用于改变证据状态。 */
  issuerMisattributed?: boolean;
};

/** 用户看到的整句结论。 */
export type SentenceVerdict =
  | "can-believe"
  | "cannot-believe"
  | "part-true-part-false"
  | "partly-holds"
  | "not-enough-evidence"
  | "disputed";

export type VerdictRule =
  | "main-refuted"
  | "parallel-true-and-false"
  | "main-unresolved"
  | "main-conflicting"
  | "main-partial"
  | "premise-refuted"
  | "premise-unresolved"
  | "premise-partial"
  | "background-refuted"
  | "all-supported"
  | "no-checkable-claim";

type VerdictDecision = {
  verdict: SentenceVerdict;
  /** 哪条规则得出的结论，写进报告便于回查。 */
  rule: VerdictRule;
  /** 不决定结论、只作边界说明的部分：结论定下来之后，其余没查清的部分。 */
  boundaryParts: SentencePart[];
};

export function decideSentenceVerdict(input: readonly SentencePart[]): VerdictDecision {
  // 出处归属也是待核查事实，不能因为另一部分属实而撤销它的反驳结果。
  const parts = input;
  if (parts.length === 0) return { verdict: "not-enough-evidence", rule: "no-checkable-claim", boundaryParts: [] };

  const declaredMains = parts.filter((part) => part.role === "main");
  const mains = declaredMains.length > 0 ? declaredMains : parts;
  const premises = parts.filter((part) => part.role === "premise");
  const background = parts.filter((part) => part.role === "background");
  const has = (list: readonly SentencePart[], standing: PartStanding) => list.some((part) => part.standing === standing);
  const boundaryIfDecided = parts.filter((part) => part.standing === "unresolved");
  const decided = (verdict: SentenceVerdict, rule: VerdictRule): VerdictDecision => ({
    verdict,
    rule,
    boundaryParts: verdict === "not-enough-evidence" ? [] : boundaryIfDecided,
  });

  // 行1、行2：主要主张被反驳。只有真正并列的主要主张（≥2 条）里另一条被证实，才是有真有假；
  // 被反驳加没查清或只成立一部分，仍是不能信（用户裁决 2）。
  if (has(mains, "refuted")) {
    return mains.length >= 2 && has(mains, "supported")
      ? decided("part-true-part-false", "parallel-true-and-false")
      : decided("cannot-believe", "main-refuted");
  }
  // 行7 先于行8：表里查不清排在证据冲突前面，两者并存按证据不足。
  if (has(mains, "unresolved")) return decided("not-enough-evidence", "main-unresolved");
  if (has(mains, "conflicting")) return decided("disputed", "main-conflicting");
  if (has(mains, "partial")) return decided("partly-holds", "main-partial");

  // 主要主张全部被证实：看前提，再看背景。
  if (has(premises, "refuted")) return decided("part-true-part-false", "premise-refuted"); // 行5
  if (has(premises, "unresolved") || has(premises, "conflicting")) {
    return decided("not-enough-evidence", "premise-unresolved"); // 行6
  }
  if (has(premises, "partial")) return decided("partly-holds", "premise-partial");
  if (has(background, "refuted")) return decided("partly-holds", "background-refuted"); // 行4
  return decided("can-believe", "all-supported"); // 行3
}
