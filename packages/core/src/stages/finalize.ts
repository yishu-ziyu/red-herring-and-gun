import type { Report } from "../casefile/schema.js";
import type { StageContext } from "./context.js";
import { buildCitationTable, type CitationTable } from "./compose.js";
import type { ComposeDraft } from "./compose.schema.js";
import { constrainComposeDraft } from "./safeVerdictLine.js";

export const FINALIZE_JOB = "finalize";

export type FinalizeInput = {
  draft: ComposeDraft | null;
};

export type FinalizeResult = { report: Report };

export async function runFinalize(ctx: StageContext, input: FinalizeInput): Promise<FinalizeResult> {
  ctx.emit({ type: "stage.started", stage: FINALIZE_JOB });
  const table = buildCitationTable(ctx.current);
  const report = buildSafeReport(ctx, table);
  ctx.emit({ type: "report.finalized", report });
  ctx.emit({ type: "stage.finished", stage: FINALIZE_JOB, outcome: input.draft ? "ok" : "failed-open" });
  return { report };
}

function buildSafeReport(ctx: StageContext, table: CitationTable): Report {
  const constrained = constrainComposeDraft({
    sourceText: ctx.current.text,
    claims: ctx.current.claims,
    verdicts: ctx.current.verdicts,
    overall: ctx.current.overall,
    table,
  });
  return assembleReport(ctx, constrained.conclusion, constrained.claimItems, table);
}

function assembleReport(
  ctx: StageContext,
  conclusion: string,
  items: Array<{ claimId: string; line: string }>,
  table: CitationTable,
): Report {
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
