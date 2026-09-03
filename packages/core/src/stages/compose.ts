import type { Case, Claim, ClaimVerdict, Evidence, Pivot, Stance } from "../casefile/schema.js";
import type { StageContext } from "./context.js";
import { ComposeOutputSchema, type ComposeDraft } from "./compose.schema.js";
import { parseJobOutput } from "./parseOutput.js";

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
};

export type ComposeResult = { draft: ComposeDraft | null };

export type CitationRef = { n: number; evidenceId: string };

export type CitationTable = {
  citations: CitationRef[];
  nsByClaim: Map<string, number[]>;
};

type PromptCite = {
  n: number;
  host: string;
  title?: string;
  quote: string;
};

type PromptClaim = {
  claimId: string;
  text: string;
  checkable: boolean;
  verdict: ClaimVerdict["verdict"];
  rule: string;
  tally?: { sup: number; ref: number; par: number };
  citations: PromptCite[];
};

type FrontierKind = Pivot["kind"];

type FrontierSummary = {
  unconsumed: number;
  byKind: { kind: FrontierKind; count: number }[];
};

const PIVOT_KINDS: FrontierKind[] = ["link", "doc_number", "date", "image", "entity", "query"];

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

export async function runCompose(ctx: StageContext, input: ComposeInput = {}): Promise<ComposeResult> {
  ctx.emit({ type: "stage.started", stage: COMPOSE_JOB });
  const table = buildCitationTable(ctx.current);
  const systemPrompt = input.systemPromptSuffix
    ? `${COMPOSE_SYSTEM_PROMPT}\n\n${input.systemPromptSuffix}`
    : COMPOSE_SYSTEM_PROMPT;
  const userContent = buildUserContent(ctx.current, table);

  let output: unknown;
  try {
    const result = await ctx.llm({
      job: COMPOSE_JOB,
      systemPrompt,
      userContent,
      responseSchema: ComposeOutputSchema,
    });
    output = result.output;
  } catch {
    ctx.emit({ type: "stage.finished", stage: COMPOSE_JOB, outcome: "failed-open" });
    return { draft: null };
  }

  const parsed = parseJobOutput(ComposeOutputSchema, output);
  if (!parsed.ok) {
    ctx.emit({ type: "error", stage: COMPOSE_JOB, message: parsed.reason });
    ctx.emit({ type: "stage.finished", stage: COMPOSE_JOB, outcome: "failed-open" });
    return { draft: null };
  }

  ctx.emit({ type: "stage.finished", stage: COMPOSE_JOB, outcome: "ok" });
  return { draft: parsed.value };
}

type CiteLookup = {
  stanceById: Map<string, Stance>;
  evidenceById: Map<string, Evidence>;
};

function buildUserContent(c: Case, table: CitationTable): string {
  const lookup: CiteLookup = {
    stanceById: new Map(c.stances.map((item) => [item.id, item])),
    evidenceById: new Map(c.evidence.map((item) => [item.id, item])),
  };
  const payload = {
    原句: c.text,
    命题: c.claims.map((claim) => promptClaim(c, claim, table, lookup)),
    frontier: frontierSummary(c),
  };
  return JSON.stringify(payload, null, 2);
}

function promptClaim(
  c: Case,
  claim: Claim,
  table: CitationTable,
  lookup: CiteLookup,
): PromptClaim {
  const claimId = claim.id;
  const verdict = c.verdicts.find((item) => item.claimId === claimId);
  const row: PromptClaim = {
    claimId,
    text: claim.text,
    checkable: claim.checkable,
    verdict: verdict?.verdict ?? "unverified",
    rule: verdict?.rule ?? "",
    citations: promptCites(c, claimId, table.nsByClaim.get(claimId) ?? [], table, lookup),
  };
  if (verdict?.tally) row.tally = { ...verdict.tally };
  return row;
}

function promptCites(
  c: Case,
  claimId: string,
  ns: number[],
  table: CitationTable,
  lookup: CiteLookup,
): PromptCite[] {
  const { stanceById, evidenceById } = lookup;
  const verdict = c.verdicts.find((item) => item.claimId === claimId);
  const out: PromptCite[] = [];
  for (const n of ns) {
    const ref = table.citations.find((item) => item.n === n);
    if (!ref) continue;
    const evidence = evidenceById.get(ref.evidenceId);
    if (!evidence) continue;
    let quote = "";
    if (verdict) {
      for (const stanceId of verdict.basis) {
        const stance = stanceById.get(stanceId);
        if (stance?.evidenceId === ref.evidenceId) {
          quote = stance.quote;
          break;
        }
      }
    }
    const cite: PromptCite = { n, host: evidence.host, quote };
    if (evidence.title !== undefined) cite.title = evidence.title;
    out.push(cite);
  }
  return out;
}

function frontierSummary(c: Case): FrontierSummary {
  const consumed = new Set(c.consumedPivotIds);
  const open = c.frontier.filter((pivot) => !consumed.has(pivot.id));
  const counts = new Map<FrontierKind, number>();
  for (const pivot of open) {
    counts.set(pivot.kind, (counts.get(pivot.kind) ?? 0) + 1);
  }
  return {
    unconsumed: open.length,
    byKind: PIVOT_KINDS.filter((kind) => (counts.get(kind) ?? 0) > 0).map((kind) => ({
      kind,
      count: counts.get(kind) ?? 0,
    })),
  };
}
