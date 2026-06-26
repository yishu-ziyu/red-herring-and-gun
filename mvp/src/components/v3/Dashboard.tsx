/**
 * Dashboard.tsx — 红鲱鱼与枪首页落地页
 *
 * 设计方向：
 * - 品牌优先：Logo + 品牌名醒目展示
 * - 红黑配色源自 Logo：ink-black + crimson-red
 * - 衬线标题 + 无衬线正文，esther-design-system 风格
 * - 单页落地页：Hero → Intake → Footer
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  createCaseIntake,
  extractLinks,
  imageFileToCaseImage,
  type CaseImage,
  type CaseIntake,
  type CaseLink,
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

const LIVE_PIPELINE = [
  "立案",
  "原子命题拆解",
  "多引擎溯源",
  "证据交叉验证",
  "报告与闭环",
];

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
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const detectedLinks = useMemo(() => extractLinks(inputValue), [inputValue]);
  const hasMaterial = Boolean(inputValue.trim() || detectedLinks.length > 0 || images.length > 0);
  const aipingBalanceText = useMemo(() => {
    if (aipingAuth.status !== "authenticated") return "";
    const point = Number(aipingAuth.user.point_remain ?? 0);
    const recharge = Number(aipingAuth.user.recharge_remain ?? 0);
    return `点数 ${point + recharge}`;
  }, [aipingAuth]);

  const handleStart = useCallback(async () => {
    const intake = createCaseIntake(inputValue, images);
    if (!intake.text && intake.links.length === 0 && intake.images.length === 0) {
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
  }, [images, inputValue, modelChoice, onStartAnalysis]);

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
        handleStart();
      }
    },
    [handleStart]
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
      {/* ── Hero Section ── */}
      <section className="landing-hero">
        <div className="landing-hero-content">
          {/* Logo */}
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

          {/* Tagline */}
          <p className="landing-tagline">
            信息真相猎人
          </p>
        </div>
      </section>

      {/* ── Input Section ── */}
      <section className="landing-input-section">
        <div className="landing-input-card">
          <label htmlFor="claim-input" className="landing-input-label">
            添加待核查材料
          </label>
          <textarea
            id="claim-input"
            name="claim"
            className="landing-input"
            placeholder="输入文字、粘贴链接，或添加聊天截图 / 网页截图"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={4}
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
          {inputError ? <p className="landing-input-error">{inputError}</p> : null}
          <ModelPicker value={modelChoice} onChange={setModelChoice} />
          <div className="landing-input-actions">
            <button
              className="landing-submit-btn"
              onClick={handleStart}
              type="button"
              disabled={!hasMaterial || isScraping || !hasAvailableModels}
            >
              <span className="landing-submit-icon">
                {isScraping ? "⏳" : "🔎"}
              </span>
              {isScraping ? "正在抓取链接内容…" : "启动真实核查"}
            </button>
          </div>
          <ol className="landing-pipeline" aria-label="真实核查路径">
            {LIVE_PIPELINE.map((step, index) => (
              <li key={step} className="landing-pipeline-step">
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="landing-footer">
        <div className="landing-footer-brand">
          <img src="/logo.png?v=20260615" alt="" className="landing-footer-logo" />
          <span>红鲱鱼与枪</span>
        </div>
        <p className="landing-footer-powered">
          Powered by StepFun / MiMo / DeepSeek + 360 / AnySearch / Metaso
        </p>
      </footer>
      {showUtilityMenu ? <FloatingActionMenu /> : null}
    </div>
  );
}
