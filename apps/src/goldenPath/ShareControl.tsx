/**
 * ShareControl — 把这一轮调查分享成一个公开链接（#142 part b，不需要登录）。
 *
 * 点「分享」才建链接。链接内容由服务端从它存下的这一轮调查生成，这里不发送任何正文。
 * 只有发起这轮调查的浏览器能建、能撤。
 */
import { useEffect, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { displayFollowUpClaim } from "../lib/composeFollowUpClaim";

function formatBriefDate(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toLocaleDateString("zh-CN");
}

/** 文字简报只放原句、判断、边界、日期、真实来源 URL。产品署名不是证据。 */
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

type ShareState =
  | { phase: "idle" }
  | { phase: "creating" }
  | { phase: "created"; url: string; shareId: string }
  | { phase: "revoked" }
  | { phase: "error"; message: string };

export function ShareControl({ runId, brief }: { runId: string; brief: string }) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [state, setState] = useState<ShareState>({ phase: "idle" });
  const [copied, setCopied] = useState<"" | "link" | "brief">("");
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    setState({ phase: "idle" });
    setCopied("");
    setCopyError("");
  }, [runId]);

  const create = async () => {
    setState({ phase: "creating" });
    try {
      const response = await fetch(`/api/investigations/${encodeURIComponent(runId)}/shares`, {
        method: "POST",
        credentials: "include",
      });
      const data = (await response.json().catch(() => ({}))) as { shareId?: string; url?: string; message?: string };
      if (!response.ok || !data.shareId || !data.url) {
        setState({ phase: "error", message: data.message || copy.shareCreateFailed });
        return;
      }
      setState({ phase: "created", url: `${window.location.origin}${data.url}`, shareId: data.shareId });
    } catch {
      setState({ phase: "error", message: copy.shareCreateFailed });
    }
  };

  const revoke = async () => {
    if (state.phase !== "created") return;
    try {
      const response = await fetch(
        `/api/investigations/${encodeURIComponent(runId)}/shares/${encodeURIComponent(state.shareId)}`,
        { method: "DELETE", credentials: "include" }
      );
      setState(response.ok ? { phase: "revoked" } : { phase: "error", message: copy.shareRevokeFailed });
    } catch {
      setState({ phase: "error", message: copy.shareRevokeFailed });
    }
  };

  const copyText = async (text: string, which: "link" | "brief") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setCopyError("");
    } catch {
      setCopied("");
      setCopyError(which === "link" ? copy.shareCopyFailed : copy.copyBriefFailed);
    }
  };

  return (
    <section className="gp-share" aria-label={copy.shareTitle} data-gp-share-state={state.phase}>
      <div className="gp-share-head">
        {state.phase === "idle" ? (
          <button type="button" className="gp-btn" data-gp-share-start onClick={() => void create()}>
            {copy.shareCreate}
          </button>
        ) : (
          <span className="gp-share-label">{copy.shareTitle}</span>
        )}
        {state.phase === "creating" ? <span className="gp-share-hint">{copy.shareCreating}</span> : null}
      </div>

      {state.phase === "created" ? (
        <div className="gp-share-body">
          <p className="gp-share-url" data-gp-share-url>{state.url}</p>
          <div className="gp-share-actions">
            <button type="button" className="gp-btn" data-gp-share-copy onClick={() => void copyText(state.url, "link")}>
              {copied === "link" ? copy.shareCopied : copy.shareCopy}
            </button>
            <button type="button" className="gp-btn" data-gp-share-copy-brief onClick={() => void copyText(brief, "brief")}>
              {copied === "brief" ? copy.shareCopied : copy.shareCopyBrief}
            </button>
            <button type="button" className="gp-link-btn" data-gp-share-revoke onClick={() => void revoke()}>
              {copy.shareRevoke}
            </button>
          </div>
          {copyError ? (
            <p className="gp-share-hint is-error" role="alert">
              {copyError}
            </p>
          ) : null}
          <p className="gp-share-hint">{copy.shareRevokeNote}</p>
        </div>
      ) : null}

      {state.phase === "revoked" ? <p className="gp-share-hint" data-gp-share-revoked>{copy.shareRevoked}</p> : null}
      {state.phase === "error" ? (
        <p className="gp-share-hint is-error" role="alert">
          {state.message}
        </p>
      ) : null}
    </section>
  );
}
