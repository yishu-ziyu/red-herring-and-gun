/** 解析客户端带来的上一轮对话材料；历史材料不能替代本轮检索。 */
import { claimAtomKey } from "../../../shared/claimAtomText.js";
import type { VisiblePriorClaim, VisiblePriorEvidence, VisiblePriorRound } from "../../../shared/followUp.js";

const VISIBLE_JUDGMENTS = new Set(["supported", "refuted", "mixed"]);
const VISIBLE_ROLES = new Set(["support", "contradict"]);
const VISIBLE_CLAIM_CAP = 8;
const VISIBLE_EVIDENCE_CAP = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clipText(value: unknown, max: number): string {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function judgmentToVerdict(judgment: VisiblePriorClaim["judgment"]): string {
  if (judgment === "supported") return "true";
  if (judgment === "refuted") return "false";
  return "mixed_misleading";
}

function parseVisibleEvidence(raw: unknown): VisiblePriorEvidence | null {
  if (!isRecord(raw)) return null;
  const url = String(raw.url ?? "").trim();
  if (!/^https?:\/\//i.test(url)) return null;
  const role = String(raw.role ?? "").trim();
  if (!VISIBLE_ROLES.has(role)) return null;
  return {
    url,
    title: clipText(raw.title, 200),
    excerpt: clipText(raw.excerpt ?? raw.snippet, 320),
    role: role as VisiblePriorEvidence["role"],
  };
}

function parseVisibleClaim(raw: unknown): VisiblePriorClaim | null {
  if (!isRecord(raw)) return null;
  const text = clipText(raw.text, 240);
  const judgment = String(raw.judgment ?? "").trim();
  if (!text || !VISIBLE_JUDGMENTS.has(judgment)) return null;
  const evidence: VisiblePriorEvidence[] = [];
  const seenUrl = new Set<string>();
  for (const item of Array.isArray(raw.evidence) ? raw.evidence : []) {
    const parsed = parseVisibleEvidence(item);
    if (!parsed || seenUrl.has(parsed.url)) continue;
    seenUrl.add(parsed.url);
    evidence.push(parsed);
    if (evidence.length >= VISIBLE_EVIDENCE_CAP) break;
  }
  if (evidence.length === 0) return null;
  return {
    text,
    judgment: judgment as VisiblePriorClaim["judgment"],
    evidence,
  };
}

/** 读取客户端携带的上一轮材料；仅供理解对话。 */
function parsePriorRoundBrief(raw: unknown): VisiblePriorRound | null {
  if (!isRecord(raw)) return null;
  const claims: VisiblePriorClaim[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(raw.claims) ? raw.claims : []) {
    const claim = parseVisibleClaim(item);
    if (!claim) continue;
    const key = claimAtomKey(claim.text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    claims.push(claim);
    if (claims.length >= VISIBLE_CLAIM_CAP) break;
  }
  if (claims.length === 0) return null;
  return {
    originalClaim: clipText(raw.originalClaim, 500),
    conclusion: clipText(raw.conclusion, 800),
    ...(typeof raw.checkedAt === "string" && Number.isFinite(Date.parse(raw.checkedAt)) ? { checkedAt: raw.checkedAt } : {}),
    claims,
  };
}

function priorReportFromVisibleBrief(brief: VisiblePriorRound): Record<string, unknown> {
  return {
    conclusion: brief.conclusion,
    subclaimVerdicts: brief.claims.map((claim) => ({
      claimAtom: claim.text,
      verdict: judgmentToVerdict(claim.judgment),
      supportingSources: claim.evidence
        .filter((item) => item.role === "support")
        .map((item) => ({ url: item.url, title: item.title, snippet: item.excerpt })),
      contradictingSources: claim.evidence
        .filter((item) => item.role === "contradict")
        .map((item) => ({ url: item.url, title: item.title, snippet: item.excerpt })),
    })),
  };
}

export function followUpReuseFromClientBrief(raw: unknown): {
  priorReport: unknown;
  priorClaim: string;
  priorCreatedAt?: number;
} | null {
  const brief = parsePriorRoundBrief(raw);
  if (!brief) return null;
  return {
    priorReport: priorReportFromVisibleBrief(brief),
    priorClaim: brief.originalClaim,
    ...(brief.checkedAt ? { priorCreatedAt: Date.parse(brief.checkedAt) } : {}),
  };
}
