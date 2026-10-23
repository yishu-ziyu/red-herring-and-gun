/**
 * 首页输入、示例和分工说明。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  caseIntakeFailedLinks,
  createCaseIntake,
  isUrlOnlyClaim,
  imageFileToCaseImage,
  type CaseImage,
  type CaseIntake,
} from "../lib/caseIntake";
import { scrapeLinks } from "../lib/linkScraper";
import { PromptInput, type PromptAttachment } from "../components/v3/promptInput/PromptInput";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import {
  checksRemainingMessage,
  parseCheckQuota,
  quotaIsExhausted,
  type CheckQuotaView,
} from "../../shared/quota";

const MAX_IMAGE_COUNT = 4;
const MAX_TOTAL_IMAGE_BYTES = 6 * 1024 * 1024;

const LINK_SCRAPE_NOTICE_CLASS = "gp-link-scrape-notice";
const LINK_SCRAPE_NOTICE_TTL_MS = 12000;

/**
 * 把「链接打不开」的提示挂到输入态所在的那一层页面容器上（产品壳的 main），
 * 而不是挂在输入态的 React 树里。
 *
 * 原因：点提交后 App 立刻切到调查态，输入态整块卸载，挂在输入态树里的提示一帧都画不出来。
 * 产品壳的 main 在一次会话里始终在，提示挂上去以后提交后仍留在屏幕上，十几秒后自己消失。
 */
function showLinkScrapeNotice(text: string, host: HTMLElement | null) {
  if (typeof document === "undefined" || !document.body) return;

  const container = host?.isConnected && host.parentElement ? host.parentElement : document.body;
  let notice = container.querySelector<HTMLElement>(`.${LINK_SCRAPE_NOTICE_CLASS}`);
  if (!notice) {
    notice = document.createElement("p");
    notice.className = LINK_SCRAPE_NOTICE_CLASS;
    notice.setAttribute("role", "alert");
    const { style } = notice;
    style.position = "fixed";
    style.left = "50%";
    style.bottom = "24px";
    style.transform = "translateX(-50%)";
    style.width = "max-content";
    style.maxWidth = "min(560px, calc(100vw - 32px))";
    style.margin = "0";
    style.padding = "8px 12px";
    style.borderRadius = "8px";
    style.border = "0.5px solid var(--sand-7)";
    style.background = "var(--sand-1)";
    style.color = "var(--sand-12)";
    style.fontSize = "13px";
    // 低于 scrim(40)/drawer(50)：抽屉打开时提示不该浮在遮罩之上。
    style.zIndex = "35";
    container.appendChild(notice);
  }

  notice.textContent = text;
  // 真实 App 提交后会立刻卸载 InputStage，并由 App 的常驻 notice 接管。
  // 下一帧若输入态 host 已离开 DOM，就撤掉这枚临时 toast，避免两个同文案提示叠在一起。
  const sourceHost = host;
  window.setTimeout(() => {
    if (!sourceHost || sourceHost.isConnected) return;
    const current = container.querySelector<HTMLElement>(`.${LINK_SCRAPE_NOTICE_CLASS}`);
    if (current?.textContent === text) current.remove();
  }, 250);
  window.setTimeout(() => {
    if (!container.isConnected) return;
    const current = container.querySelector<HTMLElement>(`.${LINK_SCRAPE_NOTICE_CLASS}`);
    if (current?.textContent === text) current.remove();
  }, LINK_SCRAPE_NOTICE_TTL_MS);
}

type InputStageProps = {
  onSubmit: (intake: CaseIntake) => void;
  initialClaim?: string;
};

export function InputStage({
  onSubmit,
  initialClaim = "",
}: InputStageProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [inputValue, setInputValue] = useState(initialClaim);
  const [images, setImages] = useState<CaseImage[]>([]);
  const [inputError, setInputError] = useState("");
  const [isScraping, setIsScraping] = useState(false);
  const [checkQuota, setCheckQuota] = useState<CheckQuotaView | null>(null);
  const [highlightedDemo, setHighlightedDemo] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  const attachments = useMemo<PromptAttachment[]>(
    () => images.map((image) => ({ id: image.id, name: image.name })),
    [images]
  );
  const quotaExhausted = quotaIsExhausted(checkQuota);

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
  }, []);

  const handleStart = useCallback(async () => {
    if (quotaExhausted && checkQuota) {
      setInputError(checksRemainingMessage(checkQuota));
      return;
    }
    if (isScraping) return;
    const intake = createCaseIntake(inputValue, images);
    if (!intake.text && intake.links.length === 0 && intake.images.length === 0) {
      setInputError(copy.fillMaterialFirst);
      return;
    }
    let enriched = intake;
    if (intake.links.length > 0) {
      setIsScraping(true);
      setInputError("");
      try {
        const scraped = await scrapeLinks(intake.links);
        const hasContent = scraped.some((link) => link.scrapeStatus === "success" && !link.scrapeFailed && link.scrapedContent.trim());
        enriched = {
          ...intake,
          links: scraped,
        };
        if (caseIntakeFailedLinks(enriched).length > 0) {
          if (!hasContent && intake.images.length === 0 && isUrlOnlyClaim(intake.text)) {
            setInputError(copy.urlOnlyUnreadable);
            return;
          }
          showLinkScrapeNotice(copy.linkUnreachableNotice, rootRef.current);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : copy.scrapeFailed;
        setInputError(message);
        showLinkScrapeNotice(message, rootRef.current);
      } finally {
        setIsScraping(false);
      }
    }
    onSubmit(enriched);
  }, [checkQuota, images, inputValue, isScraping, copy, onSubmit, quotaExhausted]);

  const handleAddFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setInputError("");
      try {
        const imageFiles = files.filter((file) => file.type.startsWith("image/"));
        if (imageFiles.length === 0 || imageFiles.length !== files.length) {
          setInputError(copy.filesUnsupported);
          return;
        }
        if (images.length + imageFiles.length > MAX_IMAGE_COUNT) {
          setInputError(copy.tooManyImages);
          return;
        }
        const total = images.reduce((sum, image) => sum + image.size, 0) + imageFiles.reduce((sum, file) => sum + file.size, 0);
        if (total > MAX_TOTAL_IMAGE_BYTES) {
          setInputError(copy.imagesTooLarge);
          return;
        }
        const next = await Promise.all(imageFiles.map(imageFileToCaseImage));
        setImages((prev) => [...prev, ...next].slice(0, MAX_IMAGE_COUNT));
      } catch (error) {
        setInputError(error instanceof Error ? error.message : copy.imageReadFailed);
      }
    },
    [images, copy]
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
    if (inputError) return { tone: "warning", text: inputError } as const;
    if (checkQuota?.enforced) {
      if (quotaExhausted) {
        return { tone: "warning", text: copy.quotaExhausted } as const;
      }
      return { tone: "muted", text: checksRemainingMessage(checkQuota) } as const;
    }
    return null;
  })();

  return (
    <div className="gp-input-stage gp-column" ref={rootRef}>
      <h1 className="gp-headline">
        <span className="gp-headline-part">{copy.inputHeadlineA}</span>
        <em>{copy.inputHeadlineAccent}</em>
      </h1>

      <section className="gp-input-card" aria-label={copy.inputLabel}>
        <PromptInput
          value={inputValue}
          onChange={(next) => {
            setInputValue(next);
            setHighlightedDemo((current) => (next === current ? current : null));
            if (inputError) setInputError("");
          }}
          onSubmit={handleSubmit}
          attachments={attachments}
          onAddFiles={handleAddFiles}
          onRemoveAttachment={removeImage}
          busy={isScraping}
          submitLabel={isScraping ? copy.inputScraping : copy.inputSubmit}
          ariaLabel={copy.inputLabel}
          placeholder={copy.inputPlaceholder}
        />
        {userHint ? (
          <p className={`gp-hint gp-hint--${userHint.tone}`} role={userHint.tone === "warning" ? "alert" : "status"}>
            {userHint.text}
          </p>
        ) : null}
      </section>

      <section className="gp-examples" aria-label={copy.examplesAria}>
        <p className="gp-examples-label">{copy.examplesLabel}</p>
        <ul className="gp-examples-list">
          {copy.demoClaims.map((claim) => (
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
