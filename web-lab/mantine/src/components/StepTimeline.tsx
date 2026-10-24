// 照抄 Mantine Timeline「Usage」（https://mantine.dev/core/timeline/）：bullet 换成 agent 头像，每项下写这一步自己的耗时。
import { Avatar, Badge, Group, Loader, Text, Timeline, UnstyledButton } from "@mantine/core";
import { IconAlertTriangle, IconCheck } from "@tabler/icons-react";
import { STEP_META, seconds, type RunView, type StepKey } from "../lib/runState.ts";

export function stepDuration(view: RunView, key: StepKey, now: number): number | null {
  const s = view.steps[key];
  if (!s.startedAt) return null;
  const end = s.endedAt ?? (s.status === "running" ? now : s.startedAt);
  return Math.max(0, end - s.startedAt);
}

export function StepTimeline({ view, now, selected, onSelect }: { view: RunView; now: number; selected: StepKey; onSelect: (key: StepKey) => void }) {
  const active = view.order.reduce((acc, key, i) => (view.steps[key].status !== "waiting" ? i : acc), -1);
  return (
    <Timeline active={active} bulletSize={34} lineWidth={2} color="red">
      {view.order.map((key) => {
        const step = view.steps[key];
        const meta = STEP_META[key];
        const ms = stepDuration(view, key, now);
        return (
          <Timeline.Item
            key={key}
            bullet={<Avatar src={meta.img} alt={meta.agent} size={30} radius="xl" style={{ opacity: step.status === "waiting" ? 0.45 : 1 }} />}
            title={
              <UnstyledButton onClick={() => onSelect(key)} w="100%" aria-current={selected === key ? "step" : undefined}>
                <Group gap={6} justify="space-between" wrap="nowrap">
                  <Text fw={selected === key ? 700 : 600} c={step.status === "waiting" ? "dimmed" : selected === key ? "red.8" : undefined}>
                    {meta.title}
                    {step.rounds > 1 ? <Text span size="xs" c="dimmed"> ×{step.rounds}</Text> : null}
                  </Text>
                  {step.status === "running" ? (
                    <Loader size={14} color="red" type="dots" />
                  ) : step.status === "done" ? (
                    <IconCheck size={16} color="var(--mantine-color-teal-6)" />
                  ) : step.status === "failed" ? (
                    <IconAlertTriangle size={16} color="var(--mantine-color-orange-6)" />
                  ) : null}
                </Group>
              </UnstyledButton>
            }
          >
            <UnstyledButton onClick={() => onSelect(key)} w="100%">
              <Text c="dimmed" size="xs">
                {meta.agent} · {meta.doing}
              </Text>
              {ms !== null ? (
                <Badge mt={4} size="sm" variant={step.status === "running" ? "light" : "default"} color={step.status === "running" ? "red" : "gray"} radius="sm" tt="none" fw={500}>
                  {step.status === "running" ? "已用 " : "用时 "}
                  {seconds(ms)}
                </Badge>
              ) : (
                <Text size="xs" c="dimmed" mt={2}>
                  等待中
                </Text>
              )}
            </UnstyledButton>
          </Timeline.Item>
        );
      })}
    </Timeline>
  );
}
