/**
 * Machine scoring for the answer benchmark (docs/evals/2026-09-29-answer-benchmark.md).
 * Pure functions only: no provider, network or file access. No LLM judging.
 */
import type { BenchLabel } from "./answerBenchLabel.js";
import type { AtomEngineCounts } from "../src/lib/atomSearch.js";
import { LABEL_TEXT, isLabelKey, type LabelKey } from "../src/domain/labels.js";

export type ResultLabel = BenchLabel | "错误";

export interface BenchQuote {
  url: string;
  title?: string;
  quote?: string;
}
export interface BenchPart {
  text?: string;
  role?: string;
  status?: string;
  quotes?: BenchQuote[];
}
export interface BenchCase {
  id: string;
  claim: string;
  /** null when the case is a boundary case (not scored by a single label). */
  derivedLabel: BenchLabel | null;
  boundary: boolean;
  parts: BenchPart[];
  expectedLead?: string;
  keyFact?: string;
  acceptIf?: string;
  mustMention?: string[] | string;
  requiredCorrection?: string;
}

export interface PipelineSource {
  url: string;
  title: string;
  /** 支持 / 反驳 / 相关 / 待核对 (the UI's ROLE_LABEL). */
  relation: string;
  quote?: string;
  /** Search engines that returned this URL (bundle.enginesByUrl); measurement only (#144). */
  foundBy?: string[];
  /** Evidence only: text of every snapshot claim this url+relation is linked to. */
  parts?: string[];
}
export interface PipelineResult {
  label: ResultLabel;
  /** Raw pipeline verdict before mapping (e.g. verdictType "mixed_misleading"). */
  rawVerdict: string;
  lead: string;
  answerText: string;
  /** What the UI's snapshot shows with a real role. Empty when the snapshot could not be built. */
  evidenceSources: PipelineSource[];
  /** What the final report cites (relation is "unknown" unless the snapshot gives a role). */
  citedSources: PipelineSource[];
  /** Everything the searches returned (relation always "unknown"). */
  searchedSources: PipelineSource[];
  snapshotBuilt: boolean;
  /** bundle.enginesPerAtom (#144); absent in rows recorded before it existed. */
  enginesPerAtom?: Record<string, AtomEngineCounts>;
  /** Snapshot `conclusion.reason` (else `verdictLead`): the sentence under the big verdict. Absent in older rows. */
  reason?: string;
  conclusionLabel?: string;
  /** Snapshot phase (complete / interrupted / stopped). Absent in older rows. */
  phase?: string;
  /** Snapshot claims, compact (no quote text). Absent in older rows. */
  parts?: PipelinePart[];
  timings: { totalMs: number };
  calls: { model: number; search: number };
  error?: string;
}

export interface PipelinePart {
  text: string;
  label?: string;
  evidence: { role: string; excerptKind?: string; hasQuote: boolean }[];
}

type Rec = Record<string, unknown>;
const asRec = (v: unknown): Rec => (v && typeof v === "object" ? (v as Rec) : {});
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** The fields the two snapshot checks read, from `finalReport.investigation`. Empty when there is no snapshot. */
export function compactSnapshot(snapshot: unknown): Pick<PipelineResult, "reason" | "conclusionLabel" | "phase" | "parts"> {
  const snap = asRec(snapshot);
  if (snap.schemaVersion !== 1) return {};
  const conclusion = asRec(snap.conclusion);
  return {
    reason: str(conclusion.reason) || str(conclusion.verdictLead),
    phase: str(snap.phase),
    conclusionLabel: str(conclusion.label),
    parts: arr(snap.claims).map((raw) => {
      const claim = asRec(raw);
      return {
        text: str(claim.text),
        ...(str(claim.label) ? { label: str(claim.label) } : {}),
        evidence: arr(claim.evidence).map((e) => {
          const link = asRec(e);
          return { role: str(link.role), ...(str(link.excerptKind) ? { excerptKind: str(link.excerptKind) } : {}), hasQuote: str(link.quote).trim() !== "" };
        }),
      };
    }),
  };
}

const labelText = (label: string | undefined): string => LABEL_TEXT[isLabelKey(label) ? label : "unresolved"];
/** Same as `clip` in src/lib/sentenceVerdict.ts (not exported): collapse whitespace, cut to max, add "…". */
const clipEllipsis = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
};
/** Same as `clip` in src/lib/investigation/build.ts (not exported): trim, cut to max, no "…". */
const clipPlain = (text: string, max: number): string => {
  const t = text.trim();
  return t.length > max ? t.slice(0, max) : t;
};
const ISSUER_TEMPLATE = "的内容属实，只是原句把发文机关或出处说错了";
/** Longest first, so 基本属实 / 部分属实 / 不属实 go before 属实. */
const LABEL_WORDS = (Object.values(LABEL_TEXT) as string[]).sort((a, b) => b.length - a.length);
/**
 * Words that only point at the claim or restate a verdict in other words. Without them a reason like
 * 「该句核心事实成立。」 (2026-10-15 pilot, NEW-404) passed while saying nothing beyond the label.
 */
const GENERIC_WORDS = [
  "这句话", "该说法", "这一说法", "此说法", "该句", "此句", "原句", "整句", "说法",
  "核心事实", "核心", "事实", "不成立", "成立", "正确", "错误", "准确", "真实", "虚假", "不可信", "可信",
  "无法核实", "无法证实", "未能核实", "现有", "公开", "资料", "材料", "信息", "证据", "依据",
  "主要", "基本", "内容", "情况", "均", "都",
].sort((a, b) => b.length - a.length);
const MIN_NEW_CHARS = 4;

/**
 * 理由句有新内容: the reason must say something beyond the original claim, the part texts and the label words.
 * `templated` is true when the reason is exactly the code fallback 「part」label；… (sentenceVerdict.ts partLine,
 * or the relabel line in investigation/build.ts, which clips without "…").
 */
export function checkReason(input: { reason: string; claim: string; parts: readonly { text: string; label?: string }[]; phase?: string }): {
  pass: boolean;
  templated: boolean;
  remainder: string;
} {
  const reason = input.reason.trim();
  const templateWith = (clip: (t: string, max: number) => string) =>
    `${input.parts.map((p) => `「${clip(p.text, 40)}」${labelText(p.label)}`).join("；")}。`;
  const templated = reason !== "" && (reason === templateWith(clipEllipsis) || reason === templateWith(clipPlain));
  if (!reason) return { pass: false, templated, remainder: "" };
  // 没查完的调查（例：「本次核查没能完成，判断还没写成。」）不算有理由。
  if (input.phase && input.phase !== "complete") return { pass: false, templated, remainder: "" };
  const texts = [input.claim, ...input.parts.map((p) => p.text)].flatMap((t) => [t, t.replace(/\s+/g, " ").trim(), clipEllipsis(t, 40), clipPlain(t, 40)]);
  const restated = [...new Set(texts.filter((t) => t.trim() !== ""))].sort((a, b) => b.length - a.length);
  let rest = reason;
  for (const t of restated) rest = rest.split(t).join("");
  // The issuer template contains 属实, so it has to go before the label words.
  rest = rest.split(ISSUER_TEMPLATE).join("");
  for (const w of LABEL_WORDS) rest = rest.split(w).join("");
  for (const w of GENERIC_WORDS) rest = rest.split(w).join("");
  rest = rest.replace(/[\p{P}「」『』“”"'\s]/gu, "");
  return { pass: [...rest].length >= MIN_NEW_CHARS, templated, remainder: rest };
}

/** Labels that decide something; unresolved / uncheckable / opinion are excluded. */
const DECISIVE_LABELS: ReadonlySet<LabelKey> = new Set<LabelKey>(["true", "mostly-true", "partly-true", "exaggerated", "false", "disputed"]);

/** 依据读到正文: every decisive part has a support/contradict quote checked against fetched page text. */
export function checkGrounded(parts: readonly PipelinePart[]): { decisiveParts: number; groundedParts: number; pass: boolean | null } {
  const decisive = parts.filter((p) => isLabelKey(p.label) && DECISIVE_LABELS.has(p.label));
  const grounded = decisive.filter((p) =>
    p.evidence.some((e) => (e.role === "support" || e.role === "contradict") && e.excerptKind === "page-excerpt" && e.hasQuote),
  );
  return { decisiveParts: decisive.length, groundedParts: grounded.length, pass: decisive.length === 0 ? null : grounded.length === decisive.length };
}

/**
 * Whole-claim label in the benchmark vocabulary. `face` is the production `faceVerdict`
 * (reportAssembly FACE_VERDICT: 能信/不能信/有真有假/部分成立/有争议/还查不清); the UI badge calls the
 * unresolved state 证据不足 (snapshotUi JUDGMENT_LABEL), and a not-applicable snapshot judgment is 立场型.
 */
export function mapToBenchLabel(input: { face?: string; judgment?: string }): BenchLabel {
  if (input.judgment === "not-applicable") return "立场型";
  switch ((input.face ?? "").trim()) {
    case "能信":
      return "能信";
    case "不能信":
      return "不能信";
    case "有真有假":
      return "有真有假";
    case "部分成立":
      return "部分成立";
    case "有争议":
      return "有争议";
    default:
      return "证据不足"; // 还查不清 and anything unknown
  }
}

export function normalizeUrlKey(raw: string): { host: string; hostPath: string } | null {
  try {
    const u = new URL(raw);
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "");
    return { host, hostPath: `${host}${path}` };
  } catch {
    return null;
  }
}

/**
 * Domain -> source type, matched by host suffix. "reliable" = first-hand or major-media original;
 * everything else (self-media, reposts, aggregators, unknown) is "other". Edit here only.
 */
export type SourceType = "official" | "debunk" | "media" | "other";
export const SOURCE_TYPE_TABLE: ReadonlyArray<{ suffix: string; type: Exclude<SourceType, "other"> }> = [
  // debunk platforms (before gov.cn so piyao.* / jubao.* are labelled debunk)
  { suffix: "piyao.org.cn", type: "debunk" },
  { suffix: "piyao.gov.cn", type: "debunk" },
  // government / institution originals
  { suffix: "gov.cn", type: "official" },
  { suffix: "12306.cn", type: "official" },
  { suffix: "edu.cn", type: "official" },
  { suffix: "who.int", type: "official" },
  { suffix: "cochrane.org", type: "official" },
  { suffix: "mayoclinic.org", type: "official" },
  { suffix: "nih.gov", type: "official" },
  { suffix: "cdc.gov", type: "official" },
  { suffix: "fda.gov", type: "official" },
  { suffix: "cdc.gov.cn", type: "official" },
  // central / major media original reporting
  { suffix: "news.cn", type: "media" },
  { suffix: "xinhuanet.com", type: "media" },
  { suffix: "people.com.cn", type: "media" },
  { suffix: "cctv.com", type: "media" },
  { suffix: "cctv.cn", type: "media" },
  { suffix: "cnr.cn", type: "media" },
  { suffix: "gmw.cn", type: "media" },
  { suffix: "chinanews.com.cn", type: "media" },
  { suffix: "chinanews.com", type: "media" },
  { suffix: "thepaper.cn", type: "media" },
  { suffix: "cri.cn", type: "media" },
  { suffix: "china.com.cn", type: "media" },
  { suffix: "chinadaily.com.cn", type: "media" },
];

export function sourceType(url: string): SourceType {
  const key = normalizeUrlKey(url);
  if (!key) return "other";
  const hit = SOURCE_TYPE_TABLE.find((r) => key.host === r.suffix || key.host.endsWith(`.${r.suffix}`));
  return hit ? hit.type : "other";
}

export interface ScoredRow {
  id: string;
  derivedLabel: BenchLabel | null;
  label: ResultLabel;
  /** null for boundary cases (human review). */
  labelCorrect: boolean | null;
  needsHuman: boolean;
  trueToFalse: boolean;
  shouldJudgeButDidnt: boolean;
  wrongSupport: number;
  /** Key source (same host, or same host+path for Exact) among all search results. */
  keyInSearch: boolean;
  keyInSearchExact: boolean;
  /** Same, among the final citations plus snapshot evidence. */
  keyInCited: boolean;
  keyInCitedExact: boolean;
  /** Any cited or evidence source is official / debunk platform / major-media original. */
  usedReliablePrimary: boolean;
  seconds: number;
  modelCalls: number;
  searchCalls: number;
  /** Checks on the snapshot; null = unknown (row recorded before these fields existed), never a failure. */
  reasonPass: boolean | null;
  reasonTemplated: boolean | null;
  reasonRemainder: string;
  decisiveParts: number | null;
  groundedParts: number | null;
  groundedPass: boolean | null;
  error?: string;
}

export function scoreCase(c: BenchCase, r: PipelineResult): ScoredRow {
  const derived = c.boundary ? null : c.derivedLabel;
  const keys = c.parts
    .flatMap((p) => p.quotes ?? [])
    .map((q) => normalizeUrlKey(q.url))
    .filter((k): k is { host: string; hostPath: string } => k !== null);
  const keyHosts = new Set(keys.map((k) => k.host));
  const keyHostPaths = new Set(keys.map((k) => k.hostPath));
  const match = (list: readonly PipelineSource[]) => {
    const got = list.map((x) => normalizeUrlKey(x.url)).filter((k): k is { host: string; hostPath: string } => k !== null);
    const exact = got.some((k) => keyHostPaths.has(k.hostPath));
    return { exact, hit: exact || got.some((k) => keyHosts.has(k.host)) };
  };
  const inSearch = match(r.searchedSources);
  const inCited = match([...r.citedSources, ...r.evidenceSources]);
  const reason = r.reason !== undefined && r.parts ? checkReason({ reason: r.reason, claim: c.claim, parts: r.parts, phase: r.phase }) : null;
  const grounded = r.parts ? checkGrounded(r.parts) : null;
  return {
    id: c.id,
    derivedLabel: derived,
    label: r.label,
    labelCorrect: c.boundary ? null : r.error ? false : r.label === derived,
    needsHuman: c.boundary,
    trueToFalse: derived === "能信" && r.label === "不能信",
    shouldJudgeButDidnt: (derived === "不能信" || derived === "能信") && r.label === "证据不足",
    wrongSupport: derived === "不能信" ? r.evidenceSources.filter((s) => s.relation === "支持").length : 0,
    keyInSearch: inSearch.hit,
    keyInSearchExact: inSearch.exact,
    keyInCited: inCited.hit,
    keyInCitedExact: inCited.exact,
    usedReliablePrimary: [...r.citedSources, ...r.evidenceSources].some((x) => sourceType(x.url) !== "other"),
    seconds: r.timings.totalMs / 1000,
    modelCalls: r.calls.model,
    searchCalls: r.calls.search,
    reasonPass: reason ? reason.pass : null,
    reasonTemplated: reason ? reason.templated : null,
    reasonRemainder: reason ? reason.remainder : "",
    decisiveParts: grounded ? grounded.decisiveParts : null,
    groundedParts: grounded ? grounded.groundedParts : null,
    groundedPass: grounded ? grounded.pass : null,
    ...(r.error ? { error: r.error } : {}),
  };
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export function summarize(rows: readonly ScoredRow[]) {
  const scoredRows = rows.filter((r) => r.labelCorrect !== null);
  const correct = scoredRows.filter((r) => r.labelCorrect).length;
  const byLabel: Record<string, { n: number; correct: number }> = {};
  for (const r of scoredRows) {
    const k = r.derivedLabel ?? "?";
    const e = (byLabel[k] ??= { n: 0, correct: 0 });
    e.n += 1;
    if (r.labelCorrect) e.correct += 1;
  }
  const seconds = rows.map((r) => r.seconds);
  // Older rows have no reasonPass / grounded fields at all (undefined), newer ones null when unknown.
  const reasonKnown = rows.filter((r) => r.reasonPass === true || r.reasonPass === false);
  const groundedKnown = rows.filter((r) => r.groundedPass === true || r.groundedPass === false);
  const partsKnown = rows.filter((r) => typeof r.decisiveParts === "number");
  return {
    cases: rows.length,
    scored: scoredRows.length,
    correct,
    accuracy: scoredRows.length ? correct / scoredRows.length : null,
    boundary: rows.filter((r) => r.needsHuman).length,
    byLabel,
    trueToFalse: rows.filter((r) => r.trueToFalse).length,
    shouldJudgeButDidnt: rows.filter((r) => r.shouldJudgeButDidnt).length,
    wrongSupport: rows.reduce((a, r) => a + r.wrongSupport, 0),
    keyInSearch: rows.filter((r) => r.keyInSearch).length,
    keyInSearchExact: rows.filter((r) => r.keyInSearchExact).length,
    keyInCited: rows.filter((r) => r.keyInCited).length,
    keyInCitedExact: rows.filter((r) => r.keyInCitedExact).length,
    usedReliablePrimary: rows.filter((r) => r.usedReliablePrimary).length,
    errors: rows.filter((r) => r.error).length,
    secondsMedian: median(seconds),
    secondsMax: seconds.length ? Math.max(...seconds) : null,
    modelCallsMean: mean(rows.map((r) => r.modelCalls)),
    searchCallsMean: mean(rows.map((r) => r.searchCalls)),
    reasonPass: { pass: reasonKnown.filter((r) => r.reasonPass).length, of: reasonKnown.length },
    reasonTemplated: rows.filter((r) => r.reasonTemplated === true).length,
    groundedCases: { pass: groundedKnown.filter((r) => r.groundedPass).length, of: groundedKnown.length },
    groundedParts: {
      grounded: partsKnown.reduce((a, r) => a + (r.groundedParts ?? 0), 0),
      of: partsKnown.reduce((a, r) => a + (r.decisiveParts ?? 0), 0),
    },
  };
}
