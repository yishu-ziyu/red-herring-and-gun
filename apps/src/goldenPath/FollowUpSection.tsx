/**
 * FollowUpSection — 调查结论后的探索与追问入口（全栈闭环）。
 * 针对当前结论提供高频追问建议胶囊、自由追问输入框以及操作按钮组。
 */
import { useEffect, useRef, useState } from "react";
import { displayFollowUpClaim } from "../lib/composeFollowUpClaim";
import type { InvestigationClaim } from "../lib/investigation";
import { isCompleteEmptyShell, isMetaQuestionFragment } from "./leftoverClaims";

type FollowUpSectionProps = {
  onFollowUp?: (question: string) => void;
  onReverify?: () => void;
  directAnswer?: string;
  originalClaim?: string;
  boundaries?: string[];
  claims?: InvestigationClaim[];
  leftoverTexts?: string[];
  checkedAt?: string;
  sourceUrls?: string[];
  suggestedQuestion?: string;
  coverageNote?: string;
};

function formatBriefDate(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toLocaleDateString("zh-CN");
}

/** 简报只放原句、判断、边界、日期、真实来源 URL。产品署名不是证据。 */
export function buildConclusionBrief(input: {
  originalClaim: string;
  directAnswer: string;
  boundaries?: string[];
  checkedAt?: string;
  sourceUrls?: string[];
  coverageNote?: string;
}): string {
  const claim = displayFollowUpClaim(input.originalClaim);
  const urls = (input.sourceUrls ?? []).map((url) => url.trim()).filter(Boolean);
  return [
    claim ? `原句：${claim}` : "",
    input.directAnswer ? `判断：${input.directAnswer}` : "",
    input.boundaries?.length ? `必要边界：${input.boundaries.join("；")}` : "",
    input.coverageNote ?? "",
    input.checkedAt ? `核查日期：${formatBriefDate(input.checkedAt)}` : "",
    urls.length ? `关键来源：\n${urls.join("\n")}` : "关键来源：这次没有可用的来源链接",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function clipAsk(text: string): string {
  // Keep qualifiers and negations in the actual question; visual wrapping belongs to CSS.
  return text.replace(/\s+/g, " ").trim();
}

function hasTwoSidedEvidence(claims: InvestigationClaim[]): boolean {
  return claims.some(
    (claim) =>
      claim.evidence.some((link) => link.role === "support") &&
      claim.evidence.some((link) => link.role === "contradict"),
  );
}

/** 只从真实缺口、未覆盖原句、未解决争点生成；没有就不给建议。 */
export function generateFollowUpSuggestions(
  _originalClaim = "",
  boundaries: string[] = [],
  claims: InvestigationClaim[] = [],
  leftoverTexts: string[] = [],
): string[] {
  const suggestions: string[] = [];
  const push = (raw: string) => {
    const text = raw.replace(/\s+/g, " ").trim();
    if (!text || text.length > 1500 || suggestions.includes(text) || suggestions.length >= 3) return;
    suggestions.push(text);
  };

  for (const claim of claims) {
    if (isCompleteEmptyShell(claim)) continue;
    for (const gap of claim.gaps) {
      if (gap.status === "open" && gap.description.trim()) push(`还没查清：${clipAsk(gap.description)}`);
    }
  }

  for (const leftover of leftoverTexts) {
    if (leftover.trim() && !isMetaQuestionFragment(leftover)) {
      push(`原句里还没查：「${clipAsk(leftover)}」站得住吗？`);
    }
  }

  for (const claim of claims) {
    if (claim.judgment === "unresolved" && claim.text.trim()) {
      push(`「${clipAsk(claim.text)}」还缺什么才能判断？`);
    }
  }

  if (hasTwoSidedEvidence(claims) && suggestions.length === 0) {
    push("支持与反驳双方的核心分歧究竟在何处？");
  }

  for (const claim of claims) {
    if (claim.boundary?.trim()) push(`适用边界是「${clipAsk(claim.boundary)}」，还要再查哪一段？`);
  }

  if (suggestions.length === 0) {
    for (const boundary of boundaries) {
      if (boundary.trim()) push(`适用边界是「${clipAsk(boundary)}」，还要再查哪一段？`);
    }
  }

  return suggestions;
}

export function FollowUpSection({
  onFollowUp,
  onReverify,
  directAnswer = "",
  originalClaim = "",
  boundaries = [],
  claims = [],
  leftoverTexts = [],
  checkedAt,
  sourceUrls = [],
  suggestedQuestion = "",
  coverageNote,
}: FollowUpSectionProps) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (suggestedQuestion) setQuery(suggestedQuestion);
  }, [suggestedQuestion]);

  const suggestions = generateFollowUpSuggestions(originalClaim, boundaries, claims, leftoverTexts);

  const handleSubmit = () => {
    const text = query.trim();
    if (!text || !onFollowUp) return;
    onFollowUp(text);
    setQuery("");
  };

  const handleCopySummary = () => {
    const summary = buildConclusionBrief({
      originalClaim,
      directAnswer,
      boundaries,
      checkedAt,
      sourceUrls,
      coverageNote,
    });
    const write = navigator.clipboard?.writeText;
    if (!write) {
      setCopied(false);
      setCopyError("没能复制到剪贴板，请重试。");
      return;
    }
    void write(summary).then(
      () => {
        setCopyError("");
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      },
      () => {
        setCopied(false);
        setCopyError("没能复制到剪贴板，请重试。");
      }
    );
  };

  return (
    <section className="gp-followup" aria-label="针对结论追问">
      <div className="gp-followup-header">
        <div className="gp-followup-title-row">
          <span className="gp-followup-icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M18 10c0 3.866-3.582 7-8 7a8.841 8.841 0 0 1-4.083-.98L2 17l1.138-3.415C2.422 12.484 2 11.282 2 10c0-3.866 3.582-7 8-7s8 3.134 8 7z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <h3 className="gp-followup-title">基于当前缺口继续查证</h3>
        </div>
        <p className="gp-followup-subtitle">点一个推荐问题，它会填入下方输入框；确认后再发出追查。本轮结果会保留，补查仍在同一份调查里。</p>
      </div>

      {suggestions.length > 0 ? (
        <div className="gp-followup-suggestions" aria-label="推荐追问">
          <span className="gp-followup-suggestions-label">推荐追问：</span>
          <div className="gp-followup-chips">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                type="button"
                className="gp-followup-chip"
                aria-label={`将「${s}」填入追问输入框`}
                onClick={() => {
                  setQuery(s);
                  inputRef.current?.focus();
                  inputRef.current?.setSelectionRange(s.length, s.length);
                }}
              >
                <span className="gp-followup-chip-text">{s}</span>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.6" className="gp-followup-chip-arrow" aria-hidden="true">
                  <path d="M3 8h10M9 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="gp-followup-input-box">
        <textarea
          className="gp-followup-input"
          ref={inputRef}
          value={query}
          rows={1}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="针对此结论追问，或展开未尽命题…（按 Enter 发送）"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              handleSubmit();
            }
          }}
        />
        <div className="gp-followup-input-actions">
          <button
            type="button"
            className="gp-followup-send-btn"
            disabled={!query.trim()}
            onClick={() => handleSubmit()}
            aria-label="发送追问"
          >
            <span>追问</span>
            <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M14 2 7 9M14 2 9.5 14l-2.5-4.5L2.5 7 14 2z" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="gp-followup-actions-bar">
        <div className="gp-followup-actions-left">
          {onReverify ? (
            <button type="button" className="gp-action-btn gp-action-btn--secondary" onClick={onReverify}>
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9M2.5 12V8h4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>重新调查</span>
            </button>
          ) : null}
          <button type="button" className="gp-action-btn gp-action-btn--ghost" data-gp-copy-brief onClick={handleCopySummary}>
            {copied ? (
              <>
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="#16a34a" strokeWidth="2" aria-hidden="true">
                  <path d="m3 8 3.5 3.5L13 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span style={{ color: "#16a34a" }}>已复制简报</span>
              </>
            ) : (
              <>
                <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                  <rect x="5" y="5" width="8" height="8" rx="1.5" />
                  <path d="M3 11V3.5A1.5 1.5 0 0 1 4.5 2H11" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                <span>复制结论简报</span>
              </>
            )}
          </button>
        </div>
        <span className="gp-followup-tip">支持快捷键 Enter 直接提交追问</span>
      </div>
      {copyError ? (
        <p className="gp-followup-copy-error" role="alert" data-gp-copy-brief-error>
          {copyError}
        </p>
      ) : null}
    </section>
  );
}
