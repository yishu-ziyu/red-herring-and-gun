// 来源小标签照抄 Mantine Badge「Sections」（https://mantine.dev/core/badge/）+ Avatar「Image fallback」（https://mantine.dev/core/avatar/）；
// [n] 悬停卡照抄 HoverCard「Usage」与 Mantine UI「UserInfoAction / HoverCard profile」（https://mantine.dev/core/hover-card/）。
import { Fragment, type ReactNode } from "react";
import { Anchor, Avatar, Badge, Group, HoverCard, Stack, Text } from "@mantine/core";
import { IconArrowUpRight } from "@tabler/icons-react";
import { faviconUrl, type CiteSource } from "../lib/derive.ts";

export type ChipSource = { href: string; domain: string; title: string };

export function Favicon({ domain, size = 16 }: { domain: string; size?: number }) {
  return (
    <Avatar src={faviconUrl(domain)} alt="" size={size} radius="xs" color="gray" variant="light">
      <Text span fz={size * 0.6} fw={700}>
        {domain.slice(0, 1).toUpperCase()}
      </Text>
    </Avatar>
  );
}

/** 一个来源：favicon + 域名 + ↗，点开原文。 */
export function SourceChip({ source }: { source: ChipSource }) {
  return (
    <Badge
      component="a"
      href={source.href}
      target="_blank"
      rel="noopener noreferrer"
      title={source.title}
      variant="default"
      radius="sm"
      size="md"
      tt="none"
      fw={500}
      leftSection={<Favicon domain={source.domain} size={14} />}
      rightSection={<IconArrowUpRight size={12} />}
      style={{ cursor: "pointer", verticalAlign: "middle", maxWidth: 220 }}
    >
      {source.domain}
    </Badge>
  );
}

/** 多源时只露第一个，其余收进 +N。 */
export function SourceChips({ sources }: { sources: ChipSource[] }) {
  const unique = sources.filter((s, i) => sources.findIndex((o) => o.href === s.href) === i);
  if (!unique.length) return null;
  const [first, ...rest] = unique;
  return (
    <Group gap={4} display="inline-flex" wrap="nowrap" style={{ verticalAlign: "middle" }} ml={4}>
      <SourceChip source={first} />
      {rest.length ? (
        <HoverCard width={280} shadow="md" openDelay={80} closeDelay={150} withinPortal>
          <HoverCard.Target>
            <Badge variant="light" color="gray" radius="sm" size="md" style={{ cursor: "default" }} tabIndex={0}>
              +{rest.length}
            </Badge>
          </HoverCard.Target>
          <HoverCard.Dropdown>
            <Stack gap={6}>
              {rest.map((s) => (
                <SourceChip key={s.href} source={s} />
              ))}
            </Stack>
          </HoverCard.Dropdown>
        </HoverCard>
      ) : null}
    </Group>
  );
}

function SourceCard({ cite }: { cite: CiteSource }) {
  return (
    <Stack gap={6}>
      <Group gap={6} wrap="nowrap">
        <Favicon domain={cite.domain} />
        <Text size="xs" c="dimmed" truncate>
          {cite.domain} · {cite.published ?? "发布日期不详"}
        </Text>
        <Badge size="xs" variant="light" color={cite.role === "support" ? "teal" : "red"} ml="auto">
          {cite.role === "support" ? "支持" : "反驳"}
        </Badge>
      </Group>
      <Anchor href={cite.url} target="_blank" rel="noopener noreferrer" size="sm" fw={600} lineClamp={2}>
        {cite.title}
      </Anchor>
      {cite.quote ? (
        <Text size="sm" c="dark.6" className="prose">
          “{cite.quote}”
        </Text>
      ) : null}
    </Stack>
  );
}

/** 正文里的 [n] 换成上标角标，悬停出来源卡片。对不上来源的编号直接去掉。 */
export function CitedText({ text, sources }: { text: string; sources: CiteSource[] }): ReactNode {
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part);
    if (!m) return <Fragment key={i}>{part}</Fragment>;
    const cite = sources.find((s) => s.n === Number(m[1]));
    if (!cite) return null;
    return (
      <HoverCard key={i} width={320} shadow="md" openDelay={60} closeDelay={180} position="top" withinPortal>
        <HoverCard.Target>
          <Anchor component="sup" className="cite-sup" c={cite.role === "support" ? "teal.8" : "red.8"} tabIndex={0} aria-label={`来源 ${cite.n}：${cite.title}`}>
            [{cite.n}]
          </Anchor>
        </HoverCard.Target>
        <HoverCard.Dropdown>
          <SourceCard cite={cite} />
        </HoverCard.Dropdown>
      </HoverCard>
    );
  });
}
