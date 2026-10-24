// 照抄 AI Elements PromptInput 官方示例（https://ai-sdk.dev/elements/components/prompt-input 「Usage with AI SDK」）：
// PromptInputHeader 放附件预览（Attachments，https://ai-sdk.dev/elements/components/attachments），Body 放输入框，Footer 放工具和提交。
import { useEffect, useState } from "react";
import { ImageIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import { Attachment, AttachmentPreview, AttachmentRemove, Attachments } from "@/components/ai-elements/attachments";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { loadQuota, startInvestigation } from "@/lib/data";
import { navigate } from "@/lib/route";

const PromptInputAttachmentsDisplay = () => {
  const attachments = usePromptInputAttachments();
  if (attachments.files.length === 0) return null;
  return (
    <Attachments variant="inline">
      {attachments.files.map((attachment) => (
        <Attachment data={attachment} key={attachment.id} onRemove={() => attachments.remove(attachment.id)}>
          <AttachmentPreview />
          <AttachmentRemove label="移除图片" />
        </Attachment>
      ))}
    </Attachments>
  );
};

const AddImageButton = () => {
  const attachments = usePromptInputAttachments();
  return (
    <PromptInputButton onClick={() => attachments.openFileDialog()} aria-label="添加图片">
      <ImageIcon className="size-4" />
      <span>添加图片</span>
    </PromptInputButton>
  );
};

export function Home() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<{ remaining: number; enforced: boolean } | null>(null);
  useEffect(() => {
    void loadQuota().then(setQuota);
  }, []);

  const submit = async (message: PromptInputMessage) => {
    const images = (message.files ?? [])
      .filter((file) => file.mediaType?.startsWith("image/") && file.url.startsWith("data:"))
      .map((file) => ({ name: file.filename, type: file.mediaType, dataUrl: file.url }));
    if (!message.text.trim() && images.length === 0) return;
    setBusy(true);
    setError("");
    try {
      const runId = await startInvestigation(message.text, images);
      navigate("running", runId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "没能开始核查");
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-[calc(100svh-3.5rem)] flex-col items-center justify-center px-4 pb-24">
      <div className="flex w-full max-w-2xl flex-col items-center gap-8">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo.png" alt="" className="size-20 rounded-2xl" />
          <h1 className="text-2xl font-semibold tracking-tight">红鲱鱼与枪</h1>
        </div>
        <PromptInput onSubmit={submit} accept="image/*" multiple globalDrop maxFiles={4} className="w-full">
          <PromptInputHeader>
            <PromptInputAttachmentsDisplay />
          </PromptInputHeader>
          <PromptInputBody>
            <PromptInputTextarea
              aria-label="要核查的说法"
              placeholder="输入或粘贴要核查的话，也可以粘贴图片"
              value={text}
              onChange={(e) => setText(e.target.value)}
              className="min-h-28"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <AddImageButton />
            </PromptInputTools>
            <PromptInputSubmit data-gp-start size="sm" className="px-3" disabled={busy} aria-label="开始调查">
              {busy ? <Spinner /> : null}
              开始调查
            </PromptInputSubmit>
          </PromptInputFooter>
        </PromptInput>
        {error ? (
          <Alert variant="destructive" className="w-full">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {quota?.enforced ? <p className="text-xs text-muted-foreground">今天还能核查 {quota.remaining} 次</p> : null}
      </div>
    </main>
  );
}
