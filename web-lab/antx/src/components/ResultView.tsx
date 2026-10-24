// 整句结论照抄自 antd Card 基础示例 https://ant.design/components/card-cn#card-demo-basic 与 Typography 示例 https://ant.design/components/typography-cn#typography-demo-text
// 「怎么推出来的」照抄自 antd Alert「含有辅助性文字介绍」示例 https://ant.design/components/alert-cn#alert-demo-description
// 图片里读出的文字照抄自 Ant Design X FileCard / antd Card 内嵌示例 https://ant.design/components/card-cn#card-demo-inner
import { Alert, Card, Flex, Typography } from "antd";
import { presentConclusion, shownClaims } from "@shared/investigation/presentation.ts";
import { explainVerdict, partsByClaim } from "../lib/explain.ts";
import { cleanCitedText, cleanText } from "../lib/scrub.ts";
import type { InvestigationSnapshotV1 } from "../lib/types.ts";
import { CitedText, SourceChips, citeSourcesOf } from "./Cite.tsx";
import LabelTag from "./LabelTag.tsx";
import PointCard from "./PointCard.tsx";

export function ConclusionCard({ snapshot, report, extra }: { snapshot: InvestigationSnapshotV1; report: Record<string, unknown> | null; extra?: React.ReactNode }) {
  const c = presentConclusion(snapshot);
  if (!c) return null;
  const claims = shownClaims(snapshot);
  const explain = explainVerdict(report, claims, c.label);
  const cites = citeSourcesOf(snapshot, report);
  const rawRationale = snapshot.conclusion?.verdictLead?.trim() ? cleanCitedText(snapshot.conclusion?.rationale ?? "") : "";
  return (
    <Card actions={extra ? [extra] : undefined} title={<Typography.Text type="secondary" style={{ fontWeight: 400 }}>整句结论</Typography.Text>}>
      <Typography.Paragraph style={{ fontSize: 18, marginBottom: 16 }}>
        <Typography.Text type="secondary">“</Typography.Text>
        {snapshot.originalClaim}
        <Typography.Text type="secondary">”</Typography.Text>
      </Typography.Paragraph>
      <Flex data-gp-direct-answer="" gap={12} align="baseline" wrap>
        <span data-gp-conclusion-label="" style={{ display: "contents" }}>
          <LabelTag label={c.label} big />
        </span>
        <Typography.Text data-gp-conclusion-reason="" style={{ fontSize: 18, fontWeight: 500, flex: "1 1 280px" }}>
          {cleanText(c.lead)}
        </Typography.Text>
      </Flex>
      {explain ? <Alert style={{ marginTop: 16 }} type="info" showIcon title="这个结论是怎么推出来的" description={explain} /> : null}
      {rawRationale ? (
        <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>
          <CitedText text={rawRationale} sources={cites} /> <SourceChips sources={cites} />
        </Typography.Paragraph>
      ) : null}
      {c.boundaries.length ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          必要边界：{c.boundaries.map(cleanText).join("；")}
        </Typography.Paragraph>
      ) : null}
      {c.notCovered ? <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>{cleanText(c.notCovered)}</Typography.Paragraph> : null}
      {c.checkedDay ? <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0, fontSize: 12 }}>核查于 {c.checkedDay}</Typography.Paragraph> : null}
    </Card>
  );
}

export function OcrCard({ lines }: { lines: string[] }) {
  if (!lines.length) return null;
  return (
    <Card size="small" type="inner" title="从图片里读出的文字">
      <Typography.Paragraph style={{ whiteSpace: "pre-wrap", margin: 0 }}>{lines.map(cleanText).join("\n")}</Typography.Paragraph>
    </Card>
  );
}

export default function ResultView({
  snapshot, report, ocr = [], shareSlot,
}: { snapshot: InvestigationSnapshotV1; report: Record<string, unknown> | null; ocr?: string[]; shareSlot?: React.ReactNode }) {
  const claims = shownClaims(snapshot);
  const parts = partsByClaim(report, claims);
  return (
    <Flex vertical gap={16} data-gp-result="" style={{ maxWidth: 880, margin: "0 auto", width: "100%" }}>
      <OcrCard lines={ocr} />
      <ConclusionCard snapshot={snapshot} report={report} extra={shareSlot} />
      {claims.map((claim, i) => (
        <PointCard key={claim.id} claim={claim} sources={snapshot.sources} index={i} part={parts.get(claim.id)} />
      ))}
    </Flex>
  );
}
