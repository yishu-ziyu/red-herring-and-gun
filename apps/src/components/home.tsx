// 首页。版式照 web-lab/mantine 首页（大 logo 居中，下面一张输入卡片：输入框 + 贴图片区域 + 开始按钮），用 shadcn/ui 组件实现：
// 卡片照抄 Card（https://ui.shadcn.com/docs/components/card），输入框照抄 Textarea（https://ui.shadcn.com/docs/components/textarea），
// 贴图片区域照抄 Empty 的 Outline 示例（https://ui.shadcn.com/docs/components/empty，虚线框），
// 已选图片照抄 AI Elements Attachments 的 Grid 示例（https://ai-sdk.dev/elements/components/attachments）。
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ImageIcon } from "lucide-react";
import { Attachment, AttachmentPreview, AttachmentRemove, Attachments } from "@/components/ai-elements/attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { loadQuota, startInvestigation, type IntakeImage } from "@/lib/data";
import { navigate } from "@/lib/route";

// 后端最多读 4 张图；请求体上限 10MB，图片转成 data URL 后会变大约三分之一，所以原图合计不超过 7MB。
const MAX_IMAGES = 4;
const MAX_TOTAL_BYTES = 7 * 1024 * 1024;

type Picked = { id: string; file: File; url: string };

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function Home() {
  const [text, setText] = useState("");
  const [images, setImages] = useState<Picked[]>([]);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<{ remaining: number; total: number; enforced: boolean } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  useEffect(() => {
    void loadQuota().then(setQuota);
    return () => imagesRef.current.forEach((p) => URL.revokeObjectURL(p.url));
  }, []);

  const addFiles = (files: File[]) => {
    const fresh = files.filter((file) => file.type.startsWith("image/"));
    if (!fresh.length) return;
    setError("");
    setImages((prev) => {
      const next = [...prev];
      for (const file of fresh) {
        if (next.length >= MAX_IMAGES) break;
        next.push({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) });
      }
      return next;
    });
  };

  const remove = (id: string) =>
    setImages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((p) => p.id !== id);
    });

  const outOfQuota = quota?.enforced === true && quota.remaining <= 0;
  const canStart = (text.trim().length > 0 || images.length > 0) && !busy && !outOfQuota;

  const submit = async () => {
    if (!canStart) return;
    if (images.reduce((sum, p) => sum + p.file.size, 0) > MAX_TOTAL_BYTES) {
      setError("图片太大了，合计请不要超过 7MB");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload: IntakeImage[] = await Promise.all(
        images.map(async ({ file }) => ({ name: file.name, type: file.type, size: file.size, dataUrl: await readDataUrl(file) }))
      );
      const runId = await startInvestigation(text, payload);
      navigate({ view: "run", run: runId });
    } catch (err) {
      setError(err instanceof Error ? err.message : "没能开始核查");
      setBusy(false);
    }
  };

  const onDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setDragging(false);
    addFiles(Array.from(event.dataTransfer.files));
  };
  const full = images.length >= MAX_IMAGES;

  return (
    <main className="min-h-[calc(100svh-3.5rem)] bg-[#f9f7f4] px-4 pt-4 pb-10 sm:pt-12">
      <div className="mx-auto flex w-full max-w-[640px] flex-col gap-6">
        <img src="/logo.png" alt="红鲱鱼与枪" className="mx-auto h-auto w-[168px] sm:w-[208px]" />
        <Card className="gap-0 rounded-2xl py-3 shadow-xs sm:py-4">
          <CardContent className="flex flex-col gap-3 px-3 sm:px-4">
            <Textarea
              aria-label="要核查的说法"
              placeholder="贴一句要核查的话，也可以直接粘贴图片"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files);
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
              }}
              className="max-h-64 min-h-[5.5rem] bg-background px-3.5 py-2.5 text-base md:text-base"
            />
            {images.length ? (
              <Attachments variant="grid" className="ml-0 w-full justify-start">
                {images.map((p) => (
                  <Attachment
                    key={p.id}
                    data={{ id: p.id, type: "file", url: p.url, mediaType: p.file.type, filename: p.file.name }}
                    onRemove={() => remove(p.id)}
                  >
                    <AttachmentPreview />
                    <AttachmentRemove label="移除图片" />
                  </Attachment>
                ))}
              </Attachments>
            ) : null}
            <button
              type="button"
              disabled={full}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex min-h-[4.25rem] w-full items-center justify-center gap-3 rounded-lg border border-dashed px-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-60",
                dragging && "border-primary bg-muted/60 text-foreground"
              )}
            >
              <ImageIcon className="size-5 shrink-0" strokeWidth={1.5} />
              <span>{full ? `最多 ${MAX_IMAGES} 张图片` : "添加图片：拖到这里或点击选择"}</span>
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                {outOfQuota ? "今天的核查次数用完了" : quota?.enforced ? `今天还能核查 ${quota.remaining} 次` : ""}
              </p>
              <Button data-gp-start size="lg" className="h-10 px-5 text-base" disabled={!canStart} onClick={() => void submit()}>
                {busy ? <Spinner /> : null}
                开始核查
              </Button>
            </div>
          </CardContent>
        </Card>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </div>
    </main>
  );
}
