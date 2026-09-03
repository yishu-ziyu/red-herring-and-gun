import { clampMarkersToSources } from "../text/citationBinding.js";
import { directAnswer, findFuzzyQuantifiers, scrubPublicText, startsWithFace, stripFaceStamp } from "../text/publicCopy.js";
import type { Claim, Report } from "../casefile/schema.js";
import type { StageContext } from "./context.js";
import { buildCitationTable, type CitationTable } from "./compose.js";
import type { ComposeDraft } from "./compose.schema.js";

export const FINALIZE_JOB = "finalize";

const VENDOR_ASCII = [
  "Anthropic",
  "Claude",
  "OpenAI",
  "GPT",
  "Codex",
  "Kimi",
  "DeepSeek",
  "Gemini",
  "Grok",
  "Bocha",
  "Serper",
] as const;

export type FinalizeInput = {
  draft: ComposeDraft | null;
};

export type FinalizeResult = { report: Report };

type ClaimLine = { claimId: string; line: string };

export async function runFinalize(ctx: StageContext, input: FinalizeInput): Promise<FinalizeResult> {
  ctx.emit({ type: "stage.started", stage: FINALIZE_JOB });
  const table = buildCitationTable(ctx.current);
  const report = input.draft === null ? buildFallbackReport(ctx, table) : repairDraft(ctx, input.draft, table);
  ctx.emit({ type: "report.finalized", report });
  ctx.emit({ type: "stage.finished", stage: FINALIZE_JOB, outcome: input.draft ? "ok" : "failed-open" });
  return { report };
}

/** 1. draft 为空时的整份确定性报告 */
function buildFallbackReport(ctx: StageContext, table: CitationTable): Report {
  const items = ctx.current.claims.map((claim) => ({
    claimId: claim.id,
    line: scrubJargon(fallbackLine(ctx, claim, table)),
  }));
  const conclusion = ensureCitedConclusion(ctx, fallbackConclusion(ctx), table);
  return assembleReport(ctx, scrubJargon(conclusion), items, table);
}

function repairDraft(ctx: StageContext, draft: ComposeDraft, table: CitationTable): Report {
  const repaired = repairCitationMarkers(ctx, draft, table);
  // 先修首句再补引用：首句被整句替换成兜底时，补上的 [n] 才不会一起丢
  let conclusion = ensureCitedConclusion(ctx, repairLeadSentence(repaired.conclusion, ctx), table);
  let items = repaired.items.map((item) => ({ ...item, line: scrubJargon(item.line) }));
  conclusion = scrubJargon(conclusion);
  emitFuzzyQuantifiers(ctx, conclusion, items);
  items = fillMissingClaims(ctx, items, table);
  const filled = ensureNonEmpty(ctx, table, conclusion, items);
  return assembleReport(ctx, filled.conclusion, filled.items, table);
}

/** 2. 丢掉悬空 [n] 与案外命题；true/false/partial 行补引用或改兜底句 */
function repairCitationMarkers(
  ctx: StageContext,
  draft: ComposeDraft,
  table: CitationTable,
): { conclusion: string; items: ClaimLine[] } {
  const count = table.citations.length;
  const claimIds = new Set(ctx.current.claims.map((claim) => claim.id));
  const items: ClaimLine[] = [];
  for (const raw of draft.claimItems) {
    if (!claimIds.has(raw.claimId)) continue;
    const line = clampMarkersToSources(raw.line, count);
    items.push({ claimId: raw.claimId, line: ensureCitedLine(ctx, raw.claimId, line, table) });
  }
  return { conclusion: clampMarkersToSources(draft.conclusion, count), items };
}

function ensureCitedLine(ctx: StageContext, claimId: string, line: string, table: CitationTable): string {
  const verdict = ctx.current.verdicts.find((item) => item.claimId === claimId)?.verdict;
  if (verdict !== "true" && verdict !== "false" && verdict !== "partial") return line;
  if (extractCiteNs(line).length > 0) return line;
  const first = (table.nsByClaim.get(claimId) ?? [])[0];
  if (first !== undefined) return `${line}[${first}]`;
  const claim = ctx.current.claims.find((item) => item.id === claimId);
  return claim ? fallbackLine(ctx, claim, table) : line;
}

/** 3. 章印或过短首句：剥掉；剥空则兜底首句 */
function repairLeadSentence(conclusion: string, ctx: StageContext): string {
  if (!startsWithFace(conclusion) && leadCharCount(conclusion) > 6) return conclusion;
  const stripped = stripFaceStamp(conclusion);
  if (!stripped) return fallbackConclusion(ctx);
  return stripped;
}

/** 4. 工具名 / 厂商名 / 模型名 / 案外 URL */
function scrubJargon(text: string): string {
  return stripVendorTokens(scrubPublicText(stripHttpUrls(stripVerdictEnums(text))));
}

function stripVerdictEnums(text: string): string {
  const framed =
    /(该|此|本|这个|这一|以上)?(判断|判决|结论|命题|说法)(为|是|：|:)\s*[“"'「]?(true|false|partial|unverified|contested|mixed_misleading)[”"'」]?\s*[。．.;；,，]?/gi;
  const bare = /\b(true|false|partial|unverified|contested|mixed_misleading)\b/gi;
  return collapseGaps(text.replace(framed, "").replace(bare, ""));
}

/** overall 已有真/假判断但结论漏了 [n] 时，按命题 order 补第一条引用。 */
function ensureCitedConclusion(ctx: StageContext, conclusion: string, table: CitationTable): string {
  const verdictType = ctx.current.overall?.verdictType;
  if (verdictType !== "true" && verdictType !== "false" && verdictType !== "mixed_misleading") {
    return conclusion;
  }
  if (extractCiteNs(conclusion).length > 0) return conclusion;
  if (table.citations.length === 0) return conclusion;
  const claims = ctx.current.claims.slice().sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  for (const claim of claims) {
    const first = (table.nsByClaim.get(claim.id) ?? [])[0];
    if (first !== undefined) return `${conclusion}[${first}]`;
  }
  return conclusion;
}

function stripHttpUrls(text: string): string {
  return collapseGaps(text.replace(/https?:\/\/[^\s\u3000\[\]<>"']+/gi, ""));
}

function stripVendorTokens(text: string): string {
  let out = text;
  for (const token of VENDOR_ASCII) {
    out = out.replace(new RegExp(`\\b${token}\\b`, "gi"), "");
  }
  out = out.replace(/博查/g, "");
  return collapseGaps(out);
}

function collapseGaps(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([，。；：、,.!?;:])/g, "$1")
    .trim();
}

/** 5. 模糊量词：记 error，不改行、不阻塞 */
function emitFuzzyQuantifiers(ctx: StageContext, conclusion: string, items: ClaimLine[]): void {
  const hits: string[] = [];
  const seen = new Set<string>();
  for (const text of [conclusion, ...items.map((item) => item.line)]) {
    for (const word of findFuzzyQuantifiers(text)) {
      if (seen.has(word)) continue;
      seen.add(word);
      hits.push(word);
    }
  }
  if (hits.length === 0) return;
  ctx.emit({
    type: "error",
    stage: FINALIZE_JOB,
    message: `模糊量词：${hits.join("、")}`,
  });
}

/** 6. 案内命题缺行则补兜底行 */
function fillMissingClaims(ctx: StageContext, items: ClaimLine[], table: CitationTable): ClaimLine[] {
  const have = new Set(items.map((item) => item.claimId));
  const next = items.slice();
  for (const claim of ctx.current.claims) {
    if (have.has(claim.id)) continue;
    next.push({ claimId: claim.id, line: scrubJargon(fallbackLine(ctx, claim, table)) });
  }
  return next;
}

/** 7. 确定性兜底句 */
function fallbackLine(ctx: StageContext, claim: Claim, table: CitationTable): string {
  if (!claim.checkable) return `${claim.text}：这是评价或立场，不做真假判断。`;
  const verdict = ctx.current.verdicts.find((item) => item.claimId === claim.id)?.verdict ?? "unverified";
  const marks = (table.nsByClaim.get(claim.id) ?? []).map((n) => `[${n}]`).join("");
  switch (verdict) {
    case "true":
      return `${claim.text}：有依据。${marks}`;
    case "false":
      return `${claim.text}：与现有依据相反。${marks}`;
    case "partial":
      return `${claim.text}：只有一部分成立。${marks}`;
    case "contested":
      return `${claim.text}：来源之间相互矛盾，两边都有依据。${marks}`;
    default:
      return `${claim.text}：没有找到足够依据。`;
  }
}

function fallbackConclusion(ctx: StageContext): string {
  const lead = directAnswer(ctx.current.overall?.verdictType);
  if (ctx.current.overall?.contested) {
    return `${lead}来源之间相互矛盾，两边都有依据。`;
  }
  return lead;
}

function ensureNonEmpty(
  ctx: StageContext,
  table: CitationTable,
  conclusion: string,
  items: ClaimLine[],
): { conclusion: string; items: ClaimLine[] } {
  return {
    conclusion: conclusion.trim() ? conclusion : scrubJargon(fallbackConclusion(ctx)),
    items: items.map((item) => {
      if (item.line.trim()) return item;
      const claim = ctx.current.claims.find((row) => row.id === item.claimId);
      if (!claim) return item;
      return { claimId: item.claimId, line: scrubJargon(fallbackLine(ctx, claim, table)) };
    }),
  };
}

/** 8. 组 Report 并发出前的形状 */
function assembleReport(ctx: StageContext, conclusion: string, items: ClaimLine[], table: CitationTable): Report {
  const claimItems = items.map((item) => ({
    claimId: item.claimId,
    line: item.line,
    citations: extractCiteNs(item.line),
  }));
  const used = new Set<number>();
  for (const n of extractCiteNs(conclusion)) used.add(n);
  for (const item of claimItems) {
    for (const n of item.citations) used.add(n);
  }
  return {
    conclusion,
    claimItems,
    citations: table.citations.filter((item) => used.has(item.n)),
    finalizedAt: ctx.now(),
  };
}

function extractCiteNs(text: string): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const n = Number(match[1]);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

function firstSentence(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const match = t.match(/^.+?(?:[。！？\n]|$)/u);
  return match ? match[0] : t;
}

function leadCharCount(text: string): number {
  return Array.from(firstSentence(text).replace(/\s/g, "")).length;
}
