// 结论卡照抄 Mantine UI「StatsRingCard / Card with sections」的卡片分区（https://ui.mantine.dev/category/stats/ ，https://mantine.dev/core/card/），
// 「怎么推出来的」照抄 Alert「Usage」（https://mantine.dev/core/alert/），结论句荧光照抄 Mark（https://mantine.dev/core/mark/），
// 原句照抄 Blockquote（https://mantine.dev/core/blockquote/），每一点照抄 Paper + Badge 的 Mantine UI「ArticleCardFooter」排布。
import { useMemo } from "react";
import { Accordion, Alert, Badge, Blockquote, Box, Card, Divider, Group, List, Mark, Paper, Spoiler, Stack, Text, Title } from "@mantine/core";
import { IconPhoto, IconRoute } from "@tabler/icons-react";
import { FALLBACK_PART_REASON, LABEL_TEXT } from "@shared/domain/labels.ts";
import {
  presentClaim,
  presentConclusion,
  shownClaims,
  domainOf,
} from "@shared/investigation/presentation.ts";
import type { InvestigationClaim, InvestigationEvidenceLink } from "@shared/investigation/schema.ts";
import type { ResultData } from "../lib/data.ts";
import { displayClaimOf } from "../lib/data.ts";
import { claimCitations, derivationSentence, labelColor, splitRationale, type ClaimCitations } from "../lib/derive.ts";
import { plainPart } from "../lib/scrub.ts";
import { CitedText, SourceChips } from "./SourceBits.tsx";
import { EvidenceRow } from "./EvidenceRow.tsx";
import type { ReactNode } from "react";

function decisiveLinks(claim: InvestigationClaim, sourceIds: Set<string>): InvestigationEvidenceLink[] {
  return claim.evidence.filter((link) => (link.role === "support" || link.role === "contradict") && sourceIds.has(link.sourceId));
}

function relatedLinks(claim: InvestigationClaim, sourceIds: Set<string>): InvestigationEvidenceLink[] {
  const decisive = new Set(decisiveLinks(claim, sourceIds).map((l) => l.sourceId));
  const seen = new Set<string>();
  return claim.evidence.filter((link) => {
    if (link.role === "support" || link.role === "contradict") return false;
    if (decisive.has(link.sourceId) || seen.has(link.sourceId) || !sourceIds.has(link.sourceId)) return false;
    seen.add(link.sourceId);
    return true;
  });
}

export function ImageReadingCard({ image }: { image: NonNullable<ResultData["image"]> }) {
  return (
    <Card withBorder radius="md" padding="md">
      <Group gap={6} mb={6}>
        <IconPhoto size={18} color="var(--mantine-color-dimmed)" />
        <Text size="sm" fw={600}>
          从图片里读出的文字
        </Text>
      </Group>
      {image.texts.length ? (
        <Stack gap={4}>
          {image.texts.map((t, i) => (
            <Text key={i} size="sm" ff="monospace" bg="gray.0" px="xs" py={4} style={{ borderRadius: 4, whiteSpace: "pre-wrap" }}>
              {t}
            </Text>
          ))}
        </Stack>
      ) : (
        <Text size="sm" c="dimmed">
          图片里没有读出文字
        </Text>
      )}
      {image.summary ? (
        <Spoiler maxHeight={0} showLabel="画面说明" hideLabel="收起画面说明" mt={6}>
          <Text size="sm" c="dimmed" className="prose">
            {image.summary}
          </Text>
        </Spoiler>
      ) : null}
    </Card>
  );
}

function ClaimArticle({ claim, index, data, citations }: { claim: InvestigationClaim; index: number; data: ResultData; citations: ClaimCitations | null }) {
  const sources = data.snapshot.sources;
  const ids = new Set(sources.map((s) => s.id));
  const p = presentClaim(claim, sources);
  const decisive = decisiveLinks(claim, ids);
  const related = relatedLinks(claim, ids);
  const urlOf = (id: string) => sources.find((s) => s.id === id)?.url ?? "";
  // 改版前的记录没有每点理由：有标签和依据时用共享层的标准说法补一句。
  const reason = p.reason || (p.label && decisive.length ? FALLBACK_PART_REASON[p.label] : "");
  const chips = p.decisive.map((ev) => {
    const url = urlOf(ev.sourceId);
    return { href: ev.href || url, domain: domainOf(url), title: ev.linkText };
  });
  return (
    <Paper component="article" withBorder radius="lg" p={{ base: "md", sm: "lg" }} data-gp-claim-id={claim.id}>
      <Stack gap="sm">
        <Group gap="xs" wrap="nowrap" align="flex-start">
          <Badge
            size="lg"
            radius="sm"
            color={labelColor(p.label)}
            variant="filled"
            data-gp-claim-label={p.label ?? ""}
            style={{ flexShrink: 0 }}
          >
            {p.label ? LABEL_TEXT[p.label] : "未判断"}
          </Badge>
          <Text size="xs" c="dimmed" mt={6} style={{ flexShrink: 0 }}>
            第 {index + 1} 点
          </Text>
        </Group>
        <Title order={4} fw={600} lh={1.5}>
          {plainPart(p.text)}
        </Title>
        {reason ? (
          <Text component="div" className="prose" data-gp-claim-reason>
            <Mark color="yellow.2" px={2}>
              {plainPart(reason)}
            </Mark>
            <SourceChips sources={chips} />
          </Text>
        ) : (
          <Text c="dimmed" size="sm">
            没有找到直接支持或反驳这一点的依据。
          </Text>
        )}
        {citations ? (
          <Box>
            <Text size="xs" c="dimmed" fw={600} mb={2}>
              依据
            </Text>
            <Text size="sm" className="prose" c="dark.6">
              <CitedText text={citations.text} sources={citations.sources} />
            </Text>
          </Box>
        ) : null}
        {p.boundary ? (
          <Text size="sm" c="dimmed" className="prose">
            <Text span fw={600} inherit>
              仍不能推出：
            </Text>
            {plainPart(p.boundary)}
          </Text>
        ) : null}
        {decisive.length ? (
          <Stack gap="xs">
            {p.decisive.map((ev, i) => (
              <EvidenceRow key={`${ev.sourceId}-${ev.role}-${i}`} ev={ev} link={decisive[i]} url={urlOf(ev.sourceId)} />
            ))}
          </Stack>
        ) : null}
        {related.length ? (
          <Accordion variant="contained" radius="md" chevronPosition="right">
            <Accordion.Item value="related">
              <Accordion.Control>
                <Text size="sm" c="dimmed">
                  另有 {related.length} 条相关材料，未用于判断
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="xs">
                  {p.related.map((ev, i) => (
                    <EvidenceRow key={`${ev.sourceId}-r-${i}`} ev={ev} link={related[i]} url={urlOf(ev.sourceId)} />
                  ))}
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function ConclusionCard({ data, citations }: { data: ResultData; citations: { citations: ClaimCitations | null }[] }) {
  const c = presentConclusion(data.snapshot);
  if (!c) return null;
  const derivation = derivationSentence(data.snapshot, data.report, c.label);
  const rationaleRaw = data.snapshot.conclusion?.verdictLead?.trim() ? data.snapshot.conclusion?.rationale?.trim() ?? "" : "";
  const pieces = rationaleRaw ? splitRationale(rationaleRaw, citations) : [];
  const rationale: ReactNode = pieces.map((piece, i) =>
    piece.citations ? (
      <CitedText key={i} text={piece.text} sources={piece.citations.sources} />
    ) : (
      <span key={i}>{plainPart(piece.text.replace(/\[\d+\]/g, ""))}</span>
    ),
  );
  return (
    <Card withBorder radius="lg" padding="lg" shadow="sm" data-gp-direct-answer>
      <Card.Section inheritPadding py="xs" withBorder>
        <Group justify="space-between">
          <Text size="sm" fw={600} c="dimmed">
            整句结论
          </Text>
          {c.checkedDay ? (
            <Text size="xs" c="dimmed">
              核查于 {c.checkedDay}
            </Text>
          ) : null}
        </Group>
      </Card.Section>
      <Stack gap="sm" mt="md">
        <Group>
          <Badge size="xl" radius="sm" color={labelColor(c.label)} variant="filled" data-gp-conclusion-label={c.label}>
            {LABEL_TEXT[c.label]}
          </Badge>
        </Group>
        <Text size="lg" fw={600} className="prose" data-gp-conclusion-reason>
          {plainPart(c.lead)}
        </Text>
        <Alert variant="light" color="gray" radius="md" icon={<IconRoute size={18} />} title="怎么推出来的">
          <Text size="sm" className="prose">
            {derivation}
          </Text>
        </Alert>
        {pieces.length ? (
          <Spoiler maxHeight={54} showLabel="展开说明" hideLabel="收起说明">
            <Text size="sm" className="prose" c="dark.6">
              {rationale}
            </Text>
          </Spoiler>
        ) : null}
        {c.boundaries.length ? (
          <Box>
            <Text size="sm" c="dimmed" fw={600}>
              仍不能推出
            </Text>
            <List size="sm" c="dimmed" spacing={2}>
              {c.boundaries.map((b, i) => (
                <List.Item key={i}>{plainPart(b)}</List.Item>
              ))}
            </List>
          </Box>
        ) : null}
        {c.notCovered ? (
          <Text size="sm" c="dimmed">
            {plainPart(c.notCovered)}
          </Text>
        ) : null}
      </Stack>
    </Card>
  );
}

/** 结果主体：原句 →（图片文字）→ 整句结论 → 各点。结果页、运行页收尾、分享预览共用。 */
export function ResultView({ data, footer }: { data: ResultData; footer?: ReactNode }) {
  const claims = shownClaims(data.snapshot);
  const citations = useMemo(
    () => claims.map((claim) => ({ claim, citations: claimCitations(data.report, claim.text, data.snapshot.sources) })),
    [claims, data.report, data.snapshot.sources],
  );
  return (
    <Stack gap="lg" data-gp-result>
      <Blockquote color="gray" radius="md" p="md" iconSize={0} styles={{ root: { background: "var(--mantine-color-white)" } }}>
        <Text size="xs" c="dimmed" fw={600} mb={4}>
          原句
        </Text>
        <Text size="md" className="prose" style={{ whiteSpace: "pre-wrap" }}>
          {displayClaimOf(data.snapshot)}
        </Text>
      </Blockquote>
      {data.image ? <ImageReadingCard image={data.image} /> : null}
      <ConclusionCard data={data} citations={citations} />
      {footer}
      {claims.length ? (
        <>
          <Divider label={`拆成 ${claims.length} 点逐一核对`} labelPosition="left" />
          <Stack gap="md">
            {citations.map(({ claim, citations: c }, i) => (
              <ClaimArticle key={claim.id} claim={claim} index={i} data={data} citations={c} />
            ))}
          </Stack>
        </>
      ) : null}
    </Stack>
  );
}
