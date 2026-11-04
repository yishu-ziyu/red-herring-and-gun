/**
 * 整句判定：一份核查报告的 verdictType、徽章、结论首句与正文、判定记录都在这里决定、这里写入。
 *
 * decideAndWriteVerdict 读取报告里各部分的判词 → 交给 domain/verdict 的规则表 → 写回报告。
 * 模型只判每一部分；整句不读模型写的整句字段。其它模块不得再改这些字段
 * （快照读判定记录，见 domain/decision.ts 与 investigation/build.ts）。
 */
import { decideSentenceVerdict, VERDICT_OUTCOME, type PartRole, type PartStanding, type SentencePart } from "../../../shared/domain/verdict.js";
import { attachVerdictRecord, type VerdictRecord } from "../../../shared/domain/decision.js";
import { listAtomsForSearch } from "./atomSearch.js";
import { claimAtomKey } from "../../../shared/claimAtomText.js";
import { hasDirectionalBoundHttpUrl, normalizeReportCitations } from "./citationBinding.js";
import {
  FALLBACK_PART_REASON,
  LABEL_TEXT,
  isLabelKey,
  labelBackedByEvidence,
  nonCheckableLabel,
  partLabelFor,
  wholeLabelFor,
  type LabelKey,
} from "../../../shared/domain/labels.js";
import { scrubReportText } from "./publicCopy.js";
import { buildScopedEvidence } from "./scopedEvidence.js";

type Report = Record<string, unknown>;

/** 一截的显示标签与理由：标签由证据状态定、模型标签细分（domain/labels.partLabelFor）。 */
type AssessedPart = SentencePart & { label: LabelKey; reason: string };

type VerdictInput = {
  /** 用户提交的原话（含追问、链接）。 */
  claim: string;
  claimAtoms: unknown;
  /** 每条含 verifiable / type，拆题标了的还含 role（main / premise / background）。 */
  claimAtomTypes: unknown;
  /** 拆题给出的主次顺序；没标角色时，第一条可核查的是主要主张。 */
  priorityClaimAtoms?: unknown;
  /** 核查模型写的整句理由。 */
  factCheckReason?: unknown;
  /** 核查没有跑完：出错的步骤名（超时为空）。不传表示正常跑完。 */
  incomplete?: string[];
};

function records(value: unknown): Report[] {
  return Array.isArray(value) ? value.filter((v): v is Report => Boolean(v && typeof v === "object")) : [];
}

function findVerdict(report: Report, atom: string): Report | undefined {
  const key = claimAtomKey(atom);
  return records(report.subclaimVerdicts).find((v) => claimAtomKey(String(v.claimAtom ?? "")) === key);
}

/** 被反驳的要素必须是原句里的话（空白不计）；模型自己编的说法不算。 */
function quotesClaim(element: unknown, claimAtom: unknown): boolean {
  const quote = typeof element === "string" ? element.replace(/\s+/g, "") : "";
  const atom = typeof claimAtom === "string" ? claimAtom.replace(/\s+/g, "") : "";
  return quote.length > 0 && atom.includes(quote);
}

/**
 * 判词 → 这一部分的状态。只认方向一致、能点开的出处；
 * 夸大在有对应来源时按部分成立处理；缺少来源时保持未解决。
 */
function standingOf(verdict: Report | undefined): PartStanding {
  if (!verdict) return "unresolved";
  const v = String(verdict.verdict ?? "").trim().toLowerCase();
  const bound = (direction: string) =>
    hasDirectionalBoundHttpUrl({
      verdict: direction,
      supportingSources: verdict.supportingSources,
      contradictingSources: verdict.contradictingSources,
      sourcesRelatedOnly: verdict.sourcesRelatedOnly,
    });
  if (v === "false") return bound("false") ? "refuted" : "unresolved";
  if (v === "true") return bound("true") ? "supported" : "unresolved";
  // 夸大：有一部分道理，按部分成立处理；主要说法夸大时，整句标为「夸大了」。
  // 模型有时把说明夸大的出处放进反驳桶，任一方向有出处都算。
  if (v === "exaggerated") return bound("exaggerated") || bound("partial") ? "partial" : "unresolved";
  if (v === "partial" || v === "mixed" || v === "mixed_misleading") {
    if (!bound(v)) return "unresolved";
    // 部分成立只在有来源明确反驳了原句里某个具体要素（数字、日期、范围、主体、因果关系），并且逐字引出那个要素时才算。
    // 缺少可核对的反驳要素时保留不确定性，不能把模型的部分成立升级为属实。
    const contradicted =
      records(verdict.contradictingSources).length > 0 &&
      verdict.sourcesRelatedOnly !== true &&
      quotesClaim(verdict.contradictedElement, verdict.claimAtom);
    if (contradicted && records(verdict.supportingSources).length > 0) return "partial";
    return "unresolved";
  }
  if (v === "disputed") {
    // 有争议要两边都有能点开的出处；只有一边是没查清（一边的出处撑不起「权威互相矛盾」）。
    return records(verdict.supportingSources).length > 0 &&
      records(verdict.contradictingSources).length > 0 &&
      verdict.sourcesRelatedOnly !== true
      ? "conflicting"
      : "unresolved";
  }
  return "unresolved";
}

const ROLES: Record<string, PartRole> = { main: "main", premise: "premise", background: "background" };

/** 判词里能点开的支持 / 反驳出处各有几条（同一出处不同时算两边）。 */
function sourceCounts(verdict: Report | undefined): { support: number; contradict: number } {
  const urls = (list: unknown) =>
    new Set(records(list).map((s) => String(s.url ?? "").trim()).filter((url) => /^https?:\/\//i.test(url)));
  const support = urls(verdict?.supportingSources);
  const contradict = [...urls(verdict?.contradictingSources)].filter((url) => !support.has(url));
  return { support: support.size, contradict: contradict.length };
}

/** 可核查的部分及其角色。拆题标了角色就用；没标时排序第一条可核查的是主要主张，其余算必要前提。 */
function listAssessedClaims(report: Report, input: VerdictInput): AssessedPart[] {
  const { verifiable } = listAtomsForSearch(input.claimAtoms, input.claimAtomTypes);
  if (verifiable.length === 0) return [];
  const verifiableKeys = new Map(verifiable.map((atom) => [claimAtomKey(atom), atom]));
  const meta = new Map<string, Report>();
  for (const item of records(input.claimAtomTypes)) meta.set(claimAtomKey(String(item.text ?? "")), item);
  const priority = Array.isArray(input.priorityClaimAtoms)
    ? input.priorityClaimAtoms.map((atom) => verifiableKeys.get(claimAtomKey(String(atom)))).find(Boolean)
    : undefined;
  const fallbackMain = priority ?? verifiable[0];
  const declared = verifiable.map((atom) => ROLES[String(meta.get(claimAtomKey(atom))?.role ?? "")]);
  const anyMain = declared.includes("main");
  const standings = verifiable.map((atom) => standingOf(findVerdict(report, atom)));
  return verifiable.map((atom, index) => {
    const role: PartRole = anyMain ? (declared[index] ?? "premise") : atom === fallbackMain ? "main" : (declared[index] ?? "premise");
    const verdict = findVerdict(report, atom);
    const modelLabel = isLabelKey(verdict?.label) ? verdict.label : undefined;
    let standing = standings[index]!;
    let label = partLabelFor(standing, modelLabel);
    const modelReason = typeof verdict?.reason === "string" ? verdict.reason.trim() : "";
    // 代码改了模型的标签时，模型那句理由说的是另一个标签，不能留。
    let reason = label === modelLabel && modelReason ? modelReason : FALLBACK_PART_REASON[label];
    // 标签要有出处撑着；撑不住的退回还查不清，整句规则表按退回之后的状态算。
    const { support, contradict } = sourceCounts(verdict);
    const backed = labelBackedByEvidence(label, support, contradict);
    if (backed !== label) {
      label = backed;
      standing = "unresolved";
      reason = FALLBACK_PART_REASON[label];
    }
    return { text: atom, role, standing, label, reason };
  });
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function partLine(part: AssessedPart): string {
  // 用和这一截标签相同的词，结论和标签不会说成两样。
  return `「${clip(part.text, 40)}」${LABEL_TEXT[part.label]}`;
}

/** 模型有时写成好几句、带内部用语：只留一句（第一句只复述判定时用第二句）；这一句仍带内部用语就不用，改用各截标签拼的句子。 */
const INTERNAL_TERMS = /原子|命题|判定为|判词|整句为|整句是|Agent|模型|置信/;
/** 指这句话的「该命题」直接换成「这句话」，不因为一个指代词丢掉整句理由。 */
const CLAIM_REFERENT = /(?:该|此|这个|这一)命题/g;
/** 只说「这句话成立」的开头句不是理由，理由在下一句。 */
const RESTATED_VERDICT = /^(?:该|这|此)(?:句话?|说法)?的?(?:核心|主要)?(?:事实|内容)?(?:基本)?(?:成立|不成立|属实|不属实|正确|错误)[。！？]?$/;
/** 理由超过这个长度就不是「一句理由」了，读者在结论处读不完。 */
const MAX_REASON_CHARS = 80;
/**
 * 模型写的理由只在三种情况下不用：带内部用语；太长；提到了和整句标签不同的判断词
 * （例：标签「不属实」，理由却说「整句为部分属实」——理由先于标签写出，会和代码定的标签矛盾）。
 */
function firstSentence(text: string, label: LabelKey): string {
  const sentences = (text.replace(CLAIM_REFERENT, "这句话").match(/[^。！？]+[。！？]?/g) ?? []).map((s) => s.trim()).filter(Boolean);
  const first = (RESTATED_VERDICT.test(sentences[0] ?? "") ? sentences[1] : sentences[0]) ?? "";
  if (!first || INTERNAL_TERMS.test(first) || first.length > MAX_REASON_CHARS) return "";
  // 代码内部的标签名和不成对的引号（开头多了「」」）。
  if (/\b(true|false|mostly-true|partly-true|exaggerated|unresolved|uncheckable|disputed|opinion|supported|refuted|mixed)\b/i.test(first)) return "";
  if ((first.match(/「/g) ?? []).length !== (first.match(/」/g) ?? []).length) return "";
  const own = LABEL_TEXT[label];
  const rest = first.split(own).join("");
  if (/部分属实|基本属实|不属实|属实|夸大了|还查不清|无法核对|说法不一|是观点/.test(rest)) return "";
  return /[。！？]$/.test(first) ? first : `${first}。`;
}

/** 核查模型写的整句理由；模型没给或不合格时用各截标签拼一句。 */
function wholeReasonOf(parts: readonly AssessedPart[], label: LabelKey, factCheckReason?: unknown): string {
  // 没有可查的部分就没有搜索，模型那句「目前没有资料」没有根据。
  if (parts.length === 0) return FALLBACK_PART_REASON[label];
  const pick = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const model = firstSentence(pick(factCheckReason), label);
  if (model) return model;
  // 只有一截时，「「X」部分属实」只是把说法和标签重复一遍；用这一截自己的理由。
  const only = parts.length === 1 ? parts[0]! : undefined;
  if (only) {
    const own = firstSentence(only.reason, label);
    if (own) return own;
  }
  if (parts.length > 0) return `${parts.map(partLine).join("；")}。`;
  return FALLBACK_PART_REASON[label];
}

/** 这一部分的判词说明（带能点开出处的 [n]，编号已映射到全局）。没有出处的判词不出文字。 */
function evidenceText(report: Report, part: AssessedPart): string {
  const verdict = findVerdict(report, part.text);
  return verdict ? (buildScopedEvidence([verdict]).texts[0] ?? "") : "";
}

/** 系统流程自己写进缺口的话（不是用户该去核实的东西）。 */
const SYSTEM_GAP = /待补证|独立核验|暂不用来下判断|定向检索|模型未覆盖/;

/** 没查清的部分还缺什么：判词里写的缺口，去掉「待补证」这类占位词。 */
function missingNotes(report: Report, parts: readonly AssessedPart[]): string[] {
  const notes: string[] = [];
  for (const part of parts) {
    if (part.standing !== "unresolved") continue;
    const gaps = records([findVerdict(report, part.text)]).flatMap((v) => (Array.isArray(v.evidenceGaps) ? v.evidenceGaps : []));
    for (const gap of gaps) {
      const text = typeof gap === "string" ? gap.trim() : "";
      if (text && !SYSTEM_GAP.test(text) && !notes.includes(text)) notes.push(text);
    }
  }
  return notes.slice(0, 2);
}

const DECISIVE_FIRST: Record<PartStanding, number> = { refuted: 0, conflicting: 1, partial: 2, supported: 3, unresolved: 4 };

/**
 * 结论正文：首句回答（由规则表的结论定）→ 逐部分的状态（多于一部分时）→ 各部分的判词说明 →
 * 立场型与仍缺的依据。正文里的每一句都从各部分的状态与判词来，不读模型写的整句文字。
 */
function renderConclusion(
  report: Report,
  parts: readonly AssessedPart[],
  whole: { label: LabelKey; reason: string },
  unresolved: boolean
) {
  // 结论第一句 = 整句标签 + 一句理由。
  const lead = `${LABEL_TEXT[whole.label]}。${whole.reason}`;
  const stance = records(report.nonVerifiableAtoms)
    .map((atom) => String(atom.text ?? "").trim())
    .filter(Boolean)
    .slice(0, 2);

  const partsLine = parts.length > 1 ? `${parts.map(partLine).join("；")}。` : "";
  // 理由已经逐截列过时不再列第二遍。
  const enumerated = whole.reason.startsWith(partsLine) ? "" : partsLine;
  const ordered = [...parts].sort((a, b) => DECISIVE_FIRST[a.standing] - DECISIVE_FIRST[b.standing]);
  // 判断被代码撤销的部分，模型的判词说明也不再成立。
  const shown = ordered
    .filter((part) => part.reason !== FALLBACK_PART_REASON[part.label])
    .map((part) => evidenceText(report, part))
    .filter(Boolean)
    .slice(0, 2);

  const body = [lead, enumerated, ...shown];
  for (const text of stance) body.push(`「${clip(text, 40)}」不适用真假判断，未计入真假结论。`);
  if (unresolved) {
    for (const note of missingNotes(report, parts)) body.push(`还缺：${clip(note, 100)}。`);
  }

  const summary = [lead, enumerated];
  if (stance.length > 0) summary.push(`${stance.length}条表述不适用真假判断，未计入结论。`);
  return {
    conclusion: body.join("").slice(0, 480),
    summaryForPublic: summary.join("").slice(0, 200),
    recommendation: lead,
  };
}

/** 只贴了链接、没有其它要查的文字。 */
function looksLikeUrlOnlyClaim(claim: string): boolean {
  const raw = String(claim ?? "").trim();
  if (!raw) return false;
  const t = raw.replace(/^请核查链接内容：/, "").trim();
  return t.replace(/https?:\/\/[^\s]+/gi, "").replace(/\s+/g, "").length === 0;
}

const UNOPENED_LINK_NOTICE = "链接打不开（可能需要登录），已按你输入的文字继续";
const UNOPENED_LINK_ANSWER = "链接打不开（可能需要登录），没法从链接里读到要查的说法。";

/**
 * 核查没有跑完是运行事件，不是「查过了但材料不够」：标记沿用 error-boundary
 * （重建 / 列表 / 复核都把这份报告按中断处理），结论换成未完成的真实说明。
 */
function writeIncomplete(report: Report, failedSteps: string[]): void {
  report._source = "error-boundary";
  if (failedSteps.length > 0) report.incompleteSteps = failedSteps;
  report.conclusion = "本次核查没能完成，判断还没写成。已找到的公开材料保留在来源里，可以重新调查。";
  report.summaryForPublic = "本次核查没能完成，判断还没写成。";
  report.recommendation = "本次核查没能完成，请重新调查后再看判断。";
}

/**
 * 下整句结论并写回报告：verdictType、徽章、结论 / 摘要 / 建议、判定记录。
 * 在此之前报告里不该有这些字段；在此之后任何模块都只读不改。
 *
 * 拆题没拆出命题且原话只是打不开的链接时，结论说明链接打不开；核查没跑完时（incomplete）说明没完成。
 * 两种都只换文字，规则表的结论与记录照旧。
 */
export function decideAndWriteVerdict(report: Report, input: VerdictInput): VerdictRecord {
  scrubReportText(report);
  const parts = listAssessedClaims(report, input);
  const decision = decideSentenceVerdict(parts);
  const outcome = VERDICT_OUTCOME[decision.verdict];
  const label = wholeLabelFor(
    decision.rule,
    parts,
    records(report.nonVerifiableAtoms).map((atom) => nonCheckableLabel(String(atom.type ?? "")))
  );
  // 模型的整句理由写在来源审核之前；有哪一点的判断被代码撤销，这句就可能说着已经没有依据的话。
  const overruled = parts.some((p) => p.reason === FALLBACK_PART_REASON[p.label] || findVerdict(report, p.text)?.demotedFrom || findVerdict(report, p.text)?.reversedFrom);
  const reason = wholeReasonOf(parts, label, overruled ? undefined : input.factCheckReason);

  report.verdictType = outcome.verdictType;
  report.faceVerdict = outcome.badge;
  Object.assign(report, renderConclusion(report, parts, { label, reason }, decision.verdict === "not-enough-evidence"));
  normalizeReportCitations(report);
  const noAtoms = !Array.isArray(input.claimAtoms) || input.claimAtoms.length === 0;
  if (noAtoms && looksLikeUrlOnlyClaim(input.claim)) {
    report.conclusion = UNOPENED_LINK_ANSWER;
    report.summaryForPublic = UNOPENED_LINK_ANSWER;
    report.recommendation = UNOPENED_LINK_ANSWER;
    report.causalBoundary = UNOPENED_LINK_NOTICE;
  }
  if (input.incomplete) writeIncomplete(report, input.incomplete);

  const record: VerdictRecord = {
    verdict: decision.verdict,
    rule: decision.rule,
    label,
    reason,
    parts: parts.map((p) => ({ ...p })),
  };
  attachVerdictRecord(report, record);
  return record;
}
