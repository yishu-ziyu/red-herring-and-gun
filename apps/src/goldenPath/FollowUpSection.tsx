/**
 * FollowUpSection — 调查结论后的探索与追问入口（全栈闭环）。
 * 针对当前结论提供高频追问建议胶囊、自由追问输入框以及操作按钮组。
 */
import { useRef, useState } from "react";
import { displayFollowUpClaim } from "../lib/composeFollowUpClaim";
import type { InvestigationClaim } from "../lib/investigation";

type FollowUpSectionProps = {
  onFollowUp?: (question: string) => void;
  onReverify?: () => void;
  directAnswer?: string;
  originalClaim?: string;
  boundaries?: string[];
  claims?: InvestigationClaim[];
};

function generateFollowUpSuggestions(
  originalClaim = "",
  boundaries: string[] = [],
  claims: InvestigationClaim[] = []
): string[] {
  const suggestions: string[] = [];

  // 1. 如果有明确的边界，将边界转化为追问
  for (const b of boundaries) {
    if (b.includes("冷藏") || b.includes("储存") || b.includes("变质")) {
      suggestions.push("冷藏隔夜菜具体能放多久？细菌与毒素随时间如何变化？");
    } else if (b.includes("剂量") || b.includes("夸大")) {
      suggestions.push("医学或权威机构对该有害成分的安全限量标准是多少？");
    }
  }

  // 2. 根据原始文本与命题特征推荐深入方向
  const text = `${originalClaim} ${claims.map((c) => c.text).join(" ")}`;
  if (text.includes("隔夜") || text.includes("亚硝酸盐")) {
    if (!suggestions.some((s) => s.includes("蔬菜"))) {
      suggestions.push("不同蔬菜（如叶菜 vs 根茎类）亚硝酸盐残留有何差异？");
    }
    if (!suggestions.some((s) => s.includes("加热"))) {
      suggestions.push("隔夜菜彻底回热能杀灭有害菌或分解亚硝酸盐吗？");
    }
    if (!suggestions.some((s) => s.includes("限量"))) {
      suggestions.push("国家标准中对熟食亚硝酸盐含量的上限是如何规定的？");
    }
  } else if (text.includes("癌") || text.includes("致病") || text.includes("健康")) {
    suggestions.push("这一说法在流行病学或临床医学中是否有可靠的实验数据支持？");
    suggestions.push("该说法最初是从哪个渠道或事件发酵起来的？");
    suggestions.push("针对此类风险，普通公众在日常生活中应当如何科学防范？");
  } else {
    suggestions.push("针对这一结论，学术界或行业权威是否存在不同观点？");
    suggestions.push("支持与反驳双方的核心分歧究竟在何处？");
    suggestions.push("如果想要进一步核实一手资料，最权威的查证渠道是什么？");
  }

  return suggestions.slice(0, 3);
}

export function FollowUpSection({
  onFollowUp,
  onReverify,
  directAnswer = "",
  originalClaim = "",
  boundaries = [],
  claims = [],
}: FollowUpSectionProps) {
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = generateFollowUpSuggestions(originalClaim, boundaries, claims);
  // 复制出去的简报只放用户自己写的说法，不放内部拼接段（与原句区同一份裁切规则）。
  const claimForCopy = displayFollowUpClaim(originalClaim);

  const handleSubmit = () => {
    const text = query.trim();
    if (!text || !onFollowUp) return;
    onFollowUp(text);
    setQuery("");
  };

  const handleCopySummary = () => {
    const summary = [
      `【调查结论】${directAnswer}`,
      claimForCopy ? `原说法：${claimForCopy}` : "",
      boundaries.length > 0 ? `边界与注意：${boundaries.join("；")}` : "",
      `来源核查：红鲱鱼与枪（事实核查与出处查证引擎）`,
    ]
      .filter(Boolean)
      .join("\n\n");

    navigator.clipboard?.writeText(summary).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // 容错降级
    });
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
          <h3 className="gp-followup-title">针对此结论追问与深入查证</h3>
        </div>
        <p className="gp-followup-subtitle">点一个推荐问题，它会填入下方输入框；确认后再发出追查。</p>
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
            if (e.key === "Enter" && !e.shiftKey) {
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
          <button type="button" className="gp-action-btn gp-action-btn--ghost" onClick={handleCopySummary}>
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
    </section>
  );
}
