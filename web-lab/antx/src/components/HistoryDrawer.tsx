// 照抄自 antd Drawer 基础示例 https://ant.design/components/drawer-cn#drawer-demo-basic-right
// 列表照抄自 Ant Design X Conversations「分组」示例 https://x.ant.design/components/conversations-cn#conversations-demo-group
import { FileSearchOutlined } from "@ant-design/icons";
import { Conversations, type ConversationsProps } from "@ant-design/x";
import { Drawer, Empty, Flex, Grid, Skeleton, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { isLabelKey, LABEL_TEXT } from "@shared/domain/labels.ts";
import { listHistory, loadFixtureIndex } from "../lib/api.ts";
import { navigate } from "../lib/nav.ts";
import type { FixtureMeta, HistoryEntry } from "../lib/types.ts";
import { LABEL_COLOR } from "./LabelTag.tsx";

const STATUS_TEXT: Record<string, string> = {
  accepted: "排队中", extracting: "进行中", investigating: "进行中", judging: "进行中",
  cancelling: "正在停止", cancelled: "已停止", interrupted: "已中断", completed: "",
};

function day(ms: number) {
  return new Date(ms).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

export default function HistoryDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [mine, setMine] = useState<HistoryEntry[] | null>(null);
  const [samples, setSamples] = useState<FixtureMeta[]>([]);
  const screens = Grid.useBreakpoint();

  useEffect(() => {
    if (!open) return;
    listHistory().then(setMine).catch(() => setMine([]));
    loadFixtureIndex().then(setSamples).catch(() => setSamples([]));
  }, [open]);

  const label = (claim: string, at: number, extra: React.ReactNode) => (
    <Flex vertical gap={2} style={{ minWidth: 0, padding: "4px 0" }}>
      <Typography.Text ellipsis={{ tooltip: claim }} style={{ maxWidth: "100%" }}>{claim}</Typography.Text>
      <Flex gap={6} align="center">
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{day(at)}</Typography.Text>
        {extra}
      </Flex>
    </Flex>
  );

  const items: ConversationsProps["items"] = [
    ...(mine ?? []).map((run) => ({
      key: `live:${run.runId}`,
      group: "这台浏览器发起的核查",
      icon: <FileSearchOutlined />,
      label: label(run.claim || "（没有文字）", run.createdAt, STATUS_TEXT[run.status] ? <Tag>{STATUS_TEXT[run.status]}</Tag> : null),
      "data-history-run": run.runId,
    })),
    ...samples.map((s) => ({
      key: `run:${s.fixture}`,
      group: "样例记录（本地回放）",
      icon: <FileSearchOutlined />,
      label: label(
        s.claim,
        s.createdAt,
        isLabelKey(s.label) ? <Tag color={LABEL_COLOR[s.label]} variant="filled">{LABEL_TEXT[s.label]}</Tag> : null,
      ),
    })),
  ];

  return (
    <Drawer title="历史记录" open={open} onClose={onClose} placement="right" size={screens.sm ? 420 : "100%"} styles={{ body: { padding: 8 } }}>
      {mine === null ? (
        <Skeleton active paragraph={{ rows: 4 }} style={{ padding: 16 }} />
      ) : items.length === 0 ? (
        <Empty description="还没有核查记录" />
      ) : (
        <Conversations
          items={items}
          groupable
          onActiveChange={(key) => {
            onClose();
            const [kind, id] = String(key).split(/:(.*)/);
            if (kind === "live") navigate({ part: "result", live: id });
            else navigate({ part: "result", run: id });
          }}
        />
      )}
    </Drawer>
  );
}
