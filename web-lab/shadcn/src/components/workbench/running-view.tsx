// 运行过程工作台。布局照抄 shadcn/ui sidebar 系 block（https://ui.shadcn.com/blocks/sidebar，SidebarProvider + Sidebar + 右侧内容区；
// 这里用 collapsible="none" 让左栏常驻），左栏步骤照抄 AI Elements ChainOfThought（https://ai-sdk.dev/elements/components/chain-of-thought），
// 右栏是当前 agent 的产出卡片（shadcn/ui Card）。回放控制照抄 shadcn/ui Toggle Group / Slider 示例。
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLineIcon,
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleIcon,
  ImageIcon,
  LoaderCircleIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { ChainOfThought, ChainOfThoughtContent, ChainOfThoughtStep } from "@/components/ai-elements/chain-of-thought";
import { Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarProvider } from "@/components/ui/sidebar";
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
import { buildWorkbench, eventsFromActivities, seconds, STEP_META, type Step, type StepKind } from "@/lib/workbench";
import { useLiveEvents, useNow, useReplay } from "@/lib/playback";
import { displayClaim } from "@/lib/derive";
import { loadRun } from "@/lib/data";
import type { RunData } from "@/lib/types";

const PHASE_TEXT: Record<string, string> = {
  received: "正在拆题",
  decomposed: "已拆题",
  investigating: "正在找材料、核对",
  judging: "正在下结论",
  complete: "已完成",
  interrupted: "没有查完",
};

const PIPELINE: StepKind[] = ["split", "search", "check", "audit", "write"];

function StepIcon({ step }: { step: Step | null }): LucideIcon {
  if (!step) return CircleDashedIcon;
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

  const current = (selected ? wb.steps.find((s) => s.id === selected) : null) ?? wb.steps.at(-1) ?? null;
  const following = viewCursor === null && selected === null;
  const pending = wb.terminal ? [] : PIPELINE.filter((kind) => !wb.steps.some((s) => s.kind === kind) && PIPELINE.indexOf(kind) >= PIPELINE.indexOf(wb.steps.at(-1)?.kind === "vision" ? "split" : (wb.steps.at(-1)?.kind ?? "split")));

  // 时间线：跟随时滚到底；用户往上翻就停下，出现「回到最新」。
  const listRef = useRef<HTMLDivElement>(null);
  const [scrolledUp, setScrolledUp] = useState(false);
  const userScrolling = useRef(false);
  useEffect(() => {
    const el = listRef.current;
    if (el && following && !scrolledUp) el.scrollTop = el.scrollHeight;
  }, [wb.lines.length, following, scrolledUp]);
  // 选中较早的步骤时，时间线滚到这一步的第一条活动。
  useEffect(() => {
    const el = listRef.current;
    if (!el || !selected) return;
    el.querySelector(`[data-step="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  const backToLatest = () => {
    setViewCursor(null);
    setSelected(null);
    setScrolledUp(false);
  };

  const claim = displayClaim(wb.snapshot?.originalClaim ?? data.snapshot?.originalClaim ?? "");
  const resultRun: RunData | null =
    wb.terminal && wb.phase === "complete"
      ? { ...(final ?? data), events, snapshot: final?.snapshot ?? wb.snapshot ?? data.snapshot }
      : null;
  const elapsed = seconds((wb.terminal ? wb.lastAt : now) - wb.startedAt);

  return (
    <div data-gp-phase={wb.phase} className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 lg:p-6">
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardDescription className="flex flex-wrap items-center gap-2">
            {isFixture ? <Badge variant="secondary">回放</Badge> : null}
            <Badge variant={wb.phase === "complete" ? "default" : "outline"}>{PHASE_TEXT[wb.phase] ?? wb.phase}</Badge>
            {elapsed ? <span>总用时 {elapsed}</span> : null}
          </CardDescription>
          <CardTitle className="line-clamp-2 text-base leading-snug">
            {claim.fromImage ? (
              <span className="inline-flex items-center gap-2">
                <ImageIcon className="size-4" />
                {claim.text}
              </span>
            ) : (
              `「${claim.text}」`
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 px-4">
          <div className="flex flex-wrap items-center gap-2">
            {isFixture ? (
              <>
                <Button size="sm" variant="outline" onClick={() => replay.setPlaying(!replay.playing)} disabled={replay.received >= replay.total}>
                  {replay.playing ? <PauseIcon /> : <PlayIcon />}
                  {replay.playing ? "暂停" : "播放"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { backToLatest(); replay.restart(); }}>
                  <RotateCcwIcon />
                  从头回放
                </Button>
                <ToggleGroup type="single" size="sm" variant="outline" value={String(replay.speed)} onValueChange={(v) => v && replay.setSpeed(Number(v))} aria-label="回放速度">
                  <ToggleGroupItem value="1">1×</ToggleGroupItem>
                  <ToggleGroupItem value="8">8×</ToggleGroupItem>
                  <ToggleGroupItem value="32">32×</ToggleGroupItem>
                </ToggleGroup>
                <Separator orientation="vertical" className="mx-1 hidden data-[orientation=vertical]:h-5 sm:block" />
              </>
            ) : null}
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={viewCursor === null ? "live" : "history"}
              onValueChange={(v) => {
                if (v === "live") backToLatest();
                if (v === "history") setViewCursor(Math.max(1, received - 1));
              }}
              aria-label="时间线模式"
            >
              <ToggleGroupItem value="live">实时跟随</ToggleGroupItem>
              <ToggleGroupItem value="history">历史回放</ToggleGroupItem>
            </ToggleGroup>
            {!following || scrolledUp ? (
              <Button size="sm" onClick={backToLatest}>
                <ArrowDownToLineIcon />
                回到最新
              </Button>
            ) : null}
          </div>
          {viewCursor !== null ? (
            <div className="flex items-center gap-3">
              <Slider
                min={1}
                max={Math.max(1, received)}
                step={1}
                value={[viewCursor]}
                onValueChange={([v]) => setViewCursor(v ?? 1)}
                aria-label="回到某个时刻"
                className="flex-1"
              />
              <span className="w-24 shrink-0 text-right text-xs text-muted-foreground tabular-nums">+{seconds(wb.lastAt - wb.startedAt) || "0.0 秒"}</span>
            </div>
          ) : null}
          {live.error || wb.error ? <p className="text-sm text-destructive">{wb.error || live.error}</p> : null}
        </CardContent>
      </Card>

      <SidebarProvider className="min-h-0 flex-col items-stretch gap-4 lg:flex-row lg:items-start" style={{ "--sidebar-width": "22rem" } as React.CSSProperties}>
        <Sidebar collapsible="none" className="h-auto w-full rounded-xl border lg:sticky lg:top-[4.5rem] lg:max-h-[calc(100svh-5.5rem)] lg:w-(--sidebar-width)">
          <SidebarHeader className="px-4 pt-4">
            <p className="text-sm font-medium">步骤</p>
          </SidebarHeader>
          <SidebarContent className="lg:overflow-hidden">
            <SidebarGroup>
              <SidebarGroupContent className="px-2">
                <ChainOfThought defaultOpen>
                  <ChainOfThoughtContent className="mt-0 space-y-1">
                    {wb.steps.map((step) => {
                      const meta = STEP_META[step.kind];
                      const active = current?.id === step.id;
                      return (
                        <button
                          key={step.id}
                          type="button"
                          onClick={() => setSelected(step.id)}
                          className={cn("w-full rounded-md px-2 py-2 text-left transition-colors hover:bg-sidebar-accent", active && "bg-sidebar-accent")}
                        >
                          <ChainOfThoughtStep
                            icon={StepIcon({ step })}
                            status={step.status === "active" ? "active" : "complete"}
                            className={cn(step.status === "active" && "[&_svg:first-child]:animate-spin", active && "text-foreground")}
                            label={
                              <span className="flex items-center justify-between gap-2">
                                <span className="font-medium">{meta.title}</span>
                                <span className="text-xs tabular-nums text-muted-foreground">{stepDuration(step, now)}</span>
                              </span>
                            }
                            description={step.status === "active" ? meta.doing : step.status === "error" ? "没能完成" : stepSummary(step)}
                          />
                        </button>
                      );
                    })}
                    {pending.map((kind) => (
                      <div key={kind} className="px-2 py-2">
                        <ChainOfThoughtStep icon={CircleIcon} status="pending" label={STEP_META[kind].title} description="等待中" />
                      </div>
                    ))}
                  </ChainOfThoughtContent>
                </ChainOfThought>
              </SidebarGroupContent>
            </SidebarGroup>
            <SidebarGroup className="min-h-0 lg:flex-1">
              <SidebarGroupLabel>活动时间线</SidebarGroupLabel>
              <SidebarGroupContent className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
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
                  className="max-h-72 overflow-y-auto px-2 lg:max-h-none lg:min-h-32 lg:flex-1"
                >
                  <ol className="flex flex-col gap-1.5 text-xs">
                    {wb.lines.map((line) => (
                      <li key={line.index} data-step={line.stepId} className={cn("flex gap-2 rounded-sm", selected && line.stepId === selected && "bg-sidebar-accent")}>
                        <span className="w-12 shrink-0 text-right tabular-nums text-muted-foreground">+{((line.at - wb.startedAt) / 1000).toFixed(1)}s</span>
                        <span
                          className={cn(
                            "min-w-0 flex-1 break-words",
                            line.tone === "support" && "text-emerald-700",
                            line.tone === "contradict" && "text-red-700",
                            line.tone === "done" && "font-medium"
                          )}
                        >
                          {line.text}
                        </span>
                      </li>
                    ))}
                    {wb.lines.length === 0 ? <li className="text-muted-foreground">等待第一条活动</li> : null}
                  </ol>
                </div>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
        </Sidebar>

        <Card className="min-w-0 flex-1">
          {current ? (
            <>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="size-9">
                    {STEP_META[current.kind].avatar ? <AvatarImage src={STEP_META[current.kind].avatar} alt="" /> : null}
                    <AvatarFallback>{STEP_META[current.kind].title.slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <CardTitle>{STEP_META[current.kind].title}</CardTitle>
                    <CardDescription>
                      {current.status === "active" ? "进行中" : current.status === "error" ? "没能完成" : "已完成"}
                      {current.approx ? " · 这条旧记录只存了活动，没有逐步耗时和思考过程" : ` · 这一步用时 ${stepDuration(current, now)}`}
                    </CardDescription>
                  </div>
                </div>
                {!following ? (
                  <CardAction>
                    <Badge variant="outline">正在看较早的步骤</Badge>
                  </CardAction>
                ) : null}
              </CardHeader>
              <CardContent>
                <StepOutput step={current} snapshot={wb.snapshot} now={now} lines={wb.lines} />
              </CardContent>
            </>
          ) : (
            <CardContent className="py-10 text-center text-sm text-muted-foreground">正在连接…</CardContent>
          )}
        </Card>
      </SidebarProvider>

      {resultRun ? (
        <section className="flex flex-col gap-3 pt-2">
          <h2 className="text-lg font-semibold">结论</h2>
          <ResultView run={resultRun} />
        </section>
      ) : null}
    </div>
  );
}
