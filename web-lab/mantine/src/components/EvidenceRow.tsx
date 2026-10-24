// 依据行照抄 Mantine UI「CommentSimple」的头像 + 正文排布（https://ui.mantine.dev/category/comments/），
// 「为什么算支持 / 反驳」照抄 Collapse「Usage」（https://mantine.dev/core/collapse/），上下文照抄 Spoiler（https://mantine.dev/core/spoiler/）。
import { useState } from "react";
import { Anchor, Badge, Box, Button, Collapse, Group, Paper, Spoiler, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import type { PresentedEvidence } from "@shared/investigation/presentation.ts";
import { domainOf } from "@shared/investigation/presentation.ts";
import type { InvestigationEvidenceLink } from "@shared/investigation/schema.ts";
import { SourceChip } from "./SourceBits.tsx";
import { cleanText, plainPart } from "../lib/scrub.ts";

const READ_COLOR = { read: "teal", partial: "yellow", none: "gray" } as const;
const ROLE_COLOR: Record<string, string> = { support: "teal", contradict: "red", "context-only": "gray", unassessed: "gray" };

export function EvidenceRow({ ev, link, url }: { ev: PresentedEvidence; link: InvestigationEvidenceLink | undefined; url: string }) {
  const [opened, { toggle }] = useDisclosure(false);
  const [contextOpen, setContextOpen] = useState(false);
  const decisive = ev.role === "support" || ev.role === "contradict";
  const why = plainPart(cleanText(link?.relationReason || link?.finding || ev.finding || ""));
  const domain = domainOf(url);
  return (
    <Paper withBorder radius="md" p="sm" data-gp-evidence-row data-gp-role={ev.role} bg={decisive ? "white" : "gray.0"}>
      <Stack gap={8}>
        <Group gap={6} wrap="wrap">
          <Badge color={ROLE_COLOR[ev.role]} variant={decisive ? "filled" : "light"} radius="sm">
            {ev.roleText}
          </Badge>
          <SourceChip source={{ href: ev.href || url, domain, title: ev.linkText }} />
          <Text size="xs" c="dimmed">
            {ev.published ?? "发布日期不详"}
          </Text>
        </Group>

        {ev.quote ? (
          ev.quote.kind === "page" ? (
            <Box pl="sm" style={{ borderLeft: `3px solid var(--mantine-color-${ROLE_COLOR[ev.role]}-4)` }}>
              <Text size="sm" className="prose">
                “{ev.quote.text}”
              </Text>
            </Box>
          ) : (
            <Text component="div" size="sm" className="prose" c="dark.5">
              <Badge component="span" size="xs" variant="outline" color="gray" mr={6} radius="sm">
                {ev.quote.kind === "snippet" ? "搜索摘要" : "概括"}
              </Badge>
              {plainPart(ev.quote.text)}
            </Text>
          )
        ) : null}

        {ev.href ? (
          <Anchor href={ev.href} target="_blank" rel="noopener noreferrer" size="sm" lineClamp={1}>
            {ev.linkText} ↗
          </Anchor>
        ) : (
          <Text size="sm">{ev.linkText}</Text>
        )}

        <Group gap={6}>
          <Badge size="sm" variant="dot" color={READ_COLOR[ev.read.level]} tt="none" fw={500}>
            {ev.read.text}
          </Badge>
          {ev.dead ? (
            <Badge size="sm" variant="light" color="gray" tt="none">
              链接已失效
            </Badge>
          ) : null}
          {ev.provenance ? (
            <Badge size="sm" variant="light" color="gray" tt="none">
              {ev.provenance.text}
              {ev.provenance.originDate ? ` · ${ev.provenance.originDate}` : ""}
            </Badge>
          ) : null}
        </Group>

        {decisive ? (
          <Box>
            <Button
              variant="subtle"
              color="gray"
              size="compact-sm"
              px={4}
              onClick={toggle}
              rightSection={opened ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />}
            >
              {ev.role === "support" ? "为什么算支持" : "为什么算反驳"}
            </Button>
            <Collapse in={opened}>
              <Stack gap={8} pt={6}>
                <Text size="sm" className="prose">
                  {why || "这条来源没有留下判定理由。"}
                </Text>
                {ev.passage ? (
                  <Paper bg="gray.0" p="xs" radius="sm">
                    <Text size="xs" c="dimmed" mb={4}>
                      {ev.passageNote}
                    </Text>
                    <Spoiler maxHeight={72} showLabel="查看上下文" hideLabel="收起" expanded={contextOpen} onExpandedChange={setContextOpen}>
                      <Text size="xs" className="prose" c="dark.5">
                        {ev.passage.replace(/&emsp;/g, " ")}
                      </Text>
                    </Spoiler>
                  </Paper>
                ) : null}
              </Stack>
            </Collapse>
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}
