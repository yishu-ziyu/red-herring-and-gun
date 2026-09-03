import type { Evidence, Stance, Tier } from "../casefile/schema.js";
import { ASSESS_MAX_EVIDENCE } from "../rules/judgeConfig.js";
import type { StageContext } from "./context.js";
import { AssessOutputSchema, type AssessOutput } from "./assess.schema.js";
import { parseJobOutput } from "./parseOutput.js";

const TEXT_SNIPPET_MAX = 1500;
const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2, unknown: 3 };

export const ASSESS_JOB = "assess";

export const ASSESS_SYSTEM_PROMPT = `你在做证据立场判读，不是在裁定命题真假。

给定一条命题和若干条证据。对每条证据，只判断「这篇材料对这条命题的关系」，不要回答命题本身是真是假，也不要给出整句结论。

关系只能是下面四个之一：
- supports：材料在断言命题成立
- refutes：材料在断言命题不成立
- partial：材料只支持或只反驳命题的一部分
- contextual：材料相关，但既不支持也不反驳命题

规则：
- 只根据给定证据原文判断，不要用你自己的世界知识补证据里没有的事实。
- 每条输出必须引用该证据原文中的连续片段作为 quote，不要改写、不要省略号拼接。
- quote 不超过 60 字。
- 最多输出与输入证据数相同条数。
- evidenceId 必须是输入里出现过的证据编号。
- confidence 是 0 到 1 的小数，表示你对「这条关系判断」的把握，不是命题为真的概率。
- 没有关系可判时返回空的 stances 数组。
- 不要输出命题级真假、分数或建议。
输出 JSON：{ "stances": [{ "evidenceId": "e1", "stance": "supports|refutes|partial|contextual", "quote": "证据原文连续片段", "confidence": 0.8 }] }。不要加其他键。`;

export type AssessInput = {
  claimIds?: string[];
  evidenceIds?: string[];
  by?: "main" | "prosecutor" | "defender";
  systemPromptSuffix?: string;
  deadline?: number;
  now?: () => number;
};

export type AssessResult = { assessed: string[] };

type EvidenceSnippet = {
  id: string;
  title?: string;
  excerpt?: string;
  text?: string;
};

export async function runAssess(ctx: StageContext, input: AssessInput = {}): Promise<AssessResult> {
  const by = input.by ?? "main";
  const systemPrompt = input.systemPromptSuffix
    ? `${ASSESS_SYSTEM_PROMPT}\n\n${input.systemPromptSuffix}`
    : ASSESS_SYSTEM_PROMPT;
  const selected = selectClaims(ctx, input.claimIds);
  const deadline = input.deadline ?? ctx.deadline;
  const now = input.now ?? ctx.clock;
  const assessed: string[] = [];

  await Promise.all(
    selected.map(async (claim) => {
      if (deadline !== undefined && now() >= deadline) {
        ctx.emit({ type: "stage.started", stage: ASSESS_JOB, claimId: claim.id });
        ctx.emit({ type: "stage.finished", stage: ASSESS_JOB, claimId: claim.id, outcome: "skipped" });
        assessed.push(claim.id);
        return;
      }
      const given = selectEvidence(ctx, claim.id, by, input.evidenceIds);
      if (given.length === 0) return;
      ctx.emit({ type: "stage.started", stage: ASSESS_JOB, claimId: claim.id });
      const givenIds = new Set(given.map((item) => item.id));
      const userContent = buildUserContent(claim.text, given);

      let output: unknown;
      try {
        const result = await ctx.llm({
          job: ASSESS_JOB,
          systemPrompt,
          userContent,
          responseSchema: AssessOutputSchema,
        });
        output = result.output;
      } catch {
        ctx.emit({ type: "stage.finished", stage: ASSESS_JOB, claimId: claim.id, outcome: "failed-open" });
        assessed.push(claim.id);
        return;
      }

      let parsed = parseJobOutput(AssessOutputSchema, output);
      if (!parsed.ok && (deadline === undefined || now() < deadline)) {
        const firstReason = parsed.reason;
        try {
          const retry = await ctx.llm({
            job: ASSESS_JOB,
            systemPrompt,
            userContent: `${userContent}\n\n上一次输出不合规：${firstReason.slice(0, 200)}。只输出规定 JSON。`,
            responseSchema: AssessOutputSchema,
          });
          parsed = parseJobOutput(AssessOutputSchema, retry.output);
        } catch {
          ctx.emit({ type: "error", stage: ASSESS_JOB, message: firstReason });
          ctx.emit({ type: "stage.finished", stage: ASSESS_JOB, claimId: claim.id, outcome: "failed-open" });
          assessed.push(claim.id);
          return;
        }
      }

      if (!parsed.ok) {
        ctx.emit({ type: "error", stage: ASSESS_JOB, message: parsed.reason });
        ctx.emit({ type: "stage.finished", stage: ASSESS_JOB, claimId: claim.id, outcome: "failed-open" });
        assessed.push(claim.id);
        return;
      }

      emitStances(ctx, claim.id, parsed.value, givenIds, given, by);
      ctx.emit({ type: "stage.finished", stage: ASSESS_JOB, claimId: claim.id, outcome: "ok" });
      assessed.push(claim.id);
    }),
  );

  return { assessed };
}

function evidenceTierSort(a: Evidence, b: Evidence): number {
  const tier = TIER_RANK[a.tier] - TIER_RANK[b.tier];
  if (tier !== 0) return tier;
  return a.id.localeCompare(b.id, undefined, { numeric: true });
}

function isOwnClaimEvidence(item: Evidence, claimId: string): boolean {
  const provenance = item.provenance;
  if (provenance.kind !== "search" || provenance.claimId === undefined) return true;
  return provenance.claimId === claimId;
}

function selectEvidence(
  ctx: StageContext,
  claimId: string,
  by: Stance["by"],
  evidenceIds: string[] | undefined,
): Evidence[] {
  const allow = evidenceIds !== undefined ? new Set(evidenceIds) : undefined;
  const judged = new Set(
    ctx.current.stances
      .filter((stance) => stance.claimId === claimId && stance.by === by)
      .map((stance) => stance.evidenceId),
  );
  const eligible = ctx.current.evidence.filter((item) => {
    if (item.reachable === false) return false;
    if (allow && !allow.has(item.id)) return false;
    if (judged.has(item.id)) return false;
    return true;
  });
  if (allow) {
    const pool = [...eligible];
    pool.sort(evidenceTierSort);
    return pool.slice(0, ASSESS_MAX_EVIDENCE);
  }
  const own: Evidence[] = [];
  const cross: Evidence[] = [];
  for (const item of eligible) {
    if (isOwnClaimEvidence(item, claimId)) own.push(item);
    else cross.push(item);
  }
  own.sort(evidenceTierSort);
  cross.sort(evidenceTierSort);
  return [...own, ...cross].slice(0, ASSESS_MAX_EVIDENCE);
}

function selectClaims(ctx: StageContext, claimIds: string[] | undefined) {
  const pool = ctx.current.claims.filter((claim) => claim.checkable);
  if (claimIds === undefined) return pool;
  const byId = new Map(pool.map((claim) => [claim.id, claim]));
  const out = [];
  for (const id of claimIds) {
    const claim = byId.get(id);
    if (claim) out.push(claim);
  }
  return out;
}

function buildUserContent(claimText: string, evidence: Evidence[]): string {
  const items: EvidenceSnippet[] = evidence.map((item) => {
    const snippet: EvidenceSnippet = { id: item.id };
    if (item.title !== undefined) snippet.title = item.title;
    const body = item.text !== undefined && item.text.length > 0 ? item.text.slice(0, TEXT_SNIPPET_MAX) : undefined;
    if (body !== undefined) snippet.text = body;
    else snippet.excerpt = item.excerpt;
    return snippet;
  });
  return `命题：\n${claimText}\n\n证据：\n${JSON.stringify(items, null, 2)}`;
}

function emitStances(
  ctx: StageContext,
  claimId: string,
  output: AssessOutput,
  givenIds: Set<string>,
  given: Evidence[],
  by: Stance["by"],
): void {
  const byEvidenceId = new Map(given.map((item) => [item.id, item]));
  for (const raw of output.stances) {
    if (!givenIds.has(raw.evidenceId)) continue;
    const evidence = byEvidenceId.get(raw.evidenceId);
    if (!evidence) continue;
    const source = evidence.text ?? evidence.excerpt;
    const quoteFidelity = quoteIsFaithful(raw.quote, source);
    const stance: Stance = {
      id: `s${ctx.current.stances.length + 1}`,
      claimId,
      evidenceId: raw.evidenceId,
      stance: raw.stance,
      quote: raw.quote,
      confidence: quoteFidelity ? raw.confidence : 0,
      quoteFidelity,
      by,
    };
    ctx.emit({ type: "stance.added", stance });
  }
}

/** 去空白、全半角标点折叠后再做子串。空引文不算忠实。 */
export function quoteIsFaithful(quote: string, source: string): boolean {
  const q = foldQuote(quote);
  if (q.length === 0) return false;
  return foldQuote(source).includes(q);
}

function foldQuote(value: string): string {
  let out = "";
  for (const ch of value) {
    if (/\s/u.test(ch)) continue;
    const code = ch.charCodeAt(0);
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCharCode(code - 0xfee0);
      continue;
    }
    switch (ch) {
      case "。":
        out += ".";
        break;
      case "、":
        out += ",";
        break;
      case "「":
      case "」":
      case "『":
      case "』":
      case "“":
      case "”":
        out += '"';
        break;
      case "‘":
      case "’":
        out += "'";
        break;
      case "【":
        out += "[";
        break;
      case "】":
        out += "]";
        break;
      case "《":
        out += "<";
        break;
      case "》":
        out += ">";
        break;
      case "—":
      case "–":
      case "－":
        out += "-";
        break;
      case "…":
        out += "...";
        break;
      default:
        out += ch;
    }
  }
  return out;
}
