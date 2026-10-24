// 句内 [n] 角标照抄自 Ant Design X Sources「行内模式」示例 https://x.ant.design/components/sources-cn#sources-demo-inline
// 角标悬停卡片照抄自 antd Popover 基础示例 https://ant.design/components/popover-cn#popover-demo-basic
// 来源小标签（favicon + 域名，多源 +N）同样用 Sources 行内模式，图标照 Sources「自定义图标」示例 https://x.ant.design/components/sources-cn#sources-demo-icon
import { ExportOutlined, GlobalOutlined } from "@ant-design/icons";
import { Sources } from "@ant-design/x";
import { Flex, Popover, Typography } from "antd";
import { useState } from "react";
import { publishedDay } from "@shared/investigation/presentation.ts";
import { cleanText, domainOf } from "../lib/scrub.ts";
import type { InvestigationSnapshotV1 } from "../lib/types.ts";

export type CiteSource = { url: string; title: string; excerpt?: string; published?: string | null };

export function Favicon({ url, size = 14 }: { url: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    /* 非法 URL 用默认图标 */
  }
  if (!origin || failed) return <GlobalOutlined style={{ fontSize: size, color: "rgba(0,0,0,0.45)" }} />;
  return <img src={`${origin}/favicon.ico`} alt="" width={size} height={size} style={{ borderRadius: 3, verticalAlign: "-2px" }} onError={() => setFailed(true)} referrerPolicy="no-referrer" />;
}

/** 来源目录 → 角标用的卡片资料。 */
export function citeSourcesOf(snapshot: InvestigationSnapshotV1, report: Record<string, unknown> | null): CiteSource[] {
  const byUrl = new Map(snapshot.sources.map((s) => [s.url, s]));
  const cited = Array.isArray(report?.citationSources) ? (report!.citationSources as Record<string, unknown>[]) : null;
  if (cited) {
    return cited.map((c) => {
      const url = String(c.url ?? "");
      const known = byUrl.get(url);
      return { url, title: cleanText(known?.title || String(c.title ?? "")), excerpt: cleanText(known?.excerpt || String(c.snippet ?? "")), published: publishedDay(known) };
    });
  }
  return (snapshot.conclusion?.sourceIds ?? [])
    .map((id) => snapshot.sources.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))
    .map((s) => ({ url: s.url, title: cleanText(s.title), excerpt: cleanText(s.excerpt), published: publishedDay(s) }));
}

function SourceCard({ source }: { source: CiteSource }) {
  return (
    <Flex vertical gap={6} style={{ maxWidth: 320 }}>
      <Flex gap={6} align="center">
        <Favicon url={source.url} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {domainOf(source.url)}
          {source.published ? ` · ${source.published}` : ""}
        </Typography.Text>
      </Flex>
      <Typography.Link href={source.url} target="_blank" rel="noopener noreferrer nofollow" strong>
        {source.title || domainOf(source.url)} <ExportOutlined style={{ fontSize: 11 }} />
      </Typography.Link>
      {source.excerpt ? (
        <Typography.Paragraph type="secondary" ellipsis={{ rows: 4 }} style={{ margin: 0, fontSize: 13 }}>
          {source.excerpt}
        </Typography.Paragraph>
      ) : null}
    </Flex>
  );
}

/** 正文里的 [n]：变成角标，悬停出来源卡片；找不到对应来源的编号直接去掉。 */
export function CitedText({ text, sources }: { text: string; sources: CiteSource[] }) {
  const pieces = text.split(/(\[\d+\])/);
  return (
    <>
      {pieces.map((piece, i) => {
        const m = /^\[(\d+)\]$/.exec(piece);
        if (!m) return <span key={i}>{piece}</span>;
        const source = sources[Number(m[1]) - 1];
        if (!source) return null;
        return (
          <Popover key={i} content={<SourceCard source={source} />} trigger={["hover", "click"]}>
            <sup className="cite-sup" data-cite={m[1]} tabIndex={0}>[{m[1]}]</sup>
          </Popover>
        );
      })}
    </>
  );
}

/** 正文来源小标签：第一个来源的 favicon + 域名，多源显示 +N，点开列出全部。 */
export function SourceChips({ sources }: { sources: CiteSource[] }) {
  const unique = sources.filter((s, i) => sources.findIndex((o) => o.url === s.url) === i);
  if (unique.length === 0) return null;
  const first = unique[0]!;
  return (
    <Sources
      inline
      popoverOverlayWidth={320}
      title={
        <Flex gap={4} align="center" component="span">
          <Favicon url={first.url} size={12} />
          <span>{domainOf(first.url)}</span>
          {unique.length > 1 ? <span>+{unique.length - 1}</span> : null}
        </Flex>
      }
      items={unique.map((s, i) => ({
        key: s.url,
        title: `${i + 1}. ${s.title || domainOf(s.url)}`,
        url: s.url,
        icon: <Favicon url={s.url} />,
        description: s.excerpt,
      }))}
      onClick={(item) => item.url && window.open(item.url, "_blank", "noopener")}
    />
  );
}
