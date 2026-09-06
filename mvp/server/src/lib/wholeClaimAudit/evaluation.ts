/**
 * Whole-Claim Evaluation — Phase 2（Issue #78 §7）。
 *
 * 时机：初轮 atom retrieval + FactChecker + Source binding（含既有补查 / 质询）完成后、
 * ReportComposer 之前。只允许一次 audit-driven 额外补查 pass（§8）。
 *
 * 职责：回答「原句现在成立到哪里 / 最大缺口是什么 / 下一步最值得查什么」。
 * LM 先验只负责发现疑点、生成问题、选择下一步；不得替代最终证明（§6）——
 * 本模块的任何输出都不进入 Evidence，只有随后真实工具取得的来源才进 bundle。
 */

import { claimAtomKey } from "../claimAtom/text.js";
import type {
  WholeClaimAuditEvaluation,
  WholeClaimAuditModelCall,
  WholeClaimAuditQuestion,
} from "./types.js";

export const WHOLE_CLAIM_EVALUATION_SYSTEM_PROMPT = [
  "你是红鲱鱼与枪的整句证据评估器（Whole-Claim Evaluation）。",
  "输入是原句、拆题后的原子命题、每条命题的当前判定与绑定证据。你的任务是评估整句论证，不是给 verdict、不是重新判定单条命题。",
  "",
  "你必须回答三件事：",
  "1. supportedWhere：原句现在成立到哪里。只能陈述已绑定来源的判定撑到的层级。",
  "2. biggestGap：从单条命题判定到「整句结论成立」之间最大的推理 / 依据缺口。",
  "3. nextQuestions：下一步最值得验证的 1-3 个问题（没有就空数组）。targetClaimAtom 必须逐字取自输入的原子命题列表；映射不到任何已有原子时省略该字段。suggestedQuery 是给搜索引擎的查询词。",
  "",
  "重点检查「前提真 ≠ 结论成立」：",
  "- 即使各原子命题都被证据支持，也要检查它们是否足以推出原句整句的结论。",
  "- 例：「吃饭升血糖」「胰岛素降血糖」都被支持，推不出「所有人每顿饭后都应注射胰岛素」——中间缺适应症、普遍适用性、风险例外等独立依据。",
  "- 缺口能明确归属到某条已有原子时，把问题指向该原子（targetClaimAtom）；纯桥接问题无法诚实映射时省略 targetClaimAtom。",
  "",
  "硬约束：",
  "- 模型记忆不是证据：你发现疑点只能生成问题，不得据此宣称某命题成立或不成立。",
  "- missingJustifications 只在「现有证据不足以把各命题连成整句结论」时填写；单命题查证充分、整句论证完整时必须留空数组。",
  "- 不得输出 supported / refuted 之类整句标签。",
  "",
  "输出严格 JSON（不要 Markdown，不要代码块）。",
].join("\n");

export const wholeClaimEvaluationSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    supportedWhere: { type: "string" },
    biggestGap: { type: "string" },
    missingJustifications: { type: "array", items: { type: "string" } },
    nextQuestions: {
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
  required: ["supportedWhere", "biggestGap", "missingJustifications", "nextQuestions"],
};

export type VerdictSummaryInput = {
  claimAtom?: unknown;
  verdict?: unknown;
  evidence?: unknown;
  supportingSources?: unknown;
  contradictingSources?: unknown;
};

/** 压缩判词清单给评估调用：只带判定方向 + 来源计数，不带长文本（控 token）。 */
export function compactVerdicts(verdicts: unknown): Array<{
  claimAtom: string;
  verdict: string;
  supportCount: number;
  contradictCount: number;
  evidence: string;
}> {
  if (!Array.isArray(verdicts)) return [];
  const out: Array<{
    claimAtom: string;
    verdict: string;
    supportCount: number;
    contradictCount: number;
    evidence: string;
  }> = [];
  for (const item of verdicts) {
    if (!item || typeof item !== "object") continue;
    const rec = item as VerdictSummaryInput;
    const atom = typeof rec.claimAtom === "string" ? rec.claimAtom.trim() : "";
    if (!atom) continue;
    out.push({
      claimAtom: atom,
      verdict: typeof rec.verdict === "string" ? rec.verdict : "unverified",
      supportCount: Array.isArray(rec.supportingSources) ? rec.supportingSources.length : 0,
      contradictCount: Array.isArray(rec.contradictingSources) ? rec.contradictingSources.length : 0,
      evidence: typeof rec.evidence === "string" ? rec.evidence.slice(0, 160) : "",
    });
    if (out.length >= 12) break;
  }
  return out;
}

export function buildEvaluationUserContent(input: {
  claim: string;
  keptAtoms: string[];
  claimAtomTypes: unknown;
  subclaimVerdicts: unknown;
  missingJustificationsFromPlan?: readonly string[];
}): string {
  return [
    "原句（originalClaim）：",
    input.claim,
    "",
    "原子命题（claimAtoms）：",
    input.keptAtoms.map((a, i) => `${i + 1}. ${a}`).join("\n") || "（无）",
    "",
    `类型工单（claimAtomTypes）：${JSON.stringify(input.claimAtomTypes ?? [])}`,
    "",
    `当前逐条判定与证据（subclaimVerdicts）：${JSON.stringify(compactVerdicts(input.subclaimVerdicts))}`,
    input.missingJustificationsFromPlan?.length
      ? `规划阶段记录的待补依据：${JSON.stringify(input.missingJustificationsFromPlan)}`
      : "",
    "",
    "请输出整句证据评估 JSON。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

/** 解析并夹紧；结构非法返回 null（fail-open，不阻断收束）。 */
export function parseWholeClaimEvaluation(output: unknown): WholeClaimAuditEvaluation | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const rec = output as Record<string, unknown>;
  const supportedWhere = typeof rec.supportedWhere === "string" ? rec.supportedWhere.trim().slice(0, 400) : "";
  const biggestGap = typeof rec.biggestGap === "string" ? rec.biggestGap.trim().slice(0, 300) : "";
  if (!supportedWhere && !biggestGap) return null;
  const questions: WholeClaimAuditQuestion[] = [];
  if (Array.isArray(rec.nextQuestions)) {
    for (const item of rec.nextQuestions) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const r = item as Record<string, unknown>;
      const question = typeof r.question === "string" ? r.question.trim().slice(0, 200) : "";
      if (!question) continue;
      questions.push({
        question,
        reason: typeof r.reason === "string" ? r.reason.trim().slice(0, 200) : "",
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
  const missing: string[] = [];
  if (Array.isArray(rec.missingJustifications)) {
    for (const item of rec.missingJustifications) {
      const text = typeof item === "string" ? item.trim().slice(0, 200) : "";
      if (!text) continue;
      missing.push(text);
      if (missing.length >= 5) break;
    }
  }
  return { supportedWhere, biggestGap, missingJustifications: missing, nextQuestions: questions };
}

/** Phase 2 运行器：失败返回 null（fail-open）。 */
export async function runWholeClaimEvaluation(input: {
  claim: string;
  keptAtoms: string[];
  claimAtomTypes: unknown;
  subclaimVerdicts: unknown;
  missingJustificationsFromPlan?: readonly string[];
  callModel: WholeClaimAuditModelCall;
}): Promise<{ evaluation: WholeClaimAuditEvaluation; model: string } | null> {
  try {
    const result = await input.callModel({
      systemPrompt: WHOLE_CLAIM_EVALUATION_SYSTEM_PROMPT,
      userContent: buildEvaluationUserContent(input),
      responseSchema: wholeClaimEvaluationSchema,
      maxTokens: 800,
    });
    const evaluation = parseWholeClaimEvaluation(result?.output);
    return evaluation ? { evaluation, model: result?.model ?? "" } : null;
  } catch {
    return null;
  }
}

/** 问题能否映射到真实 kept atom（无 target 的问题是桥接问题，第一版只记录不补查）。 */
export function resolveQuestionAtomKey(
  question: WholeClaimAuditQuestion,
  keptAtoms: readonly string[]
): string | null {
  if (!question.targetClaimAtom) return null;
  const key = claimAtomKey(question.targetClaimAtom);
  if (!key) return null;
  return keptAtoms.some((a) => claimAtomKey(a) === key) ? key : null;
}
