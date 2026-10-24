// 照抄 AI Elements InlineCitationCardTrigger 的样式（https://ai-sdk.dev/elements/components/inline-citation：secondary Badge + hostname + 「+N」），
// 在 hostname 前加站点图标（读不到就退回地球图标）。
import { useState } from "react";
import { GlobeIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function Favicon({ url, className }: { url: string; className?: string }) {
  // 站点图标从外网取，可能慢或取不到：加载成功前一直显示地球图标，不留空白。
  const [state, setState] = useState<"loading" | "ok" | "failed">("loading");
  const host = domainOf(url);
  const fallback = <GlobeIcon className={cn("size-3.5 shrink-0 text-muted-foreground", className)} />;
  if (state === "failed" || !host) return fallback;
  return (
    <>
      {state === "loading" ? fallback : null}
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`}
        alt=""
        onLoad={() => setState("ok")}
        onError={() => setState("failed")}
        className={cn("size-3.5 shrink-0 rounded-sm", state === "loading" && "hidden", className)}
      />
    </>
  );
}

export function SourceLabel({ urls, className }: { urls: string[]; className?: string }) {
  const first = urls[0] ?? "";
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1", className)}>
      <Favicon url={first} />
      <span className="truncate">{domainOf(first)}</span>
      {urls.length > 1 ? <span className="shrink-0 text-muted-foreground">+{urls.length - 1}</span> : null}
    </span>
  );
}
