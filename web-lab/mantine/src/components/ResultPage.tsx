// 外层照抄 AppShell「Basic usage」只有 header（https://mantine.dev/core/app-shell/），载入态照抄 Skeleton（https://mantine.dev/core/skeleton/）。
import { useEffect, useState } from "react";
import { Alert, AppShell, Button, Container, Group, Skeleton, Stack } from "@mantine/core";
import { IconPlayerPlay } from "@tabler/icons-react";
import type { Route, ShellProps } from "../App.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { ResultView } from "./ResultView.tsx";
import { SharePanel } from "./SharePanel.tsx";
import { fetchResult, loadFixture, resultFromParts, type ResultData } from "../lib/data.ts";

/** 样例或真实记录 → 结果；不重新发起核查。 */
export function useResult(route: Route) {
  const [state, setState] = useState<{ data: ResultData | null; error: string | null; hasEvents: boolean }>({ data: null, error: null, hasEvents: false });
  useEffect(() => {
    let alive = true;
    const load = route.run
      ? loadFixture(route.run).then((f) => ({ data: resultFromParts(f.result.snapshot, f.result.report, f.events, f.runId), hasEvents: f.events.length > 0 }))
      : route.runId
        ? fetchResult(route.runId).then((data) => ({ data, hasEvents: true }))
        : Promise.reject(new Error("没有指定记录"));
    load
      .then(({ data, hasEvents }) => alive && setState({ data, error: null, hasEvents }))
      .catch((err) => alive && setState({ data: null, error: err instanceof Error ? err.message : "没能读取结果", hasEvents: false }));
    return () => {
      alive = false;
    };
  }, [route.run, route.runId]);
  return state;
}

export function ResultSkeleton() {
  return (
    <Stack gap="md">
      <Skeleton h={72} radius="md" />
      <Skeleton h={220} radius="lg" />
      <Skeleton h={180} radius="lg" />
    </Stack>
  );
}

export function ResultPage({ route, onOpenHistory, navigate }: { route: Route } & ShellProps) {
  const { data, error, hasEvents } = useResult(route);
  const query = route.run ? `run=${route.run}` : `runId=${encodeURIComponent(route.runId ?? "")}`;
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <AppHeader onOpenHistory={onOpenHistory} navigate={navigate} />
      </AppShell.Header>
      <AppShell.Main>
        <Container size={760} px={0} pb="xl" data-gp-phase={data ? data.snapshot.phase : undefined}>
          {error ? <Alert color="red" variant="light">{error}</Alert> : null}
          {!data && !error ? <ResultSkeleton /> : null}
          {data ? (
            <ResultView
              data={data}
              footer={
                <Stack gap="sm">
                  <SharePanel runId={data.runId} complete={data.snapshot.phase === "complete"} />
                  {hasEvents ? (
                    <Group>
                      <Button variant="default" leftSection={<IconPlayerPlay size={16} />} onClick={() => navigate(`?part=running&${query}`)}>
                        回放核查过程
                      </Button>
                    </Group>
                  ) : null}
                </Stack>
              }
            />
          ) : null}
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
