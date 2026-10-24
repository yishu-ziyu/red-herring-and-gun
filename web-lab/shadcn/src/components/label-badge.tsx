// 照抄 shadcn/ui Badge（https://ui.shadcn.com/docs/components/badge），只按 9 标签的色调换背景色。
import type { ComponentProps } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { LABEL_TONE, labelText, type LabelKey } from "@shared/domain/labels";

const TONE_CLASS = {
  positive: "bg-emerald-50 text-emerald-700 border-emerald-200",
  mixed: "bg-amber-50 text-amber-700 border-amber-200",
  negative: "bg-red-50 text-red-700 border-red-200",
  muted: "bg-secondary text-secondary-foreground border-border",
} as const;

export const TONE_TEXT = {
  positive: "text-emerald-700",
  mixed: "text-amber-700",
  negative: "text-red-700",
  muted: "text-foreground",
} as const;

export function LabelBadge({ label, className, ...props }: { label: LabelKey } & ComponentProps<typeof Badge>) {
  return (
    <Badge variant="outline" className={cn(TONE_CLASS[LABEL_TONE[label]], className)} {...props}>
      {labelText(label)}
    </Badge>
  );
}
