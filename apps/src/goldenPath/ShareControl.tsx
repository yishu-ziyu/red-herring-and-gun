/**
 * ShareControl — 把这一轮调查分享成一个公开链接。
 *
 * 点「分享」才建链接。链接内容由服务端从它存下的这一轮调查生成，这里不发送任何正文。
 * 只有发起这轮调查的浏览器能建、能撤。
 */
import { useEffect, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { createShare, revokeShare } from "../lib/investigationClient";
import { gpCopyFor } from "./copy";
import { displayFollowUpClaim } from "../../shared/followUp";

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
  claimBoundaries?: Array<{ text: string; boundary?: string }>;
}): string {
  const claim = displayFollowUpClaim(input.originalClaim);
  const urls = (input.sourceUrls ?? []).map((url) => url.trim()).filter(Boolean);
  return [
    claim ? `原句：${claim}` : "",
    input.directAnswer ? `判断：${input.directAnswer}` : "",
    input.boundaries?.length ? `必要边界：${input.boundaries.join("；")}` : "",
    ...(input.claimBoundaries ?? []).filter((claim) => claim.boundary?.trim()).map((claim) =>
      `关于「${claim.text}」：不能推出${claim.boundary!.trim().replace(/^不能推出[：:]?/, "")}`),
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
    const result = await createShare(runId);
    if (!result.ok) {
      setState({ phase: "error", message: result.message || copy.shareCreateFailed });
      return;
    }
    setState({ phase: "created", url: `${window.location.origin}${result.url}`, shareId: result.shareId });
  };

  const revoke = async () => {
    if (state.phase !== "created") return;
    const revoked = await revokeShare(runId, state.shareId);
    setState(revoked ? { phase: "revoked" } : { phase: "error", message: copy.shareRevokeFailed });
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
      {state.phase === "idle" || state.phase === "creating" ? (
        <button
          type="button"
          className="gp-btn"
          data-gp-share-start
          disabled={state.phase === "creating"}
          onClick={() => void create()}
        >
          {state.phase === "creating" ? copy.shareCreating : copy.shareCreate}
        </button>
      ) : null}

      {state.phase === "created" ? (
        <div className="gp-share-body">
          <p className="gp-share-url" data-gp-share-url>{state.url}</p>
          <div className="gp-share-actions">
            <button type="button" className="gp-btn gp-btn--primary" data-gp-share-copy onClick={() => void copyText(state.url, "link")}>
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
          ) : (
            <p className="gp-share-hint">{copy.shareRevokeNote}</p>
          )}
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
