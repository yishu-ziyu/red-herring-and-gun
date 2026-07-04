/**
 * sanitizeReport - strip infrastructure-error fragments from report-style text.
 *
 * Background (2026-07-04, v3-byo-key plan Wave 1):
 *   The cannotSay stream in pipeline output (and downstream evidence_clue UI)
 *   leaks upstream infrastructure failures (API quota exhaustion, timeouts,
 *   stack traces, internal URLs). This module filters those fragments out of
 *   user-facing text while keeping the raw drops available for dev debugging.
 *
 * Design rules:
 *   - Whitelist-style: a line stays UNLESS one of INFRA_PATTERNS matches.
 *   - "验证失败" / "进一步核查仍未通过" / etc. are legitimate Chinese phrases
 *     and must NOT be dropped. The 调用失败 pattern requires the literal
 *     substring "调用失败|调用异常|超时" to avoid false positives.
 *   - Drops + warnings are kept for internal use; the public consumer should
 *     use `allowed`/`blocked` only.
 */

const INFRA_PATTERNS: ReadonlyArray<{ pattern: RegExp; label: string }> = [
  { pattern: /\bexceeded?\b/i, label: "exceed" },
  { pattern: /\bquota\b/i, label: "quota" },
  { pattern: /\bcredits?\b/i, label: "credits" },
  { pattern: /(调用失败|调用异常|超时)/, label: "调用失败/调用异常/超时" },
  { pattern: /\btime[\s-]?out\b/i, label: "timeout" },
  { pattern: /\bapi[\s_-]?error\b/i, label: "api error" },
  { pattern: /^\s*Error:/, label: "Error:" },
  { pattern: /^\s*Exception/, label: "Exception" },
  { pattern: /[\u{1F300}-\u{1FAFF}]/u, label: "emoji" },
  { pattern: /(localhost|127\.|10\.\d{1,3}\.)/, label: "internal host" },
  { pattern: /\b(http|https):\/\/[^\s]+\/(api|v1)\b/i, label: "internal API URL" },
];

export interface SanitizedReport {
  allowed: string[];
  blocked: string[];
  warnings: string[];
  drops: string[];
}

export function sanitizeReport(input: { allowed: string[]; blocked: string[] }): SanitizedReport {
  const allowedOut: string[] = [];
  const blockedOut: string[] = [];
  const warnings: string[] = [];
  const drops: string[] = [];

  const filter = (items: string[], target: string[]): void => {
    for (const item of items) {
      const matched = INFRA_PATTERNS.find((p) => p.pattern.test(item));
      if (matched) {
        warnings.push(`dropped(${matched.label}): ${item}`);
        drops.push(item);
      } else {
        target.push(item);
      }
    }
  };

  filter(input.allowed, allowedOut);
  filter(input.blocked, blockedOut);

  return {
    allowed: allowedOut,
    blocked: blockedOut,
    warnings,
    drops,
  };
}