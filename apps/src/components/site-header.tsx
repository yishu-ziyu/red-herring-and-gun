// 照抄 shadcn/ui dashboard-01 block 的 SiteHeader（https://ui.shadcn.com/blocks#dashboard-01，components/site-header.tsx）：
// 左侧品牌，竖分隔线，标题；右侧操作按钮。
import type { ReactNode } from "react";
import { HistoryIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { navigate } from "@/lib/route";

export function SiteHeader({ title, onHistory, actions }: { title?: ReactNode; onHistory: () => void; actions?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b bg-background/95 backdrop-blur">
      <div className="flex w-full min-w-0 items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <a
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate({ view: "home" });
          }}
          className="flex shrink-0 items-center gap-2 font-semibold"
        >
          <img src="/mark.png" alt="" className="size-7" />
          <span className="text-base">红鲱鱼与枪</span>
        </a>
        {title ? (
          <>
            <Separator orientation="vertical" className="mx-2 hidden data-[orientation=vertical]:h-4 sm:block" />
            <div className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">{title}</div>
          </>
        ) : (
          <div className="flex-1" />
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {actions}
          <Button variant="ghost" size="sm" onClick={() => navigate({ view: "home" })} aria-label="新的核查">
            <PlusIcon />
            <span className="hidden sm:inline">新的核查</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onHistory} aria-label="历史记录">
            <HistoryIcon />
            <span className="hidden sm:inline">历史记录</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
