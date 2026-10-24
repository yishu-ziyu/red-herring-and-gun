// 运行过程工作台。三栏版式照 web-lab/mantine 的 RunPage（左：核查步骤，中：当前 agent 的实际产出，右：活动时间线；
// 手机上步骤变成横排切换条，活动时间线移到产出下面），组件全部用 shadcn/ui + AI Elements：
// 步骤列表照抄 AI Elements ChainOfThought（https://ai-sdk.dev/elements/components/chain-of-thought），
// 产出卡片照抄 shadcn/ui Card（https://ui.shadcn.com/docs/components/card），里面的思考 / 子任务见 step-output.tsx（Reasoning、Task），
// 跟随 / 回放切换照抄 shadcn/ui Toggle Group（https://ui.shadcn.com/docs/components/toggle-group），回放进度照抄 Slider（https://ui.shadcn.com/docs/components/slider）。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLineIcon,
  CheckCircle2Icon,
  CircleIcon,
  CircleStopIcon,
  DotIcon,
  ImageIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { ResultView } from "@/components/result/result-view";
import { StepOutput } from "./step-output";
import { cn } from "@/lib/utils";
import { buildWorkbench, eventsFromActivities, seconds, STEP_META, type Step, type StepKind, type TimelineLine, type WorkbenchState } from "@/lib/workbench";
import { useLiveEvents, useNow, useReplay } from "@/lib/playback";
import { displayClaim } from "@/lib/derive";
import { cancelInvestigation, loadRun } from "@/lib/data";
import type { RunData } from "@/lib/types";

const PHASE_TEXT: Record<string, string> = {
  received: "正在拆题",
  decomposed: "已拆题",
  investigating: "正在找材料、核对",
  judging: "正在下结论",
  complete: "已出结论",
  interrupted: "没有查完",
};

const PIPELINE: StepKind[] = ["split", "search", "check", "audit", "write"];

function statusIcon(step: Step | null): LucideIcon {
  if (!step) return CircleIcon;
  if (step.status === "error") return TriangleAlertIcon;
  if (step.status === "active") return LoaderCircleIcon;
  return CheckCircle2Icon;
}

function stepDuration(step: Step, now: number) {
  if (step.approx) return "";
  return seconds((step.endedAt ?? now) - step.startedAt);
}

function stepSummary(step: Step): string {
  if (step.approx) {
    const n = step.activityCount ?? 0;
    const found = step.searches.reduce((sum, t) => sum + t.sources.length, 0);
    return { vision: "", split: `拆出 ${n} 点`, search: `找到 ${found} 条材料`, check: `${n} 条核对记录`, audit: `${n} 条审核记录`, write: "结论已写好" }[step.kind];
  }
  const out = (step.output ?? {}) as Record<string, unknown>;
  const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  switch (step.kind) {
    case "vision":
      return `读出 ${count(out.ocrTexts)} 行文字`;
    case "split":
      return `拆成 ${count(out.claimAtoms) || count(out.claimAtomTypes)} 点`;
    case "search":
      return `${step.searches.length} 次检索 · ${step.searches.reduce((n, t) => n + t.sources.length, 0)} 条材料`;
    case "check":
      return count(out.subclaimVerdicts) ? `${count(out.subclaimVerdicts)} 点有了判断` : "已核对";
    case "audit":
      return count(out.claimSourceRelations) ? `审核了 ${count(out.claimSourceRelations)} 条来源` : "已审核";
    case "write":
      return out.passed === false ? "复核后改写" : "结论已写好";
  }
}

function AgentAvatar({ kind, className, dim }: { kind: StepKind; className?: string; dim?: boolean }) {
  const meta = STEP_META[kind];
  return (
    <Avatar className={cn("size-8 border bg-background", dim && "opacity-45", className)}>
      <AvatarImage src={meta.avatar} alt="" />
      <AvatarFallback>{meta.title.slice(0, 1)}</AvatarFallback>
    </Avatar>
  );
}

/** 左栏：核查步骤。每步写这一步自己用了多久（不是从开头算的时间点）。 */
function StepList({
  steps,
  pending,
  currentId,
  now,
  onSelect,
}: {
  steps: Step[];
  pending: StepKind[];
  currentId: string | undefined;
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <ChainOfThought defaultOpen>
      <ChainOfThoughtContent className="mt-0 space-y-1">
        {steps.map((step) => {
          const meta = STEP_META[step.kind];
          const active = currentId === step.id;
          const duration = stepDuration(step, now);
          return (
            <button
              key={step.id}
              type="button"
              aria-current={active ? "step" : undefined}
              onClick={() => onSelect(step.id)}
              className={cn("w-full rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted", active && "bg-muted")}
            >
              <ChainOfThoughtStep
                icon={statusIcon(step)}
                status={step.status === "active" ? "active" : "complete"}
                className={cn(
                  "[&>div:first-child]:mt-2",
                  step.status === "active" && "[&>div:first-child_svg]:animate-spin",
                  step.status === "complete" && "[&>div:first-child_svg]:text-emerald-600",
                  step.status === "error" && "[&>div:first-child_svg]:text-amber-600",
                  active && "text-foreground"
                )}
                label={
                  <span className="flex items-center gap-2.5">
                    <AgentAvatar kind={step.kind} />
                    <span className="min-w-0 flex-1">
                      <span className={cn("block font-medium text-foreground", active && "font-semibold")}>{meta.title}</span>
                    </span>
                  </span>
                }
                description={
                  <span className="flex flex-wrap items-center gap-1.5 pl-[2.625rem]">
                    {duration ? (
                      <Badge variant={step.status === "active" ? "secondary" : "outline"} className="font-normal tabular-nums">
                        {step.status === "active" ? "已用" : "用时"} {duration}
                      </Badge>
                    ) : null}
                    <span>{step.status === "active" ? meta.doing : step.status === "error" ? "没能完成" : stepSummary(step)}</span>
                  </span>
                }
              />
            </button>
          );
        })}
        {pending.map((kind) => (
          <div key={kind} className="px-2 py-2.5">
            <ChainOfThoughtStep
              icon={CircleIcon}
              status="pending"
              className="[&>div:first-child]:mt-2"
              label={
                <span className="flex items-center gap-2.5">
                  <AgentAvatar kind={kind} dim />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{STEP_META[kind].title}</span>
                  </span>
                </span>
              }
              description={<span className="pl-[2.625rem]">等待中</span>}
            />
          </div>
        ))}
      </ChainOfThoughtContent>
    </ChainOfThought>
  );
}

/** 手机：步骤横排切换条。 */
function StepChips({ steps, pending, currentId, onSelect }: { steps: Step[]; pending: StepKind[]; currentId: string | undefined; onSelect: (id: string) => void }) {
  return (
    <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 lg:hidden">
      {steps.map((step) => (
        <Button
          key={step.id}
          size="sm"
          variant={currentId === step.id ? "default" : "secondary"}
          className="shrink-0 rounded-full"
          onClick={() => onSelect(step.id)}
        >
          {STEP_META[step.kind].title}
          {step.status === "active" ? <LoaderCircleIcon className="animate-spin" /> : step.status === "error" ? <TriangleAlertIcon /> : <CheckCircle2Icon />}
        </Button>
      ))}
      {pending.map((kind) => (
        <Button key={kind} size="sm" variant="outline" className="shrink-0 rounded-full text-muted-foreground" disabled>
          {STEP_META[kind].title}
        </Button>
      ))}
    </div>
  );
}

type ActivityProps = {
  wb: WorkbenchState;
  selected: string | null;
  mode: "live" | "history";
  onMode: (mode: "live" | "history") => void;
  cursor: number;
  total: number;
  onCursor: (n: number) => void;
  onLatest: () => void;
  className?: string;
};

/** 右栏：活动时间线。实时跟随时滚到底；用户往上翻就停下，出现「回到最新」；历史回放拖动到任一时刻。 */
function ActivityPanel({ wb, selected, mode, onMode, cursor, total, onCursor, onLatest, className }: ActivityProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const userScrolling = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (el && mode === "live" && !scrolledUp && !selected) el.scrollTop = el.scrollHeight;
  }, [wb.lines.length, mode, scrolledUp, selected]);
  // 选中较早的步骤时，时间线滚到这一步的第一条活动。
  useEffect(() => {
    const el = listRef.current;
    if (!el || !selected) return;
    el.querySelector(`[data-step="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const latest = () => {
    setScrolledUp(false);
    onLatest();
  };
  const behind = mode === "history" || scrolledUp || selected !== null;

  return (
    <div className={cn("flex min-h-0 flex-col gap-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">活动时间线</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{wb.lines.length} 条</span>
      </div>
      <ToggleGroup
        type="single"
        size="sm"
        variant="outline"
        value={mode}
        onValueChange={(v) => v && onMode(v as "live" | "history")}
        aria-label="时间线模式"
        className="w-full [&>*]:flex-1"
      >
        <ToggleGroupItem value="live">实时跟随</ToggleGroupItem>
        <ToggleGroupItem value="history">历史回放</ToggleGroupItem>
      </ToggleGroup>
      {mode === "history" ? (
        <div className="flex flex-col gap-2">
          <Slider min={1} max={Math.max(1, total)} step={1} value={[Math.min(cursor, Math.max(1, total))]} onValueChange={([v]) => onCursor(v ?? 1)} aria-label="回到某个时刻" />
          <p className="text-xs text-muted-foreground tabular-nums">
            {seconds(wb.lastAt - wb.startedAt) || "0.0 秒"}
          </p>
        </div>
      ) : null}
      {behind ? (
        <Button size="sm" variant="secondary" onClick={latest} className="self-start">
          <ArrowDownToLineIcon />
          回到最新
        </Button>
      ) : null}
      <div
        ref={listRef}
        onScroll={(e) => {
          // 只认用户自己滚动（滚轮 / 触摸 / 拖动）；程序滚到底不算。
          if (!userScrolling.current) return;
          const el = e.currentTarget;
          setScrolledUp(el.scrollHeight - el.scrollTop - el.clientHeight > 24);
        }}
        onWheel={() => (userScrolling.current = true)}
        onTouchStart={() => (userScrolling.current = true)}
        onPointerDown={() => (userScrolling.current = true)}
        onMouseLeave={() => (userScrolling.current = false)}
        onTouchEnd={() => (userScrolling.current = false)}
        className="min-h-0 flex-1 overflow-y-auto pr-1"
      >
        {wb.lines.length === 0 ? (
          <p className="text-sm text-muted-foreground">等待第一条活动</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {wb.lines.map((line) => (
              <li key={line.index} data-step={line.stepId} className={cn("rounded-md", selected && line.stepId === selected && "bg-muted")}>
                <ActivityLine line={line} startedAt={wb.startedAt} />
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}

function ActivityLine({ line, startedAt }: { line: TimelineLine; startedAt: number }) {
  return (
    <ChainOfThoughtStep
      icon={line.tone === "done" ? CheckCircle2Icon : DotIcon}
      status={line.tone === "done" ? "active" : "complete"}
      className={cn(
        // 时间线条目密：时间紧贴在文字下面，不画步骤间的竖线。
        "gap-1.5 text-xs [&>div:first-child>div]:hidden [&>div:last-child]:space-y-0.5 [&>div:last-child>div:nth-child(2)]:text-[11px]",
        line.tone === "done" && "[&>div:first-child_svg]:text-emerald-600",
        line.tone === "support" && "text-emerald-700",
        line.tone === "contradict" && "text-red-700"
      )}
      label={<span className={cn("break-words leading-relaxed", line.tone === "done" && "font-medium")}>{line.text}</span>}
      description={<span className="tabular-nums">+{seconds(line.at - startedAt) || "0.0 秒"}</span>}
    />
  );
}

export function RunningView({ data }: { data: RunData }) {
  const isFixture = Boolean(data.fixture);
  const stored = useMemo(
    () => (data.events.length ? data.events : isFixture ? eventsFromActivities(data.snapshot, data.activities, data.createdAt) : []),
    [data, isFixture]
  );
  const live = useLiveEvents(data.runId, !isFixture);
  const events = isFixture ? stored : live.events;
  const replay = useReplay(stored, isFixture);
  const received = isFixture ? replay.received : events.length;

  const [viewCursor, setViewCursor] = useState<number | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const cursor = viewCursor ?? received;
  const wb = useMemo(() => buildWorkbench(events, cursor), [events, cursor]);
  const latest = useMemo(() => (viewCursor === null ? wb : buildWorkbench(events, received)), [events, received, viewCursor, wb]);
  const tick = useNow(!isFixture && !latest.terminal);
  const now = isFixture || viewCursor !== null ? wb.lastAt : tick;

  // 真实运行结束后再取一次结果（判定记录在报告里，事件流不带）。
  const [final, setFinal] = useState<RunData | null>(null);
  useEffect(() => {
    if (isFixture || !latest.terminal) return;
    void loadRun(data.runId).then(setFinal).catch(() => {});
  }, [isFixture, latest.terminal, data.runId]);

  const [stopping, setStopping] = useState(false);
  const [stopError, setStopError] = useState("");
  const stop = () => {
    setStopping(true);
    setStopError("");
    cancelInvestigation(data.runId).catch((err: unknown) => {
      setStopping(false);
      setStopError(err instanceof Error ? err.message : "没能停止");
    });
  };

  const current = (selected ? wb.steps.find((s) => s.id === selected) : null) ?? wb.steps.at(-1) ?? null;
  const lastKind = wb.steps.at(-1)?.kind;
  const pending = wb.terminal ? [] : PIPELINE.filter((kind) => !wb.steps.some((s) => s.kind === kind) && PIPELINE.indexOf(kind) >= PIPELINE.indexOf(!lastKind || lastKind === "vision" ? "split" : lastKind));

  const backToLatest = () => {
    setViewCursor(null);
    setSelected(null);
  };
  const changeMode = (mode: "live" | "history") => {
    if (mode === "live") backToLatest();
    else setViewCursor(Math.max(1, received));
  };
  const selectStep = (id: string) => setSelected(id);

  const claim = displayClaim(wb.snapshot?.originalClaim ?? data.snapshot?.originalClaim ?? "");
  const resultRun: RunData | null =
    wb.terminal && wb.phase === "complete" ? { ...(final ?? data), events, snapshot: final?.snapshot ?? wb.snapshot ?? data.snapshot } : null;
  const elapsed = seconds((wb.terminal ? wb.lastAt : now) - wb.startedAt);

  // 跟随时，结论一出来就滚到结果。
  const resultRef = useRef<HTMLElement>(null);
  const hasResult = Boolean(resultRun);
  useEffect(() => {
    if (hasResult && viewCursor === null && selected === null) resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // 只在结果第一次出现时滚动。
  }, [hasResult]);

  const activity = {
    wb,
    selected,
    mode: viewCursor === null ? ("live" as const) : ("history" as const),
    onMode: changeMode,
    cursor,
    total: received,
    onCursor: (n: number) => setViewCursor(n),
    onLatest: backToLatest,
  };

  return (
    <div data-gp-phase={wb.phase} className="lg:grid lg:grid-cols-[17.5rem_minmax(0,1fr)_20rem] lg:items-start">
      <aside className="hidden border-r bg-background p-4 lg:sticky lg:top-14 lg:flex lg:h-[calc(100svh-3.5rem)] lg:flex-col lg:gap-3 lg:overflow-y-auto">
        <h2 className="px-2 text-sm font-semibold">核查步骤</h2>
        <StepList steps={wb.steps} pending={pending} currentId={current?.id} now={now} onSelect={selectStep} />
      </aside>

      <main className="min-h-[calc(100svh-3.5rem)] min-w-0 bg-muted/30 px-4 py-4 lg:px-6">
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-4">
          <Card className="gap-2 py-3">
            <CardHeader className="px-4">
              <CardDescription className="flex flex-wrap items-center gap-2">
                {isFixture ? <Badge variant="secondary">回放</Badge> : null}
                <Badge variant={wb.phase === "complete" ? "default" : "outline"}>
                  {!wb.terminal && current?.status === "active" ? `正在${STEP_META[current.kind].title}` : PHASE_TEXT[wb.phase] ?? wb.phase}
                </Badge>
                {viewCursor !== null ? <Badge variant="outline">历史回放中</Badge> : null}
                {elapsed ? <span className="tabular-nums">总用时 {elapsed}</span> : null}
              </CardDescription>
              <CardTitle className="line-clamp-2 text-base leading-snug">
                {claim.fromImage ? (
                  <span className="inline-flex items-center gap-2">
                    <ImageIcon className="size-4" />
                    {claim.text}
                  </span>
                ) : claim.text ? (
                  `「${claim.text}」`
                ) : null}
              </CardTitle>
            </CardHeader>
            {isFixture || !latest.terminal ? (
              <CardContent className="flex flex-wrap items-center gap-2 px-4">
                {isFixture ? (
                  <>
                    <Button size="sm" variant="outline" onClick={() => replay.setPlaying(!replay.playing)} disabled={replay.received >= replay.total}>
                      {replay.playing ? <PauseIcon /> : <PlayIcon />}
                      {replay.playing ? "暂停" : "播放"}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        backToLatest();
                        replay.restart();
                      }}
                    >
                      <RotateCcwIcon />
                      从头回放
                    </Button>
                    <ToggleGroup type="single" size="sm" variant="outline" value={String(replay.speed)} onValueChange={(v) => v && replay.setSpeed(Number(v))} aria-label="回放速度">
                      <ToggleGroupItem value="1">1×</ToggleGroupItem>
                      <ToggleGroupItem value="8">8×</ToggleGroupItem>
                      <ToggleGroupItem value="32">32×</ToggleGroupItem>
                    </ToggleGroup>
                  </>
                ) : (
                  <Button size="sm" variant="outline" onClick={stop} disabled={stopping}>
                    <CircleStopIcon />
                    {stopping ? "正在停止" : "停止核查"}
                  </Button>
                )}
              </CardContent>
            ) : null}
            {live.error || wb.error || stopError ? <p className="px-4 text-sm text-destructive">{wb.error || live.error || stopError}</p> : null}
          </Card>

          <StepChips steps={wb.steps} pending={pending} currentId={current?.id} onSelect={selectStep} />

          <Card className="min-w-0">
            {current ? (
              <>
                <CardHeader>
                  <div className="flex min-w-0 items-center gap-3">
                    <AgentAvatar kind={current.kind} className="size-10" />
                    <div className="min-w-0">
                      <CardTitle>{STEP_META[current.kind].title}</CardTitle>
                    </div>
                  </div>
                  <CardAction className="flex flex-col items-end gap-1">
                    {current.approx ? (
                      <Badge variant="outline">旧记录</Badge>
                    ) : (
                      <Badge variant={current.status === "active" ? "secondary" : "outline"} className="tabular-nums">
                        {current.status === "active" ? "已用" : current.status === "error" ? "没能完成 ·" : "用时"} {stepDuration(current, now)}
                      </Badge>
                    )}
                    {selected !== null ? <span className="text-xs text-muted-foreground">正在看较早的步骤</span> : null}
                  </CardAction>
                </CardHeader>
                <CardContent>
                  <StepOutput step={current} snapshot={wb.snapshot} now={now} lines={wb.lines} />
                </CardContent>
              </>
            ) : (
              <CardContent className="py-10 text-center text-sm text-muted-foreground">正在连接…</CardContent>
            )}
          </Card>

          <Card className="h-[22rem] py-4 lg:hidden">
            <CardContent className="flex h-full min-h-0 flex-col px-4">
              <ActivityPanel {...activity} className="h-full" />
            </CardContent>
          </Card>

          {resultRun ? (
            <section ref={resultRef} className="flex scroll-mt-20 flex-col gap-4 pt-2">
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <h2 className="text-sm font-medium text-muted-foreground">结果</h2>
                <Separator className="flex-1" />
              </div>
              <ResultView run={resultRun} />
            </section>
          ) : null}
        </div>
      </main>

      <aside className="hidden border-l bg-background p-4 lg:sticky lg:top-14 lg:flex lg:h-[calc(100svh-3.5rem)] lg:flex-col">
        <ActivityPanel {...activity} className="h-full" />
      </aside>
    </div>
  );
}
