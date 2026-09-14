/**
 * PublicActivity — 调查正在做什么的确定性投影（IMPLEMENTATION_PLAN §5.1）。
 *
 * 它不是模型写的直播稿，也不是原始工具日志：只由已校验快照的差分与结构化 hook 生成，
 * payload 走每 kind 的白名单，供应商原文、内部思考、提示词与密钥都进不来。
 *
 * 活动层不是第二个真相源：结果内容以 InvestigationSnapshotV1 为准；
 * 活动层坏了不影响结果，快照坏了不伪造结果。
 *
 * 引用纪律：`claimIds` / `sourceIds` 必须指向同一 `snapshotRevision` 里已存在的对象；
 * 没有可归属对象的事件只能描述动作（引用数组留空）。
 * `InvestigationEvidenceLink` 没有稳定 id，故本契约不设 `evidenceIds`——
 * 编一个 id 就是改快照 schema，等 run 内证据 id 落地再加。
 *
 * 镜像约束：本文件与 `packages/core/src/investigation/activity.ts` 字节一致。
 */
import { Type, type Static } from "typebox";
import { Value } from "typebox/value";
import type { InvestigationSnapshotV1 } from "./schema.js";

const closed = { additionalProperties: false } as const;

export const WorkRoleSchema = Type.Union([
  Type.Literal("question"),
  Type.Literal("source"),
  Type.Literal("context"),
  Type.Literal("judgment"),
]);
export type WorkRole = Static<typeof WorkRoleSchema>;

/** 活动种类的唯一清单；改这里必须同时改下面的 Schema（有测试守住两者一致）。 */
export const ACTIVITY_KINDS = [
  "claim_decomposed",
  "search_started",
  "knowledge_hit",
  "prior_round_reuse",
  "source_found",
  "source_checked",
  "evidence_assessed",
  "conflict_detected",
  "gap_identified",
  "judgment_revised",
  "run_completed",
] as const;

// 逐字列出来而不是从 ACTIVITY_KINDS 推导：TS 对映射出来的 Type.Union 推不出联合，会塌成 never。
export const ActivityKindSchema = Type.Union([
  Type.Literal("claim_decomposed"),
  Type.Literal("search_started"),
  /**
   * 命中本地知识库：该命题跳过这次联网检索（记忆只加速，不代替核查）。
   * 没有可归属对象（动作类）：claimIds / sourceIds 留空，日期只在 payload 里。
   */
  Type.Literal("knowledge_hit"),
  /**
   * 同一案上一轮证据够用：该命题不再联网检索。
   * 没有可归属对象（动作类）：claimIds / sourceIds 留空。
   */
  Type.Literal("prior_round_reuse"),
  Type.Literal("source_found"),
  Type.Literal("source_checked"),
  Type.Literal("evidence_assessed"),
  Type.Literal("conflict_detected"),
  Type.Literal("gap_identified"),
  Type.Literal("judgment_revised"),
  Type.Literal("run_completed"),
]);
export type ActivityKind = Static<typeof ActivityKindSchema>;

/** 每个 kind 允许出现在 payload 里的键。白名单之外一律丢弃，不报错、不落库。 */
export const ACTIVITY_PAYLOAD_KEYS: Record<ActivityKind, readonly string[]> = {
  claim_decomposed: ["claimText"],
  search_started: ["query"],
  /** 已核日期（YYYY-MM-DD）。verifiedAt 是历史别名，两个键都可能出现。 */
  knowledge_hit: ["originDate", "verifiedAt"],
  prior_round_reuse: ["originDate"],
  source_found: ["title", "domain"],
  source_checked: ["title", "domain", "role"],
  evidence_assessed: ["judgment"],
  conflict_detected: ["summary"],
  gap_identified: ["description"],
  judgment_revised: ["from", "to"],
  run_completed: ["phase"],
};

/** 每个 kind 固定归属的工作职责；不让调用方自由指定。 */
export const ACTIVITY_ROLE: Record<ActivityKind, WorkRole> = {
  claim_decomposed: "question",
  search_started: "source",
  knowledge_hit: "source",
  prior_round_reuse: "source",
  source_found: "source",
  source_checked: "source",
  evidence_assessed: "judgment",
  conflict_detected: "context",
  gap_identified: "context",
  judgment_revised: "judgment",
  run_completed: "judgment",
};

/** 单条 payload 值的长度上限；超出即截断，避免把整篇正文塞进事件流。 */
export const ACTIVITY_VALUE_MAX = 160;

export const PublicActivitySchema = Type.Object(
  {
    version: Type.Literal(1),
    /** `runId:seq`，稳定且不含时间戳；重放同一份数据得到同一个 id。 */
    id: Type.String(),
    runId: Type.String(),
    seq: Type.Integer({ minimum: 1 }),
    occurredAt: Type.String(),
    kind: ActivityKindSchema,
    role: WorkRoleSchema,
    claimIds: Type.Array(Type.String()),
    sourceIds: Type.Array(Type.String()),
    /** 先落相关快照，后允许引用。 */
    snapshotRevision: Type.Integer({ minimum: 0 }),
    payload: Type.Record(Type.String(), Type.String()),
  },
  closed,
);
export type PublicActivity = Static<typeof PublicActivitySchema>;

/** 校验并返回；不合法抛错（信息含违规路径）。 */
export function validatePublicActivity(input: unknown): PublicActivity {
  if (Value.Check(PublicActivitySchema, input)) return input as PublicActivity;
  const detail =
    Value.Errors(PublicActivitySchema, input)
      .map((err) => `${err.instancePath || "/"}: ${err.message}`)
      .join("\n") || "invalid";
  throw new Error(detail);
}

export function isPublicActivity(input: unknown): input is PublicActivity {
  return Value.Check(PublicActivitySchema, input);
}

/** 只留白名单键，值压成字符串并截断；不编值、不补默认。 */
export function sanitizeActivityPayload(
  kind: ActivityKind,
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  const allowed = ACTIVITY_PAYLOAD_KEYS[kind];
  const out: Record<string, string> = {};
  if (!raw) return out;
  for (const key of allowed) {
    const value = raw[key];
    if (typeof value === "string") {
      const text = value.trim();
      if (text) out[key] = text.length > ACTIVITY_VALUE_MAX ? text.slice(0, ACTIVITY_VALUE_MAX) : text;
    } else if (typeof value === "number" || typeof value === "boolean") {
      out[key] = String(value);
    }
  }
  return out;
}

/** 投影中间态：id / seq / occurredAt / revision 由 ActivityLog 统一分配。 */
export type ActivityDraft = Pick<PublicActivity, "kind" | "claimIds" | "sourceIds"> & {
  payload?: Record<string, unknown>;
};

function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

const ASSESSED_ROLES = new Set(["support", "contradict"]);

/**
 * 一次 run 的活动账本：负责 seq、稳定 id、快照 revision、去重与引用校验。
 * 不读自由文本推测关联；没有可归属对象的 draft 引用数组必须为空。
 */
export function createActivityLog(options: { runId: string; now?: () => Date }) {
  const runId = options.runId;
  const now = options.now ?? (() => new Date());
  let seq = 0;
  let revision = 0;
  const emitted = new Set<string>();
  const activities: PublicActivity[] = [];

  function push(draft: ActivityDraft): PublicActivity[] {
    const claimIds = [...new Set(draft.claimIds)];
    const sourceIds = [...new Set(draft.sourceIds)];
    seq += 1;
    const activity: PublicActivity = {
      version: 1,
      id: `${runId}:${seq}`,
      runId,
      seq,
      occurredAt: now().toISOString(),
      kind: draft.kind,
      role: ACTIVITY_ROLE[draft.kind],
      claimIds,
      sourceIds,
      snapshotRevision: revision,
      payload: sanitizeActivityPayload(draft.kind, draft.payload),
    };
    activities.push(activity);
    return [activity];
  }

  /** 同一 key 只发一次；没有可归属对象的活动（claimIds 为空且 kind 不是动作类）不发。 */
  function once(claimIds: string[], key: string, draft: ActivityDraft): PublicActivity[] {
    if (claimIds.length === 0) return [];
    if (emitted.has(key)) return [];
    emitted.add(key);
    return push(draft);
  }

  return {
    runId,
    /** 已投影的快照份数；活动引用它表示「这份快照已经发过了」。 */
    revision: () => revision,
    all: () => [...activities],

    /** 动作类事件：没有可归属对象，只能描述动作。 */
    recordSearchStarted(query: string): PublicActivity[] {
      return push({ kind: "search_started", claimIds: [], sourceIds: [], payload: { query } });
    },

    /**
     * 命中知识库 → 该命题这次不联网检索。
     * 与 search_started 同类：动作本身没有可归属对象（证据会由快照给出来源行），
     * 所以引用数组留空；日期放 payload，读侧不从文案里猜时间。
     */
    recordKnowledgeHit(originDate: string): PublicActivity[] {
      const day = String(originDate ?? "").trim();
      if (!day) return [];
      return push({ kind: "knowledge_hit", claimIds: [], sourceIds: [], payload: { originDate: day } });
    },

    /**
     * 同一案上一轮证据够用 → 该命题这次不联网检索。
     * 与 knowledge_hit 同类：动作类、引用留空；日期可缺（不编日期）。
     */
    recordPriorRoundReuse(originDate: string): PublicActivity[] {
      const day = String(originDate ?? "").trim();
      return push({
        kind: "prior_round_reuse",
        claimIds: [],
        sourceIds: [],
        payload: day ? { originDate: day } : {},
      });
    },

    /** 快照先落，再允许引用。同一份快照重复投影不产生新活动。 */
    project(prev: InvestigationSnapshotV1 | null, next: InvestigationSnapshotV1): PublicActivity[] {
      if (prev === next) return [];
      revision += 1;
      const claimIdsSet = new Set(next.claims.map((claim) => claim.id));
      const sourceIdsSet = new Set(next.sources.map((source) => source.id));
      const sourceById = new Map(next.sources.map((source) => [source.id, source]));
      const out: PublicActivity[] = [];

      for (const claim of next.claims) {
        out.push(
          ...once([claim.id], `claim_decomposed:${claim.id}`, {
            kind: "claim_decomposed",
            claimIds: [claim.id],
            sourceIds: [],
            payload: { claimText: claim.text },
          }),
        );

        const priorClaim = prev?.claims.find((c) => c.id === claim.id);
        const priorRoleBySource = new Map(
          (priorClaim?.evidence ?? []).map((link) => [link.sourceId, link.role]),
        );

        for (const link of claim.evidence) {
          if (!sourceIdsSet.has(link.sourceId) || !claimIdsSet.has(claim.id)) continue;
          const source = sourceById.get(link.sourceId);
          const title = source?.title ?? "";
          const domain = source ? domainOf(source.url) : "";
          const payload = { title, domain };
          const priorRole = priorRoleBySource.get(link.sourceId);
          // 一份材料只报一次转归：到货时已判定就报「已判定」，未判定改判定就报「改了」。
          if (ASSESSED_ROLES.has(link.role) && priorRole !== link.role) {
            out.push(
              ...once([claim.id], `source_checked:${claim.id}:${link.sourceId}:${link.role}`, {
                kind: "source_checked",
                claimIds: [claim.id],
                sourceIds: [link.sourceId],
                payload: { ...payload, role: link.role },
              }),
            );
          } else if (!priorRole) {
            out.push(
              ...once([claim.id], `source_found:${claim.id}:${link.sourceId}`, {
                kind: "source_found",
                claimIds: [claim.id],
                sourceIds: [link.sourceId],
                payload,
              }),
            );
          }
        }

        const priorJudgment = priorClaim?.judgment ?? null;
        if (claim.judgment && !priorJudgment) {
          out.push(
            ...once([claim.id], `evidence_assessed:${claim.id}`, {
              kind: "evidence_assessed",
              claimIds: [claim.id],
              sourceIds: [],
              payload: { judgment: claim.judgment },
            }),
          );
        } else if (claim.judgment && priorJudgment && priorJudgment !== claim.judgment) {
          out.push(
            ...once([claim.id], `judgment_revised:${claim.id}:${claim.judgment}`, {
              kind: "judgment_revised",
              claimIds: [claim.id],
              sourceIds: [],
              payload: { from: priorJudgment, to: claim.judgment },
            }),
          );
        }

        for (const gap of claim.gaps) {
          out.push(
            ...once([claim.id], `gap_identified:${gap.id}`, {
              kind: "gap_identified",
              claimIds: [claim.id],
              sourceIds: [],
              payload: { description: gap.description },
            }),
          );
        }
      }

      for (const conflict of next.conflicts) {
        const claimIds = claimIdsSet.has(conflict.claimId) ? [conflict.claimId] : [];
        const sourceIds = conflict.sides
          .flatMap((side) => side.sourceIds)
          .filter((id) => sourceIdsSet.has(id));
        out.push(
          ...once(claimIds, `conflict_detected:${conflict.id}`, {
            kind: "conflict_detected",
            claimIds,
            sourceIds,
            payload: { summary: conflict.summary },
          }),
        );
      }

      if (next.phase === "complete" && !emitted.has("run_completed")) {
        emitted.add("run_completed");
        out.push(
          ...push({
            kind: "run_completed",
            claimIds: [],
            sourceIds: [],
            payload: { phase: next.phase },
          }),
        );
      }

      return out;
    },
  };
}

export type ActivityLog = ReturnType<typeof createActivityLog>;
