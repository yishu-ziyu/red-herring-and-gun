const INFRASTRUCTURE_ERROR_PATTERNS = [
  /ReportComposer/i,
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

export const PUBLIC_REPORT_FALLBACK_REASON = "最终写作服务暂时不可用，系统已改用保守兜底报告。";

export function sanitizePublicReportText(value: string, replacement = PUBLIC_REPORT_FALLBACK_REASON): string {
  const text = value.trim();
  if (!text) return "";
  return INFRASTRUCTURE_ERROR_PATTERNS.some((pattern) => pattern.test(text)) ? replacement : text;
}

export function sanitizePublicReportArray(values: string[], replacement = PUBLIC_REPORT_FALLBACK_REASON): string[] {
  return values.map((value) => sanitizePublicReportText(value, replacement));
}
