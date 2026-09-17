/**
 * ShareControl — 显式分享（IMPLEMENTATION_PLAN §3.5）。
 *
 * 顺序是：先看清楚接收方会看见的内容 → 再创建 → 复制要等服务器写完 → 可以撤销。
 * 预览只渲染服务端脱敏投影，不在前端用私人调查对象另拼公开版。
 */
import { useEffect, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";

type SharePreview = {
  claim?: unknown;
  createdAt?: unknown;
  checkedAt?: unknown;
  report?: unknown;
};

type ShareState =
  | { phase: "idle" }
  | { phase: "previewing" }
  | { phase: "preview"; preview: SharePreview }
  | { phase: "creating" }
  | { phase: "created"; url: string; shareId: string }
  | { phase: "revoked" }
  | { phase: "error"; message: string };

/** 从 GET 公开投影取出接收方页会用的字段。不补私人对象里的内容。 */
export function sharePreviewContent(preview: SharePreview) {
  const report = preview.report && typeof preview.report === "object" && !Array.isArray(preview.report)
    ? (preview.report as Record<string, unknown>)
    : {};
  const investigation = report.investigation && typeof report.investigation === "object"
    ? (report.investigation as { claims?: Array<{ text?: string }>; sources?: Array<{ title?: string; url?: string }> })
    : undefined;
  const claims = Array.isArray(investigation?.claims) ? investigation.claims : [];
  const sources = Array.isArray(investigation?.sources) ? investigation.sources : [];
  return {
    claim: typeof preview.claim === "string" ? preview.claim : "",
    conclusion: typeof report.conclusion === "string" ? report.conclusion : "",
    verdictLead: typeof report.causalBoundary === "string" ? report.causalBoundary : "",
    createdAt: typeof preview.createdAt === "number" ? preview.createdAt : null,
    checkedAt: typeof preview.checkedAt === "string" ? preview.checkedAt : "",
    claims: claims.map((claim) => (typeof claim.text === "string" ? claim.text : "")).filter(Boolean),
    sources: sources
      .map((source) => ({
        title: typeof source.title === "string" ? source.title : "",
        url: typeof source.url === "string" ? source.url : "",
      }))
      .filter((source) => source.url || source.title),
  };
}

export function ShareControl({ caseId }: { caseId: string }) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [state, setState] = useState<ShareState>({ phase: "idle" });
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState("");

  useEffect(() => {
    setState({ phase: "idle" });
    setCopied(false);
    setCopyError("");
  }, [caseId]);

  const loadPreview = async () => {
    setState({ phase: "previewing" });
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/share-preview`, {
        credentials: "include",
      });
      if (!response.ok) {
        setState({ phase: "error", message: copy.shareNeedLogin });
        return;
      }
      const data = (await response.json()) as { preview?: SharePreview };
      setState({ phase: "preview", preview: data.preview ?? {} });
    } catch {
      setState({ phase: "error", message: copy.sharePreviewFailed });
    }
  };

  const create = async () => {
    setState({ phase: "creating" });
    try {
      const response = await fetch(`/api/cases/${encodeURIComponent(caseId)}/shares`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        setState({ phase: "error", message: copy.shareCreateFailed });
        return;
      }
      const data = (await response.json()) as { shareId?: string; url?: string };
      if (!data.shareId || !data.url) {
        setState({ phase: "error", message: copy.shareCreateFailed });
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
        `/api/cases/${encodeURIComponent(caseId)}/shares/${encodeURIComponent(state.shareId)}`,
        { method: "DELETE", credentials: "include" }
      );
      setState(response.ok ? { phase: "revoked" } : { phase: "error", message: copy.shareRevokeFailed });
    } catch {
      setState({ phase: "error", message: copy.shareRevokeFailed });
    }
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setCopyError("");
    } catch {
      setCopied(false);
      setCopyError(copy.shareCopyFailed);
    }
  };

  const previewView = state.phase === "preview" ? sharePreviewContent(state.preview) : null;

  return (
    <section className="gp-share" aria-label={copy.shareTitle} data-gp-share-state={state.phase}>
      <div className="gp-share-head">
        <span className="gp-share-label">{copy.shareTitle}</span>
        {state.phase === "idle" ? (
          <button type="button" className="gp-link-btn" data-gp-share-start onClick={() => void loadPreview()}>
            {copy.shareCreate}
          </button>
        ) : null}
        {state.phase === "previewing" ? <span className="gp-share-hint">{copy.shareLoading}</span> : null}
        {state.phase === "creating" ? <span className="gp-share-hint">{copy.shareCreating}</span> : null}
      </div>

      {state.phase === "preview" && previewView ? (
        <div className="gp-share-body">
          <p className="gp-share-hint">{copy.sharePreviewLead}</p>
          <article className="gp-share-preview" data-gp-share-preview>
            <h3 className="gp-share-preview-claim">{previewView.claim}</h3>
            <p className="gp-share-preview-meta">
              {previewView.createdAt
                ? `原调查时间：${new Date(previewView.createdAt).toLocaleString("zh-CN", { hour12: false })}`
                : "原调查时间"}
              {previewView.checkedAt ? ` · 核查完成：${previewView.checkedAt}` : ""}
            </p>
            {previewView.conclusion ? <p className="gp-share-preview-lead">{previewView.conclusion}</p> : null}
            {previewView.verdictLead ? <p>{previewView.verdictLead}</p> : null}
            {previewView.claims.length ? (
              <ul data-gp-share-preview-claims>
                {previewView.claims.map((text) => (
                  <li key={text}>{text}</li>
                ))}
              </ul>
            ) : null}
            {previewView.sources.length ? (
              <ul data-gp-share-preview-sources>
                {previewView.sources.map((source) => (
                  <li key={source.url || source.title}>
                    {source.url ? (
                      <a href={source.url} rel="noreferrer nofollow">
                        {source.title || source.url}
                      </a>
                    ) : (
                      source.title
                    )}
                  </li>
                ))}
              </ul>
            ) : null}
          </article>
          <p className="gp-share-hint">{copy.shareExcluded}</p>
          <div className="gp-share-actions">
            <button type="button" className="gp-primary-btn" data-gp-share-confirm onClick={() => void create()}>
              {copy.shareConfirm}
            </button>
            <button type="button" className="gp-ghost-btn" onClick={() => setState({ phase: "idle" })}>
              {copy.cancel}
            </button>
          </div>
        </div>
      ) : null}

      {state.phase === "created" ? (
        <div className="gp-share-body">
          <p className="gp-share-hint">{copy.shareReady}</p>
          <p className="gp-share-url" data-gp-share-url>{state.url}</p>
          <div className="gp-share-actions">
            <button type="button" className="gp-link-btn" onClick={() => void copyLink(state.url)}>
              {copied ? copy.shareCopied : copy.shareCopy}
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
