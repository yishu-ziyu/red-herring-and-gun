/**
 * 快照里的结论、各点判断和依据怎么显示（结果页和分享页同一口径）。
 * 两页只渲染这里的输出，不各自再推一遍；分享页只用中文。
 */
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSnapshotV1, InvestigationSource } from "./schema.js";
import { judgmentToLabel, labelText, type LabelKey } from "../domain/labels.js";
import { materialPassageLabel, materialReadTag, materialRetrievedLabel, type MaterialReadLevel } from "./material.js";
import { quoteLinkUrl } from "./quote.js";
import { normalizePublishedDate } from "./sourceDate.js";
import { conclusionMissesFollowUp, displayFollowUpClaim, followUpQuestionLead } from "../followUp.js";
import { scrubFaceText } from "../scrubFace.js";

export type PresentLang = "zh" | "en";

const ZH = {
  role: { support: "支持", contradict: "反驳", unassessed: "尚未核对", "context-only": "相关材料" } as Record<InvestigationEvidenceLink["role"], string>,
  checkability: {
    checkable: "",
    "not-applicable": "立场或价值表达，不适用真假判断",
    "trace-only": "只能追查这个说法的出处",
  } as Record<InvestigationClaim["checkability"], string>,
  provenance: { "prior-round": "来自上一轮", knowledge: "来自历史材料" } as Record<"prior-round" | "knowledge", string>,
  publishedUnknown: "发布日期不详",
  noDecisive: "没有找到直接支持或反驳这一点的依据。",
  related: (n: number) => `另有 ${n} 条相关材料，未用于判断`,
  viewContext: "查看上下文",
  noPassage: "这条依据没有保存可检查的上下文。",
  snippetTag: "搜索摘要",
  summaryTag: "概括",
  deadLink: "链接已失效",
  cannotInfer: "不能推出",
  boundaries: "必要边界",
  fetchNote: (note: string) => `正文读取情况：${note}`,
  notCovered: (names: string) => `本次未核查${names}，结论不涉及这部分。`,
  listJoin: "、",
  linkUnreachableVerdict: "链接无法打开（可能需要登录），没能读到要核实的说法。",
  checkedAt: (day: string) => `核查于 ${day}`,
  brief: {
    claim: "原句：",
    verdict: "判断：",
    boundaries: "必要边界：",
    claimBoundary: (text: string, boundary: string) => `关于「${text}」：不能推出${boundary}`,
    scope: "核查范围：",
    deferred: "。本轮未覆盖：",
    checked: "核查日期：",
    sources: "关键来源：",
    noSources: "关键来源：这次没有可用的来源链接",
  },
};

const EN: typeof ZH = {
  role: { support: "Supports", contradict: "Contradicts", unassessed: "Not yet assessed", "context-only": "Related" },
  checkability: {
    checkable: "",
    "not-applicable": "A stance or value judgment; true or false doesn't apply",
    "trace-only": "Only the origin of this claim can be traced",
  },
  provenance: { "prior-round": "From the previous round", knowledge: "From earlier material" },
  publishedUnknown: "Publish date unknown",
  noDecisive: "No source was found that directly supports or contradicts this point.",
  related: (n: number) => `${n} more related ${n === 1 ? "source" : "sources"}, not used for the verdict`,
  viewContext: "Show context",
  noPassage: "No context was saved for this source.",
  snippetTag: "Search snippet",
  summaryTag: "Summary",
  deadLink: "Link no longer works",
  cannotInfer: "Doesn't show",
  boundaries: "Limits",
  fetchNote: (note: string) => `Page reading: ${note}`,
  notCovered: (names: string) => `This check did not cover ${names}; the verdict doesn't address it.`,
  listJoin: ", ",
  linkUnreachableVerdict: "The link can't be opened (it may need a sign-in), so there is no claim to check from it.",
  checkedAt: (day: string) => `Checked ${day}`,
  brief: {
    claim: "Claim: ",
    verdict: "Verdict: ",
    boundaries: "Limits: ",
    claimBoundary: (text: string, boundary: string) => `On “${text}”: doesn't show ${boundary}`,
    scope: "Scope: ",
    deferred: ". Not covered: ",
    checked: "Checked: ",
    sources: "Key sources:",
    noSources: "Key sources: no usable source links this time",
  },
};

export type ResultWording = typeof ZH;

export function resultWording(lang: PresentLang = "zh"): ResultWording {
  return lang === "en" ? EN : ZH;
}

/** 日期统一写成北京时间的 2026-10-23；读不出就返回空串。 */
export function formatDay(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const time = typeof value === "number" ? value : Date.parse(value);
  if (!Number.isFinite(time)) return "";
  return new Date(time + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 来源发布日期 YYYY-MM-DD；老快照里的原样日期也按同一规则读，读不出就是 null。不拿取得时间顶替。 */
export function publishedDay(source: Pick<InvestigationSource, "publishedAt"> | undefined): string | null {
  return normalizePublishedDate(source?.publishedAt) ?? null;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** 用户输入去掉 URL 之后没有别的字：只贴了链接。 */
export function isUrlOnlyClaim(text: string): boolean {
  const raw = String(text ?? "").trim();
  if (!raw) return false;
  const t = raw.replace(/^请核查链接内容：/, "").trim();
  const leftover = t.replace(/https?:\/\/[^\s]+/gi, "").replace(/\s+/g, "");
  return leftover.length === 0;
}

/** 这一点显示的标签：快照带了就用；改版前的快照只有 judgment，按它推出（此时没有理由）。 */
export function claimLabel(claim: Pick<InvestigationClaim, "label" | "judgment">): LabelKey | null {
  if (claim.label) return claim.label;
  return claim.judgment ? judgmentToLabel(claim.judgment) : null;
}

export function claimReason(claim: Pick<InvestigationClaim, "reason" | "checkability">, lang: PresentLang = "zh"): string {
  return claim.reason?.trim() || (claim.checkability !== "checkable" ? resultWording(lang).checkability[claim.checkability] : "");
}

function claimBoundary(claim: Pick<InvestigationClaim, "boundary">): string {
  return claim.boundary?.trim().replace(/^不能推出[：:]?/, "") ?? "";
}

export type PresentedConclusion = {
  label: LabelKey;
  /** 结论第一句（标签后面那句）。 */
  lead: string;
  /** 这一句是不是模型写的理由；追问改写、链接打不开时的替换句、改版前的快照都不是。 */
  hasReason: boolean;
  rationale: string;
  boundaries: string[];
  /** 原句里没进本次核查的部分，必须明说。 */
  notCovered: string;
  checkedDay: string;
};

export function presentConclusion(
  snapshot: InvestigationSnapshotV1,
  { linkUnreachable = false, lang = "zh" }: { linkUnreachable?: boolean; lang?: PresentLang } = {}
): PresentedConclusion | null {
  const conclusion = snapshot.conclusion;
  if (!conclusion) return null;
  const complete = snapshot.phase === "complete";
  const intakeLinkFailed = snapshot.sources.some((source) => source.material === "user-intake" && source.fetchStatus === "failed");
  const unopened =
    complete &&
    snapshot.claims.length === 0 &&
    (linkUnreachable || intakeLinkFailed || isUrlOnlyClaim(snapshot.originalClaim));
  const rewrite =
    complete && conclusionMissesFollowUp(conclusion.verdictLead || conclusion.directAnswer, snapshot.originalClaim)
      ? followUpQuestionLead(displayFollowUpClaim(snapshot.originalClaim), conclusion.judgment)
      : "";
  const raw = unopened
    ? resultWording(lang).linkUnreachableVerdict
    : rewrite || (conclusion.verdictLead?.trim() ? conclusion.verdictLead : conclusion.directAnswer);
  return {
    label: conclusion.label ?? judgmentToLabel(conclusion.judgment),
    lead: scrubFaceText(raw) || raw,
    hasReason: Boolean(conclusion.reason) && !rewrite && !unopened,
    rationale: conclusion.verdictLead?.trim() ? scrubFaceText(conclusion.rationale?.trim() ?? "") : "",
    boundaries: conclusion.boundaries.map((text) => text.trim()).filter(Boolean),
    notCovered: notCoveredNote(snapshot, lang),
    checkedDay: formatDay(snapshot.checkedAt),
  };
}

/** 完成后要显示的各点：检索名额没覆盖、模型没写出判词的空壳不列，它们进「本次未核查」。 */
export function shownClaims(snapshot: InvestigationSnapshotV1): InvestigationClaim[] {
  return snapshot.phase === "complete" && snapshot.conclusion
    ? snapshot.claims.filter((claim) => !isEmptyShellClaim(claim))
    : snapshot.claims;
}

export type PresentedEvidence = {
  role: InvestigationEvidenceLink["role"];
  roleText: string;
  sourceId: string;
  materialKind: string;
  /** page = 网页原话，加引号；snippet = 搜索摘要，可能被搜索引擎改写过；summary = 我们的概括。 */
  quote: { kind: "page" | "snippet" | "summary"; text: string } | null;
  href: string;
  linkText: string;
  published: string | null;
  read: { text: string; level: MaterialReadLevel };
  passage: string;
  passageNote: string;
  dead: boolean;
  provenance: { kind: "prior-round" | "knowledge"; text: string; originDate: string } | null;
  finding: string;
};

export function presentEvidence(link: InvestigationEvidenceLink, source: InvestigationSource, lang: PresentLang = "zh"): PresentedEvidence {
  const w = resultWording(lang);
  // 引文只保证出自这条依据实际取得的文字；摘要不能冒充网页正文。
  const quote = link.quote?.trim() ?? "";
  const summary = quote ? "" : link.relationReason?.trim() ?? "";
  const href = source.url ? quoteLinkUrl(source.url, link.excerptKind === "page-excerpt" ? quote : "") : "";
  const name = source.publisher?.trim() || (source.url ? domainOf(source.url) : "") || source.title?.trim() || source.id;
  const provenance = link.provenance ?? source.provenance;
  return {
    role: link.role,
    roleText: w.role[link.role],
    sourceId: source.id,
    materialKind: link.excerptKind ?? "unknown",
    quote: quote
      ? { kind: link.excerptKind === "page-excerpt" ? "page" : "snippet", text: quote }
      : summary
        ? { kind: "summary", text: summary }
        : null,
    href,
    linkText: href ? source.title?.trim() || name : name,
    published: publishedDay(source),
    read: materialReadTag(link, source),
    passage: link.passage?.trim() ?? "",
    passageNote: [
      materialPassageLabel(link.excerptKind),
      source.fetchNote ? w.fetchNote(source.fetchNote) : "",
      materialRetrievedLabel(source.retrievedAt),
    ].filter(Boolean).join("；"),
    dead: source.reachable === false,
    provenance: provenance
      ? { kind: provenance, text: w.provenance[provenance], originDate: (link.originDate || source.originDate || "").trim() }
      : null,
    finding: scrubFaceText(link.finding?.trim() ?? ""),
  };
}

export type PresentedClaim = {
  text: string;
  label: LabelKey | null;
  reason: string;
  /** 理由是模型写的（不是按性质补的说明）。 */
  reasonFromModel: boolean;
  boundary: string;
  /** 支持或反驳这一点的依据。 */
  decisive: PresentedEvidence[];
  /** 其余相关材料，每个来源只列一次，已作依据的来源不再列。 */
  related: PresentedEvidence[];
};

export function presentClaim(
  claim: Pick<InvestigationClaim, "text" | "label" | "judgment" | "reason" | "boundary" | "checkability" | "evidence">,
  sources: readonly InvestigationSource[],
  lang: PresentLang = "zh"
): PresentedClaim {
  const sourceOf = (link: InvestigationEvidenceLink) => sources.find((s) => s.id === link.sourceId);
  const decisive = claim.evidence.filter((link) => (link.role === "contradict" || link.role === "support") && sourceOf(link));
  const decisiveIds = new Set(decisive.map((link) => link.sourceId));
  const seen = new Set<string>();
  const related = claim.evidence.filter((link) => {
    if (link.role === "contradict" || link.role === "support") return false;
    if (decisiveIds.has(link.sourceId) || seen.has(link.sourceId) || !sourceOf(link)) return false;
    seen.add(link.sourceId);
    return true;
  });
  return {
    text: claim.text,
    label: claimLabel(claim),
    reason: claimReason(claim, lang),
    reasonFromModel: Boolean(claim.reason),
    boundary: claimBoundary(claim),
    decisive: decisive.map((link) => presentEvidence(link, sourceOf(link)!, lang)),
    related: related.map((link) => presentEvidence(link, sourceOf(link)!, lang)),
  };
}

/** 复制出去的文字版：原句、判断、边界、核查范围、日期、真实来源 URL。产品署名不是证据。 */
export function conclusionBrief(
  snapshot: InvestigationSnapshotV1,
  conclusion: PresentedConclusion,
  claims: readonly InvestigationClaim[],
  lang: PresentLang = "zh"
): string {
  const w = resultWording(lang).brief;
  const claim = displayFollowUpClaim(snapshot.originalClaim);
  const textsOf = (ids: readonly string[]) => snapshot.claims.filter((c) => ids.includes(c.id)).map((c) => c.text).join("；");
  const scope = snapshot.scope;
  const coverage = scope
    ? `${w.scope}${textsOf(scope.includedClaimIds)}${scope.deferredClaimIds.length ? `${w.deferred}${textsOf(scope.deferredClaimIds)}` : ""}`
    : "";
  const urls = (snapshot.conclusion?.sourceIds.length
    ? snapshot.conclusion.sourceIds.map((id) => snapshot.sources.find((source) => source.id === id)?.url)
    : snapshot.sources.map((source) => source.url)
  ).map((url) => url?.trim()).filter((url): url is string => Boolean(url));
  const checked = formatDay(snapshot.checkedAt);
  return [
    claim ? `${w.claim}${claim}` : "",
    `${w.verdict}${labelText(conclusion.label, lang)}。${conclusion.lead}`,
    conclusion.boundaries.length ? `${w.boundaries}${conclusion.boundaries.join("；")}` : "",
    ...claims.map((c) => ({ text: c.text, boundary: claimBoundary(c) })).filter((c) => c.boundary).map((c) => w.claimBoundary(c.text, c.boundary)),
    coverage,
    checked ? `${w.checked}${checked}` : "",
    urls.length ? `${w.sources}\n${urls.join("\n")}` : w.noSources,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// ── 本次未核查的部分 ──
// 快照生成时（build.ts）算好存进 scope.notCoveredTexts；没有这个字段的老快照按同一规则现算。

const BUDGET_GAP = "检索预算未覆盖";
const MODEL_UNCOVERED = "模型未覆盖";

/**
 * 完成态空壳：检索名额没覆盖、或模型没写出判词的命题。
 * 查过但没材料的「证据不足」卡不是空壳，必须留下。
 */
export function isEmptyShellClaim(claim: Pick<InvestigationClaim, "checkability" | "evidence" | "gaps" | "boundary" | "judgment">): boolean {
  if (claim.checkability !== "checkable") return false;
  if (claim.evidence.length > 0) return false;
  if (claim.gaps.some((gap) => gap.description.includes(BUDGET_GAP)) || (claim.boundary ?? "").includes(MODEL_UNCOVERED)) return true;
  return claim.judgment === null || claim.judgment === "not-applicable";
}

/** 只在完成或中断后说；进行中还没查到的不算「未核查」。 */
export function notCoveredOf(snapshot: InvestigationSnapshotV1): string[] {
  if (snapshot.phase !== "complete" && snapshot.phase !== "interrupted") return [];
  return snapshot.scope?.notCoveredTexts ?? notCoveredTexts(snapshot.originalClaim, snapshot.claims);
}

export function notCoveredNote(snapshot: InvestigationSnapshotV1, lang: PresentLang = "zh"): string {
  return notCoveredSentence(notCoveredOf(snapshot), lang);
}

/** 一句「尚缺」：这些没查，所以结论没拿它们。不出现检索预算 / 模型未覆盖这类内部说法。 */
export function notCoveredSentence(texts: readonly string[], lang: PresentLang = "zh"): string {
  if (texts.length === 0) return "";
  const w = resultWording(lang);
  return w.notCovered(texts.map((text) => `「${clipText(text)}」`).join(w.listJoin));
}

function clipText(text: string, max = 72): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 空壳命题 + 原句里没被命题盖住的分句。 */
export function notCoveredTexts(
  originalClaim: string,
  claims: ReadonlyArray<Pick<InvestigationClaim, "text" | "checkability" | "evidence" | "gaps" | "boundary" | "judgment">>
): string[] {
  const shells = claims.filter(isEmptyShellClaim).map((claim) => claim.text.trim()).filter(Boolean);
  return mergeLeftover([...shells, ...uncoveredOriginalClauses(originalClaim, claims.map((claim) => claim.text))]);
}

const SENTENCE_SPLIT = /[。！？；!?;\n]+/;
const CLAUSE_COMMA = /[，,、]/;

function compactText(text: string): string {
  return text.replace(/\s+/g, "").replace(/[“”"「」『』'']/g, "");
}

/**
 * 用户对前一句的确认/质疑语气，不是新的事实主张。
 * 这些片段可以表达「请核实上一句」，但不能被当成独立命题。
 */
function isMetaQuestionFragment(text: string): boolean {
  const compact = compactText(text)
    .replace(/[？?！!。；;，,、]+$/g, "")
    .trim();
  if (!compact) return true;
  return /^(?:(?:这|这个|该|这个说法|该说法))?(?:真的假的|是真的吗|真的(?:吗|么|嘛)|是吗|对吗|没错吗|靠谱吗|可信(?:吗|么)|可靠吗|属实吗)$/.test(compact);
}

function sentencesOf(originalClaim: string): string[] {
  return originalClaim
    .split(SENTENCE_SPLIT)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 4 && !isMetaQuestionFragment(part));
}

function commaParts(sentence: string): string[] {
  return sentence
    .split(CLAUSE_COMMA)
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length >= 4);
}

function longestCommonLen(a: string, b: string): number {
  const n = a.length;
  const m = b.length;
  let best = 0;
  let prev = new Array<number>(m + 1).fill(0);
  let curr = new Array<number>(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        if (curr[j] > best) best = curr[j];
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  return best;
}

function covers(claimText: string, clause: string): boolean {
  const claim = compactText(claimText);
  const piece = compactText(clause);
  if (!claim || !piece) return false;
  if (claim.includes(piece) || piece.includes(claim)) return true;
  const shorter = Math.min(claim.length, piece.length);
  const need = Math.min(shorter, Math.max(4, Math.ceil(shorter * 0.45)));
  return longestCommonLen(claim, piece) >= need;
}

const FUNCTION_CHARS = new Set("的了是在和与及会能可被将就都也还又而且或把对为从".split(""));

/**
 * 命题常改写原句措辞（「常穿黑色内衣易患癌」→「频繁穿着黑色内衣会提高患癌概率」），
 * 连续片段会断开。原句这一段的实词有六成出现在命题里，就算这段被查过。
 */
function paraphraseCovers(claimTexts: string[], clause: string): boolean {
  const pool = new Set(compactText(claimTexts.join("")).split(""));
  const chars = compactText(clause)
    .split("")
    .filter((ch) => /[\p{Script=Han}A-Za-z0-9]/u.test(ch) && !FUNCTION_CHARS.has(ch));
  if (chars.length === 0) return true;
  return chars.filter((ch) => pool.has(ch)).length / chars.length >= 0.6;
}

/** 原句里有、命题列表盖不住的句子。整句都没盖住就整句留下；只有半句被盖住才按逗号拆开。 */
function uncoveredOriginalClauses(originalClaim: string, claimTexts: string[]): string[] {
  const texts = claimTexts.map((text) => text.trim()).filter(Boolean);
  const leftover: string[] = [];
  const isCovered = (clause: string) => texts.some((text) => covers(text, clause)) || paraphraseCovers(texts, clause);
  for (const sentence of sentencesOf(originalClaim)) {
    const parts = commaParts(sentence);
    const uncoveredParts = parts.filter((part) => !isCovered(part));
    // 先看逗号分句：半句被盖住就只留下没盖住的半句，避免整句因前半句 LCS 被当成已覆盖。
    if (parts.length > 1) {
      if (uncoveredParts.length === 0) continue;
      leftover.push(...(uncoveredParts.length < parts.length ? uncoveredParts : [sentence]));
      continue;
    }
    if (!isCovered(sentence)) leftover.push(sentence);
  }
  return leftover;
}

function mergeLeftover(parts: string[]): string[] {
  const out: string[] = [];
  for (const part of parts) {
    const text = part.trim();
    if (!text || isMetaQuestionFragment(text)) continue;
    if (out.some((existing) => covers(existing, text) || covers(text, existing))) continue;
    out.push(text);
  }
  return out;
}
