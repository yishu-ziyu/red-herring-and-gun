// 照抄 Mantine CopyButton「Usage」（https://mantine.dev/core/copy-button/）+ TextInput rightSection（https://mantine.dev/core/text-input/）。
import { useState } from "react";
import { ActionIcon, Alert, Anchor, Button, CopyButton, Group, Paper, Stack, Text, TextInput, Tooltip } from "@mantine/core";
import { IconCheck, IconCopy, IconExternalLink, IconShare } from "@tabler/icons-react";
import { createShare } from "../lib/data.ts";

export function SharePanel({ runId, complete }: { runId: string | null; complete: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const make = async () => {
    if (!runId) return;
    setBusy(true);
    setError(null);
    try {
      setUrl(await createShare(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "没能生成链接");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Paper withBorder radius="lg" p="md">
      <Stack gap="sm">
        <Group justify="space-between" wrap="nowrap">
          <Text fw={600} size="sm">
            分享这条结论
          </Text>
          <Button
            leftSection={<IconShare size={16} />}
            variant="light"
            onClick={make}
            loading={busy}
            disabled={!runId || !complete || Boolean(url)}
            data-gp-share-start
          >
            生成链接
          </Button>
        </Group>
        {!complete ? (
          <Text size="sm" c="dimmed">
            查完才能分享
          </Text>
        ) : null}
        {url ? (
          <Group gap="xs" wrap="nowrap">
            <TextInput
              readOnly
              value={url}
              aria-label="分享链接"
              data-gp-share-url={url}
              style={{ flex: 1, minWidth: 0 }}
              rightSection={
                <CopyButton value={url} timeout={1600}>
                  {({ copied, copy }) => (
                    <Tooltip label={copied ? "已复制" : "复制"} withArrow position="left">
                      <ActionIcon color={copied ? "teal" : "gray"} variant="subtle" onClick={copy} aria-label="复制链接">
                        {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                      </ActionIcon>
                    </Tooltip>
                  )}
                </CopyButton>
              }
            />
            <Anchor href={url} target="_blank" rel="noopener noreferrer" aria-label="打开分享页">
              <IconExternalLink size={20} />
            </Anchor>
          </Group>
        ) : null}
        {error ? (
          <Alert color="orange" variant="light" radius="md" data-share-error>
            {error}
          </Alert>
        ) : null}
      </Stack>
    </Paper>
  );
}
