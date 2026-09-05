/**
 * Investigation Snapshot v1 — 白盒调查语义契约（Issue #51）。
 *
 * 用户语义契约：原始说法 → 拆分命题 → 出处及其与命题的关系 → 尚缺什么 →
 * 是否存在实质争议 → 当前/最终判断。实现层（Agent / provider / tool / token /
 * 内部 verdict enum）不出现在本契约。
 *
 * 语义与 `../casefile` 对齐：Claim(text/order/span) ↔ casefile Claim；
 * Source ↔ casefile Evidence（url/title/excerpt/reachable）；EvidenceLink.role ↔
 * casefile Stance.stance（support/refute/context-only）；judgment ↔ ClaimVerdict.verdict。
 * CaseFile 未覆盖的语义（Evidence Gap / Conflict / phase / conclusion）为本契约一等对象。
 *
 * 镜像约束：本目录（schema.ts / build.ts / invariants.ts / index.ts）被整份镜像到
 * 生产 `mvp/server/src/lib/investigation/`（部署只打包 mvp/，server 不能运行时依赖
 * 工作区包）。两侧由 drift-guard 测试做字节级一致校验；改动必须两侧同步。
 */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

const closed = { additionalProperties: false } as const;

export const InvestigationPhaseSchema = Type.Union([
  Type.Literal("received"),
  Type.Literal("decomposed"),
  Type.Literal("investigating"),
  Type.Literal("judging"),
  Type.Literal("complete"),
  Type.Literal("interrupted"),
]);
export type InvestigationPhase = Static<typeof InvestigationPhaseSchema>;

export const InvestigationCheckabilitySchema = Type.Union([
  Type.Literal("checkable"),
  Type.Literal("not-applicable"),
  Type.Literal("trace-only"),
]);
export type InvestigationCheckability = Static<typeof InvestigationCheckabilitySchema>;

export const InvestigationProgressSchema = Type.Union([
  Type.Literal("pending"),
  Type.Literal("searching"),
  Type.Literal("complete"),
  Type.Literal("interrupted"),
]);
export type InvestigationProgress = Static<typeof InvestigationProgressSchema>;

export const InvestigationJudgmentSchema = Type.Union([
  Type.Literal("supported"),
  Type.Literal("refuted"),
  Type.Literal("mixed"),
  Type.Literal("unresolved"),
  Type.Literal("not-applicable"),
]);
export type InvestigationJudgment = Static<typeof InvestigationJudgmentSchema>;

export const InvestigationEvidenceRoleSchema = Type.Union([
  Type.Literal("unassessed"),
  Type.Literal("support"),
  Type.Literal("contradict"),
  Type.Literal("context-only"),
]);
export type InvestigationEvidenceRole = Static<typeof InvestigationEvidenceRoleSchema>;

export const InvestigationSourceSchema = Type.Object(
  {
    id: Type.String(),
    url: Type.String(),
    title: Type.String(),
    excerpt: Type.Optional(Type.String()),
    publishedAt: Type.Optional(Type.String()),
    retrievedAt: Type.Optional(Type.String()),
    reachable: Type.Optional(Type.Boolean()),
  },
  closed,
);
export type InvestigationSource = Static<typeof InvestigationSourceSchema>;

export const InvestigationEvidenceLinkSchema = Type.Object(
  {
    sourceId: Type.String(),
    /** unassessed 只是检索返回后的暂态，不得计入支持/反驳，也不得残留在完成态。 */
    role: InvestigationEvidenceRoleSchema,
    finding: Type.Optional(Type.String()),
    limitation: Type.Optional(Type.String()),
  },
  closed,
);
export type InvestigationEvidenceLink = Static<typeof InvestigationEvidenceLinkSchema>;

export const InvestigationGapSchema = Type.Object(
  {
    id: Type.String(),
    claimId: Type.String(),
    description: Type.String(),
    /** 为什么缺这个会阻止更强判断；有材料才写，不能编。 */
    consequence: Type.Optional(Type.String()),
    status: Type.Union([Type.Literal("open"), Type.Literal("resolved")]),
    resolvedBySourceIds: Type.Optional(Type.Array(Type.String())),
  },
  closed,
);
export type InvestigationGap = Static<typeof InvestigationGapSchema>;

export const InvestigationSpanSchema = Type.Object(
  {
    start: Type.Integer({ minimum: 0 }),
    end: Type.Integer({ minimum: 0 }),
  },
  closed,
);

export const InvestigationClaimSchema = Type.Object(
  {
    id: Type.String(),
    text: Type.String(),
    order: Type.Integer({ minimum: 0 }),
    /** 只有原子文本逐字出现在原句时才给真实字符下标（UTF-16 code unit）；不得伪造 span。 */
    originalSpan: Type.Optional(InvestigationSpanSchema),
    checkability: InvestigationCheckabilitySchema,
    progress: InvestigationProgressSchema,
    judgment: Type.Union([InvestigationJudgmentSchema, Type.Null()]),
    /** 判断透明补充（审计新增）：该命题「仍不能推出什么」，来自生产 boundary 字段。 */
    boundary: Type.Optional(Type.String()),
    evidence: Type.Array(InvestigationEvidenceLinkSchema),
    gaps: Type.Array(InvestigationGapSchema),
  },
  closed,
);
export type InvestigationClaim = Static<typeof InvestigationClaimSchema>;

export const InvestigationConflictSideSchema = Type.Object(
  {
    position: Type.Union([
      Type.Literal("support"),
      Type.Literal("contradict"),
      Type.Literal("other"),
    ]),
    sourceIds: Type.Array(Type.String()),
    summary: Type.Optional(Type.String()),
  },
  closed,
);
export type InvestigationConflictSide = Static<typeof InvestigationConflictSideSchema>;

export const InvestigationConflictSchema = Type.Object(
  {
    id: Type.String(),
    claimId: Type.String(),
    summary: Type.String(),
    sides: Type.Array(InvestigationConflictSideSchema),
    /** 只有证据/质询回应能支持时才填；不知道就 reasonStatus=unknown 且不给 reason。 */
    reason: Type.Optional(Type.String()),
    reasonStatus: Type.Union([Type.Literal("known"), Type.Literal("unknown")]),
    unresolved: Type.Boolean(),
  },
  closed,
);
export type InvestigationConflict = Static<typeof InvestigationConflictSchema>;

export const InvestigationConclusionSchema = Type.Object(
  {
    /** 对原问题的直接回答（生产 conclusion 文本），不是内部 verdict 标签。 */
    directAnswer: Type.String(),
    judgment: InvestigationJudgmentSchema,
    rationale: Type.Optional(Type.String()),
    boundaries: Type.Array(Type.String()),
    claimIds: Type.Array(Type.String()),
    sourceIds: Type.Array(Type.String()),
  },
  closed,
);
export type InvestigationConclusion = Static<typeof InvestigationConclusionSchema>;

export const InvestigationSnapshotSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    originalClaim: Type.String(),
    phase: InvestigationPhaseSchema,
    claims: Type.Array(InvestigationClaimSchema),
    sources: Type.Array(InvestigationSourceSchema),
    conflicts: Type.Array(InvestigationConflictSchema),
    conclusion: Type.Optional(InvestigationConclusionSchema),
    checkedAt: Type.Optional(Type.String()),
  },
  closed,
);
export type InvestigationSnapshot = Static<typeof InvestigationSnapshotSchema>;
export type InvestigationSnapshotV1 = InvestigationSnapshot;

function errorLines(input: unknown): string {
  return (
    Value.Errors(InvestigationSnapshotSchema, input)
      .map((err) => `${err.instancePath || "/"}: ${err.message}`)
      .join("\n") || "invalid"
  );
}

/** 校验并返回 InvestigationSnapshotV1；不合法抛错（信息含全部违规路径）。 */
export function validateInvestigationSnapshot(input: unknown): InvestigationSnapshotV1 {
  if (Value.Check(InvestigationSnapshotSchema, input)) {
    return input as InvestigationSnapshotV1;
  }
  throw new Error(errorLines(input));
}

/** 只判断不抛错。 */
export function isInvestigationSnapshot(input: unknown): input is InvestigationSnapshotV1 {
  return Value.Check(InvestigationSnapshotSchema, input);
}
