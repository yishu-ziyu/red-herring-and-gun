// 没有查完时的说明。提示框照抄 shadcn/ui Alert（https://ui.shadcn.com/docs/components/alert），
// 材料的来源小标签沿用 evidence-row 的 SourceLink。
import { useState } from "react";
import { RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SourceLink } from "@/components/result/evidence-row";
import { startInvestigation } from "@/lib/data";
import { displayClaim } from "@/lib/derive";
import { clean } from "@/lib/scrub";
import { navigate } from "@/lib/route";
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema";

export function InterruptedNotice({ snapshot }: { snapshot: InvestigationSnapshotV1 | null | undefined }) {
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const claim = displayClaim(snapshot?.originalClaim ?? "");
  const sources = (snapshot?.sources ?? []).filter((s) => /^https?:\/\//.test(s.url));

  const retry = () => {
    // 图片要重新贴，只能回首页。
    if (claim.fromImage || !claim.text) return navigate({ view: "home" });
    setStarting(true);
    setError("");
    startInvestigation(claim.text, [])
      .then((run) => navigate({ view: "run", run }))
      .catch((err: unknown) => {
        setStarting(false);
        setError(err instanceof Error ? err.message : "没能重新开始");
      });
  };

  return (
    <div data-gp-interrupted className="flex flex-col gap-4">
      <Alert>
        <TriangleAlertIcon />
        <AlertTitle>这次没有查完，所以没有结论</AlertTitle>
        <AlertDescription>
          <p>可以重新核查一次。{sources.length ? "下面是已经找到的材料，还没有核对完，不能当作判断依据。" : "这次还没有找到材料。"}</p>
          <Button data-gp-retry size="sm" className="mt-2" onClick={retry} disabled={starting}>
            <RotateCcwIcon />
            {starting ? "正在开始" : claim.fromImage ? "回到首页重新提交" : "重新核查"}
          </Button>
          {error ? <p className="mt-2 text-destructive">{error}</p> : null}
        </AlertDescription>
      </Alert>
      {sources.length ? (
        <ul className="flex flex-col gap-2 text-sm">
          {sources.map((source) => (
            <li key={source.id} className="flex flex-wrap items-center gap-2">
              <span>{clean(source.title) || source.url}</span>
              <SourceLink href={source.url} url={source.url} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
