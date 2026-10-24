/**
 * factDeskPostProcess.ts — 报告骨架里「可说 / 不可说 / 难查原因」的卫生处理。
 *
 * 1. 基础设施报错（额度、超时、HTTP 错误）不进公开文案
 * 2. 去掉夸张口吻和元标签
 * 3. canSay / cannotSay / whyHardToVerify 保持诚实且不空，不凭空补来源或事实
 *
 * 结论、摘要、建议和徽章不在这里写，由 sentenceVerdict 决定。
 */

const INFRASTRUCTURE_ERROR_PATTERNS = [
  /providers? failed/i,
  /API error/i,
  /quota\s+(?:exceeded|limit|exhausted)|(?:exceeded|insufficient)\s+quota/i,
  /credits?\s+(?:limit|exhausted|exceeded)|insufficient\s+credits?/i,
  /timeout|time out/i,
  /Error:|Exception/i,
  /\b(?:4\d\d|5\d\d)\b.*https?:\/\/\S+\/(?:v\d+|api)\b/i,
  /https?:\/\/\S+\/(?:v\d+|api)\b.*\b(?:4\d\d|5\d\d)\b/i,
  /调用失败|调用异常|超时/i,
  /invalid api key/i,
  /insufficient balance/i,
];

const PUBLIC_REPORT_FALLBACK_REASON = "最终写作服务暂时不可用，系统已改用保守兜底报告。";

/** 基础设施报错（额度、超时、HTTP 错误）不进公开文案，整句换成兜底说明。 */
function sanitizePublicReportText(value: string): string {
  const text = value.trim();
  if (!text) return "";
  return INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(text)) ? PUBLIC_REPORT_FALLBACK_REASON : text;
}

const BANNED_DRAMA =
  /纯属捏造|纯属子虚乌有|令人啼笑皆非|令人啼笑|可笑至极|震惊全网|铁证如山|毋庸置疑|智慧的网友|作为AI|作为人工智能|速来围观|当帮凶|广大网友务必/g;

const META_LABELS = /【可说】|【不可说】|（可说）|（不可说）/g;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean);
}

function unique(items: string[], max = 12): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

function stripDrama(text: string, notes: string[], label: string): string {
  if (!text) return text;
  BANNED_DRAMA.lastIndex = 0;
  if (!BANNED_DRAMA.test(text) && !META_LABELS.test(text)) return text;
  notes.push(`${label}: stripped drama/meta labels`);
  BANNED_DRAMA.lastIndex = 0;
  return text
    .replace(BANNED_DRAMA, "")
    .replace(META_LABELS, "")
    .replace(/纯属[^。]{0,12}/g, "现有证据不支持")
    .replace(/，{2,}/g, "，")
    .replace(/。{2,}/g, "。")
    .replace(/\s+/g, " ")
    .trim();
}

/** 原地清洗报告骨架里的 canSay / cannotSay / whyHardToVerify。 */
export function applyFactDeskPostProcessToReport(finalReport: unknown): void {
  const report = asRecord(finalReport);
  if (!report) return;

  const notes: string[] = [];

  for (const key of ["whyHardToVerify", "canSay", "cannotSay"] as const) {
    const arr = asStringArray(report[key]);
    if (arr.length === 0) continue;
    const sanitized = arr.map(sanitizePublicReportText);
    if (JSON.stringify(sanitized) !== JSON.stringify(arr)) notes.push(`${key}: infra array sanitized`);
    report[key] = sanitized;
  }

  let canSay = unique(asStringArray(report.canSay), 8).map((s) =>
    stripDrama(s, notes, "canSay"),
  );
  let cannotSay = unique(asStringArray(report.cannotSay), 10).map((s) =>
    stripDrama(s, notes, "cannotSay"),
  );

  // Drop canSay items that duplicate cannotSay
  const cannotSet = new Set(cannotSay.map((s) => s.replace(/\s+/g, "")));
  canSay = canSay.filter((s) => !cannotSet.has(s.replace(/\s+/g, "")));

  if (cannotSay.length === 0) {
    cannotSay = ["不能在证据不足时把原说法写成已证实事实。"];
    notes.push("cannotSay: filled default boundary");
  }

  if (canSay.length === 0) {
    canSay = ["仅能复述已核对到的公开材料，不能扩展原说法强度。"];
    notes.push("canSay: filled default cautious allow");
  }

  // whyHardToVerify: strip drama, keep 2–4
  let whyHard = unique(asStringArray(report.whyHardToVerify), 4).map((s) =>
    stripDrama(s, notes, "whyHardToVerify"),
  );
  if (whyHard.length === 0) {
    whyHard = ["原说法可能压缩了多个可核查判断", "公开材料与原强度之间仍有缺口"];
    notes.push("whyHardToVerify: filled defaults");
  }

  report.canSay = canSay;
  report.cannotSay = cannotSay;
  report.whyHardToVerify = whyHard;
  report._factDeskPostProcess = {
    applied: true,
    notes,
    version: "A+F-2026-07-10",
  };
}
