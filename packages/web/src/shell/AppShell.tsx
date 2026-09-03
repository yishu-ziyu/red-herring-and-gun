import { type ReactNode, useEffect, useState } from "react";
import type { CaseListItem } from "../lib/api.js";
import { fixtureNameOf } from "../lib/catalog.js";
import {
  APP_TITLE,
  CLOSE_NAV,
  CLOSE_OVERLAY,
  CLOSE_PANEL,
  COLLAPSE_NAV,
  EXPAND_NAV,
  OPEN_NAV,
  OPEN_PANEL,
} from "../lib/copy.js";

const NAV_KEY = "rhg.navCollapsed";

type Props = {
  activeId?: string;
  cases: CaseListItem[];
  summary: { face: string; score?: number; status: string };
  panel: ReactNode;
  onOpen: (id: string) => void;
  onHome: () => void;
  children: ReactNode;
};

function useMinWidth(px: number): boolean {
  const read = () => window.innerWidth >= px;
  const [ok, setOk] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = () => setOk(read());
    mq.addEventListener("change", onChange);
    window.addEventListener("resize", onChange);
    setOk(read());
    return () => {
      mq.removeEventListener("change", onChange);
      window.removeEventListener("resize", onChange);
    };
  }, [px]);
  return ok;
}

export function AppShell(props: Props) {
  const desktop = useMinWidth(1024);
  const tablet = useMinWidth(768);
  const [navCollapsed, setNavCollapsed] = useState(() => localStorage.getItem(NAV_KEY) === "1");
  const [navOpen, setNavOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    localStorage.setItem(NAV_KEY, navCollapsed ? "1" : "0");
  }, [navCollapsed]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setNavOpen(false);
      setPanelOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const navDrawer = !tablet;
  const panelDrawer = !desktop;
  const navVisible = desktop || tablet || navOpen;
  const panelVisible = desktop || panelOpen;
  const overlayOpen = (navDrawer && navOpen) || (panelDrawer && panelOpen);

  return (
    <div
      className="shell"
      data-nav={navCollapsed ? "collapsed" : "open"}
      data-nav-open={navOpen ? "true" : "false"}
      data-panel-open={panelOpen ? "true" : "false"}
    >
      <div className="shell-summary">
        <p className="shell-summary-text font-serif">
          {props.summary.face}
          {props.summary.score !== undefined ? ` · ${props.summary.score}` : ""}
          {` · ${props.summary.status}`}
        </p>
        <div>
          {navDrawer ? (
            <button type="button" className="btn" onClick={() => setNavOpen(true)} aria-expanded={navOpen}>
              {OPEN_NAV}
            </button>
          ) : null}{" "}
          {panelDrawer ? (
            <button type="button" className="btn" onClick={() => setPanelOpen(true)} aria-expanded={panelOpen}>
              {OPEN_PANEL}
            </button>
          ) : null}
        </div>
      </div>

      {desktop && navCollapsed ? (
        <button
          type="button"
          className="btn nav-expand"
          aria-expanded={false}
          onClick={() => setNavCollapsed(false)}
        >
          {EXPAND_NAV}
        </button>
      ) : null}

      <nav
        className="shell-nav"
        hidden={!navVisible}
        aria-label="案件列表"
        aria-expanded={desktop ? !navCollapsed : navOpen}
      >
        <div className="shell-nav-inner">
          <div className="shell-nav-head">
            <p className="shell-brand font-serif">
              <button type="button" className="btn-ghost" onClick={props.onHome}>
                {APP_TITLE}
              </button>
            </p>
            {desktop ? (
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={!navCollapsed}
                onClick={() => setNavCollapsed(true)}
              >
                {COLLAPSE_NAV}
              </button>
            ) : navDrawer ? (
              <button type="button" className="btn btn-ghost" onClick={() => setNavOpen(false)}>
                {CLOSE_NAV}
              </button>
            ) : null}
          </div>
          <ul className="shell-list">
            {props.cases.map((item) => (
              <li key={item.caseId}>
                <button
                  type="button"
                  className="linkish"
                  aria-current={item.caseId === props.activeId ? "page" : undefined}
                  onClick={() => {
                    props.onOpen(item.caseId);
                    setNavOpen(false);
                  }}
                >
                  {item.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>

      <main className="shell-main">{props.children}</main>

      <aside
        className="shell-aside"
        hidden={!panelVisible}
        aria-label="案件面板"
        aria-expanded={panelVisible}
      >
        <div className="shell-aside-inner">
          <div className="shell-aside-head">
            <p className="status-line">{props.summary.status}</p>
            {panelDrawer ? (
              <button
                type="button"
                className="btn btn-ghost"
                aria-expanded={panelOpen}
                onClick={() => setPanelOpen(false)}
              >
                {CLOSE_PANEL}
              </button>
            ) : null}
          </div>
          {props.panel}
        </div>
      </aside>

      <button
        type="button"
        className="overlay"
        data-open={overlayOpen ? "true" : "false"}
        aria-label={CLOSE_OVERLAY}
        onClick={() => {
          setNavOpen(false);
          setPanelOpen(false);
        }}
      />
    </div>
  );
}

export function fixtureNavItems(): CaseListItem[] {
  return (["decomposing", "retrieving", "contested", "done", "followup"] as const).map((name) => ({
    caseId: `fx-${name}`,
    text: name,
    createdAt: "",
    updatedAt: "",
  }));
}

export function isFixtureId(id: string | undefined): boolean {
  return id !== undefined && fixtureNameOf(id) !== undefined;
}
