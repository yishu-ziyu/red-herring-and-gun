// 照抄自 antd Tag「预设状态的标签」示例 https://ant.design/components/tag-cn#tag-demo-status
import { Tag } from "antd";
import { LABEL_TEXT, LABEL_TONE, type LabelKey } from "@shared/domain/labels.ts";

const TONE_COLOR = { positive: "success", mixed: "warning", negative: "error", muted: "default" } as const;
export const LABEL_COLOR = Object.fromEntries(
  (Object.keys(LABEL_TONE) as LabelKey[]).map((k) => [k, TONE_COLOR[LABEL_TONE[k]]]),
) as Record<LabelKey, string>;

export default function LabelTag({ label, big, ...rest }: { label: LabelKey; big?: boolean } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <Tag
      color={LABEL_COLOR[label]}
      style={big ? { fontSize: 20, lineHeight: "34px", padding: "0 12px", fontWeight: 600, marginInlineEnd: 0 } : { marginInlineEnd: 0 }}
      {...rest}
    >
      {LABEL_TEXT[label]}
    </Tag>
  );
}
