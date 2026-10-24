// 输入区照抄 Mantine Textarea「Autosize」（https://mantine.dev/core/textarea/）+ Dropzone「Usage」（https://mantine.dev/x/dropzone/），
// 图片缩略图照抄 Dropzone「Images previews」示例（同页）；外层是 AppShell「Basic usage」只有 header。
import { useEffect, useRef, useState } from "react";
import { Alert, AppShell, Button, CloseButton, Container, Group, Image, Paper, SimpleGrid, Stack, Text, Textarea } from "@mantine/core";
import { Dropzone, IMAGE_MIME_TYPE } from "@mantine/dropzone";
import { IconAlertCircle, IconPhoto, IconUpload, IconX } from "@tabler/icons-react";
import { AppHeader } from "./AppHeader.tsx";
import type { ShellProps } from "../App.tsx";
import { fetchQuota, startInvestigation, type Quota } from "../lib/data.ts";

type Picked = { file: File; url: string };

const MAX_IMAGES = 3;
const MAX_SIZE = 8 * 1024 ** 2;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function HomePage({ onOpenHistory, navigate }: ShellProps) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<Picked[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quota, setQuota] = useState<Quota | null>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    fetchQuota().then(setQuota);
    return () => imagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
  }, []);

  const addFiles = (files: File[]) => {
    const fresh = files.filter((f) => f.type.startsWith("image/") && f.size <= MAX_SIZE);
    setImages((prev) => [...prev, ...fresh.map((file) => ({ file, url: URL.createObjectURL(file) }))].slice(0, MAX_IMAGES));
  };

  const remove = (index: number) =>
    setImages((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });

  const canStart = (text.trim().length > 0 || images.length > 0) && !busy && quota?.remaining !== 0;

  const submit = async () => {
    if (!canStart) return;
    setBusy(true);
    setError(null);
    try {
      const payloadImages = await Promise.all(
        images.map(async ({ file }) => ({ name: file.name, type: file.type, size: file.size, dataUrl: await readDataUrl(file) })),
      );
      const { runId } = await startInvestigation({ text, images: payloadImages });
      navigate(`?part=running&runId=${encodeURIComponent(runId)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "没能开始核查");
      setBusy(false);
    }
  };

  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <AppHeader onOpenHistory={onOpenHistory} navigate={navigate} />
      </AppShell.Header>
      <AppShell.Main>
        <Container size={640} pt={{ base: "md", sm: 48 }} pb="xl">
          <Stack gap="lg">
            <Group justify="center">
              <Image src="/logo.png" alt="红鲱鱼与枪" w={{ base: 168, sm: 208 }} h="auto" />
            </Group>
            <Paper withBorder radius="lg" p={{ base: "sm", sm: "md" }} shadow="xs">
              <Stack gap="sm">
                <Textarea
                  aria-label="要核查的说法"
                  placeholder="贴一句要核查的话，也可以直接粘贴图片"
                  autosize
                  minRows={3}
                  maxRows={10}
                  size="md"
                  value={text}
                  onChange={(e) => setText(e.currentTarget.value)}
                  onPaste={(e) => {
                    const files = Array.from(e.clipboardData.files);
                    if (files.length) {
                      e.preventDefault();
                      addFiles(files);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
                  }}
                />
                {images.length > 0 ? (
                  <SimpleGrid cols={{ base: 3, sm: 4 }} spacing="xs">
                    {images.map((p, i) => (
                      <Paper key={p.url} withBorder radius="sm" pos="relative" style={{ overflow: "hidden" }}>
                        <Image src={p.url} alt={`图片 ${i + 1}`} h={84} fit="cover" />
                        <CloseButton
                          size="sm"
                          variant="white"
                          aria-label={`移除图片 ${i + 1}`}
                          pos="absolute"
                          top={4}
                          right={4}
                          onClick={() => remove(i)}
                        />
                      </Paper>
                    ))}
                  </SimpleGrid>
                ) : null}
                <Dropzone
                  onDrop={addFiles}
                  accept={IMAGE_MIME_TYPE}
                  maxSize={MAX_SIZE}
                  maxFiles={MAX_IMAGES}
                  disabled={images.length >= MAX_IMAGES}
                  radius="md"
                  p="sm"
                >
                  <Group justify="center" gap="sm" mih={44} style={{ pointerEvents: "none" }}>
                    <Dropzone.Accept>
                      <IconUpload size={22} color="var(--mantine-color-red-7)" stroke={1.5} />
                    </Dropzone.Accept>
                    <Dropzone.Reject>
                      <IconX size={22} color="var(--mantine-color-red-6)" stroke={1.5} />
                    </Dropzone.Reject>
                    <Dropzone.Idle>
                      <IconPhoto size={22} color="var(--mantine-color-dimmed)" stroke={1.5} />
                    </Dropzone.Idle>
                    <Text size="sm" c="dimmed">
                      {images.length >= MAX_IMAGES ? `最多 ${MAX_IMAGES} 张图片` : "添加图片：拖到这里或点击选择"}
                    </Text>
                  </Group>
                </Dropzone>
                <Group justify="space-between" wrap="nowrap">
                  <Text size="xs" c="dimmed">
                    {quota && quota.total > 0 && quota.remaining < quota.total ? `今天还能核查 ${quota.remaining} 次` : ""}
                  </Text>
                  <Button size="md" onClick={submit} loading={busy} disabled={!canStart} data-gp-start>
                    开始核查
                  </Button>
                </Group>
              </Stack>
            </Paper>
            {error ? (
              <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
                {error}
              </Alert>
            ) : null}
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
