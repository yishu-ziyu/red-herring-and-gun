/**
 * ProductShell — 生产产品壳（Issue #52 第二节）：轻量 Chrome。
 * 顶部只有品牌 / 新调查 / 历史；历史走 drawer，不再占固定栏位。
 * 主内容就是一张调查画布。
 */
import { useEffect, useState, type ReactNode } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import "./golden-path.css";

export type ShellCase = {
  id: string;
  claim: string;
  status: "running" | "done" | "interrupted";
  createdAt?: number;
  threadId?: string;
  roundCount?: number;
  report?: Record<string, unknown>;
};

type ProductShellProps = {
  cases: ShellCase[];
  activeCaseId: string | null;
  historyReady: boolean;
  onNewCase: () => void;
  onSelectCase: (id: string) => void;
  /** 正在看一次调查/旧结果：只有这时品牌才作为「回到空白输入」的入口。 */
  viewingInvestigation: boolean;
  topRightExtra?: ReactNode;
  children: ReactNode;
};

const CASE_STATUS_LABEL: Record<ShellCase["status"], string> = {
  running: "调查中",
  done: "已完成",
  interrupted: "没查完",
};

export function ProductShell({
  cases,
  activeCaseId,
  historyReady,
  onNewCase,
  onSelectCase,
  viewingInvestigation,
  topRightExtra,
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
        <div className="gp-topbar-inner">
          {/* 进门态品牌只是名字，不假装能点；回空白输入的入口只在看旧结果时出现在导航里。 */}
          <div className="gp-brand gp-brand--static">
            <img src="/logo.png?v=20260615" alt="" className="gp-brand-logo" />
            <div className="gp-brand-text">
              <span className="gp-brand-name">红鲱鱼与枪</span>
              <span className="gp-brand-tagline">{copy.brandTagline}</span>
            </div>
          </div>
          <nav className="gp-topbar-actions" aria-label="产品导航">
            {viewingInvestigation ? (
              <button type="button" className="gp-icon-btn" onClick={onNewCase}>
                {copy.newCheck}
              </button>
            ) : (
              <a className="gp-nav-text" href="#gp-examples">
                {copy.examplesNav}
              </a>
            )}
            {topRightExtra}
            <button
              type="button"
              className="gp-icon-btn"
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(true)}
            >
              <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="10" cy="10" r="7.2" />
                <path d="M10 5.8V10l2.8 1.8" strokeLinecap="round" />
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
            aria-label="关闭历史"
            onClick={() => setHistoryOpen(false)}
          />
          <aside className="gp-drawer gp-drawer--history" role="dialog" aria-label={copy.historyDrawerTitle}>
            <header className="gp-drawer-head">
              <strong>{copy.historyDrawerTitle}</strong>
              <button type="button" className="gp-icon-btn" onClick={() => setHistoryOpen(false)}>
                ✕
              </button>
            </header>
            <p className="gp-drawer-scope" data-gp-history-scope="local">
              {copy.historyScopeLocal}
            </p>
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
                      <strong>{item.claim}</strong>
                      <em>
                        <span data-gp-case-status={item.status}>{CASE_STATUS_LABEL[item.status]}</span>
                        {item.createdAt ? (
                          <span> · {new Date(item.createdAt).toLocaleDateString("zh-CN")}</span>
                        ) : null}
                      </em>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </>
      ) : null}

      <main className="gp-main">{children}</main>
    </div>
  );
}
