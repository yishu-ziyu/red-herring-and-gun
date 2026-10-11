/**
 * ProgressView — 调查进行中（和停下时）的页面，照原型 flow C（Focus，2026-10-11 定稿）。
 *
 * 每个要点从拆出来到查完都是同一个元素（按 claim.id），只在原地换状态，不重插、不重排，所以页面不跳。
 * 状态全部从真实快照推出，不按秒解锁、不编正在读哪一篇：
 * - 快照只说「这个要点搜过了」（progress=searching）和找到了哪些资料；读没读、读完什么立场，
 *   要看资料有没有读取结果（fetchStatus）和依据有没有立场。活动流里的信息也都来自快照差分，这里不另读。
 * - 判断阶段（phase=judging）是整轮的，所以还没判完的要点都说「在对照资料判断」。
 *
 * 整页只有一个转圈：正在查的第一个要点。其他没查完的要点用不转的虚线圈。还没拆出要点时，
 * 页面顶上的进度环转圈代替它，免得页面看起来停住了。
 * 查完的要点在焦点移到下一个要点时折成一行，引用和判断标签放在行尾，整行是一个展开按钮。
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { InvestigationClaim, InvestigationSnapshotV1, InvestigationSource } from "../lib/investigation";
import { CHECKABILITY_HINT, claimLabel, LABEL_TEXT, LABEL_TONE, type LabelKey } from "./snapshotUi";
import { claimSourceRelations, publisherOf, roleRank, type EvidenceRole } from "./sourceUi";
import { journeyCopy, type ConflictSide } from "./journeyCopy";
import { Icon, type IconName } from "./Icon";
import { SourceCitation, SourcePill } from "./SourcePill";
import { EvidenceRow } from "./ResultView";
import "./progress.css";

type ProgressViewProps = {
  snapshot: InvestigationSnapshotV1;
  claims: InvestigationClaim[];
  /** 中断或停止：整页冻结，不再说「在……」，没查完的要点标「没查完」。 */
  interrupted: boolean;
  /** 原句里没进本轮核查的部分，必须明说。 */
  leftoverNote: string;
  /** 已经查完、报告还没换上来：每个要点都展开，让人看清查到了什么。 */
  finishing?: boolean;
  /** 正在淡出，接着换成报告。 */
  leaving?: boolean;
};

type PartState = "pending" | "deferred" | "searching" | "reading" | "judging" | "judged" | "uncertain" | "unjudged" | "failed";

const WORKING: ReadonlySet<PartState> = new Set(["searching", "reading", "judging"]);
const FINISHED: ReadonlySet<PartState> = new Set(["judged", "uncertain", "unjudged"]);
// 有这些读取结果，说明这份资料已经去读过了（读到、截断、受限、失败都算读过）；snippet-only 是检索时就有的。
const READ_RESULTS: ReadonlySet<string> = new Set(["fetched", "truncated", "restricted", "failed"]);

type Part = { claim: InvestigationClaim; no: number; state: PartState; label: LabelKey | null; found: string[] };

function partState(
  claim: InvestigationClaim,
  label: LabelKey | null,
  ctx: { phase: InvestigationSnapshotV1["phase"]; frozen: boolean; deferred: boolean; sourceById: Map<string, InvestigationSource> },
): PartState {
  if (label) return label === "unresolved" ? "uncertain" : "judged";
  if (ctx.deferred) return "deferred";
  if (ctx.frozen || claim.progress === "interrupted") return "failed";
  // 整轮查完了这一截却没有标签（旧快照、没判出来）：不再转圈，也不替它编一个判断。
  if (ctx.phase === "complete") return "unjudged";
  if (claim.progress === "pending") return "pending";
  if (ctx.phase === "judging") return "judging";
  if (!claim.evidence.some((link) => ctx.sourceById.has(link.sourceId))) return "searching";
  return ctx.phase === "investigating" ? "reading" : "searching";
}

export function ProgressView({ snapshot, claims, interrupted, leftoverNote, finishing = false, leaving = false }: ProgressViewProps) {
  const frozen = interrupted;
  const sourceById = useMemo(() => new Map(snapshot.sources.map((source) => [source.id, source])), [snapshot.sources]);
  const deferredIds = new Set(snapshot.scope?.deferredClaimIds ?? []);
  const parts: Part[] = claims.map((claim, index) => {
    const label = claimLabel(claim);
    return {
      claim,
      no: index + 1,
      label,
      state: partState(claim, label, { phase: snapshot.phase, frozen, deferred: deferredIds.has(claim.id), sourceById }),
      found: [...new Set(claim.evidence.map((link) => link.sourceId))].filter((id) => sourceById.has(id)),
    };
  });

  const activeId = frozen || finishing ? null : (parts.find((part) => WORKING.has(part.state))?.claim.id ?? null);
  // 刚查完的要点先留在卡片里，等下一个要点开始查才折起来：不然判断一出来就缩成一行，人还没看清。
  const [lastFocus, setLastFocus] = useState<string | null>(null);
  if (activeId && activeId !== lastFocus) setLastFocus(activeId);
  const focusId = frozen || finishing ? null : (activeId ?? (parts.some((part) => part.claim.id === lastFocus && part.label) ? lastFocus : null));
  const [toggled, setToggled] = useState<Record<string, boolean>>({});

  const counted = parts.filter((part) => part.state !== "deferred");
  const total = counted.length;
  const done = counted.filter((part) => part.label !== null).length;
  const allDone = total > 0 && done === total;
  const ringSpins = !frozen && !finishing && claims.length === 0;
  const phase = allDone
    ? journeyCopy.phaseWriting(total)
    : finishing
      ? journeyCopy.phaseDone
      : snapshot.phase === "received" || claims.length === 0
        ? journeyCopy.phaseReading
        : done > 0
          ? journeyCopy.phasePartial(done, total - done)
          : journeyCopy.phaseSplit(claims.length);

  let unfinishedBefore = 0;
  return (
    <div className={`gp-progress${leaving ? " is-leaving" : ""}`} data-gp-progress>
      {frozen ? null : (
        <>
          <div className="gp-progress-now">
            <svg
              className={`gp-progress-ring${ringSpins ? " is-indeterminate" : ""}${allDone ? " is-done" : ""}`}
              viewBox="0 0 16 16"
              aria-hidden="true"
              style={{ ["--gp-progress-p" as string]: ringSpins ? 25 : (done / Math.max(total, 1)) * 100 } as CSSProperties}
            >
              <circle className="gp-progress-ring-track" cx="8" cy="8" r="6.25" />
              <circle className="gp-progress-ring-arc" cx="8" cy="8" r="6.25" pathLength={100} />
            </svg>
            <p className="gp-progress-phase" role="status" aria-live="polite" data-gp-progress-status>
              <SwapText text={phase} />
            </p>
            <Elapsed running={!finishing} />
          </div>
          {/* 这台设备会记下进行中的调查（刷新能接回去），查完或停下时自动存进历史。 */}
          <p className="gp-progress-meta">调查会自动保存在这台设备上</p>
        </>
      )}
      {parts.length > 0 ? (
        <ol className="gp-progress-rows" aria-label="每个要点的进度">
          {parts.map((part) => {
            const ahead = unfinishedBefore;
            if (!FINISHED.has(part.state) && part.state !== "deferred") unfinishedBefore += 1;
            const finished = FINISHED.has(part.state);
            const rowFrozen = frozen || part.state === "failed";
            const disclosure = (finished || rowFrozen) && (rowFrozen || finishing || part.claim.id !== focusId);
            const toggleKey = `${rowFrozen ? "frozen" : "live"}:${part.claim.id}`;
            const open = !disclosure || finishing || (toggled[toggleKey] ?? rowFrozen);
            return (
              <PartRow
                key={part.claim.id}
                part={part}
                snapshot={snapshot}
                sourceById={sourceById}
                active={part.claim.id === activeId}
                raised={part.claim.id === focusId}
                disclosure={disclosure}
                open={open}
                frozen={rowFrozen}
                ahead={ahead}
                onToggle={() => setToggled((prev) => ({ ...prev, [toggleKey]: !open }))}
              />
            );
          })}
        </ol>
      ) : null}
      {leftoverNote ? (
        <p className="gp-result-note" data-gp-leftover-gap>
          {leftoverNote}
        </p>
      ) : null}
    </div>
  );
}

function PartRow({
  part,
  snapshot,
  sourceById,
  active,
  raised,
  disclosure,
  open,
  frozen,
  ahead,
  onToggle,
}: {
  part: Part;
  snapshot: InvestigationSnapshotV1;
  sourceById: Map<string, InvestigationSource>;
  active: boolean;
  raised: boolean;
  disclosure: boolean;
  open: boolean;
  frozen: boolean;
  ahead: number;
  onToggle: () => void;
}) {
  const { claim, no, state, label } = part;
  const bodyId = useId();
  const finished = FINISHED.has(state);
  const working = WORKING.has(state);
  const count = part.found.length;
  const order = useArrivalOrder(part.found);
  const readStarted = claim.evidence.some((link) => link.role !== "unassessed" || READ_RESULTS.has(sourceById.get(link.sourceId)?.fetchStatus ?? ""));
  const waitingStatus = readStarted ? `找到 ${count} 份资料` : journeyCopy.partFoundNotRead(count);

  const status =
    state === "searching"
      ? count === 0
        ? journeyCopy.partSearching
        : active
          ? journeyCopy.partSearchingFound(count)
          : waitingStatus
      : state === "reading"
        ? active ? journeyCopy.partReading(count) : waitingStatus
        : state === "judging"
          ? journeyCopy.partJudging
          : "";
  const icon: { name: IconName; tone: "spin" | "wait" | "idle" } | null = active
    ? { name: "loader-circle", tone: "spin" }
    : working
      ? { name: "circle-dashed", tone: "wait" }
      : state === "pending"
        ? { name: "circle-dashed", tone: "idle" }
        : null;

  const reason = label
    ? (claim.reason?.trim() || claim.evidence.find((link) => link.finding?.trim())?.finding?.trim() ||
      (claim.checkability !== "checkable" ? CHECKABILITY_HINT[claim.checkability] : "")).replace(/\[\d+\]/g, "")
    : "";
  const roleBySource = new Map<string, EvidenceRole>();
  for (const link of claim.evidence) {
    const seen = roleBySource.get(link.sourceId);
    if (!seen || roleRank(link.role) < roleRank(seen)) roleBySource.set(link.sourceId, link.role);
  }
  const pills = order.ids.flatMap((id) => {
    const source = sourceById.get(id);
    const role = roleBySource.get(id);
    if (!source || !role) return [];
    // 查完以后每份资料都写明立场（背景、没读完也写）；查的时候只写已经有的立场，正在读的写「在读」。
    const shown: { role?: EvidenceRole; reading?: boolean } = finished || frozen
      ? { role }
      : role !== "unassessed"
        ? { role }
        : active && state === "reading" && !READ_RESULTS.has(source.fetchStatus ?? "")
          ? { reading: true }
          : {};
    return [{ source, ...shown, delay: order.delay[id] ?? 0 }];
  });
  const notes = partNotes(claim, snapshot, sourceById, Boolean(label));
  const citation = disclosure ? claimSourceRelations(claim, no, snapshot.sources) : [];
  const collapsed = disclosure && !open;
  const labelText = label === "unresolved" ? "查不清" : label ? LABEL_TEXT[label] : journeyCopy.partInterrupted;

  const cls = [
    "gp-progress-row",
    raised ? "is-raised" : "",
    disclosure ? "is-disclosure" : "",
    disclosure && open ? "is-open" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <li className={cls} data-gp-progress-claim={claim.id} data-gp-part-state={state}>
      {disclosure ? (
        <button
          type="button"
          className="gp-progress-hit"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={`${journeyCopy.partHeading(no)}：${claim.text}。${labelText}`}
          onClick={onToggle}
        />
      ) : null}
      <span className="gp-progress-icon" aria-hidden="true">
        <SwapIcon icon={icon} />
      </span>
      <div className="gp-progress-head">
        <span className="gp-progress-no" aria-hidden="true">
          {no}
        </span>
        <span className="gp-progress-title">{claim.text}</span>
      </div>
      <div className="gp-progress-side">
        {state === "pending" && ahead > 0 ? <span className="gp-progress-pend">{journeyCopy.partWaiting(ahead)}</span> : null}
        {state === "deferred" ? <span className="gp-progress-pend">{journeyCopy.partDeferred}</span> : null}
        {disclosure && citation.length > 0 ? (
          // 展开以后资料在下面的药丸里，行尾的引用收起来，同一份资料只出现在一处。
          <span className="gp-progress-fold-cite gp-progress-in" inert={open || undefined}>
            <span>
              <SourceCitation items={citation} variant="fold" />
            </span>
          </span>
        ) : null}
        {label ? (
          <span className={`gp-label gp-label--${LABEL_TONE[label]} gp-progress-in`}>{labelText}</span>
        ) : state === "failed" || state === "unjudged" ? (
          <span className="gp-label gp-label--muted gp-progress-in">{journeyCopy.partInterrupted}</span>
        ) : null}
        {disclosure ? (
          <span className="gp-progress-chev gp-progress-in" aria-hidden="true">
            <Icon name="chevron-right" />
          </span>
        ) : null}
      </div>
      <div className="gp-progress-body" id={bodyId} inert={collapsed || undefined}>
        <StatusLine text={status} />
        <Grow on={Boolean(reason)}>
          <p className="gp-progress-reason">{reason}</p>
        </Grow>
        {/* 停下以后下面列出完整的依据行，药丸就不再重复列一遍：同一份资料只出现在一处。 */}
        <Grow on={pills.length > 0 && !(frozen && claim.evidence.length > 0)}>
          <div className="gp-source-pills-row gp-progress-pills">
            {pills.map(({ source, role, reading, delay }) => (
              <SourcePill key={source.id} source={source} role={role} state={reading ? "reading" : undefined} entering enterDelayMs={delay} />
            ))}
          </div>
        </Grow>
        {frozen ? (
          // 停下以后要能逐份检查已经读到的材料（#151），所以列出完整的依据行，不只是药丸。
          <Grow on={claim.evidence.length > 0}>
            <ul className="gp-part-evidence gp-progress-evidence">
              {claim.evidence.map((link, i) => {
                const source = sourceById.get(link.sourceId);
                return source ? <EvidenceRow key={`${link.sourceId}:${i}`} claimId={claim.id} link={link} source={source} /> : null;
              })}
            </ul>
          </Grow>
        ) : null}
        {notes.map((note) => (
          <Grow key={note.key} on enter>
            <p className={`gp-progress-note is-${note.kind}`}>
              <Icon name={NOTE_ICON[note.kind]} />
              <span>{note.text}</span>
            </p>
          </Grow>
        ))}
      </div>
    </li>
  );
}

const NOTE_ICON = { gap: "circle-alert", conflict: "split", boundary: "info" } as const satisfies Record<string, IconName>;

type Note = { key: string; kind: keyof typeof NOTE_ICON; text: string };

/** 要点下面的提示：还缺什么、资料有支持也有反驳、判断的边界。只写快照里真有的。 */
function partNotes(
  claim: InvestigationClaim,
  snapshot: InvestigationSnapshotV1,
  sourceById: Map<string, InvestigationSource>,
  judged: boolean,
): Note[] {
  const notes: Note[] = claim.gaps
    .filter((gap) => gap.status === "open" && gap.description.trim())
    .map((gap) => ({ key: gap.id, kind: "gap", text: journeyCopy.gapLine(gap.description) }));
  for (const conflict of snapshot.conflicts) {
    if (conflict.claimId !== claim.id) continue;
    const side = (position: "support" | "contradict"): ConflictSide | undefined => {
      const entry = conflict.sides.find((item) => item.position === position);
      const source = entry?.sourceIds.map((id) => sourceById.get(id)).find(Boolean);
      return source ? { publisher: publisherOf(source), summary: entry?.summary?.trim() || source.excerpt?.trim() || undefined } : undefined;
    };
    const text = journeyCopy.conflictLine(side("support"), side("contradict"));
    notes.push({
      key: conflict.id,
      kind: "conflict",
      text: conflict.reasonStatus === "known" && conflict.reason?.trim()
        ? text.replace("两边为什么不同，我们还没查清。", `两边不同的原因：${conflict.reason.trim()}`)
        : text,
    });
  }
  if (judged && claim.boundary?.trim()) notes.push({ key: "boundary", kind: "boundary", text: journeyCopy.boundaryLine(claim.boundary) });
  return notes;
}

/**
 * 资料按第一次出现的顺序排，之后不再挪：判断回来时依据会按立场重排，药丸跟着重排就会跳。
 * 同一批到的错开一点出现（--gp-motion-stagger），延迟记在第一次出现时，之后不再改，免得动画中途跳。
 */
function useArrivalOrder(ids: string[]): { ids: string[]; delay: Record<string, number> } {
  const [order, setOrder] = useState(() => ({ ids, delay: staggered({}, ids) }));
  const fresh = ids.filter((id) => !order.ids.includes(id));
  if (fresh.length > 0) {
    setOrder({ ids: [...order.ids, ...fresh], delay: staggered(order.delay, fresh) });
  }
  return { ids: [...order.ids, ...fresh].filter((id) => ids.includes(id)), delay: order.delay };
}

function staggered(prev: Record<string, number>, fresh: string[]): Record<string, number> {
  const step = prefersReducedMotion() ? 0 : motionMs("--gp-motion-stagger");
  return { ...prev, ...Object.fromEntries(fresh.map((id, i) => [id, i * step])) };
}

/** 尺寸变化走 grid-template-rows 0fr→1fr：页面跟着内容慢慢长高，不是一下跳开。 */
function Grow({ on, enter = false, children }: { on: boolean; enter?: boolean; children: ReactNode }) {
  const [mounted, setMounted] = useState(!enter);
  useEffect(() => {
    if (!enter) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => setMounted(true));
    });
    return () => cancelAnimationFrame(frame);
  }, [enter]);
  return (
    <div className={`gp-progress-grow${on && mounted ? " is-on" : ""}`} aria-hidden={!on || undefined}>
      <div className="gp-progress-grow-in">{children}</div>
    </div>
  );
}

/** 要点下面那行状态。查完时这一行收起来，收的过程中还显示最后一句，不是先变空再收。 */
function StatusLine({ text }: { text: string }) {
  const [last, setLast] = useState(text);
  if (text && text !== last) setLast(text);
  return (
    <Grow on={Boolean(text)}>
      <p className="gp-progress-status">
        <SwapText text={text || last} />
      </p>
    </Grow>
  );
}

type Swapped<T> = { key: number; value: T; out: boolean };

/** 换内容时旧的往外退、新的进来（shared axis）：旧的留 --gp-motion-fast 再拿掉。 */
function useSwap<T>(value: T, same: (a: T, b: T) => boolean): Swapped<T>[] {
  const [items, setItems] = useState<Swapped<T>[]>(() => [{ key: 0, value, out: false }]);
  const current = items.find((item) => !item.out);
  if (!current || !same(current.value, value)) {
    const nextKey = items.reduce((max, item) => Math.max(max, item.key), 0) + 1;
    setItems([...items.filter((item) => !item.out).map((item) => ({ ...item, out: true })), { key: nextKey, value, out: false }]);
  }
  const leaving = items.some((item) => item.out);
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setItems((prev) => prev.filter((item) => !item.out)), motionMs("--gp-motion-fast"));
    return () => window.clearTimeout(timer);
  }, [leaving, items]);
  return items;
}

function SwapText({ text }: { text: string }) {
  const items = useSwap(text, (a, b) => a === b);
  return (
    <span className="gp-progress-swap">
      {items.map((item) => (
        <span key={item.key} className={item.out ? "is-out" : undefined} aria-hidden={item.out || undefined}>
          {item.value}
        </span>
      ))}
    </span>
  );
}

type Glyph = { name: IconName; tone: "spin" | "wait" | "idle" } | null;

/** 状态图标在同一个 16px 位置里淡入淡出、缩放，换图标不改排版。查完没有图标，判断标签就是结果。 */
function SwapIcon({ icon }: { icon: Glyph }) {
  const items = useSwap(icon, (a, b) => a?.name === b?.name && a?.tone === b?.tone);
  return (
    <>
      {items.map((item) =>
        item.value ? (
          <span key={item.key} className={`gp-progress-glyph is-${item.value.tone}${item.out ? " is-out" : ""}`}>
            <Icon name={item.value.name} className={!item.out && item.value.tone === "spin" ? "gp-spin" : undefined} />
          </span>
        ) : null,
      )}
    </>
  );
}

/** 用时：从这一轮在这个页面上第一次出现时算起。 */
function Elapsed({ running }: { running: boolean }) {
  const start = useRef(performance.now());
  const [now, setNow] = useState(start.current);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(performance.now()), 500);
    return () => window.clearInterval(timer);
  }, [running]);
  const seconds = Math.max(0, Math.floor((now - start.current) / 1000));
  return (
    <span className="gp-progress-clock" role="timer">
      {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

/** 读动效 token 的毫秒数。JS 里要等动画走完再换内容时用它，时长只在 golden-path.css 写一处。 */
export function motionMs(token: string): number {
  if (typeof window === "undefined") return 0;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  const value = parseFloat(raw);
  if (!Number.isFinite(value)) return 0;
  return /ms$/.test(raw) ? value : /s$/.test(raw) ? value * 1000 : value;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
