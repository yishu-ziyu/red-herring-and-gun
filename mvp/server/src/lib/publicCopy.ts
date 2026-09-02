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
  /ReportComposer|FactChecker|RumorDetector|SourceValidator|CrossExaminer|AlternativeExplanationSearcher|AgentRuntime|search360|atomSearches|MiniMax-M3|MiniMax|Mimic|StepFun|Tavily|AnySearch|Metaso|function calling|Function Calling|工具调用|智能体|LangChain|CrewAI|\bADK\b|\bAgent\b|360 AI Search|canSay|cannotSay|web_search|web_fetch|todo_write|submit_verdict|investigator/gi;

const FORWARD_RE = /先别转发|建议转发|转不转|二次传播|再传播|勿传播/;
const ESSAY_OPEN_RE = /^(截至目前|总的来说|值得注意的是|众所周知|在当今|综上所述)/;
const ADVICE_RE = /建议你|请你务必|你应该|应当转发/;

export function faceWord(verdictType: unknown): (typeof FACE_WORDS)[number] {
  const key = typeof verdictType === "string" ? verdictType.trim() : "";
  return FACE_BY_TYPE[key] || "还查不清";
}

export function looksLikeResearchMemo(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (/^#{1,3}\s/m.test(t)) return true;
  if (/^\|.+\|/m.test(t)) return true;
  if (/^REFERENCES\b/im.test(t)) return true;
  const paras = t.split(/\n\s*\n/).filter((p) => p.trim()).length;
  return paras >= 3 && t.length > 280;
}

const FACE_ALT = "只能信一部分|还查不清|不能信|这次没查完|能信";
const FACE_TOKEN = `(?:\\*\\*)?(?:${FACE_ALT})[。．.]?(?:\\*\\*)?[。．.]?[ \\t]*`;
const FACE_LEAD_RE = new RegExp(`^${FACE_TOKEN}`);
const FACE_AFTER_CORE_RE = new RegExp(`(##\\s*核心结论\\s*\\n+)${FACE_TOKEN}`);

export function startsWithFace(text: string): boolean {
  return Boolean(leadingFaceWord(text));
}

export function leadingFaceWord(text: string): (typeof FACE_WORDS)[number] | undefined {
  let t = (text ?? "").trim();
  const core = t.match(/##\s*核心结论\s*\n+([\s\S]*)/);
  if (core) t = core[1].trim();
  t = t.replace(/^\*\*/, "");
  for (const word of ["只能信一部分", "还查不清", "不能信", "能信"] as const) {
    if (t.startsWith(word)) return word;
  }
  return undefined;
}

export function stripFaceStamp(text: string): string {
  if (!text) return "";
  let t = text.trim();
  t = t.replace(FACE_AFTER_CORE_RE, "$1");
  t = t.replace(FACE_LEAD_RE, "");
  return t.trim();
}

function isFaceOnly(text: string): boolean {
  const t = text.trim().replace(/^\*\*/, "").replace(/\*\*$/, "").replace(/[。．.]$/, "");
  return (FACE_WORDS as readonly string[]).includes(t) || t === "这次没查完";
}

/** User-facing fallback when the model left no real answer. Not the four-word stamp. */
export function directAnswer(verdictType: unknown): string {
  switch (faceWord(verdictType)) {
    case "能信":
      return "公开材料撑得住这条说法。";
    case "不能信":
      return "公开材料不支持这条说法。";
    case "只能信一部分":
      return "这条说法要拆开看，不能整句当真。";
    default:
      return "公开材料还撑不住判断。";
  }
}

export function scrubPublicText(value: unknown): string {
  if (typeof value !== "string") return "";
  let text = value.replace(JARGON_RE, "");
  text = text.replace(/[ \t]{2,}/g, " ");
  text = text.replace(/[，、]{2,}/g, "，");
  text = text.replace(/\s+([。！？，、])/g, "$1");
  return text.trim();
}

/** Keep newlines so a research memo does not collapse into a slogan card. */
export function scrubMemoText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .split("\n")
    .map((line) =>
      line
        .replace(JARGON_RE, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\s+$/g, "")
    )
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function coreSectionBody(memo: string): string {
  const m = memo.match(/##\s*核心结论\s*\n+([\s\S]*?)(?=\n## |\nREFERENCES\b|$)/i);
  return (m?.[1] ?? "").trim();
}

function insertCoreLede(memo: string, lede: string): string {
  const bold = lede.startsWith("**") ? lede : `**${lede}**`;
  if (/##\s*核心结论/.test(memo)) {
    return memo.replace(/(##\s*核心结论\s*\n+)/, `$1${bold} `);
  }
  return `${bold}\n\n${memo}`;
}

export function ensureMemoFace(text: string, verdictType: unknown): string {
  const originalFace = leadingFaceWord(text);
  const body = stripFaceStamp(scrubMemoText(text));
  const answer = directAnswer(verdictType);
  if (!body) return `**${answer}**`;
  const expected = faceWord(verdictType);
  const core = /##\s*核心结论/.test(body) ? coreSectionBody(body) : body;
  if (!core || isFaceOnly(core)) {
    return /##\s*核心结论/.test(body) ? insertCoreLede(body, answer) : `**${answer}**`;
  }
  if (originalFace && originalFace !== expected) {
    return insertCoreLede(body, answer);
  }
  return body;
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？])/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** 2–5 short sentences. First answers the claim. No essay openers, no advice, no four-word stamp. */
export function shapeConclusion(text: string, verdictType: unknown): string {
  const led = leadWithFace(text, verdictType);
  const kept: string[] = [];
  for (const sentence of splitSentences(led)) {
    if (ESSAY_OPEN_RE.test(sentence) || ADVICE_RE.test(sentence)) continue;
    if (isFaceOnly(sentence)) continue;
    kept.push(sentence);
    if (kept.length >= 5) break;
  }
  if (kept.length === 0) return directAnswer(verdictType);
  return kept.slice(0, 5).join("");
}

export function leadWithFace(text: string, verdictType: unknown): string {
  const body = scrubPublicText(text);
  const originalFace = leadingFaceWord(body);
  const stripped = stripFaceStamp(body);
  const expected = faceWord(verdictType);
  if (!stripped || isFaceOnly(stripped)) return directAnswer(verdictType);
  if (originalFace && originalFace !== expected) return `${directAnswer(verdictType)}${stripped}`;
  return stripped;
}

export function constrainRecommendation(text: unknown, verdictType: unknown): string {
  const body = scrubPublicText(text);
  if (!body || FORWARD_RE.test(body)) return directAnswer(verdictType);
  const stripped = stripFaceStamp(body);
  if (!stripped || isFaceOnly(stripped)) return directAnswer(verdictType);
  return stripped;
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
    // sourceRefs 只保留可跳转的外部 URL；内部 Agent 角色名（RumorDetector 等）一律不下发
    const refs = Array.isArray(rec.sourceRefs) ? rec.sourceRefs : [];
    const sourceRefs = refs.filter((s) => {
      if (typeof s !== "string" || !s.trim()) return false;
      if (/^https?:\/\//i.test(s.trim())) return true;
      return !INTERNAL_SOURCE_REF_WORDS.some((w) => s.includes(w));
    });
    return {
      ...rec,
      finding: scrubPublicText(rec.finding) || rec.finding,
      evidence: scrubPublicText(rec.evidence) || rec.evidence,
      boundary: scrubPublicText(rec.boundary) || rec.boundary,
      sourceRefs,
    };
  });
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
  const rawConclusion = String(report.conclusion ?? "");
  if (looksLikeResearchMemo(rawConclusion)) {
    report.conclusion = ensureMemoFace(rawConclusion, verdictType);
  } else {
    report.conclusion = shapeConclusion(rawConclusion, verdictType);
  }
  const rawSummary = String(report.summaryForPublic ?? "");
  if (looksLikeResearchMemo(rawSummary)) {
    report.summaryForPublic = ensureMemoFace(rawSummary, verdictType);
  } else {
    report.summaryForPublic = shapeConclusion(rawSummary, verdictType);
  }
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
