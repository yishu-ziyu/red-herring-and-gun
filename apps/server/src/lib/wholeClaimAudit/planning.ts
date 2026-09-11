/**
 * Whole-Claim Planning — Phase 1（Issue #78 §4）。
 *
 * 时机：self-proof + forceCheckable 之后、决定哪些 atom 进入 retrieval 之前。
 * 输入：originalClaim + kept claimAtoms + claimAtomTypes + stanceClaimType（如有）。
 * 职责：调查规划（整句想推出什么 / 哪些 normative 有外部标准可查 / 还缺什么依据），
 * 不给 verdict、不改写原子、不创建新 Claim。
 *
 * checkability 修订由 LM 语义判断，确定性代码只守不变量：
 * - 只应用 false→true 提升（不降级、不改 type、不触碰未命中 kept atom 的条目）；
 * - claimAtom 必须按 claimAtomKey 命中真实 kept atom，否则整条忽略；
 * - LM 不可用时 fail-open：保持 forceCheckable 后的 legacy 行为。
 */

import { claimAtomKey } from "../claimAtom/text.js";
import type { WholeClaimAuditModelCall, WholeClaimAuditPlan } from "./types.js";

export const WHOLE_CLAIM_PLANNING_SYSTEM_PROMPT = [
  "你是红鲱鱼与枪的整句审计规划器（Whole-Claim Planning）。",
  "用户提交了一句话，系统把它拆成了若干原子命题。你的任务是做调查规划，不是判真假、不是给结论。",
  "",
  "你必须回答四件事：",
  "1. overallQuestion：原句整句真正想让人相信什么（整句层面的问题，不是任何单条原子的改写）。",
  "2. checkabilityRevisions：逐条审视原子命题的可核查性。判断依据是语义：这条主张的真伪是否存在「明确的外部可核查标准」——医学指南、药品说明书、适应症、法规、行业标准、技术规范、公开规则等。",
  "   - 纯价值 / 政策偏好（如「政府应该禁止短视频」，没有外部标准决定其真伪）→ verifiable=false，维持不适用真/假判断。",
  "   - 有明确外部标准的规范性建议（如医疗建议可由指南与适应症核查、用法建议可由药品说明书核查）→ verifiable=true；type 保持 normative 或 value，不得改成 fact/causal。",
  "   - 只依据语义判断，不得按「应该 / 应当 / 所有」等词面机械决定；每条修订必须给 reason。",
  "3. missingJustifications：要让原句整句成立，还缺哪些依据 / 条件 / 标准（例如「A、B 都真并不自动推出 C，还缺 C 的独立依据」）。只列真正缺失的桥接依据，没有就留空数组。",
  "4. auditQuestions：当前最值得验证的 1-3 个问题。targetClaimAtom 必须逐字取自输入的原子命题列表，映射不到任何已有原子时省略该字段；suggestedQuery 是给搜索引擎的查询词（工具规划，不是证据）。",
  "",
  "硬约束：",
  "- 不得创建输入原子列表之外的新「用户主张」；missingJustifications 是内部调查问题，不是用户说过的话。",
  "- 不得输出任何 verdict（成立 / 不成立 / 真假）；你的输出是调查规划。",
  "- 拆题工单已标 verifiable=true 的原子，除非你判断其真伪没有外部标准，否则不要反向修订。",
  "",
  "输出严格 JSON（不要 Markdown，不要代码块）。",
].join("\n");

export const wholeClaimPlanningSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    overallQuestion: { type: "string" },
    checkabilityRevisions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          claimAtom: { type: "string" },
          verifiable: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["claimAtom", "verifiable", "reason"],
      },
    },
    missingJustifications: { type: "array", items: { type: "string" } },
    auditQuestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          question: { type: "string" },
          reason: { type: "string" },
          targetClaimAtom: { type: "string" },
          suggestedQuery: { type: "string" },
        },
        required: ["question", "reason"],
      },
    },
  },
  required: ["overallQuestion", "checkabilityRevisions", "missingJustifications", "auditQuestions"],
};

export function buildPlanningUserContent(input: {
  claim: string;
  keptAtoms: string[];
  claimAtomTypes: unknown;
  stanceClaimType?: unknown;
}): string {
  const atoms = input.keptAtoms.map((a, i) => `${i + 1}. ${a}`).join("\n");
  return [
    "原句（originalClaim）：",
    input.claim,
    "",
    "拆题后保留的原子命题（claimAtoms）：",
    atoms || "（无）",
    "",
    `拆题类型工单（claimAtomTypes）：${JSON.stringify(input.claimAtomTypes ?? [])}`,
    input.stanceClaimType != null
      ? `整句类型（stanceClaimType）：${JSON.stringify(input.stanceClaimType)}`
      : "",
    "",
    "请输出整句审计规划 JSON。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function clipText(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function clipList(value: unknown, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clipText(item, itemMax);
    if (!text) continue;
    out.push(text);
    if (out.length >= max) break;
  }
  return out;
}

/** 解析并夹紧模型输出；结构非法的字段一律丢弃，不抛错（fail-open）。 */
export function parseWholeClaimPlan(output: unknown): WholeClaimAuditPlan | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const rec = output as Record<string, unknown>;
  const overallQuestion = clipText(rec.overallQuestion, 200);
  if (!overallQuestion) return null;
  const revisions: WholeClaimAuditPlan["checkabilityRevisions"] = [];
  if (Array.isArray(rec.checkabilityRevisions)) {
    for (const item of rec.checkabilityRevisions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      const claimAtom = clipText(r.claimAtom, 200);
      if (!claimAtom || typeof r.verifiable !== "boolean") continue;
      revisions.push({ claimAtom, verifiable: r.verifiable, reason: clipText(r.reason, 200) });
      if (revisions.length >= 12) break;
    }
  }
  const questions: WholeClaimAuditPlan["auditQuestions"] = [];
  if (Array.isArray(rec.auditQuestions)) {
    for (const item of rec.auditQuestions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      const question = clipText(r.question, 200);
      if (!question) continue;
      questions.push({
        question,
        reason: clipText(r.reason, 200),
        ...(typeof r.targetClaimAtom === "string" && r.targetClaimAtom.trim()
          ? { targetClaimAtom: r.targetClaimAtom.trim().slice(0, 200) }
          : {}),
        ...(typeof r.suggestedQuery === "string" && r.suggestedQuery.trim()
          ? { suggestedQuery: r.suggestedQuery.trim().slice(0, 160) }
          : {}),
      });
      if (questions.length >= 3) break;
    }
  }
  return {
    overallQuestion,
    checkabilityRevisions: revisions,
    missingJustifications: clipList(rec.missingJustifications, 5, 200),
    auditQuestions: questions,
  };
}

export type AppliedCheckabilityRevisions = {
  /** 修订后的 claimAtomTypes（新数组；未命中 / 降级 / 无效修订原样保留）。 */
  claimAtomTypes: Array<Record<string, unknown>>;
  /** 实际应用（false→true）的修订，含 reason；type 不改写。 */
  applied: Array<{ claimAtom: string; reason: string }>;
  /** 被确定性代码丢弃的修订及原因（模型语义不得越过的不变量）。 */
  ignored: Array<{ claimAtom: string; reasonCode: string }>;
};

/**
 * 应用可核查性修订（Issue #78 §5/§12）：
 * 仅 false→true 提升；claimAtom 必须命中真实 kept atom；type 一律不改写
 * （normative + verifiable=true 是合法组合）；不创建新原子；旧 heuristic 不回压。
 */
export function applyCheckabilityRevisions(
  claimAtomTypes: unknown,
  keptAtoms: readonly string[],
  revisions: ReadonlyArray<{ claimAtom: string; verifiable: boolean; reason: string }>
): AppliedCheckabilityRevisions {
  const keptKeys = new Set(keptAtoms.map((a) => claimAtomKey(a)));
  if (!Array.isArray(claimAtomTypes)) {
    return { claimAtomTypes: claimAtomTypes as AppliedCheckabilityRevisions["claimAtomTypes"], applied: [], ignored: [] };
  }
  const out: Array<Record<string, unknown>> = claimAtomTypes.map((item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>) }
      : item
  );
  const applied: AppliedCheckabilityRevisions["applied"] = [];
  const ignored: AppliedCheckabilityRevisions["ignored"] = [];
  for (const revision of revisions) {
    const key = claimAtomKey(revision.claimAtom);
    if (!key || !keptKeys.has(key)) {
      ignored.push({ claimAtom: revision.claimAtom, reasonCode: "not-a-kept-atom" });
      continue;
    }
    const target = out.find(
      (item) =>
        item &&
        typeof item === "object" &&
        claimAtomKey(String((item as { text?: unknown }).text ?? "")) === key
    );
    if (!target) {
      ignored.push({ claimAtom: revision.claimAtom, reasonCode: "no-type-entry" });
      continue;
    }
    if (revision.verifiable !== true) {
      ignored.push({ claimAtom: revision.claimAtom, reasonCode: "demote-not-allowed" });
      continue;
    }
    if (target.verifiable === true) {
      ignored.push({ claimAtom: revision.claimAtom, reasonCode: "already-verifiable" });
      continue;
    }
    target.verifiable = true;
    applied.push({ claimAtom: String(target.text ?? revision.claimAtom), reason: revision.reason });
  }
  return { claimAtomTypes: out, applied, ignored };
}

/** Phase 1 运行器：模型失败 / 未注入时返回 null（fail-open 到 legacy 行为）。 */
export async function runWholeClaimPlanning(input: {
  claim: string;
  keptAtoms: string[];
  claimAtomTypes: unknown;
  stanceClaimType?: unknown;
  callModel: WholeClaimAuditModelCall;
}): Promise<{ plan: WholeClaimAuditPlan; model: string } | null> {
  try {
    const result = await input.callModel({
      systemPrompt: WHOLE_CLAIM_PLANNING_SYSTEM_PROMPT,
      userContent: buildPlanningUserContent(input),
      responseSchema: wholeClaimPlanningSchema,
      maxTokens: 800,
    });
    const plan = parseWholeClaimPlan(result?.output);
    return plan ? { plan, model: result?.model ?? "" } : null;
  } catch {
    return null;
  }
}
