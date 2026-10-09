/**
 * 生产数据 → InvestigationSnapshotV1 的确定性映射（不调用任何 LLM）。
 *
 * 输入是生产结构的鸭子类型（claimAtoms / claimAtomTypes / AtomSearchBundle /
 * subclaimVerdicts / crossExam / pursuitHops / finalReport），全部可选——
 * 同一个 builder 服务调查进行中、完成、interrupted 和旧历史重建。
 *
 * 判词纪律不在本文件发明：true/false 无已绑定 http(s) 来源时按生产 demote 规则
 * 收敛为 unresolved（与 mergeSubclaimVerdicts / bindAtomEvidenceToVerdicts 同向，
 * 只在读取时兜底，不回写生产数据）。
 * false 且只有 supportingSources 时按生产 alignFalseEvidenceBuckets 改桶，
 * 不用 finding 文本猜正负。
 */
import type {
  InvestigationCheckability,
  InvestigationClaim,
  InvestigationConflict,
  InvestigationEvidenceLink,
  InvestigationGap,
  InvestigationJudgment,
  InvestigationPhase,
  InvestigationProgress,
  InvestigationSnapshotV1,
  InvestigationSource,
} from "./schema.js";
import { validateInvestigationSnapshot } from "./schema.js";
import { decideSentenceVerdict, type PartRole, type PartStanding } from "../../domain/verdict.js";
import {
  FALLBACK_PART_REASON,
  LABEL_TEXT,
  isLabelKey,
  judgmentToLabel,
  labelBackedByEvidence,
  labelToJudgment,
  nonCheckableLabel,
  standingForLabel,
  wholeLabelFor,
  type LabelKey,
} from "../../domain/labels.js";
import { investigationSourceId, normalizeInvestigationSourceUrl } from "./sourceIdentity.js";
import { dateFromUrl, normalizePublishedDate } from "./sourceDate.js";

export type InvestigationBuildInput = {
  originalClaim: string;
  phase: InvestigationPhase;
  /** self-proof 后保留的原子（原句序）。dropped 原子不进 claims——它们不是用户主张。 */
  claimAtoms?: unknown;
  /** [{ text, verifiable, type }]，拆题类型闸工单。 */
  claimAtomTypes?: unknown;
  /** Actual retrieval plan, never inferred from unmatched sentence fragments. */
  scopePlan?: { includedAtoms: readonly string[]; deferredAtoms: readonly string[] };
  /** AtomSearchBundle 形：{ atomsSearched?, byAtomKey? }。 */
  atomSearchBundle?: unknown;
  /** SubclaimVerdict 形数组（合并绑定后或模型原始）。 */
  subclaimVerdicts?: unknown;
  /** SourceValidator 对 claimAtom + URL 的独立方向核验。只给 EvidenceLink 附元信息，不凭关键词翻桶。 */
  sourceRelationAudits?: unknown;
  /** [{ text, type }] 立场/不适用原子（legacy 补 types 用）。 */
  nonVerifiableAtoms?: unknown;
  /** { ran?, atoms?: [...] } 质询记录；只用于冲突 reason，不决定冲突是否存在。 */
  crossExam?: unknown;
  /** PursuitHop[] 证据追索跳；只用于 gap consequence。 */
  pursuitHops?: unknown;
  /** finalReport 形：{ conclusion?, verdictType?, causalBoundary?, citationSources?, checkedAt? }。 */
  report?: unknown;
  /** 引用探活死链（pruneDeadCitations.deadUrls）：死链来源标 reachable=false。 */
  reachability?: { deadUrls?: readonly string[] };
  /** 从网页自己的发布元数据读到的日期（URL → YYYY-MM-DD）；只在检索方没给日期时使用。 */
  pageDates?: Readonly<Record<string, string>>;
  /**
   * 用户提交的链接材料（CaseIntakeLinkPayload[]）：客户端既有抓取链路读过正文
   * （scrapeStatus/scrapedContent/scrapedAt）。登记为来源——真读到正文才标
   * page-excerpt；抓取失败保留 failed + 原因，不新增公网读取能力。
   */
  intakeLinks?: unknown;
  checkedAt?: string;
  /**
   * received 且命题尚未出现：正在拆原句，或正在核对这些拆出来的说法。
   * 只在 received 写出；命题出现后由 builder 丢掉，避免完成态还带着过程字段。
   */
  preClaimWork?: "splitting" | "checking";
};

export type InvestigationBuildOptions = {
  /**
   * 生产传 mvp `claimAtomKey`，保证与 merge/claimItems 同键；
   * 缺省用内置同规则规范化（全角空格 → 空格，超长 180 截断）。
   * 键只用于 identity join，绝不进入 claim.text——展示文本用 kept atom 原文。
   */
  claimAtomKeyFn?: (value: string) => string;
};

const DEFAULT_KEY_MAX = 180;

function defaultClaimAtomKey(value: string): string {
  const norm = value.replace(/\u3000/g, " ");
  return norm.length > DEFAULT_KEY_MAX ? `${norm.slice(0, DEFAULT_KEY_MAX)}…` : norm;
}

const HTTP_RE = /^https?:\/\//i;

function isHttpUrl(url: string): boolean {
  return HTTP_RE.test(url);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

const DISPLAY_EXCERPT_MAX = 80;
const PASSAGE_MAX = 620;

/** 调查中可见摘录：约 80 字，超出打省略号。 */
function clipExcerpt(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (trimmed.length <= DISPLAY_EXCERPT_MAX) return trimmed;
  return `${trimmed.slice(0, DISPLAY_EXCERPT_MAX)}…`;
}

function cleanPassageText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function claimAnchorIndex(claim: string, passage: string): number {
  const compactClaim = claim.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  if (!compactClaim || !passage) return -1;
  for (let size = Math.min(8, compactClaim.length); size >= 2; size -= 1) {
    for (let start = 0; start + size <= compactClaim.length; start += 1) {
      const gram = compactClaim.slice(start, start + size);
      if (/^(所以|因此|这个|一种|可以|能够|就是|已经)$/.test(gram)) continue;
      const index = passage.indexOf(gram);
      if (index >= 0) return index;
    }
  }
  return -1;
}

function sectionTitleFromPassage(text: string, anchor: number): string | undefined {
  const before = text.slice(0, anchor >= 0 ? Math.min(text.length, anchor + 120) : text.length);
  const pattern = /(?:流言|谣言|传言|误区)\s*[：:]?\s*([^。！？；\n]{3,80}?)\s*(?=真相|事实|辟谣|解析|解读)/g;
  let selected = "";
  for (const match of before.matchAll(pattern)) selected = match[1]?.trim() ?? selected;
  return selected || undefined;
}

function passageMeta(claim: string, snippet: string): { passage?: string; sectionTitle?: string } {
  const text = cleanPassageText(snippet);
  if (!text) return {};
  const anchor = claimAnchorIndex(claim, text);
  const start = anchor > 160 ? anchor - 160 : 0;
  const passage = text.slice(start, Math.min(text.length, start + PASSAGE_MAX));
  return {
    passage: `${start > 0 ? "…" : ""}${passage}${start + PASSAGE_MAX < text.length ? "…" : ""}`,
    ...(sectionTitleFromPassage(text, anchor) ? { sectionTitle: sectionTitleFromPassage(text, anchor) } : {}),
  };
}

/** finding 若整段或其中一句已经写在结论里，就不要再挂到依据。 */
function overlapsPublicProse(candidate: string, corpus: string): boolean {
  const needle = candidate.replace(/\s+/g, "");
  const hay = corpus.replace(/\s+/g, "");
  if (needle.length < 12 || hay.length < 12) return false;
  if (hay.includes(needle) || needle.includes(hay)) return true;
  const parts = (text: string) =>
    text.split(/[。！？；\n]/).map((s) => s.replace(/\s+/g, "")).filter((s) => s.length >= 12);
  return parts(candidate).some((s) => hay.includes(s)) || parts(corpus).some((s) => needle.includes(s));
}

function pointFinding(evidence: string | undefined, conclusionText: string): string | undefined {
  const text = (evidence ?? "").trim();
  if (!text) return undefined;
  if (overlapsPublicProse(text, conclusionText)) return undefined;
  return text;
}

/**
 * 结论分层用的确定性切句：按 。！？ 切、去空白、丢空段。
 */
function splitConclusionSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 复述句的引导词；长词在前，避免被短词前缀截断。 */
const CLAIM_LEAD_WORDS = ["流传说法是", "这句话", "原句", "该说法"] as const;

/**
 * 引导词之后紧跟的连接词（「该说法称…」的「称」）。单独成表，便于以后补词。
 * 顺序不影响结果：只剥离一个命中的连接词。
 */
const CLAIM_CONNECTORS = ["指出", "表示", "宣称", "写道", "提到", "认为", "称", "说"] as const;

/** 去掉首尾引号与引导词，再去掉句末标点，用于和 originalClaim 比对。 */
function stripClaimLeadWords(sentence: string): string {
  let out = sentence.trim();
  out = out.replace(/^[「『“"'（(]+/, "").replace(/[」』”"'）)]+$/, "").trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const word of CLAIM_LEAD_WORDS) {
      if (out.startsWith(word)) {
        out = out.slice(word.length).replace(/^[：:，,、\s]+/, "").trim();
        changed = true;
      }
    }
  }
  return out.replace(/[。！？]+$/, "").trim();
}

/** 剥离紧跟引导词之后的连接词（可再带引号/冒号等分隔符）。 */
function stripClaimConnector(text: string): string {
  const out = text.trim();
  for (const word of CLAIM_CONNECTORS) {
    if (out.startsWith(word)) {
      return out
        .slice(word.length)
        .replace(/^[：:，,、\s「『“"']+/, "")
        .replace(/[」』”"']+$/, "")
        .trim();
    }
  }
  return out;
}

function startsWithClaimLeadWord(sentence: string): boolean {
  const t = sentence.trim().replace(/^[「『“"'（(]+/, "");
  return CLAIM_LEAD_WORDS.some((word) => t.startsWith(word));
}

/**
 * 是否为「原句复述句」（丢弃，不进任何一层；原句已由「你调查的说法」块展示）。
 * 命中任一即算，且两条都要求「与 originalClaim 完全相同」，无任何重叠率 / 比例阈值：
 * ① 逐字复述：去掉首尾引号与引导词后，剩余文本与 originalClaim 完全相同
 *    （「原句站不住。」不等于原句，不会被误丢）；
 * ② 带引导词 / 连接词的复述：剥离引导词后再剥离紧跟的连接词，剩余文本与 originalClaim
 *    完全相同。只盖到「完全相同」为止：像「该说法称喝隔夜水会致癌，但没超标。」这种
 *    在原句之上追加了新信息的句子，剥离后 ≠ 原句，必须保留。
 * 判据宁严不宽：判不出来就保留（三轮比例判据都因误伤「原句 + 新信息」被废止）。
 */
function isClaimRestatement(sentence: string, originalClaim: string): boolean {
  const trimmed = sentence.trim();
  const stripped = stripClaimLeadWords(trimmed);
  const claim = stripClaimLeadWords(originalClaim);
  if (stripped.length > 0 && stripped === claim) return true;
  if (startsWithClaimLeadWord(trimmed) && stripped.length > 0) {
    const withoutConnector = stripClaimConnector(stripped);
    return withoutConnector.length > 0 && withoutConnector === claim;
  }
  return false;
}

/**
 * 从 report.conclusion 原文切两层：丢掉开头连续的复述句后，verdictLead = 第 1 句，
 * rationale = 其后各句拼接（为空则不给）。全部被丢弃时不产出 verdictLead，交前端回退。
 */
function splitConclusionLayers(
  conclusion: string,
  originalClaim: string
): { verdictLead?: string; rationale?: string } {
  const sentences = splitConclusionSentences(conclusion);
  let start = 0;
  while (start < sentences.length && isClaimRestatement(sentences[start]!, originalClaim)) {
    start += 1;
  }
  const rest = sentences.slice(start);
  if (rest.length === 0) return {};
  const verdictLead = rest[0]!;
  const rationale = rest.slice(1).join("");
  return rationale ? { verdictLead, rationale } : { verdictLead };
}

type VerdictSourceLike = { url?: unknown; title?: unknown; snippet?: unknown };

/**
 * 检索/注入进 bundle 的来源（build 侧读取形状）。
 * provenance/originDate 是复用来源的两个可选字段。现在只有同一案上一轮（prior-round）会产生；
 * knowledge 是已删除的证据库留下的值，只为老数据重建时原样带过。
 */
type ReuseProvenance = "knowledge" | "prior-round";

type BundleSource = {
  url: string;
  title: string;
  snippet: string;
  provenance?: ReuseProvenance;
  originDate?: string;
  /** 检索层实际得到的发表日（YYYY-MM-DD 或 ISO）；拿不到就是没有，旧数据缺省。 */
  publishedAt?: string;
  /** 检索方实际给出的站点/发布者名；拿不到就是没有。 */
  publisher?: string;
  /** 本次检索命中时刻（ISO）。 */
  retrievedAt?: string;
  /** 摘录来历：search-snippet=检索摘要；page-excerpt=真读过正文。 */
  excerptKind?: "search-snippet" | "page-excerpt";
  /** 获取状态：snippet-only/fetched/truncated/restricted/failed。 */
  fetchStatus?: "snippet-only" | "fetched" | "truncated" | "restricted" | "failed";
  /** 获取限制说明（截断/受限/失败原因）。 */
  fetchNote?: string;
};

function reuseProvenanceOf(value: unknown): ReuseProvenance | undefined {
  return value === "knowledge" || value === "prior-round" ? value : undefined;
}

type VerdictLike = {
  claimAtom: string;
  verdict: string;
  evidence: string;
  boundary: string;
  supportingSources: VerdictSourceLike[];
  contradictingSources: VerdictSourceLike[];
  evidenceGaps: string[];
  sourcesRelatedOnly: boolean;
  /** 模型给的标签与理由（改版前的记录没有）。 */
  label?: LabelKey;
  reason?: string;
};

type RelationAuditView = {
  relation: "support" | "contradict" | "context-only" | "unverified";
  reason: string;
};

/**
 * 与 claimAtom/merge.ts 的 alignFalseEvidenceBuckets 同向：只按结构化 verdict 改桶。
 * Snapshot 读取兜底，不回写生产数据，不用 finding 文本。
 */
function alignFalseEvidenceBuckets<T>(input: {
  verdict: string;
  supporting: T[];
  contradicting: T[];
  sourcesRelatedOnly?: boolean;
}): { supporting: T[]; contradicting: T[] } {
  const verdict = String(input.verdict ?? "").trim().toLowerCase();
  if (
    verdict === "false" &&
    input.sourcesRelatedOnly !== true &&
    input.supporting.length > 0 &&
    input.contradicting.length === 0
  ) {
    return { supporting: [], contradicting: input.supporting };
  }
  return { supporting: input.supporting, contradicting: input.contradicting };
}

function readVerdicts(raw: unknown, keyFn: (s: string) => string): Map<string, VerdictLike> {
  const out = new Map<string, VerdictLike>();
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const atom = asString(rec.claimAtom).trim();
    if (!atom) continue;
    const key = keyFn(atom);
    if (!key || out.has(key)) continue;
    const supportingRaw = asArray(rec.supportingSources)
      .map(asRecord)
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({ url: s.url, title: s.title, snippet: s.snippet }));
    const contradictingRaw = asArray(rec.contradictingSources)
      .map(asRecord)
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({ url: s.url, title: s.title, snippet: s.snippet }));
    const sourcesRelatedOnly = rec.sourcesRelatedOnly === true;
    const verdict = asString(rec.verdict).trim().toLowerCase();
    const aligned = alignFalseEvidenceBuckets({
      verdict,
      supporting: supportingRaw,
      contradicting: contradictingRaw,
      sourcesRelatedOnly,
    });
    out.set(key, {
      claimAtom: key,
      verdict,
      evidence: clip(asString(rec.evidence), 240),
      boundary: clip(asString(rec.boundary), 200),
      supportingSources: aligned.supporting,
      contradictingSources: aligned.contradicting,
      evidenceGaps: asArray(rec.evidenceGaps)
        .map((g) => clip(asString(g), 120))
        .filter((g) => g.length > 0)
        .slice(0, 3),
      sourcesRelatedOnly,
      ...(isLabelKey(rec.label) ? { label: rec.label } : {}),
      ...(asString(rec.reason).trim() ? { reason: clip(asString(rec.reason), 160) } : {}),
    });
  }
  return out;
}

type DecidedPart = { key: string; text: string; role: PartRole; standing: PartStanding; label?: LabelKey; reason?: string; issuerMisattributed?: boolean };

/** 整句规则表（sentenceVerdict.applySentenceVerdict）写进报告的决定：各截标签与整句标签。 */
function readVerdictDecision(report: Record<string, unknown> | null, keyFn: (s: string) => string) {
  const decision = asRecord(report?._verdictDecision);
  if (!decision) return null;
  const parts: DecidedPart[] = asArray(decision.parts)
    .map(asRecord)
    .filter((p): p is Record<string, unknown> => p !== null && asString(p.text).trim() !== "")
    .map((p) => ({
      key: keyFn(asString(p.text).trim()),
      text: asString(p.text).trim(),
      role: (["main", "premise", "background"].includes(asString(p.role)) ? asString(p.role) : "premise") as PartRole,
      standing: (["supported", "refuted", "partial", "unresolved", "conflicting"].includes(asString(p.standing))
        ? asString(p.standing)
        : "unresolved") as PartStanding,
      ...(isLabelKey(p.label) ? { label: p.label } : {}),
      ...(asString(p.reason).trim() ? { reason: asString(p.reason).trim() } : {}),
      ...(p.issuerMisattributed === true ? { issuerMisattributed: true } : {}),
    }));
  return {
    label: isLabelKey(decision.label) ? decision.label : undefined,
    reason: asString(decision.reason).trim(),
    parts,
  };
}

function readRelationAudits(
  raw: unknown,
  keyFn: (s: string) => string,
): Map<string, RelationAuditView> {
  const out = new Map<string, RelationAuditView>();
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const claimAtom = asString(rec.claimAtom).trim();
    const url = normalizeInvestigationSourceUrl(asString(rec.url).trim());
    const relation = asString(rec.relation).trim();
    if (!claimAtom || !url) continue;
    if (relation !== "support" && relation !== "contradict" && relation !== "context-only" && relation !== "unverified") continue;
    out.set(`${keyFn(claimAtom)}\u0000${url}`, {
      relation,
      reason: clip(asString(rec.reason), 320),
    });
  }
  return out;
}

function readAtomTypes(
  claimAtomTypes: unknown,
  nonVerifiableAtoms: unknown,
  keyFn: (s: string) => string
): Map<string, { verifiable: boolean; type: string }> {
  const map = new Map<string, { verifiable: boolean; type: string }>();
  for (const item of asArray(claimAtomTypes)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = asString(rec.text).trim();
    if (!text) continue;
    map.set(keyFn(text), {
      verifiable: rec.verifiable !== false,
      type: clip(asString(rec.type), 40),
    });
  }
  for (const item of asArray(nonVerifiableAtoms)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = asString(rec.text).trim();
    if (!text) continue;
    const key = keyFn(text);
    if (!map.has(key)) {
      map.set(key, { verifiable: false, type: clip(asString(rec.type), 40) });
    }
  }
  return map;
}

function readBundle(
  raw: unknown,
  keyFn: (s: string) => string
): {
  searchedKeys: Set<string>;
  /** byAtomKey 里出现过的键（含空列表）：空列表 = 检索过但零命中，仍要拦幻觉 URL。 */
  allowKeys: Set<string>;
  perAtom: Map<string, Array<BundleSource>>;
} {
  const rec = asRecord(raw);
  const searchedKeys = new Set<string>();
  const allowKeys = new Set<string>();
  const perAtom = new Map<string, Array<BundleSource>>();
  if (!rec) return { searchedKeys, allowKeys, perAtom };
  for (const atom of asArray(rec.atomsSearched)) {
    if (typeof atom === "string" && atom.trim()) searchedKeys.add(keyFn(atom));
  }
  const byAtomKey = asRecord(rec.byAtomKey);
  if (byAtomKey) {
    for (const [key, list] of Object.entries(byAtomKey)) {
      allowKeys.add(key);
      const sources = asArray(list)
        .map(asRecord)
        .filter((s): s is Record<string, unknown> => s !== null)
        .map((s): BundleSource => {
          // 复用标记只在真带 knowledge / prior-round 时透传；老快照 / 普通检索来源没有。
          const provenance = reuseProvenanceOf(s.provenance);
          const reusable = Boolean(provenance) && isHttpUrl(asString(s.url).trim());
          const publishedAt = asString(s.publishedAt).trim();
          const publisher = clip(asString(s.publisher), 80);
          const retrievedAt = asString(s.retrievedAt).trim();
          const excerptKind = s.excerptKind === "search-snippet" || s.excerptKind === "page-excerpt" ? s.excerptKind : undefined;
          const fetchStatus =
            s.fetchStatus === "snippet-only" || s.fetchStatus === "fetched" ||
            s.fetchStatus === "truncated" || s.fetchStatus === "restricted" || s.fetchStatus === "failed"
              ? s.fetchStatus : undefined;
          const fetchNote = clip(asString(s.fetchNote), 200);
          return {
            url: asString(s.url).trim(),
            title: clip(asString(s.title), 200),
            snippet: clip(asString(s.snippet), 900),
            ...(reusable && provenance ? { provenance } : {}),
            ...(reusable && asString(s.originDate).trim()
              ? { originDate: clip(asString(s.originDate), 40) }
              : {}),
            ...(publishedAt ? { publishedAt: clip(publishedAt, 40) } : {}),
            ...(publisher ? { publisher } : {}),
            ...(retrievedAt ? { retrievedAt: clip(retrievedAt, 40) } : {}),
            ...(excerptKind ? { excerptKind } : {}),
            ...(fetchStatus ? { fetchStatus } : {}),
            ...(fetchNote ? { fetchNote } : {}),
          };
        })
        .filter((s) => isHttpUrl(s.url));
      if (sources.length > 0) perAtom.set(key, sources);
    }
  }
  return { searchedKeys, allowKeys, perAtom };
}

function readCrossExam(
  raw: unknown,
  keyFn: (s: string) => string
): Map<string, { response: string; status: string }> {
  const rec = asRecord(raw);
  const out = new Map<string, { response: string; status: string }>();
  if (!rec) return out;
  for (const item of asArray(rec.atoms)) {
    const atomRec = asRecord(item);
    if (!atomRec) continue;
    const atom = asString(atomRec.atom).trim();
    if (!atom) continue;
    out.set(keyFn(atom), {
      response: clip(asString(atomRec.response), 300),
      status: asString(atomRec.status),
    });
  }
  return out;
}

function readPursuitHops(
  raw: unknown,
  keyFn: (s: string) => string
): Map<string, { goal: string; missingAfter: string[] }> {
  const out = new Map<string, { goal: string; missingAfter: string[] }>();
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const atom = asString(rec.atom).trim();
    if (!atom) continue;
    const missingAfter = asArray(rec.missingAfter)
      .map((m) => clip(asString(m), 40))
      .filter((m) => m.length > 0);
    if (missingAfter.length === 0) continue;
    out.set(keyFn(atom), {
      goal: clip(asString(rec.goal), 80),
      missingAfter,
    });
  }
  return out;
}

function verdictToJudgment(verdict: string): InvestigationJudgment | null {
  switch (verdict) {
    case "true":
      return "supported";
    case "false":
      return "refuted";
    case "partial":
    case "exaggerated":
      return "mixed";
    case "disputed":
      return "disputed";
    case "unverified":
      return "unresolved";
    default:
      return null;
  }
}

function progressFor(
  phase: InvestigationPhase,
  searched: boolean,
  judged: boolean
): InvestigationProgress {
  if (phase === "complete") return "complete";
  if (phase === "interrupted") return judged ? "complete" : "interrupted";
  if (phase === "received" || phase === "decomposed") return "pending";
  return searched ? "searching" : "pending";
}

/**
 * 构建 InvestigationSnapshotV1。纯函数、确定性；输出先过 schema 校验再返回。
 */
export function buildInvestigationSnapshot(
  input: InvestigationBuildInput,
  options: InvestigationBuildOptions = {}
): InvestigationSnapshotV1 {
  const keyFn = options.claimAtomKeyFn ?? defaultClaimAtomKey;
  const phase = input.phase;
  const originalClaim = input.originalClaim;

  // key 与展示文本分离（#51 复审 blocker）：key 只做 identity join
  // （dedupe / verdict / bundle / type / crossExam / pursuit），会规范化全角空格
  // 并超长截断；text 是 self-proof 后 kept atom 的真实展示文本，不因内部键改写。
  const keptAtoms: Array<{ key: string; text: string }> = [];
  const seenAtom = new Set<string>();
  for (const item of asArray(input.claimAtoms)) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    const key = keyFn(text);
    if (!key || seenAtom.has(key)) continue;
    seenAtom.add(key);
    keptAtoms.push({ key, text });
  }

  const types = readAtomTypes(input.claimAtomTypes, input.nonVerifiableAtoms, keyFn);
  const verdicts = readVerdicts(input.subclaimVerdicts, keyFn);
  const bundle = readBundle(input.atomSearchBundle, keyFn);
  const relationAudits = readRelationAudits(input.sourceRelationAudits, keyFn);
  const crossExamAtoms = readCrossExam(input.crossExam, keyFn);
  const pursuitByAtom = readPursuitHops(input.pursuitHops, keyFn);
  const report = asRecord(input.report);
  const deadUrls = new Set(asArray(input.reachability?.deadUrls).map((u) => asString(u)));
  const verdictDecision = readVerdictDecision(report, keyFn);
  const decidedPartByKey = new Map((verdictDecision?.parts ?? []).map((p) => [p.key, p]));
  // 改版前的报告（模型没给标签、规则表没写标签）不写标签和理由：显示时由 judgment 推出标签，不显示理由。
  const labeled = Boolean(verdictDecision?.label) || [...verdicts.values()].some((v) => v.label);

  // 判词纪律兜底（与生产 demoteUnsourcedTrueFalse 同向）：true/false 无已绑定来源 → unresolved。
  // 先算链接再定判词，所以分两步：先收集每条 claim 的原始来源引用，再统一装配。
  type ClaimAssembly = {
    key: string;
    text: string;
    order: number;
    checkability: InvestigationCheckability;
    support: Array<{ url: string; title: string; snippet: string }>;
    contradict: Array<{ url: string; title: string; snippet: string }>;
    relatedOnly: boolean;
    verdict: VerdictLike | undefined;
  };

  const assemblies: ClaimAssembly[] = keptAtoms.map(({ key, text }, index) => {
    const verdict = verdicts.get(key);
    const info = types.get(key);
    const checkability: InvestigationCheckability =
      info && info.verifiable === false ? "not-applicable" : "checkable";
    const allowed = bundle.perAtom.get(key) ?? (bundle.allowKeys.has(key) ? [] : undefined);
    const inBundle = (list: VerdictSourceLike[]): BundleSource[] => {
      const out: BundleSource[] = [];
      const seen = new Set<string>();
      for (const s of list) {
        const url = normalizeInvestigationSourceUrl(asString(s.url).trim());
        if (!isHttpUrl(url) || seen.has(url)) continue;
        const canonical = allowed?.find((a) => normalizeInvestigationSourceUrl(a.url) === url);
        if (allowed && !canonical) continue; // 幻觉 URL 拦截
        seen.add(url);
        // URL 只证明「模型引用的是本轮拿到的来源」，不能授权模型改写 title/snippet。
        // 有 bundle 时一律用检索层 canonical metadata；旧历史没有 bundle 才回退模型字段。
        out.push(canonical ?? {
          url,
          title: clip(asString(s.title), 200),
          snippet: clip(asString(s.snippet), 900),
        });
      }
      return out;
    };
    const support = verdict ? inBundle(verdict.supportingSources) : [];
    const contradict = verdict ? inBundle(verdict.contradictingSources) : [];
    return {
      key,
      text,
      order: index,
      checkability,
      support,
      contradict,
      relatedOnly: verdict?.sourcesRelatedOnly === true,
      verdict,
    };
  });

  // 来源登记：id 由规范化 URL 确定性派生（#76），与 phase / role / 注册顺序无关。
  // 数组顺序仍是证据位先、检索垫后——只影响 catalog 排列，不决定 identity。
  const sources: InvestigationSource[] = [];
  const sourceIdByUrl = new Map<string, string>();
  // 知识库复用的 URL → 两个新增可选字段。先在 bundle 上收集再登记：
  // 同一 URL 若先被 verdict 来源登记（那份对象没有这两个字段），快照条目也不会丢标记。
  const reuseFieldsByUrl = new Map<string, { provenance: ReuseProvenance; originDate?: string }>();
  for (const list of bundle.perAtom.values()) {
    for (const s of list) {
      if (!s.provenance) continue;
      const key = normalizeInvestigationSourceUrl(s.url);
      if (!key) continue;
      reuseFieldsByUrl.set(key, {
        provenance: s.provenance,
        ...(s.originDate ? { originDate: s.originDate } : {}),
      });
    }
  }
  const reuseFieldsOf = (url: string): { provenance?: ReuseProvenance; originDate?: string } => {
    const meta = reuseFieldsByUrl.get(normalizeInvestigationSourceUrl(url));
    if (!meta) return {};
    return { provenance: meta.provenance, ...(meta.originDate ? { originDate: meta.originDate } : {}) };
  };
  const registerSource = (s: {
    url: string;
    title: string;
    snippet: string;
    publishedAt?: string;
    publisher?: string;
    retrievedAt?: string;
    excerptKind?: "search-snippet" | "page-excerpt";
    fetchStatus?: "snippet-only" | "fetched" | "truncated" | "restricted" | "failed";
    fetchNote?: string;
    material?: "user-intake";
  }): string => {
    const key = normalizeInvestigationSourceUrl(s.url);
    const existing = sourceIdByUrl.get(key);
    if (existing) {
      // 同 URL 先到先得丢信息：这里按材料合并——
      // 真读到正文（page-excerpt）才升级摘录/类型/取得时间；
      // 明确失败的尝试写进 fetchNote（有摘要时状态仍是它的真实口径，不冒充失败）；
      // 检索摘要不回写正文来源，避免摘要顶原文。
      const src = sources.find((item) => item.id === existing);
      if (src) {
        if (!normalizePublishedDate(src.publishedAt) && normalizePublishedDate(s.publishedAt)) src.publishedAt = s.publishedAt;
        if (s.publisher && !src.publisher) src.publisher = s.publisher;
        if (s.material && !src.material) src.material = s.material;
        // fetchNote 状态语义：记录这段来源遇到的限制与抓取尝试历史（追加去重），
        // 不是单值状态——既有失败记录不被后续成功吞掉，已有正文也不因新失败被伪装。
        const appendFetchNote = (existing: string | undefined, note: string | undefined): string | undefined => {
          const trimmed = note?.trim();
          if (!trimmed) return existing;
          if (!existing?.trim()) return trimmed;
          if (existing.includes(trimmed)) return existing;
          return `${existing}；${trimmed}`;
        };
        if (s.excerptKind === "page-excerpt" && src.excerptKind !== "page-excerpt" && s.snippet) {
          src.excerpt = clipExcerpt(s.snippet);
          src.excerptKind = "page-excerpt";
          src.fetchStatus = s.fetchStatus;
          // 既有 fetchNote（例如此前一次抓取失败）标为历史：用户看到
          // 「此前读取失败…本次已取得正文」，不会误当成本次又失败。
          const priorNote = src.fetchNote;
          src.fetchNote = appendFetchNote(
            // 中性标注：priorNote 可能是失败/受限/截断说明，不武断写成「失败」。
            priorNote ? `此前获取记录：${priorNote}；本次已取得正文` : undefined,
            s.fetchNote
          );
          // 取得时间必须与展示的正文出自同一份材料：用本次正文取得时间；
          // scrapedAt 缺失（旧数据/可选字段）则清空显示未知，不沿用检索时刻冒充正文取得时间。
          if (s.retrievedAt) src.retrievedAt = s.retrievedAt;
          else delete src.retrievedAt;
          return existing;
        }
        if (s.fetchStatus === "failed") {
          const note = s.fetchNote || "抓取失败，未能读取正文";
          if (src.excerptKind === "page-excerpt") {
            // 已有正文保留（excerpt/retrievedAt 属于那次成功取得的材料），
            // 但如实记录这次更新的抓取尝试失败，不把旧正文伪装为最新成功。
            src.fetchNote = appendFetchNote(src.fetchNote, `再次抓取失败：${note}`);
          } else {
            src.fetchNote = appendFetchNote(src.fetchNote, note);
            if (!src.fetchStatus) src.fetchStatus = "failed";
          }
        }
      }
      return existing;
    }
    const id = investigationSourceId(key);
    sourceIdByUrl.set(key, id);
    sources.push({
      id,
      url: key,
      title: s.title,
      ...(s.snippet ? { excerpt: clipExcerpt(s.snippet) } : {}),
      ...(s.publishedAt ? { publishedAt: s.publishedAt } : {}),
      ...(s.publisher ? { publisher: s.publisher } : {}),
      ...(s.retrievedAt ? { retrievedAt: s.retrievedAt } : {}),
      ...(s.excerptKind ? { excerptKind: s.excerptKind } : {}),
      ...(s.fetchStatus ? { fetchStatus: s.fetchStatus } : {}),
      ...(s.fetchNote ? { fetchNote: s.fetchNote } : {}),
      ...(s.material ? { material: s.material } : {}),
      ...(deadUrls.has(key) ? { reachable: false } : {}),
      ...reuseFieldsOf(key),
    });
    return id;
  };

  for (const a of assemblies) {
    for (const s of a.support) registerSource(s);
    for (const s of a.contradict) registerSource(s);
  }
  for (const a of assemblies) {
    for (const s of bundle.perAtom.get(a.key) ?? []) registerSource(s);
  }

  // 用户提交的链接材料：既有客户端抓取链路已经读过正文（scrapeStatus/scrapedContent），
  // 登记为来源。真读到正文才标 page-excerpt；同 URL 已有检索摘要来源时升级为正文摘录；
  // 抓取失败保留 failed + 原因（fetchNote），不伪造正文。
  for (const rawLink of asArray(input.intakeLinks)) {
    const link = asRecord(rawLink);
    const url = normalizeInvestigationSourceUrl(asString(link?.url).trim());
    if (!isHttpUrl(url)) continue;
    const hostname = asString(link?.hostname).trim() || url;
    const scrapedAt = link?.scrapedAt;
    const retrievedAt =
      typeof scrapedAt === "number" && Number.isFinite(scrapedAt) && scrapedAt > 0 && scrapedAt < 4e15
        ? new Date(scrapedAt).toISOString()
        : undefined;
    const status = asString(link?.scrapeStatus);
    const content = asString(link?.scrapedContent);
    if (status === "success" && content.trim()) {
      // 真读到正文：标 page-excerpt + material。截断判定与卡片实际展示的
      // 摘录上限（DISPLAY_EXCERPT_MAX）用同一把尺，不再写与实际不符的 1200。
      registerSource({
        url,
        title: hostname,
        snippet: content,
        ...(retrievedAt ? { retrievedAt } : {}),
        publisher: hostname,
        material: "user-intake",
        excerptKind: "page-excerpt",
        fetchStatus: content.length > DISPLAY_EXCERPT_MAX ? "truncated" : "fetched",
        ...(content.length > DISPLAY_EXCERPT_MAX
          ? { fetchNote: `正文共 ${content.length} 字，来源卡只展示开头 ${DISPLAY_EXCERPT_MAX} 字摘录` }
          : {}),
      });
    } else if (status === "error") {
      // 明确抓取失败才标 failed；原因保留进 fetchNote。
      registerSource({
        url,
        title: hostname,
        snippet: "",
        ...(retrievedAt ? { retrievedAt } : {}),
        publisher: hostname,
        material: "user-intake",
        fetchStatus: "failed",
        fetchNote: asString(link?.scrapeError).trim() || "抓取失败，未能读取正文",
      });
    } else {
      // 状态未知/未抓取：登记为用户材料但不标失败，保持获取状态未知。
      registerSource({
        url,
        title: hostname,
        snippet: "",
        ...(retrievedAt ? { retrievedAt } : {}),
        publisher: hostname,
        material: "user-intake",
        ...(status ? { fetchNote: `抓取状态未知（${status}），未取得正文` } : {}),
      });
    }
  }

  // 发布日期只认三处，按顺序：检索方给的 → 网页发布元数据 → URL 里的日期。都没有就不写。
  for (const src of sources) {
    const day =
      normalizePublishedDate(src.publishedAt) ?? input.pageDates?.[src.url] ?? dateFromUrl(src.url);
    if (day) src.publishedAt = day;
    else delete src.publishedAt;
  }

  const conclusionText = asString(report?.conclusion);

  const claims: InvestigationClaim[] = assemblies.map((a) => {
    const verdict = a.verdict;
    const evidence: InvestigationEvidenceLink[] = [];
    const evidenceMeta = (source: BundleSource, role: InvestigationEvidenceLink["role"]) => {
      const url = normalizeInvestigationSourceUrl(source.url);
      const audit = relationAudits.get(`${a.key}\u0000${url}`);
      const passage = passageMeta(a.text, source.snippet);
      const auditMatchesRole =
        audit &&
        ((role === "support" && audit.relation === "support") ||
          (role === "contradict" && audit.relation === "contradict") ||
          (role === "context-only" && (audit.relation === "context-only" || audit.relation === "unverified")));
      return {
        ...passage,
        ...(auditMatchesRole && audit.reason ? { relationReason: audit.reason } : {}),
      };
    };
    if (verdict) {
      const finding = pointFinding(verdict.evidence, conclusionText);
      // 支持位：related-only 的检索填充绝不映射为 support。
      // 同一出处不得同时当支持和反驳。
      // 同一段 finding 只挂到第一条需要它的证据上，不复制到同命题其他出处。
      const seenSourceIds = new Set<string>();
      let findingAttached = false;
      const takeFinding = (): { finding?: string } => {
        if (!finding || findingAttached) return {};
        findingAttached = true;
        return { finding };
      };
      for (const s of a.support) {
        const sourceId = sourceIdByUrl.get(s.url)!;
        const role = a.relatedOnly ? "context-only" : "support";
        seenSourceIds.add(sourceId);
        evidence.push({
          sourceId,
          role,
          ...evidenceMeta(s, role),
          ...((role === "support" || role === "context-only") ? takeFinding() : {}),
          ...reuseFieldsOf(s.url),
        });
      }
      for (const s of a.contradict) {
        const sourceId = sourceIdByUrl.get(s.url)!;
        if (seenSourceIds.has(sourceId)) continue;
        seenSourceIds.add(sourceId);
        evidence.push({
          sourceId,
          role: "contradict",
          ...evidenceMeta(s, "contradict"),
          ...takeFinding(),
          ...reuseFieldsOf(s.url),
        });
      }
      // 已核查命题：检索垫其余来源只是背景材料，不得残留 unassessed。
      // 打不开的链接不是材料，不列出来。
      for (const s of bundle.perAtom.get(a.key) ?? []) {
        if (deadUrls.has(normalizeInvestigationSourceUrl(s.url))) continue;
        if (sourceIdByUrl.get(s.url) && evidence.some((l) => l.sourceId === sourceIdByUrl.get(s.url))) continue;
        evidence.push({
          sourceId: sourceIdByUrl.get(s.url)!,
          role: "context-only",
          ...evidenceMeta(s, "context-only"),
          ...reuseFieldsOf(s.url),
        });
      }
    } else if (bundle.searchedKeys.has(a.key)) {
      // 检索已返回、核查未开始：只能是 unassessed 暂态。
      for (const s of bundle.perAtom.get(a.key) ?? []) {
        evidence.push({
          sourceId: sourceIdByUrl.get(s.url)!,
          role: "unassessed",
          ...evidenceMeta(s, "unassessed"),
          ...reuseFieldsOf(s.url),
        });
      }
    }

    // 判断：not-applicable 即刻成立；判词映射；true/false 无绑定来源按生产规则收敛 unresolved。
    let judgment: InvestigationJudgment | null;
    if (a.checkability === "not-applicable") {
      judgment = "not-applicable";
    } else if (verdict) {
      const mapped = verdictToJudgment(verdict.verdict);
      if (mapped === "supported" && a.support.length === 0) judgment = "unresolved";
      else if (mapped === "refuted" && a.contradict.length === 0) judgment = "unresolved";
      else judgment = mapped;
    } else {
      judgment = null;
    }

    // 标签 + 一句理由（#140）。整句规则表已经定了这一截的标签就用它；调查进行中按判词推出。
    // 标签必须有证据撑着，撑不住降为还查不清；judgment 跟着标签走，两者不矛盾。
    let label: LabelKey | undefined;
    let reason: string | undefined;
    if (!labeled) {
      // 旧报告：保持原样。
    } else if (a.checkability === "not-applicable") {
      label = nonCheckableLabel(types.get(a.key)?.type ?? "");
      reason = FALLBACK_PART_REASON[label];
    } else if (verdict && judgment) {
      const decided = decidedPartByKey.get(a.key);
      if (decided?.label) {
        label = decided.label;
        reason = decided.reason;
      } else {
        const modelLabel = verdict.label;
        label = modelLabel && labelToJudgment(modelLabel) === judgment
          ? modelLabel
          : judgment === "mixed" && verdict.verdict === "exaggerated"
            ? "exaggerated"
            : judgmentToLabel(judgment);
        reason = label === modelLabel ? verdict.reason : undefined;
      }
      const backed = labelBackedByEvidence(
        label,
        evidence.filter((l) => l.role === "support").length,
        evidence.filter((l) => l.role === "contradict").length
      );
      if (backed !== label) {
        label = backed;
        reason = undefined;
      }
      reason = reason || FALLBACK_PART_REASON[label];
      judgment = labelToJudgment(label);
    }

    const gaps: InvestigationGap[] = [];
    const pursuit = pursuitByAtom.get(a.key);
    let consequence: string | undefined;
    if (pursuit) {
      const goalPart = pursuit.goal ? `证据追索以「${pursuit.goal}」为目标补查` : "证据追索已补查";
      consequence = clip(`${goalPart}，仍缺 ${pursuit.missingAfter.join("、")}`, 160);
    }
    const seenGap = new Set<string>();
    for (const g of verdict?.evidenceGaps ?? []) {
      if (seenGap.has(g)) continue;
      seenGap.add(g);
      gaps.push({
        id: `gap-${a.order + 1}-${gaps.length + 1}`,
        claimId: `claim-${a.order + 1}`,
        description: g,
        status: "open",
        ...(consequence && gaps.length === 0 ? { consequence } : {}),
      });
    }
    // 判词没列缺口但证据追索记录了真实 missingAfter：命题还查不清时这是一等缺口，如实立对象。
    // 命题已经判定时，检索流程没补到的槽位（当事方、地点……）不是用户需要的缺口。
    const settled = judgment === "supported" || judgment === "refuted" || judgment === "mixed";
    if (gaps.length === 0 && pursuit && !settled) {
      gaps.push({
        id: `gap-${a.order + 1}-${gaps.length + 1}`,
        claimId: `claim-${a.order + 1}`,
        description: clip(`补查后仍缺：${pursuit.missingAfter.join("、")}`, 160),
        status: "open",
        ...(consequence ? { consequence } : {}),
      });
    }

    const span = originalClaim.indexOf(a.text);
    return {
      id: `claim-${a.order + 1}`,
      text: a.text,
      order: a.order,
      ...(span >= 0 ? { originalSpan: { start: span, end: span + a.text.length } } : {}),
      checkability: a.checkability,
      progress: progressFor(phase, bundle.searchedKeys.has(a.key), judgment !== null),
      judgment,
      ...(label ? { label, reason: reason ?? FALLBACK_PART_REASON[label] } : {}),
      ...(verdict?.boundary ? { boundary: verdict.boundary } : {}),
      evidence,
      gaps,
    };
  });

  // 冲突：只来自真实证据层（同命题支持与反驳来源并存）；crossExam 只补原因线索。
  // assemblies 与 claims 同序同长；判词与质询都按内部 key join，不经过展示文本。
  const conflicts: InvestigationConflict[] = [];
  for (let i = 0; i < keptAtoms.length; i++) {
    const assembly = assemblies[i]!;
    const claim = claims[i]!;
    const supportIds = claim.evidence.filter((l) => l.role === "support").map((l) => l.sourceId);
    const contradictIds = claim.evidence.filter((l) => l.role === "contradict").map((l) => l.sourceId);
    if (supportIds.length === 0 || contradictIds.length === 0) continue;
    const cross = assembly.verdict ? crossExamAtoms.get(assembly.verdict.claimAtom) : undefined;
    const knownReason = cross && cross.status === "answered" && cross.response ? cross.response : "";
    conflicts.push({
      id: `conflict-${claim.order + 1}`,
      claimId: claim.id,
      summary: `同一命题同时存在支持与反驳证据：支持 ${supportIds.length} 条、反驳 ${contradictIds.length} 条`,
      sides: [
        { position: "support", sourceIds: supportIds },
        { position: "contradict", sourceIds: contradictIds },
      ],
      ...(knownReason ? { reason: knownReason } : {}),
      reasonStatus: knownReason ? "known" : "unknown",
      unresolved: true,
    });
  }

  let conclusion: InvestigationSnapshotV1["conclusion"];
  if (phase === "complete" && report) {
    const conclusionText = asString(report.conclusion);
    const directAnswer = clip(conclusionText, 400);
    if (directAnswer) {
      // 一条命题都没拆出来时不能写 not-applicable（那是在断言整句是立场/价值表达）：
      // 无命题只说明证据撑不出判断，按 unresolved 显示，与「还查不清」同义。
      const hasClaim = claims.length > 0;
      const hasCheckable = claims.some((c) => c.checkability !== "not-applicable");
      const checkableClaims = claims.filter((c) => c.checkability !== "not-applicable");
      const hasSettledJudgment = checkableClaims.some(
        (c) => c.judgment === "supported" || c.judgment === "refuted" || c.judgment === "mixed"
      );
      const hasSupported = checkableClaims.some((c) => c.judgment === "supported");
      const hasRefuted = checkableClaims.some((c) => c.judgment === "refuted");
      const overall = asString(report.verdictType).trim().toLowerCase();
      // 报告已由整句规则表（domain/verdict）决定时，徽章直接读结论，不再自行推算；
      // 没有这个标记的历史报告仍走下面的旧推算，保持历史记录显示不变。
      const decidedByRule = Boolean(asRecord(report._verdictDecision));
      const ruleJudgment: InvestigationJudgment | null = !decidedByRule
        ? null
        : overall === "true"
          ? "supported"
          : overall === "false"
            ? "refuted"
            : overall === "mixed_misleading" || overall === "partial"
              ? "mixed"
              : overall === "disputed"
                ? "disputed"
                : "unresolved";
      const overallJudgment: InvestigationJudgment = ruleJudgment && hasCheckable ? ruleJudgment : !hasClaim
        ? "unresolved"
        : !hasCheckable
          ? "not-applicable"
          : !hasSettledJudgment
            ? "unresolved"
            : hasSupported && hasRefuted
              ? "mixed"
              : overall === "true"
                ? "supported"
                : overall === "false"
                  ? "refuted"
                  : overall === "mixed_misleading" || overall === "partial"
                    ? "mixed"
                    : "unresolved";
      const citedUrls = new Set(
        asArray(report.citationSources)
          .map((s) => asRecord(s))
          .filter((s): s is Record<string, unknown> => s !== null)
          .map((s) => asString(s.url).trim())
      );
      // 顶层边界只承载整次调查级边界（causalBoundary）。命题级 boundary 继续在
      // 命题内部展示（ClaimSection），不再同一屏出现第二次。
      const boundaries: string[] = [];
      const causal = clip(asString(report.causalBoundary), 200);
      if (causal) boundaries.push(causal);
      let layers = splitConclusionLayers(conclusionText, originalClaim);
      // 结论第一句 = 整句标签 + 一句理由（#140）。标签单独存，不靠切句子取（切句会把「不属实。」切成一句）。
      let wholeLabel: LabelKey | undefined;
      let wholeReason = "";
      if (verdictDecision?.label) {
        wholeLabel = verdictDecision.label;
        wholeReason = verdictDecision.reason;
        const prefix = `${LABEL_TEXT[verdictDecision.label]}。${verdictDecision.reason}`;
        const textHasLead = Boolean(verdictDecision.reason) && conclusionText.startsWith(prefix);
        // 上面按证据把某一截降成还查不清时，整句按显示出来的标签重新过一遍规则表，结论和各截标签不能矛盾。
        const claimByKey = new Map(assemblies.map((a, i) => [a.key, claims[i]!]));
        const shown = verdictDecision.parts.map((p) => {
          const shownLabel = claimByKey.get(p.key)?.label ?? p.label;
          return shownLabel ? { ...p, label: shownLabel, standing: standingForLabel(shownLabel) } : p;
        });
        if (shown.some((p, i) => p.label !== verdictDecision.parts[i]!.label)) {
          const redo = decideSentenceVerdict(shown);
          const relabel = wholeLabelFor(redo.rule, shown.map((p) => ({ role: p.role, standing: p.standing, label: p.label ?? "unresolved" })));
          if (relabel !== wholeLabel) {
            wholeLabel = relabel;
            wholeReason = `${shown.map((p) => `「${clip(p.text, 40)}」${LABEL_TEXT[p.label ?? "unresolved"]}`).join("；")}。`;
          }
        }
        if (textHasLead) {
          const rest = conclusionText.slice(prefix.length).trim();
          layers = { verdictLead: wholeReason, ...(rest ? { rationale: rest } : {}) };
        } else {
          // 追问改写等把首句换掉了：只给标签，不配一句对不上的理由。
          wholeReason = "";
        }
      }
      const shownJudgment = wholeLabel ? labelToJudgment(wholeLabel) : overallJudgment;
      conclusion = {
        directAnswer,
        ...(layers.verdictLead ? { verdictLead: layers.verdictLead } : {}),
        ...(layers.rationale ? { rationale: layers.rationale } : {}),
        judgment: shownJudgment,
        ...(wholeLabel ? { label: wholeLabel } : {}),
        ...(wholeLabel && wholeReason ? { reason: wholeReason } : {}),
        boundaries,
        claimIds: claims.map((c) => c.id),
        sourceIds: sources.filter((s) => citedUrls.has(s.url)).map((s) => s.id),
      };
    }
  }

  const checkedAt =
    input.checkedAt ?? (report && typeof report.checkedAt === "string" ? report.checkedAt : undefined);

  const preClaimWork =
    phase === "received" && (input.preClaimWork === "checking" || input.preClaimWork === "splitting")
      ? input.preClaimWork
      : undefined;

  return validateInvestigationSnapshot({
    schemaVersion: 1,
    originalClaim,
    phase,
    claims,
    sources,
    conflicts,
    ...(conclusion ? { conclusion } : {}),
    ...(checkedAt ? { checkedAt } : {}),
    ...(preClaimWork ? { preClaimWork } : {}),
    ...(input.scopePlan ? { scope: {
      includedClaimIds: claims.filter((c) => c.evidence.length > 0 || input.scopePlan!.includedAtoms.some((a) => keyFn(a) === keyFn(c.text))).map((c) => c.id),
      deferredClaimIds: claims.filter((c) => c.evidence.length === 0 && !input.scopePlan!.includedAtoms.some((a) => keyFn(a) === keyFn(c.text)) && input.scopePlan!.deferredAtoms.some((a) => keyFn(a) === keyFn(c.text))).map((c) => c.id),
    } } : {}),
  });
}

/**
 * 旧历史报告 → Snapshot 的确定性重建。缺字段表达 unresolved/unknown，
 * 不启动模型或搜索、不伪造新事实；`_source === 'error-boundary'` 重建为 interrupted。
 */
export function rebuildInvestigationFromReport(input: {
  report: unknown;
  claim: string;
  options?: InvestigationBuildOptions;
}): InvestigationSnapshotV1 {
  const report = asRecord(input.report) ?? {};
  const interrupted = report._source === "error-boundary";

  // 命题顺序取 claimItems（含立场条交错）；没有 claimItems 的旧数据回退 subclaimVerdicts + nonVerifiableAtoms。
  let atoms: string[] = [];
  let types: Array<{ text: string; verifiable: boolean; type: string }> = [];
  const claimItems = asArray(report.claimItems);
  if (claimItems.length > 0) {
    for (const item of claimItems) {
      const rec = asRecord(item);
      if (!rec) continue;
      const text = asString(rec.text).trim();
      if (!text) continue;
      atoms.push(text);
      types.push({ text, verifiable: rec.verifiable !== false, type: clip(asString(rec.type), 40) });
    }
  }
  if (atoms.length === 0) {
    for (const v of asArray(report.subclaimVerdicts)) {
      const rec = asRecord(v);
      if (!rec) continue;
      const text = asString(rec.claimAtom).trim();
      if (!text) continue;
      atoms.push(text);
      types.push({ text, verifiable: true, type: "" });
    }
    for (const n of asArray(report.nonVerifiableAtoms)) {
      const rec = asRecord(n);
      if (!rec) continue;
      const text = asString(rec.text).trim();
      if (!text) continue;
      atoms.push(text);
      types.push({ text, verifiable: false, type: clip(asString(rec.type), 40) });
    }
  }

  const pursuitHops = asRecord(report.evidencePursuit)?.hops;

  return buildInvestigationSnapshot(
    {
      originalClaim: input.claim,
      phase: interrupted ? "interrupted" : "complete",
      claimAtoms: atoms,
      claimAtomTypes: types,
      subclaimVerdicts: report.subclaimVerdicts,
      crossExam: report.crossExam,
      pursuitHops,
      report,
    },
    input.options
  );
}
