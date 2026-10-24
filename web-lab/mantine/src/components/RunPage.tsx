// 工作台照抄 Mantine AppShell「FullLayout」（https://mantine.dev/core/app-shell/?e=FullLayout）：
// 左 Navbar = 步骤时间线，右 Aside = 活动时间线，Main = 当前 agent 的产出；手机上 Navbar 用 Burger 打开（同一示例），Aside 内容移到正文底部。
import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, AppShell, Badge, Box, Button, Divider, Group, Paper, ScrollArea, SegmentedControl, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconPlayerPlay, IconPlayerStop, IconRefresh } from "@tabler/icons-react";
import type { Route, ShellProps } from "../App.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { StepTimeline } from "./StepTimeline.tsx";
import { StepOutput } from "./StepOutput.tsx";
import { ActivityPanel, type FollowMode } from "./ActivityPanel.tsx";
import { ResultView } from "./ResultView.tsx";
import { SharePanel } from "./SharePanel.tsx";
import { cancelInvestigation, followEvents, loadFixture, resultFromParts, type StreamEvent } from "../lib/data.ts";
import { STEP_META, buildRunView, currentStep, phaseOf, type StepKey } from "../lib/runState.ts";

const PHASE_TEXT: Record<string, string> = {
  received: "正在拆题",
  decomposed: "拆好了，准备检索",
  investigating: "正在找材料",
  judging: "正在下判断",
  complete: "已出结论",
  interrupted: "没查完",
};

const ts = (e: StreamEvent | undefined) => (typeof e?.timestamp === "number" ? e.timestamp : 0);

/** 样例回放：按原事件的时间间隔加速放。 */
function useReplay(all: StreamEvent[] | null, speed: number, nonce: number) {
  const [played, setPlayed] = useState(0);
  useEffect(() => {
    if (!all) return;
    setPlayed(0);
    let i = 0;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      i += 1;
      setPlayed(i);
      if (i >= all.length) return;
      const gap = Math.max(0, ts(all[i]) - ts(all[i - 1])) / speed;
      const floor = all[i].type === "agent_thought" ? 6 : all[i].type === "search_progress" ? 10 : 28;
      timer = setTimeout(tick, Math.min(900, Math.max(floor, gap)));
    };
    timer = setTimeout(tick, 350);
    return () => clearTimeout(timer);
  }, [all, speed, nonce]);
  return played;
}

/** 真实记录：SSE 从第 0 条接起（跑完的记录服务端补发完就收流）。 */
function useLive(runId: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!runId) return;
    setEvents([]);
    const buffer: StreamEvent[] = [];
    let raf = 0;
    const flush = () => {
      raf = 0;
      setEvents([...buffer]);
    };
    const stop = followEvents(
      runId,
      (event) => {
        buffer.push(event);
        if (!raf) raf = requestAnimationFrame(flush);
      },
      (err) => err && setError(err),
    );
    return () => {
      stop();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [runId]);
  return { events, error };
}

export function RunPage({ route, onOpenHistory, navigate }: { route: Route } & ShellProps) {
  const [navOpened, { toggle: toggleNav, close: closeNav }] = useDisclosure(false);
  const [fixtureEvents, setFixtureEvents] = useState<StreamEvent[] | null>(null);
  const [fixtureRunId, setFixtureRunId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [speed, setSpeed] = useState("20");
  const [nonce, setNonce] = useState(0);
  const [mode, setMode] = useState<FollowMode>("follow");
  const [cursor, setCursor] = useState(1);
  const [manual, setManual] = useState<StepKey | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!route.run) return;
    loadFixture(route.run)
      .then((f) => {
        setFixtureEvents(f.events);
        setFixtureRunId(f.runId);
      })
      .catch((err) => setLoadError(err instanceof Error ? err.message : "没有这条记录"));
  }, [route.run]);

  const played = useReplay(fixtureEvents, Number(speed), nonce);
  const live = useLive(route.run ? null : route.runId);
  const isReplay = Boolean(route.run);
  const events = useMemo(() => (isReplay ? (fixtureEvents ?? []).slice(0, played) : live.events), [isReplay, fixtureEvents, played, live.events]);
  const shown = useMemo(() => (mode === "follow" ? events : events.slice(0, cursor)), [mode, events, cursor]);
  const view = useMemo(() => buildRunView(shown), [shown]);
  const fullView = useMemo(() => (mode === "follow" ? view : buildRunView(events)), [mode, view, events]);

  // 实时记录：没结束时每 0.5 秒刷新「已用」；回放用事件自己的时间。
  useEffect(() => {
    if (isReplay || fullView.terminal) return;
    const id = setInterval(() => setClock(Date.now()), 500);
    return () => clearInterval(id);
  }, [isReplay, fullView.terminal]);
  const now = isReplay || view.terminal || mode === "history" ? view.lastAt ?? 0 : clock;

  const selected = manual ?? currentStep(view);
  const phase = phaseOf(view);
  const runId = isReplay ? fixtureRunId : route.runId;
  const done = view.terminal && Boolean(view.snapshot?.conclusion);
  const result = useMemo(() => (done && view.snapshot ? resultFromParts(view.snapshot, view.report, shown, runId) : null), [done, view.snapshot, view.report, shown, runId]);

  useEffect(() => {
    if (done && mode === "follow") resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [done, mode]);

  const changeMode = (next: FollowMode) => {
    if (next === "history") setCursor(events.length);
    else setManual(null);
    setMode(next);
  };
  const selectStep = (key: StepKey) => {
    setManual(key);
    closeNav();
  };
  const restart = () => {
    setMode("follow");
    setManual(null);
    setNonce((n) => n + 1);
  };

  const noEvents = isReplay && fixtureEvents !== null && fixtureEvents.length === 0;
  const activity = (height: string | number) => (
    <ActivityPanel view={view} mode={mode} onMode={changeMode} cursor={cursor} total={events.length} onCursor={setCursor} height={height} />
  );

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 280, breakpoint: "md", collapsed: { mobile: !navOpened } }}
      aside={{ width: 320, breakpoint: "md", collapsed: { desktop: false, mobile: true } }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader onOpenHistory={onOpenHistory} navigate={navigate} burger={{ opened: navOpened, toggle: toggleNav, label: "步骤" }} />
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <AppShell.Section>
          <Text fw={700} size="sm" mb="md">
            核查步骤
          </Text>
        </AppShell.Section>
        <AppShell.Section grow component={ScrollArea}>
          <StepTimeline view={view} now={now} selected={selected} onSelect={selectStep} />
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Aside p="md">{activity("100%")}</AppShell.Aside>
      <AppShell.Main>
        <Stack gap="md" maw={820} mx="auto" data-gp-phase={phase}>
          <Paper withBorder radius="md" px="sm" py={8}>
            <Group justify="space-between" gap="xs">
              <Group gap="xs" wrap="nowrap">
                <Badge color={phase === "complete" ? "teal" : phase === "interrupted" ? "gray" : "red"} variant="light" radius="sm">
                  {view.terminal || phase === "complete" ? PHASE_TEXT[phase] ?? "已结束" : view.steps[currentStep(view)].status === "running" ? `正在${STEP_META[currentStep(view)].title}` : PHASE_TEXT[phase] ?? "核查中"}
                </Badge>
                {mode === "history" ? (
                  <Badge color="gray" variant="outline" radius="sm">
                    历史回放中
                  </Badge>
                ) : null}
              </Group>
              {isReplay ? (
                <Group gap="xs" wrap="nowrap">
                  <SegmentedControl
                    size="xs"
                    value={speed}
                    onChange={setSpeed}
                    data={[
                      { label: "10×", value: "10" },
                      { label: "20×", value: "20" },
                      { label: "60×", value: "60" },
                    ]}
                    aria-label="回放速度"
                  />
                  <Button size="compact-sm" variant="default" leftSection={<IconRefresh size={14} />} onClick={restart}>
                    重放
                  </Button>
                </Group>
              ) : !view.terminal && route.runId ? (
                <Button size="compact-sm" variant="default" color="gray" leftSection={<IconPlayerStop size={14} />} onClick={() => cancelInvestigation(route.runId!)}>
                  停止核查
                </Button>
              ) : null}
            </Group>
          </Paper>
          {loadError || live.error ? <Alert color="red" variant="light">{loadError || live.error}</Alert> : null}
          {view.failure ? <Alert color="orange" variant="light">{view.failure}</Alert> : null}
          {noEvents ? (
            <Alert color="gray" variant="light" title="这条记录没有保存运行过程">
              <Button mt="xs" size="xs" variant="light" leftSection={<IconPlayerPlay size={14} />} onClick={() => navigate(`?part=result&run=${route.run}`)}>
                查看结果
              </Button>
            </Alert>
          ) : null}

          {/* 手机：步骤切换条 */}
          <ScrollArea type="never" hiddenFrom="md">
            <Group gap={6} wrap="nowrap">
              {view.order.map((key) => {
                const s = view.steps[key];
                return (
                  <Button
                    key={key}
                    size="compact-sm"
                    radius="xl"
                    variant={selected === key ? "filled" : s.status === "waiting" ? "default" : "light"}
                    onClick={() => setManual(key)}
                    style={{ flexShrink: 0 }}
                  >
                    {STEP_META[key].title}
                    {s.status === "running" ? " …" : s.status === "done" ? " ✓" : ""}
                  </Button>
                );
              })}
            </Group>
          </ScrollArea>

          {!noEvents ? <StepOutput view={view} stepKey={selected} now={now} /> : null}

          <Box hiddenFrom="md">
            <Paper withBorder radius="lg" p="md">
              {activity(360)}
            </Paper>
          </Box>

          {result ? (
            <Box ref={resultRef} pt="sm">
              <Divider label="结果" labelPosition="center" mb="md" />
              <ResultView data={result} footer={<SharePanel runId={runId} complete={result.snapshot.phase === "complete"} />} />
            </Box>
          ) : null}
        </Stack>
      </AppShell.Main>
    </AppShell>
  );
}
