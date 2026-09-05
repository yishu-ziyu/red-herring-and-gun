import type { Case } from "../casefile/schema.js";
import type { StageContext } from "./context.js";
import type { ComposeDraft } from "./compose.schema.js";
import { constrainComposeDraft } from "./safeVerdictLine.js";

export const COMPOSE_JOB = "compose";

export const COMPOSE_SYSTEM_PROMPT = `第一句必须直接回答原句，例如：「生育津贴不会直接打到个人卡里，仍由单位申领」。不准以「能信」「不能信」「只能信一部分」「还查不清」这类章印开头。

每条命题写成一行。判决为 true、false、partial 的行至少要有一个 [n] 引用；只能使用输入里给出的 [n]，不要自编编号，不要写 URL。

不要写工具名、厂商名、模型名。不要写「建议」或「提示」段。不要用「大量」「很多」「不少」「许多」「众多」这类模糊量词。引用标记写在正文里，形如 [1]。

你在把已经完成的核对结果写成给用户看的回答。每条命题的判决已经给定，你只负责把它说清楚，不得改变、弱化或质疑判决方向。

true、false、partial 的行要说明依据是什么，并引 [n]。unverified 行只说没查到什么，不要猜测，不要替原句补理由。contested 行要把两边各说一句，各自带 [n]。

checkable=false 的命题只写一句『这是评价或立场，不做真假判断』类说明。
正文不得出现 true / false / partial / unverified / contested / mixed_misleading 这些英文判决词，也不得写『该判断为…』。

输出 JSON：{ "conclusion": string, "claimItems": [{ "claimId": string, "line": string }] }。claimId 只能用输入里出现的，每条命题恰好一行。`;

export type ComposeInput = {
  systemPromptSuffix?: string;
  deadline?: number;
};

export type ComposeResult = { draft: ComposeDraft | null };

export type CitationRef = { n: number; evidenceId: string };

export type CitationTable = {
  citations: CitationRef[];
  nsByClaim: Map<string, number[]>;
};

/** 按 verdicts → basis 首次出现的 evidence 编号 [1]、[2]…；没有 basis 的命题不分配。 */
export function buildCitationTable(c: Case): CitationTable {
  const stanceById = new Map(c.stances.map((item) => [item.id, item]));
  const evidenceIds = new Set(c.evidence.map((item) => item.id));
  const citations: CitationRef[] = [];
  const byEvidenceId = new Map<string, number>();
  const nsByClaim = new Map<string, number[]>();

  for (const verdict of c.verdicts) {
    const ns: number[] = nsByClaim.get(verdict.claimId) ?? [];
    for (const stanceId of verdict.basis) {
      const stance = stanceById.get(stanceId);
      if (!stance) continue;
      if (!evidenceIds.has(stance.evidenceId)) continue;
      let n = byEvidenceId.get(stance.evidenceId);
      if (n === undefined) {
        n = citations.length + 1;
        byEvidenceId.set(stance.evidenceId, n);
        citations.push({ n, evidenceId: stance.evidenceId });
      }
      if (!ns.includes(n)) ns.push(n);
    }
    nsByClaim.set(verdict.claimId, ns);
  }

  return { citations, nsByClaim };
}

export async function runCompose(ctx: StageContext, _input: ComposeInput = {}): Promise<ComposeResult> {
  ctx.emit({ type: "stage.started", stage: COMPOSE_JOB });
  const table = buildCitationTable(ctx.current);
  const draft = constrainComposeDraft({
    sourceText: ctx.current.text,
    claims: ctx.current.claims,
    verdicts: ctx.current.verdicts,
    overall: ctx.current.overall,
    table,
  });
  ctx.emit({ type: "stage.finished", stage: COMPOSE_JOB, outcome: "ok" });
  return { draft };
}
