/**
 * 用例：给一份核查报告下整句结论。
 *
 * 读取报告里各部分的证据 → 交给 domain/verdict 的规则表 → 把结论、首句、正文写回报告。
 * 这是整句判定的唯一决定点：模型只判每一部分，整句的 verdictType、结论首句、徽章类型、
 * 正文说明都由这一个结果推出（快照读 verdictType，见 investigation/build.ts）。
 */
import { decideSentenceVerdict, type PartRole, type PartStanding, type SentencePart, type SentenceVerdict } from "../domain/verdict.js";
import { listAtomsForSearch } from "./atomSearch.js";
import { claimAtomKey } from "./claimAtom/index.js";
import { hasDirectionalBoundHttpUrl } from "./citationBinding.js";
import {
  FALLBACK_PART_REASON,
  LABEL_TEXT,
  isLabelKey,
  nonCheckableLabel,
  partLabelFor,
  wholeLabelFor,
  type LabelKey,
} from "../domain/labels.js";
import { buildScopedEvidence, clipSentence } from "./wholeClaimAudit/scopedEvidence.js";

type Report = Record<string, unknown>;

/** 一截的显示标签与理由：标签由证据状态定、模型标签细分（domain/labels.partLabelFor）。 */
export type AssessedPart = SentencePart & { label?: LabelKey; reason?: string };

export type SentenceVerdictInput = {
  claimAtoms: unknown;
  /** 每条含 verifiable / type，拆题标了的还含 role（main / premise / background）与 issuer（原句在说发文机关或出处）。 */
  claimAtomTypes: unknown;
  /** 拆题给出的主次顺序；没标角色时，第一条可核查的是主要主张。 */
  priorityClaimAtoms?: unknown;
};

/** verdictType 是报告与快照共用的字段名；这里是规则表结论到它的唯一映射。 */
export const VERDICT_TYPE: Record<SentenceVerdict, string> = {
  "cannot-believe": "false",
  "can-believe": "true",
  "part-true-part-false": "mixed_misleading",
  "partly-holds": "partial",
  "not-enough-evidence": "unverified",
  disputed: "disputed",
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
 * 夸大（评分规则 2：把个别现象说成普遍）按被反驳算，属实的一截在正文里另说。
 */
export function standingOf(verdict: Report | undefined): PartStanding {
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
  // 夸大：有一部分道理，按部分成立处理（#140：主要说法夸大 → 整句「夸大了」，不是「不属实」）。
  // 模型有时把说明夸大的出处放进反驳桶，任一方向有出处都算。
  if (v === "exaggerated") return bound("exaggerated") || bound("partial") ? "partial" : "unresolved";
  if (v === "partial" || v === "mixed" || v === "mixed_misleading") {
    if (!bound(v)) return "unresolved";
    // 部分成立只在有来源明确反驳了原句里某个具体要素（数字、日期、范围、主体、因果关系），并且逐字引出那个要素时才算。
    // 用词不精确、缺细节、来源补充的适用条件（仅境内航班、需办手续、从某日起）、只是「不是 100%」都不反驳原句：
    // 命题按日常意思成立（基准 v1：只有支持、没有反驳的真话被判成有真有假 / 部分成立）。
    const contradicted =
      records(verdict.contradictingSources).length > 0 &&
      verdict.sourcesRelatedOnly !== true &&
      quotesClaim(verdict.contradictedElement, verdict.claimAtom);
    if (contradicted) return "partial";
    return records(verdict.supportingSources).length > 0 ? "supported" : "unresolved";
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

/** 可核查的部分及其角色。拆题标了角色就用；没标时排序第一条可核查的是主要主张，其余算必要前提。 */
export function listAssessedClaims(report: Report, input: SentenceVerdictInput): AssessedPart[] {
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
  const issuers = verifiable.map((atom) => meta.get(claimAtomKey(atom))?.issuer === true);
  // 出处说错只有在另有内容被证实时才算「内容属实」（domain/verdict 同一条规则）。
  const contentTrue = standings.some((standing, i) => standing === "supported" && !issuers[i]);
  return verifiable.map((atom, index) => {
    const standing = standings[index]!;
    const role: PartRole = anyMain ? (declared[index] ?? "premise") : atom === fallbackMain ? "main" : (declared[index] ?? "premise");
    const verdict = findVerdict(report, atom);
    const modelLabel = isLabelKey(verdict?.label) ? verdict.label : undefined;
    const label = partLabelFor(standing, modelLabel);
    const modelReason = typeof verdict?.reason === "string" ? verdict.reason.trim() : "";
    // 代码改了模型的标签时，模型那句理由说的是另一个标签，不能留。
    const reason = label === modelLabel && modelReason ? modelReason : FALLBACK_PART_REASON[label];
    return {
      text: atom,
      role,
      standing,
      label,
      reason,
      ...(contentTrue && issuers[index] && standing === "refuted" ? { issuerMisattributed: true } : {}),
    };
  });
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function partLine(part: AssessedPart): string {
  const quoted = `「${clip(part.text, 40)}」`;
  if (part.issuerMisattributed) return `${quoted}的内容属实，只是原句把发文机关或出处说错了`;
  // 用和这一截标签相同的词，结论和标签不会说成两样。
  return `${quoted}${LABEL_TEXT[part.label ?? partLabelFor(part.standing, undefined)]}`;
}

/** 立场 / 预测条目（不可查）的标签，供「没有可核查部分」时定整句标签。 */
function nonCheckableLabels(report: Report, nonVerifiableAtoms: unknown): LabelKey[] {
  return records(nonVerifiableAtoms ?? report.nonVerifiableAtoms).map((atom) => nonCheckableLabel(String(atom.type ?? "")));
}

/** 模型有时写成好几句、带内部用语：只留第一句；第一句仍带内部用语就不用，改用各截标签拼的句子。 */
const INTERNAL_TERMS = /原子|命题|判定为|判词|整句为|整句是|Agent|模型|置信/;
/** 理由超过这个长度就不是「一句理由」了，读者在结论处读不完。 */
const MAX_REASON_CHARS = 80;
/**
 * 模型写的理由只在三种情况下不用：带内部用语；太长；提到了和整句标签不同的判断词
 * （例：标签「不属实」，理由却说「整句为部分属实」——理由先于标签写出，会和代码定的标签矛盾）。
 */
function firstSentence(text: string, label: LabelKey): string {
  const first = (text.match(/^[^。！？]*[。！？]?/)?.[0] ?? "").trim();
  if (!first || INTERNAL_TERMS.test(first) || first.length > MAX_REASON_CHARS) return "";
  const own = LABEL_TEXT[label];
  const rest = first.split(own).join("");
  if (/部分属实|基本属实|不属实|属实|夸大|还查不清|无法核对|说法不一|是观点/.test(rest)) return "";
  return /[。！？]$/.test(first) ? first : `${first}。`;
}

/** 模型写的整句理由；没有时（确定性报告、模型没给）用各截标签拼一句。 */
function wholeReasonOf(report: Report, parts: readonly AssessedPart[], label: LabelKey, factCheckReason?: unknown): string {
  // 报告写作那一步的理由优先；时间不够跳过报告写作时，用核查那一步写的理由（两步都是模型写的）。
  const pick = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "");
  const model = firstSentence(pick(report.verdictReason), label) || firstSentence(pick(factCheckReason), label);
  if (model) return model;
  if (parts.length > 0) return `${parts.map(partLine).join("；")}。`;
  return FALLBACK_PART_REASON[label];
}

/** 这一部分的判词说明（带能点开出处的 [n]，编号已映射到全局）。没有出处的判词不出文字。 */
function evidenceText(report: Report, part: AssessedPart): string {
  const verdict = findVerdict(report, part.text);
  return verdict ? (buildScopedEvidence([verdict]).texts[0] ?? "") : "";
}

/** 系统流程自己写进缺口的话（不是用户该去核实的东西）。 */
const SYSTEM_GAP = /待补证|独立核验|定向检索|模型未覆盖/;

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
  verdictType: string,
  parts: readonly AssessedPart[],
  context: { nonVerifiableAtoms?: unknown; auditUnresolvedGaps?: readonly string[] },
  whole: { label: LabelKey; reason: string }
) {
  // 结论第一句 = 整句标签 + 一句理由（#140）。
  const lead = `${LABEL_TEXT[whole.label]}。${whole.reason}`;
  const stance = records(context.nonVerifiableAtoms ?? report.nonVerifiableAtoms)
    .map((atom) => String(atom.text ?? "").trim())
    .filter(Boolean)
    .slice(0, 2);

  const partsLine = parts.length > 1 ? `${parts.map(partLine).join("；")}。` : "";
  // 理由已经逐截列过时不再列第二遍。
  const enumerated = whole.reason.startsWith(partsLine) ? "" : partsLine;
  // 出处说错的那一处一定要写出来：答案得说清实际是谁（评分规则 1）。
  const ordered = [...parts].sort(
    (a, b) => Number(Boolean(b.issuerMisattributed)) - Number(Boolean(a.issuerMisattributed)) || DECISIVE_FIRST[a.standing] - DECISIVE_FIRST[b.standing]
  );
  const evidence = ordered.map((part) => evidenceText(report, part)).filter(Boolean);
  const shown = evidence.slice(0, parts.some((p) => p.issuerMisattributed) ? 3 : 2);

  const body = [lead, enumerated, ...shown];
  for (const text of stance) body.push(`「${clip(text, 40)}」不适用真假判断，未计入真假结论。`);
  if (verdictType === "unverified") {
    for (const note of missingNotes(report, parts)) body.push(`还缺：${clip(note, 100)}。`);
    const gap = (context.auditUnresolvedGaps ?? []).find((g) => typeof g === "string" && g.trim());
    if (gap) body.push(`仍缺关键依据：${clip(gap, 100)}`);
  }
  report.conclusion = body.join("").slice(0, 480);

  const summary = [lead, enumerated];
  if (stance.length > 0) summary.push(`${stance.length}条表述不适用真假判断，未计入结论。`);
  report.summaryForPublic = summary.join("").slice(0, 200);
  report.recommendation = lead;
}

/** 下整句结论并写回报告。返回规则表的决定，供调用方记录。 */
export function applySentenceVerdict(
  report: Report,
  parts: AssessedPart[],
  context: { nonVerifiableAtoms?: unknown; auditUnresolvedGaps?: readonly string[]; factCheckReason?: unknown } = {}
) {
  const decision = decideSentenceVerdict(parts);
  const before = String(report.verdictType ?? "");
  const verdictType = VERDICT_TYPE[decision.verdict];
  report.verdictType = verdictType;
  const label = wholeLabelFor(
    decision.rule,
    parts.map((p) => ({ role: p.role, standing: p.standing, label: p.label ?? partLabelFor(p.standing, undefined) })),
    nonCheckableLabels(report, context.nonVerifiableAtoms)
  );
  const reason = wholeReasonOf(report, parts, label, context.factCheckReason);
  report._verdictDecision = {
    verdict: decision.verdict,
    rule: decision.rule,
    from: before,
    label,
    reason,
    parts: parts.map((p) => ({
      text: p.text,
      role: p.role,
      standing: p.standing,
      ...(p.label ? { label: p.label } : {}),
      ...(p.reason ? { reason: p.reason } : {}),
      ...(p.issuerMisattributed ? { issuerMisattributed: true } : {}),
    })),
  };
  renderConclusion(report, verdictType, parts, context, { label, reason });
  return decision;
}
