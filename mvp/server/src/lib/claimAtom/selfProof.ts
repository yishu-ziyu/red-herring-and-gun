import type { ClaimAtomDropped } from "./types.js";
import { claimAtomKey } from "./text.js";

export function prefilterClaimAtoms(
  claim: string,
  rawAtoms: unknown
): { atoms: string[]; dropped: ClaimAtomDropped[] } {
  void claim;
  const atoms: string[] = [];
  const dropped: ClaimAtomDropped[] = [];
  const seen = new Set<string>();
  if (Array.isArray(rawAtoms)) {
    for (const item of rawAtoms) {
      if (typeof item !== "string") continue;
      const trimmed = item.trim();
      if (!trimmed) continue;
      const normKey = claimAtomKey(trimmed);
      if (seen.has(normKey)) {
        dropped.push({ text: item, reason: "duplicate" });
        continue;
      }
      seen.add(normKey);
      atoms.push(normKey);
    }
  }
  return { atoms: atoms.slice(0, 6), dropped };
}

export const SELF_PROOF_SYSTEM_PROMPT = [
  "你是红鲱鱼与枪的原子命题自证校验器（原句自证闸门）。",
  "你的任务是对每条候选原子命题（claimAtom）逐条判断：它是否被原句（claim）直接支持，且作为独立可核查断言仍保有明确含义。",
  "判定标准（只有同时满足才 supported=true）：",
  "1. 原句直接支持：原子只能由原句直接支持，不得加入原句未声称的信息、不得补全上下文、不得注入模型常识。",
  "2. 独立含义：原子作为独立可核查断言仍保有明确含义——没有丢失原句的限定条件（如「某种情况下 X」不得拆成「X」）、不是截断到失去语义的碎片、也不与另一条被保留的原子冗余。",
  "3. 本闸门只判「忠实」（原句是否直接声称），不判「可核查性」。立场/价值/预测型原子若原句直接声称了该立场或断言，即使它本身不可核查，也应判 supported=true——是否可核查由后续排除层另行处置，不在本判断范围。",
  "输出严格 JSON（不要 Markdown，不要代码块）：{\n  \"results\": [\n    {\"atom\": \"原子文本\", \"supported\": true, \"reason\": \"判断依据\"}\n  ]\n}",
  "results 必须覆盖输入列出的每个原子；reason 用中文说明判断依据。",
].join("\n");

export const selfProofSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          atom: { type: "string" },
          supported: { type: "boolean" },
          reason: { type: "string" },
        },
        required: ["atom", "supported", "reason"],
      },
    },
  },
  required: ["results"],
};

export function buildSelfProofUserContent(claim: string, atoms: string[]): string {
  const lines = atoms.map((atom, i) => `${i + 1}. ${atom}`).join("\n");
  return [
    "原句（claim）：",
    claim,
    "",
    "待校验的候选原子命题（claimAtoms）：",
    lines,
    "",
    "请逐条判断每个原子是否被原句直接支持且保有独立含义，返回 results 数组。",
  ].join("\n");
}

export function parseSelfProofResults(atoms: string[], llmResults: unknown): Map<string, boolean> {
  const map = new Map<string, boolean>();
  for (const atom of atoms) map.set(atom, true);
  if (llmResults && typeof llmResults === "object") {
    const results = (llmResults as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        const atom = typeof rec.atom === "string" ? rec.atom : "";
        if (!atom) continue;
        const key = claimAtomKey(atom);
        if (map.has(key)) {
          map.set(key, rec.supported === true);
        }
      }
    }
  }
  return map;
}

function lookupSelfProofReason(atom: string, llmResults: unknown): string | undefined {
  if (llmResults && typeof llmResults === "object") {
    const results = (llmResults as Record<string, unknown>).results;
    if (Array.isArray(results)) {
      for (const item of results) {
        if (!item || typeof item !== "object") continue;
        const rec = item as Record<string, unknown>;
        if (typeof rec.atom === "string" && claimAtomKey(rec.atom) === atom) {
          return typeof rec.reason === "string" ? rec.reason : undefined;
        }
      }
    }
  }
  return undefined;
}

export function applySelfProof(
  claim: string,
  rawAtoms: unknown,
  llmResults: unknown
): { kept: string[]; dropped: ClaimAtomDropped[] } {
  const { atoms, dropped } = prefilterClaimAtoms(claim, rawAtoms);
  const supportedMap = parseSelfProofResults(atoms, llmResults);
  const kept: string[] = [];
  for (const atom of atoms) {
    if (supportedMap.get(atom) === true) {
      kept.push(atom);
    } else {
      dropped.push({ text: atom, reason: lookupSelfProofReason(atom, llmResults) ?? "unsupported" });
    }
  }
  return { kept, dropped };
}

export type SelfProofModelCall = (input: {
  systemPrompt: string;
  userContent: string;
  responseSchema: object;
  maxTokens: number;
}) => Promise<{ output: unknown; model: string }>;

/** 完整网关：预过滤 → LLM 自证 → 过滤。fail-open。 */
export async function runClaimAtomSelfProof(
  claim: string,
  rawAtoms: unknown,
  callModel: SelfProofModelCall
): Promise<{ kept: string[]; dropped: ClaimAtomDropped[]; model: string }> {
  const { atoms, dropped } = prefilterClaimAtoms(claim, rawAtoms);
  if (atoms.length === 0) {
    return { kept: [], dropped: [], model: "" };
  }
  try {
    const result = await callModel({
      systemPrompt: SELF_PROOF_SYSTEM_PROMPT,
      userContent: buildSelfProofUserContent(claim, atoms),
      responseSchema: selfProofSchema,
      maxTokens: 600,
    });
    const { kept, dropped: selfDropped } = applySelfProof(claim, atoms, result?.output);
    return { kept, dropped: [...dropped, ...selfDropped], model: result?.model ?? "" };
  } catch {
    return { kept: atoms, dropped, model: "" };
  }
}
