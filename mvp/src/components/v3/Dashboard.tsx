/**
 * Dashboard.tsx — 红鲱鱼与枪首页落地页（Version A：产品叙事）
 *
 * 首页：贴材料、开始核查。不卖话术。
 */

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  createCaseIntake,
  extractLinks,
  imageFileToCaseImage,
  type CaseImage,
  type CaseIntake,
} from "../../lib/caseIntake";
import { extractFramesFromVideo } from "../../lib/videoFrames";
import { BatchChecker } from "./BatchChecker";
import {
  scrapeLinks,
  formatScrapedContent,
} from "../../lib/linkScraper";
import { type ModelChoiceMap } from "../../lib/agentExpansion";
import { PromptInput, type PromptAttachment } from "./promptInput/PromptInput";
import { UiLangSwitch } from "./UiLangSwitch";
import { useUiLang } from "../../lib/useUiLang";
import {
  checksRemainingMessage,
  parseCheckQuota,
  quotaIsExhausted,
  type CheckQuotaView,
} from "../../lib/checkQuota";

interface DashboardProps {
  onStartAnalysis: (intake: CaseIntake, modelChoice: ModelChoiceMap) => void;
  /** 重新核查时预填原 claim；普通进入首页为空 */
  initialClaim?: string;
  accountEmail?: string | null;
  onNeedLogin?: () => void;
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

type ModelServiceState = {
  status: "checking" | "available" | "unavailable" | "unknown";
  message: string;
};

const MODEL_SERVICE_CHECKING_MESSAGE = "正在确认核查服务…";
const MODEL_SERVICE_UNAVAILABLE_MESSAGE = "核查服务暂时不可用。你的材料还没有提交，请稍后重试。";
const MODEL_SERVICE_UNKNOWN_MESSAGE = "暂时无法确认核查服务状态。你可以继续尝试，若中断请稍后重试。";

const MAX_IMAGE_COUNT = 4;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;

export function Dashboard({
  onStartAnalysis,
  initialClaim = "",
  accountEmail = null,
  onNeedLogin,
}: DashboardProps) {
  const { copy } = useUiLang();
  const [inputValue, setInputValue] = useState(initialClaim);
  const [images, setImages] = useState<CaseImage[]>([]);
  const [inputError, setInputError] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [modelChoice, setModelChoice] = useState<ModelChoiceMap>({});
  const [hasAvailableModels, setHasAvailableModels] = useState(true);
  const [modelService, setModelService] = useState<ModelServiceState>({
    status: "checking",
    message: MODEL_SERVICE_CHECKING_MESSAGE,
  });
  const [aipingAuth, setAipingAuth] = useState<AipingAuthState>({ status: "checking" });
  const [highlightedDemo, setHighlightedDemo] = useState<string | null>(null);
  const [checkQuota, setCheckQuota] = useState<CheckQuotaView | null>(null);
  const claimInputSectionRef = useRef<HTMLElement | null>(null);
  const detectedLinks = useMemo(() => extractLinks(inputValue), [inputValue]);
  const hasMaterial = Boolean(inputValue.trim() || detectedLinks.length > 0 || images.length > 0);
  const promptAttachments = useMemo<PromptAttachment[]>(
    () => images.map((image) => ({ id: image.id, name: image.name, kind: "image" as const })),
    [images]
  );
  const aipingBalanceText = useMemo(() => {
    if (aipingAuth.status !== "authenticated") return "";
    const point = Number(aipingAuth.user.point_remain ?? 0);
    const recharge = Number(aipingAuth.user.recharge_remain ?? 0);
    return `${copy.pointsPrefix} ${point + recharge}`;
  }, [aipingAuth, copy.pointsPrefix]);

  const modelServiceBlocksSubmit =
    !hasAvailableModels || modelService.status === "checking" || modelService.status === "unavailable";
  const displayedModelService: ModelServiceState = hasAvailableModels
    ? modelService
    : { status: "unavailable", message: MODEL_SERVICE_UNAVAILABLE_MESSAGE };
  const canSubmit =
    hasMaterial &&
    !isScraping &&
    hasAvailableModels &&
    !modelServiceBlocksSubmit &&
    !quotaIsExhausted(checkQuota);

  const handleStart = useCallback(async () => {
    if (quotaIsExhausted(checkQuota) && checkQuota) {
      setInputError(checksRemainingMessage(checkQuota));
      if (checkQuota.kind === "guest") onNeedLogin?.();
      return;
    }
    if (!hasAvailableModels) {
      setInputError(MODEL_SERVICE_UNAVAILABLE_MESSAGE);
      return;
    }
    if (modelServiceBlocksSubmit) {
      setInputError(modelService.message);
      return;
    }
    if (isScraping) return;

    const intake = createCaseIntake(inputValue, images);
    if (!intake.text && intake.links.length === 0 && intake.images.length === 0) {
      setInputError(copy.fillMaterialFirst);
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
        setInputError(error instanceof Error ? error.message : copy.scrapeFailed);
        // 即使抓取失败也继续，使用原始 intake
      } finally {
        setIsScraping(false);
      }
    }

    onStartAnalysis(enrichedIntake, modelChoice);
  }, [
    checkQuota,
    copy,
    hasAvailableModels,
    images,
    inputValue,
    isScraping,
    modelChoice,
    modelService.message,
    modelServiceBlocksSubmit,
    onNeedLogin,
    onStartAnalysis,
  ]);

  const fillDemoClaim = useCallback((claim: string) => {
    setInputValue(claim);
    setHighlightedDemo(claim);
    setInputError("");
    // 滚回输入区并聚焦，方便用户确认后启动
    requestAnimationFrame(() => {
      const section = claimInputSectionRef.current;
      section?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      const editor = section?.querySelector<HTMLElement>("#claim-input");
      editor?.focus();
    });
  }, []);

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
    fetch("/api/models/health")
      .then((response) => (response.ok ? response.json() : { status: "unknown" }))
      .then((data: { status?: string }) => {
        if (cancelled) return;
        if (data.status === "available") {
          setModelService({ status: "available", message: "" });
          return;
        }
        if (data.status === "unavailable") {
          setModelService({ status: "unavailable", message: MODEL_SERVICE_UNAVAILABLE_MESSAGE });
          return;
        }
        setModelService({ status: "unknown", message: MODEL_SERVICE_UNKNOWN_MESSAGE });
      })
      .catch(() => {
        if (cancelled) return;
        setModelService({ status: "unknown", message: MODEL_SERVICE_UNKNOWN_MESSAGE });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/checks/quota", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled) return;
        setCheckQuota(parseCheckQuota(data));
      })
      .catch(() => {
        if (cancelled) return;
        setCheckQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountEmail]);

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

  const handleAddFiles = useCallback(
    async (files: File[], kind: "image" | "file") => {
      if (files.length === 0) return;
      setInputError("");
      try {
        const videoFiles = files.filter((file) => file.type.startsWith("video/"));
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (videoFiles.length > 0) {
          const frames = (
            await Promise.all(videoFiles.map((file) => extractFramesFromVideo(file)))
          ).flat();
          if (frames.length === 0) {
            setInputError(copy.videoFrameFailed);
            return;
          }
          const nextTotalSize = images.reduce((sum, image) => sum + image.size, 0) + frames.reduce((sum, f) => sum + f.size, 0);
          const nextCount = images.length + frames.length;
          if (nextTotalSize > MAX_TOTAL_IMAGE_BYTES) {
            setInputError(copy.videoFrameTooLarge);
            return;
          }
          if (nextCount > MAX_IMAGE_COUNT) {
            setInputError(copy.tooManyFrames);
            return;
          }
          setImages((prev) => [...prev, ...frames].slice(0, MAX_IMAGE_COUNT));
          return;
        }
        if (kind === "file") {
          const nonImages = files.filter((file) => !file.type.startsWith("image/"));
          if (nonImages.length > 0) {
            setInputError(copy.imagesOnly);
            return;
          }
        }
        if (imageFiles.length === 0) {
          setInputError(copy.filesUnsupported);
          return;
        }
        if (imageFiles.length !== files.length) {
          setInputError(copy.filesUnsupported);
        }
        const nextTotalSize =
          images.reduce((sum, image) => sum + image.size, 0) +
          imageFiles.reduce((sum, file) => sum + file.size, 0);
        if (nextTotalSize > MAX_TOTAL_IMAGE_BYTES) {
          setInputError(copy.imagesTooLarge);
          return;
        }
        if (images.length + imageFiles.length > MAX_IMAGE_COUNT) {
          setInputError(copy.tooManyImages);
        }
        const nextImages = await Promise.all(imageFiles.map(imageFileToCaseImage));
        setImages((prev) => [...prev, ...nextImages].slice(0, MAX_IMAGE_COUNT));
      } catch (error) {
        setInputError(error instanceof Error ? error.message : copy.imageReadFailed);
      }
    },
    [copy, images]
  );

  const removeImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((image) => image.id !== imageId));
  }, []);

  const handlePromptSubmit = useCallback(() => {
    if (!canSubmit) {
      if (quotaIsExhausted(checkQuota) && checkQuota) {
        setInputError(checksRemainingMessage(checkQuota));
        if (checkQuota.kind === "guest") onNeedLogin?.();
      } else if (!hasMaterial) {
        setInputError(copy.fillMaterialFirst);
      } else if (!hasAvailableModels) {
        setInputError(MODEL_SERVICE_UNAVAILABLE_MESSAGE);
      } else if (modelServiceBlocksSubmit) {
        setInputError(modelService.message);
      }
      return;
    }
    void handleStart();
  }, [
    canSubmit,
    checkQuota,
    copy,
    handleStart,
    hasAvailableModels,
    hasMaterial,
    modelService.message,
    modelServiceBlocksSubmit,
    onNeedLogin,
  ]);

  return (
    <div className="landing-page">
      <div className="landing-top-corner">
        <UiLangSwitch />
        {aipingAuth.status !== "disabled" ? (
          <div className="landing-account-bar" aria-label={copy.accountStateLabel}>
            <span className="landing-account-provider">AI Ping</span>
            {aipingAuth.status === "checking" ? (
              <span className="landing-account-muted">{copy.accountChecking}</span>
            ) : aipingAuth.status === "authenticated" ? (
              <>
                <span className="landing-account-user">
                  {aipingAuth.user.short_phone_number || aipingAuth.user.another_name || copy.signedIn}
                </span>
                <span className="landing-account-balance">{aipingBalanceText}</span>
                <button type="button" className="landing-account-btn" onClick={handleAipingLogout}>
                  {copy.signOut}
                </button>
              </>
            ) : (
              <button type="button" className="landing-account-btn landing-account-btn-primary" onClick={handleAipingLogin}>
                {copy.signInAccount}
              </button>
            )}
          </div>
        ) : null}
      </div>

      <div className="landing-stage">
        <section className="landing-hero">
          <div className="landing-hero-content">
            <div className="landing-brand">
              <img
                src="/logo.png?v=20260615"
                alt=""
                className="landing-logo"
              />
              <h1 className="landing-title">
                <span className="landing-title-dark">红鲱鱼</span>
                <span className="landing-title-red">与</span>
                <span className="landing-title-dark">枪</span>
              </h1>
            </div>
            <p className="landing-mission">{copy.mission}</p>
            <p className="landing-outcome">{copy.outcome}</p>
          </div>
        </section>

        <section className="landing-input-section" ref={claimInputSectionRef}>
          <div className="landing-input-card landing-input-card--prompt">
            <label htmlFor="claim-input" className="landing-input-label">
              {copy.materialLabel}
            </label>
            <PromptInput
              value={inputValue}
              onChange={(next) => {
                setInputValue(next);
                setHighlightedDemo(null);
                if (inputError) setInputError("");
              }}
              onSubmit={handlePromptSubmit}
              attachments={promptAttachments}
              onAddFiles={handleAddFiles}
              onRemoveAttachment={removeImage}
              submitDisabled={modelServiceBlocksSubmit}
              busy={isScraping}
              submitLabel={isScraping ? copy.submitScraping : copy.submitStart}
              ariaLabel={copy.materialLabel}
              placeholder={copy.materialPlaceholder}
            />
            <BatchChecker initialText={inputValue} />
            {detectedLinks.length > 0 ? (
              <div className="landing-link-row" aria-label={copy.linksDetected}>
                {detectedLinks.map((link) => (
                  <a
                    key={link.id}
                    className="landing-link-chip"
                    href={link.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.hostname}
                  </a>
                ))}
              </div>
            ) : null}
            {inputError ? (
              <p id="landing-input-error" className="landing-input-error" role="alert">
                {inputError}
              </p>
            ) : displayedModelService.status !== "available" ? (
              <p
                className={`landing-input-hint${displayedModelService.status === "unavailable" ? " landing-input-hint--warning" : ""}`}
                role="status"
              >
                {displayedModelService.message}
              </p>
            ) : checkQuota?.enforced ? (
              <p className="landing-input-hint">
                {checksRemainingMessage(checkQuota)}
                {quotaIsExhausted(checkQuota) && checkQuota.kind === "guest" && onNeedLogin ? (
                  <>
                    {" "}
                    <button type="button" className="landing-input-hint-link" onClick={onNeedLogin}>
                      {copy.signIn}
                    </button>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
        </section>

        <section className="landing-examples" aria-label={copy.examplesAria}>
          <p className="landing-examples-label">{copy.examplesLabel}</p>
          <ul className="landing-examples-list">
            {copy.demoClaims.map((claim) => {
              const isActive = highlightedDemo === claim;
              return (
                <li key={claim}>
                  <button
                    type="button"
                    className={`landing-example${isActive ? " is-active" : ""}`}
                    onClick={() => fillDemoClaim(claim)}
                  >
                    {claim}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
