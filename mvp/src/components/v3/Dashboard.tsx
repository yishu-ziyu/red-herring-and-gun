/**
 * Dashboard.tsx — 红鲱鱼与枪首页落地页（Version A：产品叙事）
 *
 * 设计方向：
 * - 卖可追溯调查，不卖玄学「真假打分」
 * - 红黑配色源自 Logo：ink-black + crimson-red
 * - 暖纸 / 档案质感，侦探办公室痕迹
 * - 结构：使命 → Hero → Intake → Agent 工作流 → 角色案例 → 调查报告样例 → 信任条 → Footer
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  createCaseIntake,
  extractLinks,
  imageFileToCaseImage,
  type CaseImage,
  type CaseIntake,
} from "../../lib/caseIntake";
import {
  scrapeLinks,
  formatScrapedContent,
} from "../../lib/linkScraper";
import { FloatingActionMenu } from "./FloatingActionMenu";
import { ModelPicker, type ModelChoiceMap } from "./ModelPicker";

interface DashboardProps {
  onStartAnalysis: (intake: CaseIntake, modelChoice: ModelChoiceMap) => void;
  showUtilityMenu?: boolean;
}

interface AipingUser {
  another_name?: string;
  phone_number?: string;
  short_phone_number?: string;
  point_remain?: number;
  recharge_remain?: number;
}

type AipingAuthState =
  | { status: "checking" }
  | { status: "disabled" }
  | { status: "anonymous"; loginUrl: string }
  | { status: "authenticated"; user: AipingUser };

const HOW_IT_WORKS = [
  {
    code: "01",
    title: "拆开说法",
    desc: "把一句模糊陈述拆成多个可核对的要点，而不是整段含糊带过。",
  },
  {
    code: "02",
    title: "找公开材料",
    desc: "检索报道、官方文件、论文与公开数据，对照原句。",
  },
  {
    code: "03",
    title: "看来源靠不靠谱",
    desc: "区分一手出处、转载与利益冲突，避免把噪声当证据。",
  },
  {
    code: "04",
    title: "交叉核对",
    desc: "对照支持与反驳材料，标出矛盾、限定条件与不确定处。",
  },
  {
    code: "05",
    title: "告诉你转不转",
    desc: "给出结论、转发建议与可点来源：能说什么、不能说什么。",
  },
] as const;

/** 角色化案例：普通用户 / 投资者 / 媒体消费者 */
const DEMO_CASES = [
  {
    role: "普通用户",
    roleHint: "食品安全",
    claim: "隔夜菜会致癌，等于吃毒药",
    whyCare: "餐桌决策需要条件，而不是恐吓式口号。",
  },
  {
    role: "投资者",
    roleHint: "增长叙事",
    claim: "某公司未来三年营收将增长十倍",
    whyCare: "把「愿景」和「可核验承诺」拆开，避免被口号估值。",
  },
  {
    role: "媒体消费者",
    roleHint: "政策传言",
    claim: "某项政策已经正式确定并将立即实施",
    whyCare: "先追权威出处与时间线，再决定要不要转发。",
  },
] as const;

const MAX_IMAGE_COUNT = 4;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;

export function Dashboard({ onStartAnalysis, showUtilityMenu = false }: DashboardProps) {
  const [inputValue, setInputValue] = useState("");
  const [images, setImages] = useState<CaseImage[]>([]);
  const [inputError, setInputError] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [modelChoice, setModelChoice] = useState<ModelChoiceMap>({});
  const [hasAvailableModels, setHasAvailableModels] = useState(true);
  const [aipingAuth, setAipingAuth] = useState<AipingAuthState>({ status: "checking" });
  const [highlightedDemo, setHighlightedDemo] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const claimInputRef = useRef<HTMLTextAreaElement | null>(null);
  const detectedLinks = useMemo(() => extractLinks(inputValue), [inputValue]);
  const hasMaterial = Boolean(inputValue.trim() || detectedLinks.length > 0 || images.length > 0);
  const aipingBalanceText = useMemo(() => {
    if (aipingAuth.status !== "authenticated") return "";
    const point = Number(aipingAuth.user.point_remain ?? 0);
    const recharge = Number(aipingAuth.user.recharge_remain ?? 0);
    return `点数 ${point + recharge}`;
  }, [aipingAuth]);

  const canSubmit = hasMaterial && !isScraping && hasAvailableModels;

  const handleStart = useCallback(async () => {
    if (!hasAvailableModels) {
      setInputError("暂无可用模型，请先配置 API Key。");
      return;
    }
    if (isScraping) return;

    const intake = createCaseIntake(inputValue, images);
    if (!intake.text && intake.links.length === 0 && intake.images.length === 0) {
      setInputError("请先填写待核查材料。");
      return;
    }

    // 如果有链接，先并行抓取内容
    let enrichedIntake = intake;
    if (intake.links.length > 0) {
      setIsScraping(true);
      setInputError("");
      try {
        const scrapedLinks = await scrapeLinks(intake.links);
        const scrapedText = formatScrapedContent(scrapedLinks);

        const failedLinks = scrapedLinks.filter((l) => l.scrapeStatus === "error");
        if (failedLinks.length > 0) {
          setInputError(`${failedLinks.length} 个链接抓取失败，将跳过这些链接继续分析。`);
        }

        enrichedIntake = {
          ...intake,
          links: scrapedLinks,
          // 将抓取到的内容追加到文本末尾，供 Agent 分析
          text: scrapedText
            ? `${intake.text}\n\n【链接抓取内容】\n${scrapedText}`
            : intake.text,
        };
      } catch (error) {
        setInputError(error instanceof Error ? error.message : "链接抓取失败");
        // 即使抓取失败也继续，使用原始 intake
      } finally {
        setIsScraping(false);
      }
    }

    onStartAnalysis(enrichedIntake, modelChoice);
  }, [hasAvailableModels, images, inputValue, isScraping, modelChoice, onStartAnalysis]);

  const fillDemoClaim = useCallback((claim: string) => {
    setInputValue(claim);
    setHighlightedDemo(claim);
    setInputError("");
    // 滚回输入区并聚焦，方便用户确认后启动
    requestAnimationFrame(() => {
      const el = claimInputRef.current;
      el?.focus();
      el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    });
  }, []);

  const startDemoClaim = useCallback(
    (claim: string) => {
      if (!hasAvailableModels) return;
      setInputValue(claim);
      setHighlightedDemo(claim);
      onStartAnalysis(createCaseIntake(claim, []), modelChoice);
    },
    [hasAvailableModels, modelChoice, onStartAnalysis]
  );

  // 探测可用模型：抓取一次 list，看返回是不是 []
  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/list")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((data: { models?: unknown[] }) => {
        if (cancelled) return;
        setHasAvailableModels(Array.isArray(data.models) && data.models.length > 0);
      })
      .catch(() => {
        if (cancelled) return;
        setHasAvailableModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { authenticated: false, enabled: false }))
      .then((data: { authenticated?: boolean; enabled?: boolean; loginUrl?: string; user?: AipingUser }) => {
        if (cancelled) return;
        if (!data.enabled) {
          setAipingAuth({ status: "disabled" });
        } else if (data.authenticated && data.user) {
          setAipingAuth({ status: "authenticated", user: data.user });
        } else {
          setAipingAuth({ status: "anonymous", loginUrl: data.loginUrl || "/api/auth/aiping/login" });
        }
      })
      .catch(() => {
        if (cancelled) return;
        setAipingAuth({ status: "disabled" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAipingLogin = useCallback(() => {
    window.location.href = "/api/auth/aiping/login?next=/";
  }, []);

  const handleAipingLogout = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAipingAuth({ status: "anonymous", loginUrl: "/api/auth/aiping/login" });
  }, []);

  const handleImageSelect = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0) return;

    setInputError("");
    try {
      const imageFiles = files.filter((file) => file.type.startsWith("image/"));
      if (imageFiles.length !== files.length) {
        setInputError("只支持图片文件。");
      }
      const nextTotalSize = images.reduce((sum, image) => sum + image.size, 0) + imageFiles.reduce((sum, file) => sum + file.size, 0);
      if (nextTotalSize > MAX_TOTAL_IMAGE_BYTES) {
        setInputError("图片总大小不能超过 6MB。");
        return;
      }
      const nextImages = await Promise.all(imageFiles.map(imageFileToCaseImage));
      setImages((prev) => [...prev, ...nextImages].slice(0, MAX_IMAGE_COUNT));
    } catch (error) {
      setInputError(error instanceof Error ? error.message : "图片读取失败");
    }
  }, [images]);

  const removeImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((image) => image.id !== imageId));
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!canSubmit) {
          if (!hasMaterial) {
            setInputError("请先填写待核查材料。");
          } else if (!hasAvailableModels) {
            setInputError("暂无可用模型，请先配置 API Key。");
          }
          return;
        }
        void handleStart();
      }
    },
    [canSubmit, handleStart, hasAvailableModels, hasMaterial]
  );

  return (
    <div className="landing-page">
      {aipingAuth.status !== "disabled" ? (
        <div className="landing-account-bar" aria-label="AI Ping 账号状态">
          <span className="landing-account-provider">AI Ping</span>
          {aipingAuth.status === "checking" ? (
            <span className="landing-account-muted">账号检测中</span>
          ) : aipingAuth.status === "authenticated" ? (
            <>
              <span className="landing-account-user">
                {aipingAuth.user.short_phone_number || aipingAuth.user.another_name || "已登录"}
              </span>
              <span className="landing-account-balance">{aipingBalanceText}</span>
              <button type="button" className="landing-account-btn" onClick={handleAipingLogout}>
                退出
              </button>
            </>
          ) : (
            <button type="button" className="landing-account-btn landing-account-btn-primary" onClick={handleAipingLogin}>
              登录账号
            </button>
          )}
        </div>
      ) : null}

      {/* ── Hero ── */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          <div className="landing-brand">
            <img
              src="/logo.png?v=20260615"
              alt="红鲱鱼与枪"
              className="landing-logo"
            />
            <h1 className="landing-title">
              <span className="landing-title-dark">红鲱鱼</span>
              <span className="landing-title-red">与</span>
              <span className="landing-title-dark">枪</span>
            </h1>
          </div>

          <p className="landing-mission">
            群里又在传一条消息？先查清楚再决定转不转。
          </p>
          <p className="landing-tagline">粘贴传言，对照公开材料，给出可追溯的判断</p>
          <p className="landing-hero-body">
            输入一段文字、链接或截图。系统会拆开可核对的说法、检索公开来源，并告诉你：
            <strong>更可能属实、不实，还是证据不足</strong>
            ——以及该不该转发。
          </p>
        </div>
      </section>

      {/* ── Intake ── */}
      <section className="landing-input-section">
        <div className="landing-input-card">
          <label htmlFor="claim-input" className="landing-input-label">
            添加待核查材料
          </label>
          <textarea
            id="claim-input"
            ref={claimInputRef}
            name="claim"
            className="landing-input"
            placeholder="输入文字、粘贴链接，或添加聊天截图 / 网页截图"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
              setHighlightedDemo(null);
              if (inputError) setInputError("");
            }}
            onKeyDown={handleKeyDown}
            rows={4}
            aria-invalid={inputError ? true : undefined}
            aria-describedby={inputError ? "landing-input-error" : undefined}
          />
          <div className="landing-material-actions" aria-label="材料工具">
            <input
              ref={fileInputRef}
              className="landing-file-input"
              type="file"
              accept="image/*"
              multiple
              onChange={handleImageSelect}
            />
            <button
              className="landing-material-btn"
              type="button"
              onClick={() => fileInputRef.current?.click()}
            >
              添加图片
            </button>
            {detectedLinks.map((link) => (
              <a key={link.id} className="landing-link-chip" href={link.url} target="_blank" rel="noreferrer">
                {link.hostname}
              </a>
            ))}
          </div>
          {images.length > 0 ? (
            <div className="landing-image-list" aria-label="已添加图片">
              {images.map((image) => (
                <article key={image.id} className="landing-image-chip">
                  <img src={image.dataUrl} alt="" />
                  <span>{image.name}</span>
                  <button type="button" onClick={() => removeImage(image.id)} aria-label={`移除 ${image.name}`}>
                    移除
                  </button>
                </article>
              ))}
            </div>
          ) : null}
          {inputError ? (
            <p id="landing-input-error" className="landing-input-error" role="alert">
              {inputError}
            </p>
          ) : null}
          <ModelPicker value={modelChoice} onChange={setModelChoice} />
          <div className="landing-input-actions">
            <button
              className="landing-submit-btn"
              onClick={handleStart}
              type="button"
              disabled={!canSubmit}
              aria-busy={isScraping}
            >
              <span className="landing-submit-icon">
                {isScraping ? "⏳" : "🔎"}
              </span>
              {isScraping ? "正在抓取链接内容…" : "开始调查"}
            </button>
          </div>
        </div>
      </section>

      {/* ── 它如何工作 ── */}
      <section className="landing-section landing-how" aria-labelledby="landing-how-title">
        <div className="landing-section-inner">
          <h2 id="landing-how-title" className="landing-section-title">
            它如何工作
          </h2>
          <p className="landing-section-lead">
            不是一次问答，而是把说法拆开、对照材料、给出能不能转的判断。
          </p>
          <ol className="landing-how-grid">
            {HOW_IT_WORKS.map((step) => (
              <li key={step.code} className="landing-how-card">
                <span className="landing-how-index" aria-hidden="true">
                  {step.code}
                </span>
                <h3 className="landing-how-title">{step.title}</h3>
                <p className="landing-how-desc">{step.desc}</p>
              </li>
            ))}
          </ol>
          <div className="landing-decomposer-example" aria-label="说法拆解示例">
            <p className="landing-decomposer-label">拆开说法 · 示例</p>
            <p className="landing-decomposer-claim">「这个产品致癌」</p>
            <ol className="landing-decomposer-chain">
              <li>是否存在相关物质？</li>
              <li>剂量是否达到风险水平？</li>
              <li>是否有人体或临床证据？</li>
              <li>网络传播是否省略了限定条件？</li>
            </ol>
          </div>
        </div>
      </section>

      {/* ── 看看它如何调查 ── */}
      <section className="landing-section landing-demos" aria-labelledby="landing-demos-title">
        <div className="landing-section-inner">
          <h2 id="landing-demos-title" className="landing-section-title">
            看看它如何调查
          </h2>
          <p className="landing-section-lead">
            三个典型使用者场景。点卡片填入输入框，或直接发起调查。
          </p>
          <div className="landing-demo-grid">
            {DEMO_CASES.map((demo) => {
              const isActive = highlightedDemo === demo.claim;
              return (
                <article
                  key={demo.claim}
                  className={`landing-demo-card${isActive ? " is-active" : ""}`}
                >
                  <button
                    type="button"
                    className="landing-demo-claim"
                    onClick={() => fillDemoClaim(demo.claim)}
                  >
                    <span className="landing-demo-kicker">
                      {demo.role}
                      <span className="landing-demo-role-hint"> · {demo.roleHint}</span>
                    </span>
                    <span className="landing-demo-text">「{demo.claim}」</span>
                    <span className="landing-demo-why">{demo.whyCare}</span>
                  </button>
                  <button
                    type="button"
                    className="landing-demo-run"
                    disabled={!hasAvailableModels}
                    aria-label={`立即核查：${demo.claim}`}
                    onClick={() => startDemoClaim(demo.claim)}
                  >
                    立即调查
                  </button>
                </article>
              );
            })}
          </div>

          {/* 静态调查卷宗样例：先结论与原因，分数降级为 Evidence Confidence */}
          <aside className="landing-report-sample" aria-label="示例调查报告">
            <div className="landing-report-sample-head">
              <span className="landing-report-badge">示例卷宗</span>
              <h3 className="landing-report-sample-title">调查报告预览</h3>
            </div>
            <p className="landing-report-claim">「隔夜菜会致癌，等于吃毒药」</p>

            <div className="landing-report-verdict-block">
              <span className="landing-report-verdict-label">调查结论</span>
              <strong className="landing-report-verdict-main">部分成立</strong>
              <p className="landing-report-verdict-why">
                该说法混淆了「存在风险」和「必然致害」。硝酸盐在不当储存条件下可能升高，
                但「等于吃毒药」省略了剂量、烹饪方式与人体证据链条。
              </p>
            </div>

            <div className="landing-report-findings">
              <h4 className="landing-report-findings-title">关键发现</h4>
              <ul className="landing-report-findings-list">
                <li className="is-support">
                  <span className="landing-find-mark" aria-hidden="true">
                    ✓
                  </span>
                  <span>
                    <strong>支持：</strong>
                    部分食品安全研究指出隔夜蔬菜在特定储存条件下亚硝酸盐可能上升。
                  </span>
                </li>
                <li className="is-counter">
                  <span className="landing-find-mark" aria-hidden="true">
                    ×
                  </span>
                  <span>
                    <strong>反驳 / 限定：</strong>
                    原始研究语境多为条件风险，并非「必然致癌」；人体长期摄入的因果链未闭合。
                  </span>
                </li>
                <li className="is-gap">
                  <span className="landing-find-mark" aria-hidden="true">
                    ?
                  </span>
                  <span>
                    <strong>缺口：</strong>
                    缺少与日常家庭剂量对应的长期人体数据；不同菜品与冷藏条件不可一概而论。
                  </span>
                </li>
              </ul>
            </div>

            <div className="landing-report-meta-row">
              <div className="landing-report-signals">
                <span className="landing-report-verdict-label">核查信号</span>
                <ul className="landing-report-counts">
                  <li>
                    <span className="landing-report-count-num landing-report-count-num--support">3</span>
                    支持
                  </li>
                  <li>
                    <span className="landing-report-count-num landing-report-count-num--counter">5</span>
                    反驳 / 限定
                  </li>
                  <li>
                    <span className="landing-report-count-num">2</span>
                    待确认
                  </li>
                </ul>
              </div>
              <div className="landing-report-confidence">
                <span className="landing-report-verdict-label">转发建议</span>
                <p className="landing-report-confidence-note">
                  不宜整段转发。可说明「有条件风险，不等于必然致害」。
                </p>
              </div>
            </div>

            <p className="landing-report-note">
              以上为静态示意卷宗。真实核查会按你提交的材料重新取证，并保留来源链路。
            </p>
          </aside>
        </div>
      </section>

      {/* ── Trust strip（不堆供应商墙） ── */}
      <section className="landing-trust" aria-label="产品承诺">
        <div className="landing-trust-inner">
          <ul className="landing-trust-stats">
            <li>
              <strong>可拆</strong>
              <span>说法拆成可核对点</span>
            </li>
            <li>
              <strong>可溯</strong>
              <span>结论带来源链路</span>
            </li>
            <li>
              <strong>可决</strong>
              <span>明确转不转建议</span>
            </li>
            <li className="landing-trust-stat--demo">
              <strong>演示</strong>
              <span>样例非线上统计</span>
            </li>
          </ul>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <img src="/logo.png?v=20260615" alt="" className="landing-footer-logo" />
          <span>红鲱鱼与枪</span>
        </div>
        <p className="landing-footer-powered">
          多源检索与多模型协作 · 过程可追溯
        </p>
        <nav className="landing-footer-nav" aria-label="次要导航">
          <a href="/settings/api-key">API Key 设置</a>
        </nav>
      </footer>
      {showUtilityMenu ? <FloatingActionMenu /> : null}
    </div>
  );
}
