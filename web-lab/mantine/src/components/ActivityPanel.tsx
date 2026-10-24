// 活动时间线照抄 Mantine Timeline「Usage」（https://mantine.dev/core/timeline/），
// 跟随 / 回放切换照抄 SegmentedControl（https://mantine.dev/core/segmented-control/），回放进度照抄 Slider（https://mantine.dev/core/slider/），
// 自动滚到底照抄 ScrollArea「Scroll to」示例（https://mantine.dev/core/scroll-area/）。
import { useEffect, useRef } from "react";
import { Button, Group, ScrollArea, SegmentedControl, Slider, Stack, Text, Timeline } from "@mantine/core";
import { IconArrowBarToDown } from "@tabler/icons-react";
import type { FeedItem, RunView } from "../lib/runState.ts";
import { seconds } from "../lib/runState.ts";

export type FollowMode = "follow" | "history";

const TONE: Record<FeedItem["tone"], string> = { default: "gray", positive: "teal", negative: "red", muted: "gray", accent: "red" };

type Props = {
  view: RunView;
  mode: FollowMode;
  onMode: (mode: FollowMode) => void;
  cursor: number;
  total: number;
  onCursor: (n: number) => void;
  height: string | number;
};

export function ActivityPanel({ view, mode, onMode, cursor, total, onCursor, height }: Props) {
  const viewport = useRef<HTMLDivElement>(null);
  const items = view.feed;

  useEffect(() => {
    if (mode !== "follow") return;
    viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" });
  }, [items.length, mode]);

  return (
    <Stack gap="sm" h={height}>
      <Group justify="space-between" wrap="nowrap">
        <Text fw={700} size="sm">
          活动时间线
        </Text>
        <Text size="xs" c="dimmed">
          {items.length} 条
        </Text>
      </Group>
      <SegmentedControl
        size="xs"
        fullWidth
        value={mode}
        onChange={(v) => onMode(v as FollowMode)}
        data={[
          { label: "实时跟随", value: "follow" },
          { label: "历史回放", value: "history" },
        ]}
      />
      {mode === "history" ? (
        <Stack gap={6}>
          <Slider
            min={1}
            max={Math.max(1, total)}
            value={Math.min(cursor, Math.max(1, total))}
            onChange={onCursor}
            size="sm"
            color="red"
            label={(v) => `第 ${v} / ${total} 条事件`}
            thumbLabel="回放到第几条事件"
          />
          <Group justify="space-between" wrap="nowrap">
            <Text size="xs" c="dimmed">
              停在第 {Math.min(cursor, total)} / {total} 条事件
            </Text>
            <Button size="compact-xs" variant="light" leftSection={<IconArrowBarToDown size={14} />} onClick={() => onMode("follow")}>
              回到最新
            </Button>
          </Group>
        </Stack>
      ) : null}
      <ScrollArea viewportRef={viewport} style={{ flex: 1 }} type="auto" offsetScrollbars>
        {items.length === 0 ? (
          <Text size="sm" c="dimmed">
            等待第一条动态
          </Text>
        ) : (
          <Timeline bulletSize={12} lineWidth={1} active={items.length - 1} color="gray">
            {items.map((item) => (
              <Timeline.Item key={item.id} bullet={null} color={TONE[item.tone]} styles={{ itemBullet: { borderColor: `var(--mantine-color-${TONE[item.tone]}-5)` } }}>
                <Text size="xs" c={item.tone === "muted" ? "dimmed" : item.tone === "negative" ? "red.8" : undefined} className="prose">
                  {item.text}
                </Text>
                <Text size="10px" c="dimmed">
                  {view.startedAt ? `+${seconds(item.at - view.startedAt)}` : ""}
                </Text>
              </Timeline.Item>
            ))}
          </Timeline>
        )}
      </ScrollArea>
    </Stack>
  );
}
