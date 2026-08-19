/**
 * User-facing copy constraints (Ch.5 tool use, our form).
 * Retrieval is the tool. The user only sees judgment, problem, source.
 * No tool names, no agent names, no forwarding advice.
 */

export const FACE_WORDS = ["能信", "不能信", "只能信一部分", "还查不清"] as const;

const FACE_BY_TYPE: Record<string, (typeof FACE_WORDS)[number]> = {
  true: "能信",
  false: "不能信",
  mixed_misleading: "只能信一部分",
  partial: "只能信一部分",
  unverified: "还查不清",
};

/** Internal roles, vendors, schemas — never on the result page. */
const JARGON_RE =
  /ReportComposer|FactChecker|RumorDetector|SourceValidator|CrossExaminer|AlternativeExplanationSearcher|AgentRuntime|search360|atomSearches|MiniMax-M3|MiniMax|Mimic|StepFun|Tavily|AnySearch|Metaso|function calling|Function Calling|工具调用|智能体|LangChain|CrewAI|\bADK\b|\bAgent\b|360 AI Search|canSay|cannotSay/gi;

const FORWARD_RE = /先别转发|建议转发|转不转|二次传播|再传播|勿传播/;
const ESSAY_OPEN_RE = /^(截至目前|总的来说|值得注意的是|众所周知|在当今|综上所述)/;
const ADVICE_RE = /建议你|请你务必|你应该|应当转发/;

export function faceWord(verdictType: unknown): (typeof FACE_WORDS)[number] {
  const key = typeof verdictType === "string" ? verdictType.trim() : "";
  return FACE_BY_TYPE[key] || "还查不清";
}

export function startsWithFace(text: string): boolean {
  return FACE_WORDS.some((word) => text.startsWith(word));
}

export function scrubPublicText(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.replace(JARGON_RE, "");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/[，、]{2,}/g, "，");
  text = text.replace(/\s+([。！？，、])/g, "$1");
  return text.trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 2–5 short sentences. First is the judgment. No essay openers, no advice. */
export function shapeConclusion(text: string, verdictType: unknown): string {
  const led = leadWithFace(text, verdictType);
  const kept: string[] = [];
  for (const sentence of splitSentences(led)) {
    if (ESSAY_OPEN_RE.test(sentence) || ADVICE_RE.test(sentence)) continue;
    kept.push(sentence);
    if (kept.length >= 5) break;
  }
  if (kept.length === 0) return `${faceWord(verdictType)}。`;
  if (!startsWithFace(kept[0] ?? "")) {
    kept.unshift(`${faceWord(verdictType)}。`);
  }
  return kept.slice(0, 5).join("");
}

export function leadWithFace(text: string, verdictType: unknown): string {
  const face = faceWord(verdictType);
  const body = scrubPublicText(text);
  if (!body) return `${face}。`;
  if (startsWithFace(body)) return body;
  return `${face}。${body}`;
}

export function constrainRecommendation(text: unknown, verdictType: unknown): string {
  const face = faceWord(verdictType);
  const body = scrubPublicText(text);
  if (!body || FORWARD_RE.test(body)) return `${face}。`;
  if (startsWithFace(body)) return body;
  return `${face}。${body}`;
}

function scrubStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((item) => scrubPublicText(item))
    .filter((item) => item.length > 0)
    .slice(0, 8);
}

function scrubChain(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item) => {
    if (!item || typeof item !== "object") return item;
    const rec = item as Record<string, unknown>;
    return {
      ...rec,
      finding: scrubPublicText(rec.finding) || rec.finding,
      evidence: scrubPublicText(rec.evidence) || rec.evidence,
      boundary: scrubPublicText(rec.boundary) || rec.boundary,
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
      evidence: scrubPublicText(rec.evidence) || rec.evidence,
      boundary: scrubPublicText(rec.boundary) || rec.boundary,
    };
  });
}

/**
 * Constrain user-visible report fields. Mutates the report.
 * Does not change verdictType, URLs, or scores.
 */
export function applyPublicCopy(report: Record<string, unknown>): void {
  if (!report || typeof report !== "object") return;
  const verdictType = report.verdictType;
  report.conclusion = shapeConclusion(String(report.conclusion ?? ""), verdictType);
  report.summaryForPublic = shapeConclusion(String(report.summaryForPublic ?? ""), verdictType);
  report.recommendation = constrainRecommendation(report.recommendation, verdictType);
  report.faceVerdict = faceWord(verdictType);

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
