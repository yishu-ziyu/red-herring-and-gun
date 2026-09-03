import { Type, type Static } from "typebox";
import type { Case, Evidence } from "../casefile/schema.js";
import type { FetchedPage } from "../fetch/types.js";
import { tierOf } from "../rules/sourceTiers.js";
import { canonicalizeUrl } from "../search/toEvidence.js";
import { runAssess } from "../stages/assess.js";
import { runCompose } from "../stages/compose.js";
import type { ComposeDraft } from "../stages/compose.schema.js";
import type { StageContext } from "../stages/context.js";
import { runFinalize } from "../stages/finalize.js";
import { runInvestigator, type InvestigatorTools } from "../stages/investigate.js";
import { runJudge } from "../stages/judgeStage.js";
import { parseJobOutput } from "../stages/parseOutput.js";
import { ASK_CASE_FALLBACK, CHALLENGE_UNREACHABLE, OFF_TOPIC_REPLY } from "../text/publicCopy.js";
import { firstUrlInText, urlsInText } from "./route.js";

export const ASK_CASE_JOB = "ask_case";

const closed = { additionalProperties: false } as const;

export const AskCaseOutputSchema = Type.Object({ answer: Type.String() }, closed);
export type AskCaseOutput = Static<typeof AskCaseOutputSchema>;

export const ASK_CASE_SYSTEM_PROMPT = `根据本案已有材料回答用户。只能用给定的命题、判决、证据和报告。不要引入案内没有的网址或数字。
输出 JSON：{"answer":"..."}`;

const EXCERPT_MAX = 320;

function clipExcerpt(text: string): string {
  const points = [...text];
  if (points.length <= EXCERPT_MAX) return text;
  return points.slice(0, EXCERPT_MAX).join("");
}

function addAssistant(ctx: StageContext, text: string): void {
  ctx.emit({
    type: "message.added",
    message: {
      id: `m${ctx.current.messages.length + 1}`,
      role: "assistant",
      text,
      at: ctx.now(),
    },
  });
}

async function composeAndReply(ctx: StageContext): Promise<void> {
  let draft: ComposeDraft | null = null;
  try {
    draft = (await runCompose(ctx, {})).draft;
  } catch {
    draft = null;
  }
  const { report } = await runFinalize(ctx, { draft });
  addAssistant(ctx, report.conclusion);
}

export async function runPursueFrontier(
  ctx: StageContext,
  input: { pivotId: string | undefined; tools: InvestigatorTools; deadline: number },
): Promise<"done" | "error"> {
  const pivotId = input.pivotId;
  const pivot = pivotId ? ctx.current.frontier.find((item) => item.id === pivotId) : undefined;
  const consumed = pivotId ? ctx.current.consumedPivotIds.includes(pivotId) : false;
  if (!pivotId || !pivot || consumed) {
    ctx.emit({ type: "error", stage: "route", message: "这条线索不在案内或已经查过" });
    return "error";
  }
  const beforeIds = new Set(ctx.current.evidence.map((item) => item.id));
  await runInvestigator(ctx, {
    role: "main",
    deadline: input.deadline,
    tools: input.tools,
    seedPivotId: pivotId,
  });
  const newIds = ctx.current.evidence
    .filter((item) => !beforeIds.has(item.id))
    .filter((item) => !ctx.current.stances.some((stance) => stance.evidenceId === item.id))
    .map((item) => item.id);
  const checkable = ctx.current.claims.filter((claim) => claim.checkable).map((claim) => claim.id);
  if (newIds.length > 0 && checkable.length > 0) {
    await runAssess(ctx, { claimIds: checkable, evidenceIds: newIds });
  }
  await runJudge(ctx, {});
  await composeAndReply(ctx);
  return "done";
}

export async function runChallenge(
  ctx: StageContext,
  input: { text: string; fetch: InvestigatorTools["fetch"] },
): Promise<void> {
  const url = firstUrlInText(input.text);
  if (!url) {
    addAssistant(ctx, CHALLENGE_UNREACHABLE);
    return;
  }
  let page: FetchedPage;
  try {
    page = await input.fetch(url);
  } catch {
    addAssistant(ctx, CHALLENGE_UNREACHABLE);
    return;
  }
  if (!page.reachable || page.text.trim().length === 0) {
    addAssistant(ctx, CHALLENGE_UNREACHABLE);
    return;
  }
  const id = addUserEvidence(ctx, page, url);
  if (!id) {
    addAssistant(ctx, CHALLENGE_UNREACHABLE);
    return;
  }
  const checkable = ctx.current.claims.filter((claim) => claim.checkable).map((claim) => claim.id);
  if (checkable.length > 0) {
    await runAssess(ctx, { claimIds: checkable, evidenceIds: [id] });
  }
  await runJudge(ctx, {});
  await composeAndReply(ctx);
}

function addUserEvidence(ctx: StageContext, page: FetchedPage, url: string): string | undefined {
  const rawUrl = page.finalUrl || url;
  const canon = canonicalizeUrl(rawUrl) ?? canonicalizeUrl(url);
  if (!canon) return undefined;
  const host = new URL(canon).hostname;
  const evidence: Evidence = {
    id: `e${ctx.current.evidence.length + 1}`,
    url: rawUrl,
    canonicalUrl: canon,
    host,
    excerpt: clipExcerpt(page.text || page.title || ""),
    retrievedAt: ctx.now(),
    tier: tierOf(host),
    provenance: { kind: "user" },
    reachable: page.reachable,
  };
  if (page.title !== undefined) evidence.title = page.title;
  if (page.text.length > 0) evidence.text = page.text;
  if (page.publishedAt !== undefined) evidence.publishedAt = page.publishedAt;
  ctx.emit({ type: "evidence.added", evidence });
  return evidence.id;
}

export async function runAskCase(ctx: StageContext, input: { text: string }): Promise<void> {
  let answer: string | undefined;
  try {
    const result = await ctx.llm({
      job: ASK_CASE_JOB,
      systemPrompt: ASK_CASE_SYSTEM_PROMPT,
      userContent: askCaseUserContent(ctx, input.text),
      responseSchema: AskCaseOutputSchema,
    });
    const parsed = parseJobOutput(AskCaseOutputSchema, result.output);
    if (parsed.ok) answer = parsed.value.answer;
  } catch {
    answer = undefined;
  }
  if (answer === undefined || !answerGrounded(answer, ctx.current)) {
    addAssistant(ctx, askCaseFallback(ctx));
    return;
  }
  addAssistant(ctx, answer);
}

export function runOffTopic(ctx: StageContext): void {
  addAssistant(ctx, OFF_TOPIC_REPLY);
}

function askCaseUserContent(ctx: StageContext, question: string): string {
  const current = ctx.current;
  return JSON.stringify({
    问题: question,
    命题: current.claims.map((claim) => ({
      id: claim.id,
      text: claim.text,
      verdict: current.verdicts.find((item) => item.claimId === claim.id)?.verdict ?? "unverified",
    })),
    证据: current.evidence.map((item) => ({
      id: item.id,
      title: item.title,
      host: item.host,
      tier: item.tier,
      excerpt: item.excerpt,
      url: item.url,
    })),
    报告: current.report
      ? { conclusion: current.report.conclusion, claimItems: current.report.claimItems }
      : null,
  });
}

function askCaseFallback(ctx: StageContext): string {
  const labels = ctx.current.frontier.slice(0, 3).map((pivot) => pivot.value);
  if (labels.length === 0) return ASK_CASE_FALLBACK;
  return `${ASK_CASE_FALLBACK}${labels.join("、")}`;
}

function caseUrls(current: Case): Set<string> {
  const allowed = new Set<string>();
  for (const item of current.evidence) {
    allowed.add(item.url);
    allowed.add(item.canonicalUrl);
    const a = canonicalizeUrl(item.url);
    const b = canonicalizeUrl(item.canonicalUrl);
    if (a) allowed.add(a);
    if (b) allowed.add(b);
  }
  return allowed;
}

function urlAllowed(url: string, allowed: Set<string>): boolean {
  if (allowed.has(url)) return true;
  const canon = canonicalizeUrl(url);
  return canon !== null && allowed.has(canon);
}

function stripThousands(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(/(\d),(\d{3})/g, "$1$2");
    if (next === current) return current;
    current = next;
  }
}

function numbersIn(text: string): string[] {
  return stripThousands(text).match(/\d+(?:\.\d+)?/g) ?? [];
}

function caseNumberCorpus(current: Case): string {
  const parts: string[] = [];
  for (const claim of current.claims) parts.push(claim.text);
  for (const item of current.evidence) {
    parts.push(item.excerpt);
    if (item.text) parts.push(item.text);
    if (item.title) parts.push(item.title);
  }
  if (current.report) {
    parts.push(current.report.conclusion);
    for (const row of current.report.claimItems) parts.push(row.line);
  }
  return stripThousands(parts.join("\n"));
}

function answerGrounded(answer: string, current: Case): boolean {
  const allowed = caseUrls(current);
  if (urlsInText(answer).some((url) => !urlAllowed(url, allowed))) return false;
  // ponytail: 只校验数字串，不校验专名；专名要对齐案内需要 NER，升级时再加
  const withoutUrls = answer.replace(/https?:\/\/[^\s<>"']+/gi, " ");
  const hay = caseNumberCorpus(current);
  return numbersIn(withoutUrls).every((n) => hay.includes(n));
}
