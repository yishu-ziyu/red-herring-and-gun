// 分享：按钮照抄 shadcn/ui Button（https://ui.shadcn.com/docs/components/button），
// 链接框照抄 shadcn/ui Input Group 的「Button」示例（https://ui.shadcn.com/docs/components/input-group，复制按钮放在 addon 里）。
import { useState } from "react";
import { CheckIcon, CopyIcon, Share2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupButton } from "@/components/ui/input-group";
import { Spinner } from "@/components/ui/spinner";
import { createShare } from "@/lib/data";

export function SharePanel({ runId }: { runId: string }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const start = async () => {
    setBusy(true);
    setError("");
    try {
      setUrl(await createShare(runId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "没能生成链接");
    } finally {
      setBusy(false);
    }
  };

  if (url) {
    return (
      <InputGroup className="w-full sm:max-w-md">
        <a data-gp-share-url href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate px-3 text-sm text-primary underline-offset-4 hover:underline">
          {url}
        </a>
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            aria-label="复制链接"
            size="icon-xs"
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(() => setCopied(true));
            }}
          >
            {copied ? <CheckIcon /> : <CopyIcon />}
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1">
      <Button data-gp-share-start variant="outline" size="sm" onClick={start} disabled={busy}>
        {busy ? <Spinner /> : <Share2Icon />}
        生成分享链接
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
