// 照抄 Mantine Drawer「Usage」（https://mantine.dev/core/drawer/）+ NavLink「With description」（https://mantine.dev/core/nav-link/）；点开直接看结果，不重新核查。
import { useEffect, useState } from "react";
import { Badge, Drawer, Loader, NavLink, ScrollArea, Stack, Text } from "@mantine/core";
import { IconChevronRight } from "@tabler/icons-react";
import { LABEL_TEXT, isLabelKey } from "@shared/domain/labels.ts";
import { judgmentToLabel } from "@shared/domain/labels.ts";
import { fetchHistory, loadFixtureIndex, splitImageClaim, type HistoryItem } from "../lib/data.ts";
import { labelColor, shortDate } from "../lib/derive.ts";

type Props = { opened: boolean; onClose: () => void; navigate: (href: string) => void };

const STATUS_TEXT: Record<string, string> = {
  accepted: "排队中",
  extracting: "核查中",
  running: "核查中",
  cancelling: "正在停止",
  cancelled: "已停止",
  interrupted: "没查完",
  failed: "没能完成",
};

export function HistoryDrawer({ opened, onClose, navigate }: Props) {
  const [items, setItems] = useState<HistoryItem[] | null>(null);

  useEffect(() => {
    if (!opened) return;
    let alive = true;
    Promise.all([fetchHistory().catch(() => []), loadFixtureIndex().catch(() => [])]).then(([server, fixtures]) => {
      if (!alive) return;
      const fromFixtures: HistoryItem[] = fixtures.map((f) => ({
        key: `fixture-${f.name}`,
        claim: splitImageClaim(f.claim).claim,
        createdAt: f.createdAt,
        label: f.label ?? (f.judgment ? judgmentToLabel(f.judgment as never) : null),
        status: "completed",
        source: "fixture",
        href: `?part=result&run=${f.name}`,
      }));
      const seen = new Set(server.map((s) => s.key));
      setItems([...server, ...fromFixtures.filter((f) => !seen.has(f.key))].sort((a, b) => b.createdAt - a.createdAt));
    });
    return () => {
      alive = false;
    };
  }, [opened]);

  return (
    <Drawer opened={opened} onClose={onClose} title="历史记录" position="right" size="md" padding="md" scrollAreaComponent={ScrollArea.Autosize}>
      {items === null ? (
        <Stack align="center" py="xl">
          <Loader size="sm" />
        </Stack>
      ) : items.length === 0 ? (
        <Text c="dimmed" size="sm">
          还没有记录
        </Text>
      ) : (
        <Stack gap={4}>
          {items.map((item) => {
            const label = item.label && isLabelKey(item.label) ? item.label : null;
            return (
              <NavLink
                key={item.key}
                href={item.href}
                onClick={(event) => {
                  event.preventDefault();
                  onClose();
                  navigate(item.href);
                }}
                label={<Text size="sm" lineClamp={2}>{item.claim}</Text>}
                description={shortDate(item.createdAt)}
                leftSection={
                  label ? (
                    <Badge color={labelColor(label)} variant="light" w={86}>
                      {LABEL_TEXT[label]}
                    </Badge>
                  ) : (
                    <Badge color="gray" variant="outline" w={86}>
                      {STATUS_TEXT[item.status] ?? "已完成"}
                    </Badge>
                  )
                }
                rightSection={<IconChevronRight size={14} stroke={1.5} />}
                styles={{ root: { borderRadius: "var(--mantine-radius-md)" } }}
              />
            );
          })}
        </Stack>
      )}
    </Drawer>
  );
}
