/**
 * ProductShell — 生产产品壳（Issue #52 第二节）：轻量 Chrome。
 * 顶部只有品牌 / 新调查 / 历史 / 账号；历史与账号走 drawer，不再占固定栏位。
 * 主内容就是一张调查画布。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { accountInitial } from "../lib/accountIdentity";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import type { AccountProfile } from "../components/v3/auth/accountTypes";
import "./golden-path.css";

export type ShellCase = {
  id: string;
  claim: string;
  status: "running" | "done" | "interrupted";
  createdAt?: number;
};

type ProductShellProps = {
  cases: ShellCase[];
  activeCaseId: string | null;
  historyReady: boolean;
  onNewCase: () => void;
  onSelectCase: (id: string) => void;
  account: AccountProfile | null;
  onLoginClick: () => void;
  onAccountClick: () => void;
  onLogout: () => void;
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
  account,
  onLoginClick,
  onAccountClick,
  onLogout,
  topRightExtra,
  children,
}: ProductShellProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!accountRef.current?.contains(event.target as Node)) setAccountOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [accountOpen]);

  useEffect(() => {
    if (!historyOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [historyOpen]);

  const accountChip = account ? (
    <div className="gp-account-wrap" ref={accountRef}>
      <button
        type="button"
        className="gp-icon-btn gp-account-btn"
        aria-haspopup="menu"
        aria-expanded={accountOpen}
        aria-label={copy.accountLabel}
        onClick={() => setAccountOpen((open) => !open)}
      >
        <span className="gp-avatar" aria-hidden="true">{accountInitial(account.name)}</span>
        <span className="gp-account-name">{account.name}</span>
      </button>
      {accountOpen ? (
        <div className="gp-menu" role="menu">
          <button type="button" role="menuitem" onClick={() => { setAccountOpen(false); onAccountClick(); }}>
            {copy.accountMenu}
          </button>
          <a role="menuitem" href="/settings/api-key">{copy.modelSettings}</a>
          {/* 退出失败时菜单保持打开以便重试；成功由父层 handleLogout 关闭。 */}
          <button type="button" role="menuitem" onClick={() => onLogout()}>
            {copy.signOut}
          </button>
        </div>
      ) : null}
    </div>
  ) : (
    <>
      <a className="gp-icon-btn" href="/settings/api-key">
        {copy.modelSettings}
      </a>
      <button type="button" className="gp-icon-btn" onClick={onLoginClick}>
        {copy.signIn}
      </button>
    </>
  );

  return (
    <div className="gp-shell">
      <header className="gp-topbar">
        <div className="gp-topbar-inner">
          <button type="button" className="gp-brand" onClick={onNewCase} aria-label={copy.newCheck}>
            <img src="/logo.png?v=20260615" alt="" className="gp-brand-logo" />
            <span className="gp-brand-name">红鲱鱼与枪</span>
            <span className="gp-brand-divider" aria-hidden="true">|</span>
            <span className="gp-brand-tagline">{copy.brandTagline}</span>
          </button>
          <nav className="gp-topbar-actions" aria-label="产品导航">
            {topRightExtra}
            <button
              type="button"
              className="gp-icon-btn"
              aria-haspopup="dialog"
              aria-expanded={historyOpen}
              onClick={() => setHistoryOpen(true)}
            >
              <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="10" cy="10" r="7.2" />
                <path d="M10 5.8V10l2.8 1.8" strokeLinecap="round" />
              </svg>
              {copy.historyLabel}
            </button>
            {accountChip}
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
