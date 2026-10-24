// 每一点照抄自 antd Card「带标题与额外操作」示例 https://ant.design/components/card-cn#card-demo-basic
// 依据的「为什么算支持 / 反驳」与上下文照抄自 antd Collapse「幽灵折叠面板」示例 https://ant.design/components/collapse-cn#collapse-demo-ghost
// 支持 / 反驳标签照抄自 antd Tag 预设状态示例 https://ant.design/components/tag-cn#tag-demo-status
import { ExportOutlined } from "@ant-design/icons";
import { Card, Collapse, Flex, Tag, Typography } from "antd";
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSource } from "@shared/investigation/schema.ts";
import { presentClaim, presentEvidence } from "@shared/investigation/presentation.ts";
import { withoutReadStatus } from "@shared/investigation/material.ts";
import { ROLE_TEXT, type PartInfo } from "../lib/explain.ts";
import { cleanCitedText, cleanText, domainOf } from "../lib/scrub.ts";
import { Favicon, SourceChips, type CiteSource } from "./Cite.tsx";
import LabelTag from "./LabelTag.tsx";

const ROLE_COLOR: Record<string, string> = { support: "success", contradict: "error", "context-only": "default", unassessed: "default" };
const WHY: Record<string, string> = { support: "为什么算支持", contradict: "为什么算反驳", "context-only": "为什么只算相关材料", unassessed: "为什么还没算" };

function EvidenceRow({ link, source }: { link: InvestigationEvidenceLink; source: InvestigationSource }) {
  const ev = presentEvidence(link, source);
  const why = cleanText(withoutReadStatus(link.relationReason?.trim() ?? ""));
  const limitation = cleanText(link.limitation ?? "");
  const quote = ev.quote ? cleanText(ev.quote.text) : "";
  const panels = [
    {
      key: "why",
      label: WHY[ev.role],
      children: (
        <Flex vertical gap={6}>
          {why ? <Typography.Text>{why}</Typography.Text> : null}
          {limitation ? <Typography.Text type="secondary">局限：{limitation}</Typography.Text> : null}
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>上下文</Typography.Text>
          <Typography.Paragraph type="secondary" style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 13 }}>{ev.passage ? cleanText(ev.passage) : "这条依据没有保存可检查的上下文。"}</Typography.Paragraph>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{cleanText(ev.passageNote)}</Typography.Text>
        </Flex>
      ),
    },
  ];
  return (
    <div data-gp-evidence-row="" data-gp-role={ev.role} style={{ padding: "12px 0", borderTop: "1px solid rgba(5,5,5,0.06)" }}>
      <Flex gap={8} align="baseline" wrap>
        <Tag color={ROLE_COLOR[ev.role]} variant="filled" style={{ marginInlineEnd: 0 }}>{ev.roleText}</Tag>
        <Typography.Text style={{ flex: "1 1 240px", minWidth: 0 }}>
          {quote ? (
            ev.quote!.kind === "page" ? <mark className="hl">「{quote}」</mark> : (
              <>
                <Typography.Text type="secondary" style={{ fontSize: 12, marginInlineEnd: 6 }}>{ev.quote!.kind === "snippet" ? "搜索摘要" : "概括"}</Typography.Text>
                <mark className="hl">{quote}</mark>
              </>
            )
          ) : (
            <Typography.Text type="secondary">{ev.linkText}</Typography.Text>
          )}
          {ev.href ? (
            <a href={ev.href} target="_blank" rel="noopener noreferrer nofollow" style={{ marginInlineStart: 6, whiteSpace: "nowrap" }}>
              <Tag style={{ marginInlineEnd: 0, cursor: "pointer" }} icon={<Favicon url={source.url} size={12} />}>
                {" "}{domainOf(source.url)} <ExportOutlined style={{ fontSize: 10 }} />
              </Tag>
            </a>
          ) : null}
        </Typography.Text>
      </Flex>
      <Flex gap={8} wrap style={{ marginTop: 4, fontSize: 12 }}>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{cleanText(ev.linkText)}</Typography.Text>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ev.published ?? "发布日期不详"}</Typography.Text>
        <Typography.Text type={ev.read.level === "read" ? "success" : "secondary"} style={{ fontSize: 12 }}>{ev.read.text}</Typography.Text>
        {ev.dead ? <Typography.Text type="danger" style={{ fontSize: 12 }}>链接已失效</Typography.Text> : null}
        {ev.provenance ? <Typography.Text type="secondary" style={{ fontSize: 12 }}>{ev.provenance.text}</Typography.Text> : null}
      </Flex>
      <Collapse ghost size="small" items={panels} style={{ marginTop: 4, marginInline: -16 }} />
    </div>
  );
}

export default function PointCard({ claim, sources, index, part }: { claim: InvestigationClaim; sources: InvestigationSource[]; index: number; part?: PartInfo }) {
  const p = presentClaim(claim, sources);
  const byId = new Map(sources.map((s) => [s.id, s]));
  const decisive = claim.evidence.filter((l) => (l.role === "support" || l.role === "contradict") && byId.has(l.sourceId));
  const decisiveIds = new Set(decisive.map((l) => l.sourceId));
  const seen = new Set<string>();
  const related = claim.evidence.filter((l) => {
    if (l.role === "support" || l.role === "contradict" || decisiveIds.has(l.sourceId) || seen.has(l.sourceId) || !byId.has(l.sourceId)) return false;
    seen.add(l.sourceId);
    return true;
  });
  const chips: CiteSource[] = decisive.map((l) => byId.get(l.sourceId)!).map((s) => ({ url: s.url, title: cleanText(s.title), excerpt: cleanText(s.excerpt) }));
  const reason = cleanCitedText(p.reason).replace(/\[\d+\]/g, "");

  return (
    <article data-gp-claim-id={claim.id}>
      <Card
        size="small"
        title={
          <Flex gap={8} align="center">
            <span>第 {index + 1} 点</span>
            {part ? <Tag variant="filled" style={{ marginInlineEnd: 0 }}>{ROLE_TEXT[part.role]}</Tag> : null}
          </Flex>
        }
        extra={p.label ? <LabelTag label={p.label} data-gp-claim-label="" /> : <Tag>还在查</Tag>}
      >
        <Typography.Title level={5} style={{ marginTop: 0 }}>{cleanText(p.text)}</Typography.Title>
        {reason ? (
          <Typography.Paragraph style={{ marginBottom: 8 }}>
            <span data-gp-claim-reason="">{reason}</span>{" "}
            <SourceChips sources={chips} />
          </Typography.Paragraph>
        ) : null}
        {p.boundary ? (
          <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
            仍不能推出：{cleanText(p.boundary)}
          </Typography.Paragraph>
        ) : null}
        {decisive.length ? (
          decisive.map((link, i) => <EvidenceRow key={`${link.sourceId}:${i}`} link={link} source={byId.get(link.sourceId)!} />)
        ) : (
          <Typography.Text type="secondary">没有找到直接支持或反驳这一点的依据。</Typography.Text>
        )}
        {related.length ? (
          <Collapse
            ghost
            size="small"
            style={{ marginInline: -16 }}
            items={[{
              key: "related",
              label: <Typography.Text type="secondary">另有 {related.length} 条相关材料，未用于判断</Typography.Text>,
              children: related.map((link, i) => <EvidenceRow key={`r:${link.sourceId}:${i}`} link={link} source={byId.get(link.sourceId)!} />),
            }]}
          />
        ) : null}
      </Card>
    </article>
  );
}
