/**
 * ProductShell — 产品壳（Issue #52 第二节）。
 * 顶部只有品牌、新调查、历史记录；历史记录从右侧抽屉打开。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { formatDay } from "./snapshotUi";
import "./golden-path.css";

export type ShellCase = {
  id: string;
  claim: string;
  status: "running" | "done" | "interrupted";
  createdAt?: number;
  threadId?: string;
  roundCount?: number;
};

type ProductShellProps = {
  cases: ShellCase[];
  activeCaseId: string | null;
  historyReady: boolean;
  onNewCase: () => void;
  onSelectCase: (id: string) => void;
  /** 正在看一次调查/旧结果：只有这时品牌才作为「回到空白输入」的入口。 */
  viewingInvestigation: boolean;
  children: ReactNode;
};

/** 查完是常态，不标；只标还在查和没查完的。 */
const CASE_STATUS_LABEL: Record<ShellCase["status"], string> = {
  running: "调查中",
  done: "",
  interrupted: "未完成",
};

export function ProductShell({
  cases,
  activeCaseId,
  historyReady,
  onNewCase,
  onSelectCase,
  viewingInvestigation,
  children,
}: ProductShellProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [historyOpen, setHistoryOpen] = useState(false);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  return (
    <div className="gp-shell">
      <header className="gp-topbar">
        <div className="gp-topbar-inner gp-column">
          <div className="gp-brand">
            <img src="/mark.png" alt="" className="gp-brand-mark" />
            红鲱鱼与枪
          </div>
          <nav className="gp-topbar-actions" aria-label="产品导航">
            {viewingInvestigation ? (
              <button type="button" className="gp-icon-btn" onClick={onNewCase}>
                {copy.newCheck}
              </button>
            ) : null}
            <button
              type="button"
              className="gp-icon-btn"
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(true)}
            >
              <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="10" cy="10" r="7.25" />
                <path d="M10 6v4l2.75 1.75" strokeLinecap="round" />
              </svg>
              {copy.historyLabel}
            </button>
          </nav>
        </div>
      </header>

      {historyOpen ? (
        <>
          <button
            type="button"
            className="gp-scrim"
            aria-label={copy.close}
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="gp-drawer" role="dialog" aria-label={copy.historyLabel}>
            <header className="gp-drawer-head">
              <strong>{copy.historyLabel}</strong>
              <button
                type="button"
                className="gp-icon-btn gp-drawer-close"
                aria-label={copy.close}
                onClick={() => setHistoryOpen(false)}
              >
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>
            {!historyReady ? (
              <p className="gp-drawer-empty" role="status">{copy.loadingHistory}</p>
            ) : cases.length === 0 ? (
              <p className="gp-drawer-empty">{copy.historyEmpty}</p>
            ) : (
              <ul className="gp-history-list">
                {cases.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      className={`gp-history-item${item.id === activeCaseId ? " is-active" : ""}`}
                      onClick={() => {
                        setHistoryOpen(false);
                        onSelectCase(item.id);
                      }}
                    >
                      <span className="gp-history-claim">{item.claim}</span>
                      {CASE_STATUS_LABEL[item.status] || item.createdAt ? (
                        <span className="gp-history-meta">
                          {CASE_STATUS_LABEL[item.status] ? (
                            <span data-gp-case-status={item.status}>{CASE_STATUS_LABEL[item.status]}</span>
                          ) : null}
                          {item.createdAt ? <span>{formatDay(item.createdAt)}</span> : null}
                        </span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="gp-drawer-scope" data-gp-history-scope="local">
              {copy.historyScopeLocal}
            </p>
          </aside>
        </>
      ) : null}

      <main className="gp-main">{children}</main>
    </div>
  );
}
