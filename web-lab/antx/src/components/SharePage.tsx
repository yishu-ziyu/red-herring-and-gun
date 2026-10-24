// 分享页（陌生人看到的样子）：和服务端 /s/:id 同一份内容——原句、标签、结论第一句、各点与依据（apps/server/src/lib/shareHandlers.ts）。
// 外框照抄自 antd Result「成功」示例的信息层级 https://ant.design/components/result-cn 与 Card 基础示例 https://ant.design/components/card-cn
import { Alert, Button, Card, Flex, Result, Skeleton, Typography } from "antd";
import { useEffect, useState } from "react";
import { presentConclusion, shownClaims } from "@shared/investigation/presentation.ts";
import { loadFixture } from "../lib/api.ts";
import { partsByClaim } from "../lib/explain.ts";
import { navigate } from "../lib/nav.ts";
import { cleanText } from "../lib/scrub.ts";
import type { Fixture } from "../lib/types.ts";
import LabelTag from "./LabelTag.tsx";
import PointCard from "./PointCard.tsx";

export default function SharePage({ fixture }: { fixture: string }) {
  const [fx, setFx] = useState<Fixture | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    loadFixture(fixture).then(setFx).catch((e: Error) => setError(e.message));
  }, [fixture]);
  if (error) return <Result status="404" title="分享链接不可用" subTitle="链接不存在或已过期。" />;
  if (!fx) return <Skeleton active paragraph={{ rows: 6 }} style={{ maxWidth: 720, margin: "24px auto" }} />;
  const snapshot = fx.result.snapshot;
  const c = presentConclusion(snapshot);
  const claims = shownClaims(snapshot);
  const parts = partsByClaim(fx.result.report, claims);
  return (
    <Flex vertical gap={16} style={{ maxWidth: 720, margin: "0 auto" }}>
      <Alert type="info" showIcon title="分享的调查" />
      <Card>
        <Typography.Paragraph style={{ fontSize: 18 }}>“{snapshot.originalClaim}”</Typography.Paragraph>
        {c ? (
          <Flex data-share-conclusion="" vertical gap={8}>
            <span data-share-label={c.label}><LabelTag label={c.label} big /></span>
            <Typography.Text style={{ fontSize: 18, fontWeight: 500 }}>{cleanText(c.lead)}</Typography.Text>
          </Flex>
        ) : null}
        {c?.boundaries.length ? <Typography.Paragraph type="secondary" style={{ marginTop: 12 }}>必要边界：{c.boundaries.join("；")}</Typography.Paragraph> : null}
        {c?.notCovered ? <Typography.Paragraph type="secondary">{c.notCovered}</Typography.Paragraph> : null}
        {c?.checkedDay ? <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 0, marginTop: 8 }}>核查于 {c.checkedDay}</Typography.Paragraph> : null}
      </Card>
      {claims.map((claim, i) => (
        <PointCard key={claim.id} claim={claim} sources={snapshot.sources} index={i} part={parts.get(claim.id)} />
      ))}
      <Button type="primary" size="large" block onClick={() => navigate({ part: "home" })}>开始核查</Button>
    </Flex>
  );
}
