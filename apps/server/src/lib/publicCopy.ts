/**
 * User-facing copy constraints (Ch.5 tool use, our form).
 * Retrieval is the tool. The user only sees judgment, problem, source.
 * No tool names, no agent names, no forwarding advice.
 */
import {
  INTERNAL_SENTENCE_RE,
  SCHEMA_WORD_RE,
  SCHEMA_ZH_RE,
  SOURCE_ALIAS_RE,
  TRUNCATED_LATIN_BEFORE_QUOTE_RE,
} from "../../../shared/scrubFace.js";

/** Internal roles, vendors, schemas — never on the result page. */
const JARGON_RE =
  /wholeClaimAudit|whole_claim_auditor|WholeClaimAudit|wholeClaimAuditPlan|ReportComposer|FactChecker|RumorDetector|SourceValidator|CrossExaminer|AlternativeExplanationSearcher|AgentRuntime|webSearch|atomSearches|MiniMax-M3|MiniMax|Mimic|StepFun|Tavily|AnySearch|Metaso|function calling|Function Calling|工具调用|智能体|LangChain|CrewAI|\bADK\b|\bAgent\b|360 AI Search|canSay|cannotSay|web_search|web_fetch|todo_write|submit_verdict|investigator/gi;

function dropInternalSentences(text: string): string {
  return text
    .split(/(?<=[。！？；\n])/)
    .filter((part) => !INTERNAL_SENTENCE_RE.test(part))
    .join("");
}

/** 模糊量词 — 来源里的具体数字不得被改写成这些词。 */
const FUZZY_QUANTIFIER_RE = /很多|大量|许多|不少|众多/;

/** 检测模糊量词，返回命中的词（确定性闸上报用）。 */
export function findFuzzyQuantifiers(text: string): string[] {
  const matches = (text ?? "").match(new RegExp(FUZZY_QUANTIFIER_RE.source, "g"));
  return matches ? Array.from(new Set(matches)) : [];
}

function stripSourceAliases(text: string): string {
  if (!text) return "";
  return text
    .replace(SOURCE_ALIAS_RE, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([。！？，、；：])/g, "$1")
    .replace(/^[，、；：\s]+/gm, "")
    .replace(/[，、]{2,}/g, "，")
    .trim();
}

function scrubPublicText(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = dropInternalSentences(value);
  text = text.replace(JARGON_RE, "");
  text = text.replace(SCHEMA_ZH_RE, "");
  text = text.replace(SCHEMA_WORD_RE, "");
  text = stripSourceAliases(text);
  text = text.replace(TRUNCATED_LATIN_BEFORE_QUOTE_RE, "");
  text = text.replace(/「{2,}/g, "「");
  text = text.replace(/」{2,}/g, "」");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/[，、]{2,}/g, "，");
  text = text.replace(/\s+([。！？，、])/g, "$1");
  return text.trim();
}

function scrubStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => scrubPublicText(item))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

const INTERNAL_SOURCE_REF_WORDS: string[] = [
  "RumorDetector",
  "FactChecker",
  "SourceValidator",
  "ReportComposer",
  "CrossExaminer",
  "AlternativeExplanationSearcher",
  "AgentRuntime",
  "FallbackReport",
];

function scrubChain(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!item || typeof item !== "object") return item;
    const rec = item as Record<string, unknown>;
    // sourceRefs 只保留可跳转的外部 URL；内部 Agent 角色名（RumorDetector 等）一律不下发
    const refs = Array.isArray(rec.sourceRefs) ? rec.sourceRefs : [];
    const sourceRefs = refs.filter((s) => {
      if (typeof s !== "string" || !s.trim()) return false;
      if (/^https?:\/\//i.test(s.trim())) return true;
      return !INTERNAL_SOURCE_REF_WORDS.some((w) => s.includes(w));
    });
    return {
      ...rec,
      finding: scrubPublicText(rec.finding),
      evidence: scrubPublicText(rec.evidence),
      boundary: scrubPublicText(rec.boundary),
      sourceRefs,
    };
  });
}

function scrubVerdicts(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!item || typeof item !== "object") return item;
    const rec = item as Record<string, unknown>;
    return {
      ...rec,
      evidence: scrubPublicText(rec.evidence),
      boundary: scrubPublicText(rec.boundary),
    };
  });
}

/**
 * 清洗报告里模型和检索写出来的文字（判词说明、证据链、可说 / 不可说、难查原因），内部角色名、供应商名、
 * 字段名一律去掉。原地改。结论首句和正文由 sentenceVerdict 用这些清洗过的文字拼成，不再过第二遍。
 */
export function scrubReportText(report: Record<string, unknown>): void {
  const canSay = scrubStringArray(report.canSay);
  if (canSay) report.canSay = canSay;
  const cannotSay = scrubStringArray(report.cannotSay);
  if (cannotSay) report.cannotSay = cannotSay;

  report.evidenceChain = scrubChain(report.evidenceChain);
  report.subclaimVerdicts = scrubVerdicts(report.subclaimVerdicts);

  if (Array.isArray(report.whyHardToVerify)) {
    report.whyHardToVerify = report.whyHardToVerify.map((item) =>
      typeof item === "string" ? scrubPublicText(item) : item
    );
  }
}
