import { demoCase } from "../data/demoCase";
import {
  healthRumorCase,
  socialRumorCase,
  techRumorCase,
  financeRumorCase,
  politicalRumorCase,
  entertainmentRumorCase,
} from "../data/rumorCases";
import type { DemoCase } from "./schemas";
import { gradeAll } from "./graderRules";
import { composeReport } from "./reportComposer";

const CASE_REGISTRY: Record<string, DemoCase> = {
  "ai-content-jobs": demoCase,
  "health-overnight-vegetables": healthRumorCase,
  "social-metro-shutdown": socialRumorCase,
  "tech-5g-radiation": techRumorCase,
  "finance-rmb-devalue": financeRumorCase,
  "political-policy-rumor": politicalRumorCase,
  "entertainment-celebrity-rumor": entertainmentRumorCase,
};

export function getDemoCase(caseId: string): DemoCase {
  return CASE_REGISTRY[caseId] ?? demoCase;
}

/**
 * Bigram-set Jaccard similarity between two strings (character bigrams).
 *
 * Bigrams handle CJK without word-segmentation; Jaccard (intersection /
 * union) normalizes for length. Used as a cheap, deterministic pre-check
 * before running the heavy demo pipeline against an unrelated claim.
 */
export function bigramJaccard(a: string, b: string): number {
  if (!a || !b) return 0;
  const bigramsOf = (s: string): Set<string> => {
    const out = new Set<string>();
    for (let i = 0; i < s.length - 1; i += 1) {
      out.add(s.slice(i, i + 2));
    }
    return out;
  };
  const aSet = bigramsOf(a);
  const bSet = bigramsOf(b);
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  for (const bg of aSet) {
    if (bSet.has(bg)) intersection += 1;
  }
  const union = aSet.size + bSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

const RELEVANCE_THRESHOLD = 0.2;
const MIN_CLAIM_LENGTH = 10;

/**
 * Returns true when the user's claim is plausibly relevant to the demo case.
 *
 * Rules (per peer-spec, 2026-07-04):
 *   - empty / missing claim → true (don't block the demo on missing input)
 *   - claim <10 chars → true (avoid false positives on short prompts)
 *   - empty subclaims → true (no case content to compare against)
 *   - else: true if any (claim vs subclaim) bigram-Jaccard ≥ 0.2
 */
export function assertRelevantCase(userInput: string, demoCaseRef: DemoCase): boolean {
  const claim = (userInput ?? "").trim();
  if (!claim) return true;
  if (claim.length < MIN_CLAIM_LENGTH) return true;
  const candidates: string[] = [];
  if (demoCaseRef.originalClaim) candidates.push(demoCaseRef.originalClaim);
  if (demoCaseRef.subclaims && demoCaseRef.subclaims.length > 0) {
    candidates.push(...demoCaseRef.subclaims.map((sc) => sc.text));
  }
  if (candidates.length === 0) return true;
  return candidates.some((text) => bigramJaccard(claim, text) >= RELEVANCE_THRESHOLD);
}

export interface RunDemoPipelineOptions {
  claim?: string;
}

export interface RunDemoPipelineResult {
  caseData: DemoCase;
  gradedEvidence: ReturnType<typeof gradeAll>;
  report: ReturnType<typeof composeReport>;
  error?: "NO_MATCHING_CASE";
}

export interface RunDemoPipelineNoMatchResult {
  caseData: null;
  gradedEvidence?: undefined;
  report?: undefined;
  error: "NO_MATCHING_CASE";
}

export function runDemoPipeline(caseId?: string, opts?: undefined): RunDemoPipelineResult;
export function runDemoPipeline(
  caseId: string,
  opts: RunDemoPipelineOptions & { claim: string },
): RunDemoPipelineResult | RunDemoPipelineNoMatchResult;
export function runDemoPipeline(
  caseId: string = "ai-content-jobs",
  opts?: RunDemoPipelineOptions,
): RunDemoPipelineResult | RunDemoPipelineNoMatchResult {
  const selectedCase = getDemoCase(caseId);

  if (opts?.claim && !assertRelevantCase(opts.claim, selectedCase)) {
    return {
      caseData: null,
      error: "NO_MATCHING_CASE",
    };
  }

  const gradedEvidence = gradeAll(selectedCase.candidates, selectedCase.subclaims);
  const report = composeReport(selectedCase, gradedEvidence);

  return {
    caseData: selectedCase,
    gradedEvidence,
    report,
  };
}