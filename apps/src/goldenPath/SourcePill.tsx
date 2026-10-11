/**
 * 资料在页面上的三种样子，进度页和结果页共用，所以外观和交互只有一份：
 *
 * - SourceFavicon：网站图标。图标走我们自己的 /api/favicon，用户的浏览器不直接连第三方图标服务；
 *   取不到（404、坏链接）就换成同样大小的灰色地球，不加底框，排版不跳。同一个网站失败一次，整页都不再请求。
 * - SourcePill：进度页里一排排出现的资料，只告诉用户找到了什么、读到哪一份、读完是什么立场；不能点。
 * - SourceCitation：正文和折起来的要点行里的引用，点开或悬停看引用卡。
 *
 * 引用卡整页只有一张（SourcePopoverProvider 渲染，挂在 <body> 上）：几十个引用各带一张卡，焦点、Esc、
 * 点外面关闭就会互相打架。Provider 已经包在 InvestigationCanvas 外层，进度页和结果页直接用 SourceCitation 即可。
 *
 * 引用卡底部的「在全部资料里看」要打开结果页的抽屉，但抽屉不归画布管。抽屉组件自己调用
 * useRegisterDrawerOpener(open) 登记打开方法即可，不用改画布；没人登记时这个按钮不出现，不许诺做不到的事。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import type { InvestigationSource } from "../lib/investigation";
import { Icon } from "./Icon";
import { journeyCopy } from "./journeyCopy";
import {
  hostOf,
  publisherOf,
  relationHref,
  relationPassage,
  relationText,
  ROLE_BADGE,
  ROLE_LABEL,
  ROLE_TONE,
  siteOf,
  type EvidenceRole,
  type SourceRelation,
} from "./sourceUi";
import "./source.css";

/* ---------- 网站图标 ---------- */

const failedHosts = new Set<string>();

export function SourceFavicon({ url, className }: { url?: string; className?: string }) {
  const host = hostOf(url);
  const [failedHost, setFailedHost] = useState<string | null>(null);
  const cls = className ? `gp-favicon ${className}` : "gp-favicon";
  if (!host || failedHost === host || failedHosts.has(host)) return <Icon name="globe" className={`${cls} is-fallback`} />;
  return (
    <img
      className={cls}
      src={`/api/favicon?host=${encodeURIComponent(host)}`}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={() => {
        failedHosts.add(host);
        setFailedHost(host);
      }}
    />
  );
}

/* ---------- 进度页的药丸 ---------- */

type SourcePillProps = {
  source: InvestigationSource;
  /** 读完以后的立场；还没读完不给。 */
  role?: EvidenceRole;
  /** 正在读这一份：立场位写「在读」。 */
  state?: "reading";
  /** 刚找到：从下往上淡入；一排里依次错开 enterDelayMs。 */
  entering?: boolean;
  enterDelayMs?: number;
};

export function SourcePill({ source, role, state, entering = false, enterDelayMs = 0 }: SourcePillProps) {
  const reading = state === "reading";
  const tag = reading ? journeyCopy.pillReading : role ? ROLE_LABEL[role] : "";
  const cls = ["gp-source-pill", reading ? "is-reading" : role ? `is-${role}` : "", entering ? "is-enter" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <span
      className={cls}
      title={source.title || undefined}
      data-gp-pill-id={source.id}
      data-gp-pill-role={reading ? "reading" : role}
      style={entering && enterDelayMs ? ({ ["--gp-enter-delay" as string]: `${enterDelayMs}ms` } as CSSProperties) : undefined}
    >
      <SourceFavicon url={source.url} />
      <span className="gp-source-domain">{publisherOf(source)}</span>
      {tag ? <span className={`gp-source-stance-tag${!reading && role ? ` is-${role}` : ""}`}>{tag}</span> : null}
    </span>
  );
}

/* ---------- 引用卡的状态（整页一份） ---------- */

/** 抽屉登记的打开方法。trigger 是打开引用卡的那个引用，抽屉关上后可以把焦点还给它。 */
export type DrawerOpener = (sourceId: string, trigger: HTMLElement | null) => void;

type OpenedBy = "hover" | "focus" | "click";

type OpenCard = { key: string; anchor: HTMLElement; items: SourceRelation[]; index: number; by: OpenedBy };

type PopoverActions = {
  popoverId: string;
  show: (key: string, anchor: HTMLElement, items: SourceRelation[], by: OpenedBy) => void;
  update: (key: string, items: SourceRelation[]) => void;
  hideSoon: (key: string) => void;
  cancelHide: () => void;
  close: (returnFocus: boolean) => void;
  /** 焦点进了卡（点了卡上任何地方或用 Tab 进来）：用户在看这张卡，鼠标移开也不关。 */
  pin: () => void;
  /** 焦点离开引用或引用卡以后，焦点不在两者之内就关掉（悬停打开的卡跟着鼠标走，不管焦点）。 */
  checkFocus: () => void;
  /** 焦点是 Esc 关卡时还回来的：这次聚焦不再打开卡。 */
  consumeReturnedFocus: (anchor: HTMLElement) => boolean;
  registerDrawerOpener: (open: DrawerOpener) => () => void;
};

const ActionsContext = createContext<PopoverActions | null>(null);
const OpenKeyContext = createContext<{ key: string; by: OpenedBy } | null>(null);

// 鼠标从引用移到卡上要经过一道空隙，给它这么久，不然卡会在半路消失（原型 c.js 同值）。
const HIDE_DELAY_MS = 220;
// 卡离引用和视口边缘的距离，同 --gp-space-8 / --gp-space-16。
const ANCHOR_GAP = 8;
const VIEWPORT_EDGE = 16;

export function SourcePopoverProvider({ children, onOpenInDrawer }: { children: ReactNode; onOpenInDrawer?: DrawerOpener }) {
  const popoverId = useId();
  const [open, setOpenState] = useState<OpenCard | null>(null);
  // 包一层对象：state 直接放函数，setState 会把它当成更新函数调用。
  const [registered, setRegistered] = useState<{ open: DrawerOpener } | null>(null);
  const openRef = useRef<OpenCard | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const focusCardNext = useRef(false);
  const returnedFocus = useRef<HTMLElement | null>(null);

  const setOpen = useCallback((next: OpenCard | null) => {
    openRef.current = next;
    setOpenState(next);
  }, []);

  const cancelHide = useCallback(() => window.clearTimeout(hideTimer.current), []);

  const close = useCallback(
    (returnFocus: boolean) => {
      cancelHide();
      const current = openRef.current;
      if (!current) return;
      setOpen(null);
      if (returnFocus && current.anchor.isConnected && document.activeElement !== current.anchor) {
        returnedFocus.current = current.anchor;
        current.anchor.focus({ preventScroll: true });
      }
    },
    [cancelHide, setOpen],
  );

  const actions = useMemo<PopoverActions>(
    () => ({
      popoverId,
      show(key, anchor, items, by) {
        cancelHide();
        const current = openRef.current;
        if (current?.key === key) {
          // 悬停或聚焦打开的卡，再点一下就钉住，鼠标移开也不关；焦点移进卡里，键盘可以直接翻页、打开出处。
          if (by === "click" && current.by !== "click") {
            focusCardNext.current = true;
            setOpen({ ...current, items, by });
          }
          return;
        }
        focusCardNext.current = by === "click";
        setOpen({ key, anchor, items, index: 0, by });
      },
      update(key, items) {
        const current = openRef.current;
        if (current?.key !== key || current.items === items) return;
        setOpen({ ...current, items, index: Math.min(current.index, Math.max(items.length - 1, 0)) });
      },
      hideSoon(key) {
        if (openRef.current?.key !== key) return;
        cancelHide();
        hideTimer.current = window.setTimeout(() => setOpen(null), HIDE_DELAY_MS);
      },
      cancelHide,
      close,
      pin() {
        const current = openRef.current;
        cancelHide();
        if (current && current.by !== "click") setOpen({ ...current, by: "click" });
      },
      checkFocus() {
        window.setTimeout(() => {
          const current = openRef.current;
          if (!current || current.by === "hover" || !document.hasFocus()) return;
          const active = document.activeElement;
          if (active && (current.anchor === active || cardRef.current?.contains(active))) return;
          close(false);
        }, 0);
      },
      consumeReturnedFocus(anchor) {
        if (returnedFocus.current !== anchor) return false;
        returnedFocus.current = null;
        return true;
      },
      registerDrawerOpener(open) {
        const entry = { open };
        setRegistered(entry);
        return () => setRegistered((current) => (current === entry ? null : current));
      },
    }),
    [popoverId, cancelHide, close, setOpen],
  );

  useEffect(() => () => window.clearTimeout(hideTimer.current), []);

  // 引用被重新渲染掉了（比如进度页一行折起来），卡就没有地方指了。
  useLayoutEffect(() => {
    if (open && !open.anchor.isConnected) setOpen(null);
  });

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!open || !card) return;
    const place = () => {
      const rect = open.anchor.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;
      const width = card.offsetWidth;
      const height = card.offsetHeight;
      const left = Math.max(VIEWPORT_EDGE, Math.min(rect.left, viewportWidth - width - VIEWPORT_EDGE));
      const fitsBelow = rect.bottom + ANCHOR_GAP + height <= viewportHeight - VIEWPORT_EDGE;
      const fitsAbove = rect.top - ANCHOR_GAP - height >= VIEWPORT_EDGE;
      const below = fitsBelow || !fitsAbove;
      const top = below ? rect.bottom + ANCHOR_GAP : rect.top - ANCHOR_GAP - height;
      card.style.left = `${left + window.scrollX}px`;
      card.style.top = `${top + window.scrollY}px`;
      card.dataset.placement = below ? "bottom" : "top";
    };
    place();
    if (focusCardNext.current) {
      focusCardNext.current = false;
      card.focus({ preventScroll: true });
    }
    // 进度页一边查一边长高，引用会被推下去；页面尺寸一变就跟着重新对齐。
    const observer = new ResizeObserver(place);
    observer.observe(document.body);
    window.addEventListener("resize", place);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const isOpen = Boolean(open);
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as Node | null;
      const current = openRef.current;
      if (!target || !current) return;
      if (cardRef.current?.contains(target) || current.anchor.contains(target)) return;
      close(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      const current = openRef.current;
      close(Boolean(active && (cardRef.current?.contains(active) || current?.anchor === active)));
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen, close]);

  const opener = registered?.open ?? onOpenInDrawer ?? null;
  const openKey = useMemo(() => (open ? { key: open.key, by: open.by } : null), [open]);

  return (
    <ActionsContext.Provider value={actions}>
      <OpenKeyContext.Provider value={openKey}>
        {children}
        {open
          ? createPortal(
              <SourcePopover
                cardRef={cardRef}
                id={popoverId}
                card={open}
                onPage={(index) => setOpen({ ...open, index })}
                onPointerEnter={(event) => event.pointerType === "mouse" && cancelHide()}
                onPointerLeave={(event) => event.pointerType === "mouse" && open.by === "hover" && actions.hideSoon(open.key)}
                onFocus={actions.pin}
                onBlur={actions.checkFocus}
                onOpenInDrawer={
                  opener
                    ? (sourceId) => {
                        const trigger = open.anchor;
                        close(false);
                        opener(sourceId, trigger);
                      }
                    : undefined
                }
              />,
              document.body,
            )
          : null}
      </OpenKeyContext.Provider>
    </ActionsContext.Provider>
  );
}

/**
 * 抽屉登记「在全部资料里看」要调用的打开方法。传 undefined 等于没登记。
 * 每次渲染传新的函数也没关系：这里只在登记与否变化时重新登记，调用时总用最新那个函数。
 */
export function useRegisterDrawerOpener(open: DrawerOpener | undefined): void {
  const register = useContext(ActionsContext)?.registerDrawerOpener;
  const latest = useRef(open);
  useLayoutEffect(() => {
    latest.current = open;
  });
  const enabled = Boolean(open);
  useEffect(() => {
    if (!register || !enabled) return;
    return register((sourceId, trigger) => latest.current?.(sourceId, trigger));
  }, [register, enabled]);
}

/* ---------- 引用卡 ---------- */

function SourcePopover({
  cardRef,
  id,
  card,
  onPage,
  onPointerEnter,
  onPointerLeave,
  onFocus,
  onBlur,
  onOpenInDrawer,
}: {
  cardRef: RefObject<HTMLDivElement | null>;
  id: string;
  card: OpenCard;
  onPage: (index: number) => void;
  onPointerEnter: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLDivElement>) => void;
  onFocus: () => void;
  onBlur: (event: FocusEvent<HTMLDivElement>) => void;
  onOpenInDrawer?: (sourceId: string) => void;
}) {
  const total = card.items.length;
  const item = card.items[Math.min(card.index, total - 1)];
  if (!item) return null;
  const { source, role, claimNo } = item;
  const site = siteOf(source.url);
  const href = relationHref(item);
  const passage = relationPassage(item);
  const publisher = publisherOf(source);
  const titleId = `${id}-title`;
  const page = (step: number) => onPage((card.index + step + total) % total);
  return (
    <div
      ref={cardRef}
      id={id}
      className="gp-source-popover"
      role="dialog"
      aria-labelledby={titleId}
      tabIndex={-1}
      data-gp-source-popover={source.id}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      onFocus={onFocus}
      onBlur={onBlur}
    >
      <div className="gp-source-popover-meta">
        <span className={`gp-label gp-label--small gp-label--${ROLE_TONE[role]}`}>{ROLE_BADGE[role]}</span>
        {total > 1 ? (
          <>
            <span className="gp-source-popover-idx" aria-live="polite">
              {card.index + 1} / {total}
            </span>
            <span className="gp-source-popover-pager">
              <button type="button" aria-label={journeyCopy.popoverPrev} onClick={() => page(-1)}>
                <Icon name="chevron-left" />
              </button>
              <button type="button" aria-label={journeyCopy.popoverNext} onClick={() => page(1)}>
                <Icon name="chevron-right" />
              </button>
            </span>
          </>
        ) : null}
      </div>
      <div className="gp-source-popover-head">
        <SourceFavicon url={source.url} />
        {href ? (
          <a
            className="gp-source-popover-domain"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={journeyCopy.openSite(site)}
          >
            {site}
            <Icon name="arrow-up-right" />
          </a>
        ) : (
          <span className="gp-source-popover-domain">{site || publisher}</span>
        )}
      </div>
      <p id={titleId} className="gp-source-popover-title">
        {source.title?.trim() || publisher}
      </p>
      {passage ? <blockquote className={`gp-source-popover-snippet is-${role}`}>「{passage}」</blockquote> : null}
      <div className="gp-source-popover-footer">
        <span className="gp-source-popover-tip">{relationText(role, claimNo)}</span>
        {onOpenInDrawer ? (
          <button type="button" className="gp-source-popover-action" onClick={() => onOpenInDrawer(source.id)}>
            {journeyCopy.openInDrawer}
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- 引用 ---------- */

type SourceCitationProps = {
  /** 这处引用指向的资料，按要展示的顺序；通常来自 claimSourceRelations。为空时不渲染。 */
  items: SourceRelation[];
  /** inline：跟在正文句子后面；fold：折起来的要点行右侧。 */
  variant?: "inline" | "fold";
};

export function SourceCitation({ items, variant = "inline" }: SourceCitationProps) {
  const actions = useContext(ActionsContext);
  const openKey = useContext(OpenKeyContext);
  const key = useId();
  const isOpen = openKey?.key === key;

  useEffect(() => {
    if (isOpen) actions?.update(key, items);
  }, [actions, isOpen, key, items]);

  if (items.length === 0) return null;
  const first = items[0];
  const publishers = [...new Set(items.map((item) => publisherOf(item.source)))];
  const mouse = (event: PointerEvent) => event.pointerType === "mouse";

  return (
    <button
      type="button"
      className={`gp-source-pill gp-source-pill--cite${variant === "fold" ? " gp-source-pill--fold" : ""} is-${first.role}${isOpen ? " on" : ""}`}
      aria-label={journeyCopy.citeAria(publishers)}
      aria-haspopup="dialog"
      aria-expanded={isOpen}
      aria-controls={isOpen ? actions?.popoverId : undefined}
      data-gp-cite={items.map((item) => item.source.id).join(" ")}
      onPointerEnter={(event) => actions && mouse(event) && actions.show(key, event.currentTarget, items, "hover")}
      onPointerLeave={(event) => actions && mouse(event) && openKey?.by === "hover" && actions.hideSoon(key)}
      onFocus={(event) => {
        if (actions && !actions.consumeReturnedFocus(event.currentTarget)) actions.show(key, event.currentTarget, items, "focus");
      }}
      onBlur={() => actions?.checkFocus()}
      onClick={(event) => {
        event.stopPropagation();
        if (!actions) return;
        if (isOpen && openKey?.by === "click") actions.close(false);
        else actions.show(key, event.currentTarget, items, "click");
      }}
    >
      <span className="gp-source-stack" aria-hidden="true">
        {items.slice(0, 3).map((item, i) => (
          <SourceFavicon key={`${item.source.id}:${i}`} url={item.source.url} />
        ))}
      </span>
      <span className="gp-source-domain">{publisherOf(first.source)}</span>
      {items.length > 1 ? (
        <span className="gp-source-count">+{items.length - 1}</span>
      ) : (
        <span className={`gp-source-stance-tag is-${first.role}`}>{ROLE_LABEL[first.role]}</span>
      )}
    </button>
  );
}
