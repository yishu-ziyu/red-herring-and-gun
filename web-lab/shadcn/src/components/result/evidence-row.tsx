// 一条依据。来源外链小标签照抄 AI Elements Sources 的 Source 链接（https://ai-sdk.dev/elements/components/sources），
// 「为什么算支持 / 反驳」照抄 shadcn/ui Collapsible 示例（https://ui.shadcn.com/docs/components/collapsible），默认收起。
import { useState } from "react";
import { ArrowUpRightIcon, ChevronDownIcon } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Favicon, domainOf } from "@/components/source-chip";
import { cn } from "@/lib/utils";
import { clean } from "@/lib/scrub";
import type { PresentedEvidence } from "@shared/investigation/presentation";
import { resultWording } from "@shared/investigation/presentation";

const w = resultWording();

const ROLE_CLASS: Record<string, string> = {
  support: "border-emerald-200 bg-emerald-50 text-emerald-700",
  contradict: "border-red-200 bg-red-50 text-red-700",
};

const WHY_TEXT: Record<string, string> = {
  support: "为什么算支持",
  contradict: "为什么算反驳",
  "context-only": "为什么只作参考",
  unassessed: "还没核对",
};

export function SourceLink({ href, url, className }: { href: string; url: string; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-full border bg-background px-2 py-0.5 align-middle text-xs text-muted-foreground no-underline transition-colors hover:text-foreground",
        className
      )}
    >
      <Favicon url={url} />
      <span className="truncate">{domainOf(url)}</span>
      <ArrowUpRightIcon className="size-3 shrink-0" />
    </a>
  );
}

export function EvidenceRow({
  ev,
  url,
  reason,
  index,
}: {
  ev: PresentedEvidence;
  url: string;
  /** 来源审核写的方向理由（快照 relationReason），presentEvidence 只在没有摘句时才带出。 */
  reason: string;
  index?: number;
}) {
  const [open, setOpen] = useState(false);
  const why = clean(reason) || clean(ev.finding);
  const quote = ev.quote ? clean(ev.quote.text) : "";
  return (
    <li data-gp-evidence-row data-gp-role={ev.role} className="flex flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="outline" className={ROLE_CLASS[ev.role] ?? ""}>
          {ev.roleText}
        </Badge>
        {index !== undefined ? <span className="font-mono text-muted-foreground">[{index}]</span> : null}
        <span className="min-w-0 truncate text-muted-foreground">{clean(ev.linkText)}</span>
      </div>
      <p className="text-sm leading-relaxed">
        {ev.quote?.kind === "snippet" ? (
          <Badge variant="secondary" className="mr-1 align-middle">
            {w.snippetTag}
          </Badge>
        ) : null}
        {ev.quote?.kind === "summary" ? (
          <Badge variant="secondary" className="mr-1 align-middle">
            {w.summaryTag}
          </Badge>
        ) : null}
        {quote ? (
          ev.quote?.kind === "summary" ? (
            <span>{quote}</span>
          ) : (
            <mark className="rounded-sm bg-yellow-200/70 px-0.5 text-foreground">{ev.quote?.kind === "page" ? `「${quote}」` : quote}</mark>
          )
        ) : null}{" "}
        {ev.href ? <SourceLink href={ev.href} url={url} /> : null}
      </p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>{ev.published ?? w.publishedUnknown}</span>
        <span>{ev.read.text}</span>
        {ev.dead ? <span className="text-amber-700">{w.deadLink}</span> : null}
        {ev.provenance ? (
          <span>
            {ev.provenance.text}
            {ev.provenance.originDate ? ` · ${ev.provenance.originDate}` : ""}
          </span>
        ) : null}
      </div>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="-ml-2 h-7 px-2 text-xs text-muted-foreground">
            {WHY_TEXT[ev.role] ?? "为什么"}
            <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-2 pt-1 text-sm">
          {why ? <p>{why}</p> : <p className="text-muted-foreground">审核时没有写下理由。</p>}
          {ev.passage ? (
            <div className="rounded-md bg-muted/60 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">{w.viewContext}</p>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{clean(ev.passage)}</p>
            </div>
          ) : null}
          <p className="text-xs text-muted-foreground">{clean(ev.passageNote)}</p>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
