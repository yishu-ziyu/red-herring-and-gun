/**
 * InputStage — 输入态（Issue #52 第三节）：5 秒内看懂「放什么、会得到什么、下一步」。
 * 只有用户级状态（服务不可用 / 次数用尽 / 登录引导 / 链接抓取失败）；
 * 实现层品牌、积分、批量工具与模型供应商控制一律不在默认首页（E3 扫描对象）。
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCaseIntake,
  extractLinks,
  imageFileToCaseImage,
  type CaseImage,
  type CaseIntake,
} from "../lib/caseIntake";
import { extractFramesFromVideo } from "../lib/videoFrames";
import { formatScrapedContent, scrapeLinks } from "../lib/linkScraper";
import { PromptInput, type PromptAttachment } from "../components/v3/promptInput/PromptInput";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import {
  checksRemainingMessage,
  parseCheckQuota,
  quotaIsExhausted,
  type CheckQuotaView,
} from "../lib/checkQuota";
import type { ModelChoiceMap } from "../lib/agentExpansion";

type ServiceState = {
  status: "checking" | "available" | "unavailable" | "unknown";
};

const MAX_IMAGE_COUNT = 4;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;

type InputStageProps = {
  onSubmit: (intake: CaseIntake, modelChoice: ModelChoiceMap) => void;
  initialClaim?: string;
  accountEmail?: string | null;
  onNeedLogin?: () => void;
};

export function InputStage({ onSubmit, initialClaim = "", accountEmail = null, onNeedLogin }: InputStageProps) {
  const { lang, copy: legacy } = useUiLang();
  const copy = gpCopyFor(lang);
  const [inputValue, setInputValue] = useState(initialClaim);
  const [images, setImages] = useState<CaseImage[]>([]);
  const [inputError, setInputError] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [service, setService] = useState<ServiceState>({ status: "checking" });
  const [hasModels, setHasModels] = useState(true);
  const [checkQuota, setCheckQuota] = useState<CheckQuotaView | null>(null);
  const [highlightedDemo, setHighlightedDemo] = useState<string | null>(null);

  const detectedLinks = useMemo(() => extractLinks(inputValue), [inputValue]);
  const hasMaterial = Boolean(inputValue.trim() || detectedLinks.length > 0 || images.length > 0);
  const attachments = useMemo<PromptAttachment[]>(
    () => images.map((image) => ({ id: image.id, name: image.name, kind: "image" as const })),
    [images]
  );
  const blocked = service.status === "checking" || service.status === "unavailable" || !hasModels;
  const quotaExhausted = quotaIsExhausted(checkQuota);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/models/health")
      .then((response) => (response.ok ? response.json() : { status: "unknown" }))
      .then((data: { status?: string }) => {
        if (cancelled) return;
        setService({ status: data.status === "available" ? "available" : data.status === "unavailable" ? "unavailable" : "unknown" });
      })
      .catch(() => {
        if (!cancelled) setService({ status: "unknown" });
      });
    fetch("/api/models/list")
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((data: { models?: unknown[] }) => {
        if (!cancelled) setHasModels(Array.isArray(data.models) && data.models.length > 0);
      })
      .catch(() => {
        if (!cancelled) setHasModels(false);
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
        if (!cancelled) setCheckQuota(parseCheckQuota(data));
      })
      .catch(() => {
        if (!cancelled) setCheckQuota(null);
      });
    return () => {
      cancelled = true;
    };
  }, [accountEmail]);

  const handleStart = useCallback(async () => {
    if (quotaExhausted && checkQuota) {
      setInputError(checksRemainingMessage(checkQuota));
      if (checkQuota.kind === "guest") onNeedLogin?.();
      return;
    }
    if (blocked) {
      setInputError(copy.serviceUnavailable);
      return;
    }
    if (isScraping) return;
    const intake = createCaseIntake(inputValue, images);
    if (!intake.text && intake.links.length === 0 && intake.images.length === 0) {
      setInputError(legacy.fillMaterialFirst);
      return;
    }
    let enriched = intake;
    if (intake.links.length > 0) {
      setIsScraping(true);
      setInputError("");
      try {
        const scraped = await scrapeLinks(intake.links);
        const text = formatScrapedContent(scraped);
        const failed = scraped.filter((l) => l.scrapeStatus === "error");
        if (failed.length > 0) {
          setInputError(`${failed.length} 个链接抓取失败，将跳过这些链接继续调查。`);
        }
        enriched = {
          ...intake,
          links: scraped,
          text: text ? `${intake.text}\n\n【链接抓取内容】\n${text}` : intake.text,
        };
      } catch (error) {
        setInputError(error instanceof Error ? error.message : legacy.scrapeFailed);
      } finally {
        setIsScraping(false);
      }
    }
    onSubmit(enriched, {});
  }, [blocked, checkQuota, copy.serviceUnavailable, images, inputValue, isScraping, legacy.fillMaterialFirst, legacy.scrapeFailed, onNeedLogin, onSubmit, quotaExhausted]);

  const handleAddFiles = useCallback(
    async (files: File[], kind: "image" | "file") => {
      if (files.length === 0) return;
      setInputError("");
      try {
        const videoFiles = files.filter((file) => file.type.startsWith("video/"));
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (videoFiles.length > 0) {
          const frames = (await Promise.all(videoFiles.map((file) => extractFramesFromVideo(file)))).flat();
          if (frames.length === 0) {
            setInputError(legacy.videoFrameFailed);
            return;
          }
          const total = images.reduce((sum, image) => sum + image.size, 0) + frames.reduce((sum, f) => sum + f.size, 0);
          if (total > MAX_TOTAL_IMAGE_BYTES) {
            setInputError(legacy.videoFrameTooLarge);
            return;
          }
          if (images.length + frames.length > MAX_IMAGE_COUNT) {
            setInputError(legacy.tooManyFrames);
            return;
          }
          setImages((prev) => [...prev, ...frames].slice(0, MAX_IMAGE_COUNT));
          return;
        }
        if (imageFiles.length === 0) {
          setInputError(legacy.filesUnsupported);
          return;
        }
        const total = images.reduce((sum, image) => sum + image.size, 0) + imageFiles.reduce((sum, file) => sum + file.size, 0);
        if (total > MAX_TOTAL_IMAGE_BYTES) {
          setInputError(legacy.imagesTooLarge);
          return;
        }
        const next = await Promise.all(imageFiles.map(imageFileToCaseImage));
        setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGE_COUNT));
      } catch (error) {
        setInputError(error instanceof Error ? error.message : legacy.imageReadFailed);
      }
    },
    [images, legacy]
  );

  const removeImage = useCallback((imageId: string) => {
    setImages((prev) => prev.filter((image) => image.id !== imageId));
  }, []);

  const handleSubmit = useCallback(() => {
    void handleStart();
  }, [handleStart]);

  const fillDemo = useCallback((claim: string) => {
    setInputValue(claim);
    setHighlightedDemo(claim);
    setInputError("");
  }, []);

  const userHint = (() => {
    if (inputError) return { tone: inputError.includes("抓取失败") ? "muted" : "warning", text: inputError } as const;
    if (service.status === "checking") return { tone: "muted", text: copy.serviceChecking } as const;
    if (service.status === "unavailable" || !hasModels) return { tone: "warning", text: copy.serviceUnavailable } as const;
    if (checkQuota?.enforced) {
      if (quotaExhausted) {
        return {
          tone: "warning",
          text: checkQuota.kind === "guest" ? copy.quotaExhaustedGuest : copy.quotaExhaustedUser,
        } as const;
      }
      return { tone: "muted", text: checksRemainingMessage(checkQuota) } as const;
    }
    return null;
  })();

  return (
    <div className="gp-input-stage">
      <p className="gp-kicker">{copy.inputKicker}</p>
      <h1 className="gp-headline">
        {copy.inputHeadlineA}
        <em>{copy.inputHeadlineAccent}</em>
      </h1>
      <p className="gp-sub">{copy.inputSub}</p>

      <section className="gp-input-card" aria-label={copy.inputLabel}>
        <PromptInput
          value={inputValue}
          onChange={(next) => {
            setInputValue(next);
            setHighlightedDemo(null);
            if (inputError) setInputError("");
          }}
          onSubmit={handleSubmit}
          attachments={attachments}
          onAddFiles={handleAddFiles}
          onRemoveAttachment={removeImage}
          submitDisabled={blocked}
          busy={isScraping}
          submitLabel={isScraping ? copy.inputScraping : copy.inputSubmit}
          ariaLabel={copy.inputLabel}
          placeholder={copy.inputPlaceholder}
        />
        {detectedLinks.length > 0 ? (
          <div className="gp-link-row" aria-label={legacy.linksDetected}>
            {detectedLinks.map((link) => (
              <a key={link.id} className="gp-link-chip" href={link.url} target="_blank" rel="noreferrer">
                {link.hostname}
              </a>
            ))}
          </div>
        ) : null}
        {userHint ? (
          <p className={`gp-hint gp-hint--${userHint.tone}`} role={userHint.tone === "warning" ? "alert" : "status"}>
            {userHint.text}
            {userHint.tone === "warning" && quotaExhausted && checkQuota?.kind === "guest" && onNeedLogin ? (
              <>
                {" "}
                <button type="button" className="gp-hint-link" onClick={onNeedLogin}>
                  {legacy.signIn}
                </button>
              </>
            ) : null}
          </p>
        ) : null}
      </section>

      <section className="gp-examples" aria-label={legacy.examplesAria}>
        <p className="gp-examples-label">{copy.examplesLabel}</p>
        <ul className="gp-examples-list">
          {legacy.demoClaims.map((claim) => (
            <li key={claim}>
              <button
                type="button"
                className={`gp-example${highlightedDemo === claim ? " is-active" : ""}`}
                onClick={() => fillDemo(claim)}
              >
                {claim}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
