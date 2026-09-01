/**
 * AppShell — 最外层三栏：历史 | 工作台 | 卷宗。
 * 开源零件：react-resizable-panels（Claude / VS Code 同款分栏）。
 * 这不是聊天产品壳：左栏是查过的材料，中间是正在查，右侧是判断文书。
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator, usePanelRef } from "react-resizable-panels";
import { accountInitial } from "../../lib/accountIdentity";
import { useUiLang } from "../../lib/useUiLang";
import type { UiCopy } from "../../lib/uiLang";
import type { AccountProfile } from "./auth/accountTypes";

export type DeskCaseStatus = "running" | "done" | "interrupted";

export type DeskCase = {
  id: string;
  claim: string;
  status: DeskCaseStatus;
  report?: Record<string, unknown> | null;
};

type AppShellProps = {
  cases: DeskCase[];
  activeCaseId: string | null;
  onNewCase: () => void;
  onSelectCase: (id: string) => void;
  artifactTitle: string;
  artifactOpen: boolean;
  onArtifactOpenChange: (open: boolean) => void;
  artifact?: ReactNode;
  account?: AccountProfile | null;
  onLoginClick?: () => void;
  onLogout?: () => void;
  onAccountClick?: () => void;
  children: ReactNode;
};

function statusLabel(status: DeskCaseStatus, copy: UiCopy) {
  if (status === "running") return copy.statusRunning;
  if (status === "interrupted") return copy.statusInterrupted;
  return copy.statusDone;
}

export function AppShell({
  cases,
  activeCaseId,
  onNewCase,
  onSelectCase,
  artifactTitle,
  artifactOpen,
  onArtifactOpenChange,
  artifact,
  account = null,
  onLoginClick,
  onLogout,
  onAccountClick,
  children,
}: AppShellProps) {
  const { copy } = useUiLang();
  const dossierRef = usePanelRef();
  const [narrow, setNarrow] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 860px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const panel = dossierRef.current;
    if (!panel) return;
    if (artifactOpen) panel.expand();
    else panel.collapse();
  }, [artifactOpen, dossierRef]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const accountChip = account ? (
    <div className="app-shell-account-wrap" ref={menuRef}>
      <button
        type="button"
        className="app-shell-account"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((open) => !open)}
      >
        <span className="app-shell-avatar" aria-hidden="true">
          {accountInitial(account.name)}
        </span>
        <span className="app-shell-account-copy">
          <strong>{account.name}</strong>
          <em>{account.email}</em>
        </span>
      </button>
      {menuOpen ? (
        <div className="app-shell-account-menu" role="menu">
          {onAccountClick ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onAccountClick();
              }}
            >
              {copy.accountMenu}
            </button>
          ) : null}
          <a className="app-shell-account-menu-link" role="menuitem" href="/settings/api-key">
            {copy.modelSettings}
          </a>
          {onLogout ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              {copy.signOut}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : onLoginClick ? (
    <button type="button" className="app-shell-login" onClick={onLoginClick}>
      <span className="app-shell-account-mark" aria-hidden="true" />
      {copy.signIn}
    </button>
  ) : null;

  const rail = (
    <aside className="app-shell-rail" aria-label={copy.historyLabel}>
      <div className="app-shell-rail-brand">
        <img src="/logo.png?v=20260615" alt="" className="app-shell-logo" />
        <span>红鲱鱼与枪</span>
      </div>
      <button type="button" className="app-shell-new" onClick={onNewCase}>
        {copy.newCheck}
      </button>
      <p className="app-shell-rail-label">{copy.recentLabel}</p>
      {cases.length === 0 ? (
        <p className="app-shell-rail-empty">{copy.recentEmpty}</p>
      ) : (
        <ul className="app-shell-case-list">
          {cases.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`app-shell-case${item.id === activeCaseId ? " is-active" : ""}`}
                onClick={() => onSelectCase(item.id)}
              >
                <strong>{item.claim}</strong>
                <em>{statusLabel(item.status, copy)}</em>
              </button>
            </li>
          ))}
        </ul>
      )}
      <nav className="app-shell-rail-foot" aria-label={copy.accountNavLabel}>
        <div className="app-shell-rail-dock">
          {accountChip}
          {account ? null : (
            <a className="app-shell-rail-meta" href="/settings/api-key">
              {copy.modelSettings}
            </a>
          )}
        </div>
      </nav>
    </aside>
  );

  const dossier = (
    <aside
      className="app-shell-dossier"
      aria-label={copy.dossierLabel}
      aria-hidden={artifactOpen ? undefined : true}
      {...(artifactOpen ? {} : { inert: true })}
    >
      <header className="app-shell-dossier-head">
        <strong>{artifactTitle || copy.dossierTitle}</strong>
        <button
          type="button"
          className="app-shell-dossier-close"
          onClick={() => onArtifactOpenChange(false)}
        >
          {copy.collapse}
        </button>
      </header>
      <div className="app-shell-dossier-stage">
        <div className="app-shell-paper">
          {artifact ?? (
            <p className="app-shell-paper-empty">{copy.paperEmpty}</p>
          )}
        </div>
      </div>
    </aside>
  );

  if (narrow) {
    return (
      <div className="app-shell app-shell--narrow">
        <header className="app-shell-narrow-bar">
          <button type="button" onClick={onNewCase}>
            {copy.newCheck}
          </button>
          <span>红鲱鱼与枪</span>
          {account ? (
            <button type="button" onClick={onAccountClick ?? onLogout}>
              {account.name}
            </button>
          ) : onLoginClick ? (
            <button type="button" onClick={onLoginClick}>
              {copy.signIn}
            </button>
          ) : null}
          <button type="button" onClick={() => onArtifactOpenChange(!artifactOpen)}>
            {artifactOpen ? copy.dossierCollapse : copy.dossierToggle}
          </button>
        </header>
        <div className="app-shell-narrow-body">
          {artifactOpen ? dossier : <div className="app-shell-center">{children}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Group
        id="desk-shell"
        className="app-shell-group"
        orientation="horizontal"
        resizeTargetMinimumSize={{ coarse: 8, fine: 8 }}
      >
        <Panel
          id="rail"
          className="app-shell-panel"
          defaultSize={248}
          minSize={196}
          maxSize={320}
          groupResizeBehavior="preserve-pixel-size"
        >
          {rail}
        </Panel>
        <Separator className="app-shell-separator" />
        <Panel id="desk" className="app-shell-panel" minSize="36%">
          <div className="app-shell-center">{children}</div>
        </Panel>
        <Separator className="app-shell-separator" />
        <Panel
          id="dossier"
          className="app-shell-panel"
          panelRef={dossierRef}
          defaultSize="32%"
          minSize="22%"
          collapsible
          collapsedSize={0}
        >
          {dossier}
        </Panel>
      </Group>
    </div>
  );
}
