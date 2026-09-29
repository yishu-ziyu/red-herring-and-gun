/**
 * 整句判定：原句该得到什么结论，由各部分的角色与证据状态推出。这是全产品唯一下整句结论的地方。
 *
 * 产品最稳定的业务规则（2026-09-28 用户确认，docs/evals/2026-09-28-judgment-refactor.md「判定规则」，
 * 加 2026-09-29 评分规则 1–6，docs/evals/2026-09-29-answer-benchmark.md），换模型、换搜索、换存储都不变。
 * 本文件不得引用任何外部模块（domain.boundary.test.ts 机器检查）；评测也从这里取同一个函数。
 *
 * 参照：Snopes 按「主要内容 / 次要细节」定级；台湾事实查核中心「主要内容错误 / 部分错误 / 证据不足」。
 *
 *   主要主张（含并列） 必要前提   背景细节    结论
 *   任一被反驳         任意       任意        不能信
 *   并列：一真一假      任意       任意        有真有假
 *   全被证实           全被证实   无被反驳    能信
 *   全被证实           全被证实   有被反驳    部分成立
 *   全被证实           有被反驳   任意        有真有假
 *   全被证实           有查不清   任意        证据不足
 *   查不清             任意       任意        证据不足
 *   证据互相冲突       任意       任意        有争议
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
  /** 评分规则 1：内容属实，只是原句把发文机关或出处说错了。这一处被反驳不算被反驳（前提：另有内容部分被证实）。 */
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

export type VerdictDecision = {
  verdict: SentenceVerdict;
  /** 哪条规则得出的结论，写进报告便于回查。 */
  rule: VerdictRule;
  /** 不决定结论、只作边界说明的部分：结论定下来之后，其余没查清的部分。 */
  boundaryParts: SentencePart[];
};

export function decideSentenceVerdict(input: readonly SentencePart[]): VerdictDecision {
  // 评分规则 1：内容属实、只说错发文机关或出处，不算被反驳。「内容属实」要有另一处不是出处的部分被证实；
  // 没有任何一处内容被证实时，被标成出处的那一处就是原句本身站不住（不能借出处标记翻案）。
  const contentTrue = input.some((part) => !part.issuerMisattributed && part.standing === "supported");
  const parts = input.map((part) =>
    contentTrue && part.issuerMisattributed && part.standing === "refuted" ? { ...part, standing: "supported" as const } : part
  );
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
