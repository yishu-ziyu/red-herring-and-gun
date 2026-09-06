/**
 * SourceDrawer — 来源下钻（Issue #65）。
 * 消费 Claim + EvidenceLink + Source：关系永远绑在当前命题上。
 * finding / limitation / excerpt 有才显示，不编解释。
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useUiLang } from "../lib/useUiLang";
import { gpCopyFor } from "./copy";
import { ROLE_LABEL, domainOf } from "./snapshotUi";
import type { InvestigationEvidenceLink, InvestigationSource } from "@rhg/core/investigation";

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export type SourceDrawerView = {
  claimId: string;
  claimIndex: number;
  claimText: string;
  source: InvestigationSource;
  link: InvestigationEvidenceLink;
};

type SourceDrawerProps = {
  view: SourceDrawerView;
  resolveState?: "live" | "held";
  onClose: () => void;
};

function isSheetPlacement(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(max-width: 768px)").matches;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => {
    if (el.getAttribute("aria-hidden") === "true") return false;
    if (el.hasAttribute("disabled")) return false;
    if (el.tabIndex < 0) return false;
    return true;
  });
}

export function SourceDrawer({ view, resolveState = "live", onClose }: SourceDrawerProps) {
  const { lang } = useUiLang();
  const copy = gpCopyFor(lang);
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const reduced = prefersReducedMotion();
  const [openClass, setOpenClass] = useState(reduced);
  const [placement] = useState<"sheet" | "drawer">(isSheetPlacement() ? "sheet" : "drawer");
  const { source, link, claimText, claimIndex } = view;
  const num = String(claimIndex + 1).padStart(2, "0");
  const relation = ROLE_LABEL[link.role];
  const excerpt = source.excerpt?.trim();
  const finding = link.finding?.trim();
  const limitation = link.limitation?.trim();
  const unreachable = source.reachable === false;
  const published = source.publishedAt?.trim();
  const retrieved = source.retrievedAt?.trim();

  useEffect(() => {
    const frame = requestAnimationFrame(() => setOpenClass(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    const topbar = document.querySelector<HTMLElement>(".gp-topbar");
    const canvasInner = document.querySelector<HTMLElement>(".gp-canvas-inner");
    const inertTargets = [topbar, canvasInner].filter((el): el is HTMLElement => Boolean(el));
    for (const el of inertTargets) {
      el.setAttribute("inert", "");
    }

    const closeBtn = panel?.querySelector<HTMLElement>("[data-gp-source-close]");
    closeBtn?.focus();
    if (panel && document.activeElement !== closeBtn) {
      panel.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      event.preventDefault();
      const items = focusableIn(panel);
      if (items.length === 0) {
        panel.focus();
        return;
      }
      const active = document.activeElement;
      const idx = items.indexOf(active as HTMLElement);
      if (event.shiftKey) {
        const next = idx <= 0 ? items[items.length - 1] : items[idx - 1];
        next?.focus();
      } else {
        const next = idx === -1 || idx >= items.length - 1 ? items[0] : items[idx + 1];
        next?.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      for (const el of inertTargets) {
        el.removeAttribute("inert");
        try {
          el.inert = false;
        } catch {
          /* jsdom may not implement the inert setter */
        }
      }
    };
  }, [onClose]);

  return (
    <div className="gp-source-layer" data-gp-source-layer>
      <button
        type="button"
        className={`gp-scrim${openClass ? " is-open" : ""}`}
        aria-label={copy.sourceClose}
        tabIndex={-1}
        data-gp-scrim="source"
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className={`gp-drawer gp-drawer--source${openClass ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-gp-placement={placement}
        data-gp-reduced-motion={reduced || undefined}
        data-gp-claim-id={view.claimId}
        data-gp-source-id={source.id}
        data-gp-role={link.role}
        data-gp-source-resolve={resolveState}
      >
        <header className="gp-drawer-head">
          <div className="gp-source-head-text">
            <strong className="gp-source-title" id={titleId}>
              {source.title || domainOf(source.url)}
            </strong>
            <p className="gp-source-kicker">
              <span className={`gp-role-glyph is-${link.role}`} aria-hidden="true">
                {link.role === "support" || link.role === "contradict" ? "●" : link.role === "context-only" ? "○" : "◌"}
              </span>
              <span>
                {copy.sourceRelation}：{relation}
              </span>
              <span aria-hidden="true">·</span>
              <span className="gp-source-domain">{domainOf(source.url)}</span>
            </p>
          </div>
          <button type="button" className="gp-icon-btn" autoFocus onClick={onClose} aria-label={copy.sourceClose} data-gp-source-close>
            ✕
          </button>
        </header>

        <div className="gp-source-body">
          <section className="gp-source-block" data-gp-source-section="claim">
            <h3 className="gp-source-label">{copy.sourceAgainstClaim}</h3>
            <p className="gp-source-claim">
              <span className="gp-source-claim-num" aria-hidden="true">
                {num}
              </span>
              <span>{claimText}</span>
            </p>
          </section>

          {excerpt ? (
            <section className="gp-source-block" data-gp-source-section="excerpt">
              <h3 className="gp-source-label">{copy.sourceExcerpt}</h3>
              <blockquote className="gp-source-excerpt">{excerpt}</blockquote>
            </section>
          ) : null}

          {finding ? (
            <section className="gp-source-block" data-gp-source-section="finding">
              <h3 className="gp-source-label">{copy.sourceFinding}</h3>
              <p className="gp-source-prose">{finding}</p>
            </section>
          ) : null}

          {limitation ? (
            <section className="gp-source-block" data-gp-source-section="limitation">
              <h3 className="gp-source-label">{copy.sourceLimitation}</h3>
              <p className="gp-source-prose">{limitation}</p>
            </section>
          ) : null}

          {(published || retrieved || unreachable) ? (
            <section className="gp-source-block" data-gp-source-section="status">
              {published ? (
                <p className="gp-source-time">
                  {copy.sourcePublished} {published}
                </p>
              ) : null}
              {retrieved ? (
                <p className="gp-source-time">
                  {copy.sourceRetrieved} {retrieved}
                </p>
              ) : null}
              {unreachable ? (
                <p className="gp-source-unreachable" role="status">
                  {copy.sourceUnreachable}
                </p>
              ) : null}
            </section>
          ) : null}
        </div>

        <a
          className="gp-source-open"
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          {copy.viewSource}
          <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 12 12 4M6 4h6v6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </a>
      </aside>
    </div>
  );
}

export function resolveSourceDrawerView(
  claims: Array<{ id: string; text: string; evidence: InvestigationEvidenceLink[] }>,
  sources: InvestigationSource[],
  claimId: string,
  sourceId: string,
  role?: InvestigationEvidenceLink["role"],
): SourceDrawerView | null {
  const claimIndex = claims.findIndex((c) => c.id === claimId);
  const claim = claimIndex >= 0 ? claims[claimIndex] : undefined;
  const source = sources.find((s) => s.id === sourceId);
  const matches = claim?.evidence.filter((item) => item.sourceId === sourceId) ?? [];
  const roleMatches = role ? matches.filter((item) => item.role === role) : matches;
  let link: InvestigationEvidenceLink | undefined;
  if (roleMatches.length === 1) link = roleMatches[0];
  else if (matches.length === 1) link = matches[0];
  else link = undefined;
  if (!claim || !source || !link) return null;
  return {
    claimId: claim.id,
    claimIndex,
    claimText: claim.text,
    source,
    link,
  };
}
