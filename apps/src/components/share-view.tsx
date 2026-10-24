// 陌生人打开分享链接看到的页面（/s/:id 的前端版）。外框照抄 shadcn/ui login-01 这类居中单栏 block
// （https://ui.shadcn.com/blocks/authentication），正文复用结果页的 Card 结构，只读、不带分享按钮。
import { PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ResultView } from "@/components/result/result-view";
import { navigate } from "@/lib/route";
import type { RunData } from "@/lib/types";

export function ShareView({ data }: { data: RunData }) {
  return (
    <div className="min-h-svh bg-muted/40">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-3 px-4">
          <a href="/" className="flex items-center gap-2 font-semibold">
            <img src="/mark.png" alt="" className="size-7" />
            红鲱鱼与枪
          </a>
          <span className="text-xs text-muted-foreground">分享的核查</span>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-6">
        <ResultView run={data} mode="public" />
        <Button variant="outline" onClick={() => navigate({ view: "home" })} className="self-center">
          <PlusIcon />
          核查别的说法
        </Button>
      </main>
    </div>
  );
}
