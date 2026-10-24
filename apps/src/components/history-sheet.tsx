// 照抄 shadcn/ui Sheet（https://ui.shadcn.com/docs/components/sheet）作抽屉，
// 列表照抄 Item 的「Link」示例（https://ui.shadcn.com/docs/components/item），空状态照抄 Empty（https://ui.shadcn.com/docs/components/empty）。
import { useEffect, useState } from "react";
import { ChevronRightIcon, HistoryIcon, PlayIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemTitle } from "@/components/ui/item";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { LabelBadge } from "@/components/label-badge";
import { loadHistory } from "@/lib/data";
import { historyClaimText } from "@/lib/derive";
import { hrefOf, navigate, type Route } from "@/lib/route";
import type { HistoryEntry } from "@/lib/types";
import { isLabelKey } from "@shared/domain/labels";
import { formatDay } from "@shared/investigation/presentation";

const STATUS_TEXT: Record<string, string> = {
  completed: "",
  interrupted: "没有查完",
  cancelled: "已停止",
};

function Entry({ entry, onPick }: { entry: HistoryEntry; onPick: () => void }) {
  const run = entry.fixture ?? entry.runId;
  const status = STATUS_TEXT[entry.status] ?? "进行中";
  const target: Route = entry.status === "completed" ? { view: "result", run } : { view: "run", run };
  return (
    <Item variant="outline" size="sm" asChild>
      <a
        href={hrefOf(target)}
        onClick={(e) => {
          e.preventDefault();
          onPick();
          navigate(target);
        }}
      >
        <ItemContent className="min-w-0">
          <ItemTitle className="line-clamp-2 leading-snug">{historyClaimText(entry.claim)}</ItemTitle>
          <ItemDescription className="flex items-center gap-2">
            {isLabelKey(entry.label) ? <LabelBadge label={entry.label} /> : null}
            <span>{formatDay(entry.createdAt)}</span>
            {status ? <span>{status}</span> : null}
          </ItemDescription>
        </ItemContent>
        <ItemActions>
          <ChevronRightIcon className="size-4" />
        </ItemActions>
      </a>
    </Item>
  );
}

export function HistorySheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [data, setData] = useState<{ mine: HistoryEntry[]; samples: HistoryEntry[]; error: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    void loadHistory().then((next) => alive && setData(next));
    return () => {
      alive = false;
    };
  }, [open]);
  const close = () => onOpenChange(false);
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle>历史记录</SheetTitle>
          <SheetDescription>点开直接看结果，不会重新核查。</SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="flex flex-col gap-6 p-4">
            {!data ? (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-16" />
                <Skeleton className="h-16" />
              </div>
            ) : (
              <>
                <section className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium text-muted-foreground">这个浏览器发起的核查</h3>
                  {data.mine.length ? (
                    <ItemGroup className="gap-2">
                      {data.mine.map((entry) => (
                        <Entry key={entry.runId} entry={entry} onPick={close} />
                      ))}
                    </ItemGroup>
                  ) : (
                    <Empty className="border border-dashed p-6 md:p-6">
                      <EmptyHeader>
                        <EmptyMedia variant="icon">
                          <HistoryIcon />
                        </EmptyMedia>
                        <EmptyTitle>还没有记录</EmptyTitle>
                        <EmptyDescription>{data.error || "在这个浏览器里核查过的说法会列在这里。"}</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </section>
                {data.samples.length ? (
                  <section className="flex flex-col gap-2">
                    <h3 className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
                      <PlayIcon className="size-3" />
                      回放样例（只在开发模式出现）
                    </h3>
                    <ItemGroup className="gap-2">
                      {data.samples.map((entry) => (
                        <Entry key={entry.runId} entry={entry} onPick={close} />
                      ))}
                    </ItemGroup>
                  </section>
                ) : null}
              </>
            )}
          </div>
        </ScrollArea>
        <div className="border-t p-4">
          <Button variant="outline" className="w-full" onClick={close}>
            关闭
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
