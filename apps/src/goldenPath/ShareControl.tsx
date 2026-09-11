/**
 * ShareControl — 显式分享（IMPLEMENTATION_PLAN §3.5）。
 *
 * 顺序是：先看清楚会公开哪些字段 → 再创建 → 复制要等服务器写完 → 可以撤销。
 * 不预览就发链接、复制成功但服务器没写成功，都是假的分享。
 */
import { useEffect, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";

type ShareState =
  | { phase: "idle" }
  | { phase: "previewing" }
  | { phase: "preview"; fields: string[] }
  | { phase: "creating" }
  | { phase: "created"; url: string; shareId: string }
  | { phase: "revoked" }
  | { phase: "error"; message: string };

/** 公开字段名用产品语义说，不用字段名说。 */
function publicFieldLabels(preview: Record<string, unknown>): string[] {
  const labels: string[] = [];
  if (typeof preview.claim === "string") labels.push("原说法");
  if (preview.report) labels.push("结论与拆出的问题");
  if (preview.checkedAt) labels.push("核查完成时间");
  labels.push("原调查时间");
  return labels;
}

export function ShareControl({ caseId }: { caseId: string }) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [state, setState] = useState<ShareState>({ phase: "idle" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setState({ phase: "idle" });
    setCopied(false);
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
      const data = (await response.json()) as { preview?: Record<string, unknown> };
      setState({ phase: "preview", fields: publicFieldLabels(data.preview ?? {}) });
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
    } catch {
      setCopied(false);
    }
  };

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

      {state.phase === "preview" ? (
        <div className="gp-share-body">
          <p className="gp-share-hint">{copy.sharePreviewLead}</p>
          <ul className="gp-share-fields">
            {state.fields.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
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
