/**
 * missionControlEnhancements.ts — Plan Item 1 · P1 → Mission Control UI 接入
 *
 * 集成 P1 整波 6 个模块的纯逻辑：
 *   - P1-1 extractKeyPoints (KPA)
 *   - P1-2 buildSubclaimTree (Kialo)
 *   - P1-3 buildCitationSpan (句子级引用)
 *   - P1-4 getReputationScore (来源信誉)
 *   - P1-5 detectFallacies (谬误诊断)
 *   - P1-6 buildBlindSpotReport (盲点视图)
 *
 * 入口：buildEnhancements(report, caseData) → 一次调用聚合所有输出（async）。
 * Pure helper for tests and leftover report chrome. Not on the live claim path.
 */

import type { FinalReport, DemoCase, GradedEvidence, Subclaim } from "./schemas";
import { extractKeyPoints, shouldRunKPA } from "./claimDecomposer";
import { buildSubclaimTree, countStances, type SubclaimTree } from "./subclaimTree";
import { buildCitationSpan, type CitationSpan } from "./sourceLineage";
import { getReputationScore, type ReputationLabel } from "./sourceReputationRegistry";
import { detectFallacies, type FallacyCard, FALLACY_TYPE_LABELS, type FallacyType } from "./fallacyCard";
import { buildBlindSpotReport, summarizeBlindSpot, type BlindSpotReport } from "./blindSpotAnalysis";

export type KeyPoint = ReturnType<typeof extractKeyPoints> extends Promise<infer T> ? T : never;

export interface EnhancementBundle {
  /** P1-1 KPA */
  keyPoints: KeyPoint;
  ranKpa: boolean;
  /** P1-2 子命题树 */
  subclaimTree: SubclaimTree;
  stanceCounts: ReturnType<typeof countStances>;
  /** P1-3 引用溯源（从 evidence chain 抽取） */
  citationSpans: CitationSpan[];
  /** P1-4 来源信誉 */
  sourceReputations: Array<{ hostname: string; label: ReputationLabel }>;
  /** P1-5 谬误诊断 */
  fallacies: FallacyCard;
  /** P1-6 盲点视图 */
  blindSpot: BlindSpotReport;
  blindSpotSummary: string;
}

export interface BuildOptions {
  grades?: GradedEvidence[];
}

export async function buildEnhancements(
  report: FinalReport,
  caseData: DemoCase | undefined,
  options: BuildOptions = {},
): Promise<EnhancementBundle> {
  // 1. KPA：长 claim 才走
  const fullText = [
    report.originalClaim ?? "",
    report.allowedConclusion ?? "",
    report.rewrittenClaim?.cautious ?? "",
  ].join(" ");
  const ranKpa = shouldRunKPA(fullText);
  const keyPoints = ranKpa ? await extractKeyPoints(fullText) : [];

  // 2. 子命题树
  const treeInput: Subclaim[] = (caseData?.subclaims ?? []).map((s) => ({
    id: s.id,
    text: s.text,
    type: s.type,
    roleInArgument: s.roleInArgument,
    parentId: undefined,
    stance: undefined,
    order: undefined,
  }));
  const subclaimTree = buildSubclaimTree(treeInput);
  const stanceCounts = countStances(subclaimTree.roots);

  // 3. 句子级引用溯源：从 evidenceChain 字符串抽取
  const citationSpans: CitationSpan[] = [];
  for (const entry of (report.evidenceChain ?? []).slice(0, 20)) {
    if (typeof entry !== "string") continue;
    const urlMatch = entry.match(/https?:\/\/[^\s。，；]+/);
    if (!urlMatch) continue;
    const url = urlMatch[0];
    let host: string | undefined;
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      // ignore
    }
    const quote = entry.replace(url, "").trim().slice(0, 60);
    if (quote.length < 6) continue;
    citationSpans.push(buildCitationSpan(url, "html", entry, quote, host));
  }

  // 4. 来源信誉：按 hostname 聚合
  const hostSet = new Set<string>();
  for (const span of citationSpans) {
    try {
      hostSet.add(new URL(span.url).hostname.toLowerCase().replace(/^www\./, ""));
    } catch {
      // ignore
    }
  }
  const sourceReputations = Array.from(hostSet)
    .map((hostname) => ({ hostname, label: getReputationScore(hostname).label }))
    .sort((a, b) => a.hostname.localeCompare(b.hostname));

  // 5. 谬误诊断：拼接 cautious + publicFacing
  const fallacyText = [
    report.rewrittenClaim?.cautious ?? "",
    report.rewrittenClaim?.publicFacing ?? "",
  ].join(" ");
  const fallacies = detectFallacies(fallacyText);

  // 6. 盲点视图：把 evidence chain 字符串映射为 signal:neutral（保守）
  const blindSignal = (report.evidenceChain ?? []).slice(0, 20).map((line, i) => ({
    hostname: `case-${i}`,
    signal: "neutral" as const,
  }));
  const blindSpot = buildBlindSpotReport(blindSignal);
  const blindSpotSummary = summarizeBlindSpot(blindSpot);

  return {
    keyPoints,
    ranKpa,
    subclaimTree,
    stanceCounts,
    citationSpans,
    sourceReputations,
    fallacies,
    blindSpot,
    blindSpotSummary,
  };
}

export { FALLACY_TYPE_LABELS };
export type { FallacyType };