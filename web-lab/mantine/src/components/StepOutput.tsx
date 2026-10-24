// 当前 agent 的产出卡照抄 Mantine Card「Card.Section」（https://mantine.dev/core/card/）+ Mantine UI「UserInfoIcons」头像排布；
// 思考折叠照抄 Collapse「Usage」（https://mantine.dev/core/collapse/）；列表照抄 List / Table（https://mantine.dev/core/list/ ，https://mantine.dev/core/table/）。
import { useState } from "react";
import { Accordion, Anchor, Avatar, Badge, Box, Card, Collapse, Group, List, Loader, Paper, ScrollArea, Spoiler, Stack, Text, ThemeIcon, UnstyledButton } from "@mantine/core";
import { IconBulb, IconChevronDown, IconChevronUp } from "@tabler/icons-react";
import { LABEL_TEXT, isLabelKey, judgmentToLabel } from "@shared/domain/labels.ts";
import { domainOf } from "@shared/investigation/presentation.ts";
import { materialReadTag } from "@shared/investigation/material.ts";
import { STEP_META, readableOutput, seconds, type RunView, type StepKey } from "../lib/runState.ts";
import { labelColor } from "../lib/derive.ts";
import { plainPart } from "../lib/scrub.ts";
import { stepDuration } from "./StepTimeline.tsx";
import { Favicon } from "./SourceBits.tsx";

const ROLE_TEXT: Record<string, string> = { main: "主要说法", premise: "前提", background: "背景" };

function ThinkingFold({ view, stepKey }: { view: RunView; stepKey: StepKey }) {
  const step = view.steps[stepKey];
  const [open, setOpen] = useState(false);
  if (!step.thoughts.length && step.status !== "running") return null;
  const thinking = step.status === "running" && !step.thoughtsDone;
  const took = step.thoughtsEndAt && step.startedAt ? seconds(step.thoughtsEndAt - step.startedAt) : null;
  return (
    <Paper withBorder radius="md" bg="gray.0" p={0}>
      <UnstyledButton onClick={() => setOpen((o) => !o)} w="100%" px="sm" py={8} disabled={!step.thoughts.length}>
        <Group gap={8} wrap="nowrap">
          {thinking ? <Loader size={14} type="oval" color="gray" /> : <IconBulb size={16} color="var(--mantine-color-dimmed)" />}
          <Text size="sm" c="dimmed" fw={500} style={{ flex: 1 }}>
            {thinking ? "思考中" : `思考已完成${took ? ` · ${took}` : ""}`}
          </Text>
          {step.thoughts.length ? open ? <IconChevronUp size={14} /> : <IconChevronDown size={14} /> : null}
        </Group>
      </UnstyledButton>
      <Collapse in={open}>
        <ScrollArea.Autosize mah={260} px="sm" pb="sm" type="auto">
          <Stack gap={4}>
            {step.thoughts.map((t, i) => (
              <Text key={i} size="xs" c="dimmed" className="thought-line">
                {t.text}
              </Text>
            ))}
          </Stack>
        </ScrollArea.Autosize>
      </Collapse>
    </Paper>
  );
}

function Waiting({ text }: { text: string }) {
  return (
    <Group gap={8} py="sm">
      <Loader size={16} type="dots" color="red" />
      <Text size="sm" c="dimmed">
        {text}
      </Text>
    </Group>
  );
}

/** 一步还在跑、产出没回来时：列出各点眼下手里有多少材料、有没有判断（都来自最新快照）。 */
function ClaimProgress({ view }: { view: RunView }) {
  const claims = view.snapshot?.claims ?? [];
  if (!claims.length) return null;
  return (
    <Stack gap={6}>
      <Text size="xs" c="dimmed" fw={600}>
        各点进度
      </Text>
      {claims.map((c) => {
        const support = c.evidence.filter((e) => e.role === "support").length;
        const contradict = c.evidence.filter((e) => e.role === "contradict").length;
        const label = c.label ?? (c.judgment ? judgmentToLabel(c.judgment) : null);
        return (
          <Paper key={c.id} withBorder radius="md" px="sm" py={8}>
            <Group gap={8} wrap="wrap" justify="space-between">
              <Text size="sm" className="prose" style={{ minWidth: 0 }}>
                {plainPart(c.text)}
              </Text>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Badge size="sm" variant="light" color="gray" radius="sm" tt="none">
                  材料 {c.evidence.length}
                </Badge>
                {support ? <Badge size="sm" variant="light" color="teal" radius="sm" tt="none">支持 {support}</Badge> : null}
                {contradict ? <Badge size="sm" variant="light" color="red" radius="sm" tt="none">反驳 {contradict}</Badge> : null}
                {label ? <Badge size="sm" color={labelColor(label)} radius="sm">{LABEL_TEXT[label]}</Badge> : null}
              </Group>
            </Group>
          </Paper>
        );
      })}
    </Stack>
  );
}

function DecomposeOutput({ view }: { view: RunView }) {
  const out = view.steps.decompose.outputs.at(-1);
  const read = out ? (readableOutput("decompose", out) as ReturnType<typeof readableOutput> & { points: { text: string; role: string; checkable: boolean }[]; analysis: string }) : null;
  const points = read?.points.length
    ? read.points
    : (view.snapshot?.claims ?? []).map((c) => ({ text: plainPart(c.text), role: "", checkable: c.checkability === "checkable" }));
  if (!points.length) return <Waiting text="正在把这句话拆成几点" />;
  return (
    <Stack gap="sm">
      <Text size="sm" fw={600}>
        拆成 {points.length} 点
      </Text>
      <Stack gap={6}>
        {points.map((p, i) => (
          <Paper key={i} withBorder radius="md" px="sm" py={8}>
            <Group gap={8} wrap="nowrap" align="flex-start">
              <ThemeIcon size={22} radius="xl" variant="light" color="red" style={{ flexShrink: 0 }}>
                <Text size="xs" fw={700}>
                  {i + 1}
                </Text>
              </ThemeIcon>
              <Text size="sm" style={{ flex: 1 }} className="prose">
                {p.text}
              </Text>
              <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                {p.role && ROLE_TEXT[p.role] ? (
                  <Badge size="sm" variant="light" color={p.role === "main" ? "red" : "gray"} radius="sm">
                    {ROLE_TEXT[p.role]}
                  </Badge>
                ) : null}
                {!p.checkable ? (
                  <Badge size="sm" variant="outline" color="gray" radius="sm">
                    不可核对
                  </Badge>
                ) : null}
              </Group>
            </Group>
          </Paper>
        ))}
      </Stack>
      {read?.analysis ? (
        <Spoiler maxHeight={66} showLabel="展开拆题说明" hideLabel="收起">
          <Text size="sm" c="dimmed" className="prose">
            {read.analysis}
          </Text>
        </Spoiler>
      ) : null}
    </Stack>
  );
}

function SearchOutput({ view, now }: { view: RunView; now: number }) {
  const queries = view.steps.search.queries;
  const sources = (view.snapshot?.sources ?? []).filter((s) => !s.material);
  if (!queries.length) return <Waiting text="等拆题完成后开始检索" />;
  return (
    <Stack gap="sm">
      <Stack gap={6}>
        {queries.map((q, i) => (
          <Paper key={i} withBorder radius="md" px="sm" py={8}>
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm" style={{ flex: 1, minWidth: 0 }} className="prose">
                {plainPart(q.query)}
              </Text>
              {q.endedAt ? (
                <Group gap={4} wrap="nowrap" style={{ flexShrink: 0 }}>
                  {typeof q.found === "number" ? (
                    <Badge size="sm" variant="light" color="gray" radius="sm" tt="none">
                      {q.found} 条结果
                    </Badge>
                  ) : null}
                  <Badge size="sm" variant="default" radius="sm" tt="none" fw={500}>
                    {seconds(q.endedAt - q.startedAt)}
                  </Badge>
                </Group>
              ) : (
                <Group gap={6} wrap="nowrap">
                  <Loader size={14} type="dots" color="red" />
                  <Text size="xs" c="dimmed">
                    {seconds(Math.max(0, now - q.startedAt))}
                  </Text>
                </Group>
              )}
            </Group>
          </Paper>
        ))}
      </Stack>
      {sources.length ? (
        <>
          <Text size="sm" fw={600}>
            留作材料的来源 {sources.length} 条
          </Text>
          <Spoiler maxHeight={300} showLabel={`展开全部 ${sources.length} 条`} hideLabel="收起">
            <Stack gap={4}>
              {sources.map((s) => {
                const read = materialReadTag({ excerptKind: s.excerptKind }, s);
                return (
                  <Group key={s.id} gap={8} wrap="nowrap" py={2}>
                    <Favicon domain={domainOf(s.url)} />
                    <Box style={{ flex: 1, minWidth: 0 }}>
                      <Anchor href={s.url} target="_blank" rel="noopener noreferrer" size="sm" lineClamp={1}>
                        {s.title || s.url}
                      </Anchor>
                      <Text size="xs" c="dimmed" truncate>
                        {domainOf(s.url)}
                      </Text>
                    </Box>
                    <Badge size="xs" variant="dot" color={read.level === "read" ? "teal" : read.level === "partial" ? "yellow" : "gray"} tt="none" fw={500} style={{ flexShrink: 0 }} visibleFrom="xs">
                      {read.level === "read" ? "已读正文" : read.level === "partial" ? "部分正文" : "只有摘要"}
                    </Badge>
                  </Group>
                );
              })}
            </Stack>
          </Spoiler>
        </>
      ) : null}
    </Stack>
  );
}

function CheckOutput({ view }: { view: RunView }) {
  const out = view.steps.check.outputs.at(-1);
  if (!out) return <Stack gap="sm"><Waiting text="正在逐点对照材料" /><ClaimProgress view={view} /></Stack>;
  const read = readableOutput("check", out) as { findings: string[]; counter: string[]; verdicts: { point: string; label: string; reason: string }[] };
  return (
    <Stack gap="sm">
      <Stack gap={6}>
        {read.verdicts.map((v, i) => {
          const label = isLabelKey(v.label) ? v.label : null;
          return (
            <Paper key={i} withBorder radius="md" px="sm" py={8}>
              <Group gap={8} wrap="nowrap" align="flex-start">
                <Badge color={labelColor(label)} radius="sm" style={{ flexShrink: 0 }}>
                  {label ? LABEL_TEXT[label] : "待定"}
                </Badge>
                <Box style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600} className="prose">
                    {v.point}
                  </Text>
                  <Text size="sm" c="dimmed" className="prose">
                    {v.reason}
                  </Text>
                </Box>
              </Group>
            </Paper>
          );
        })}
      </Stack>
      {read.findings.length ? (
        <Box>
          <Text size="sm" fw={600} mb={4}>
            查到的要点
          </Text>
          <List size="sm" spacing={4} className="prose">
            {read.findings.map((f, i) => (
              <List.Item key={i}>{f}</List.Item>
            ))}
          </List>
        </Box>
      ) : null}
      {read.counter.length ? (
        <Box>
          <Text size="sm" fw={600} mb={4}>
            相反的说法
          </Text>
          <List size="sm" spacing={4} className="prose">
            {read.counter.map((f, i) => (
              <List.Item key={i}>{f}</List.Item>
            ))}
          </List>
        </Box>
      ) : null}
      <Text size="xs" c="dimmed">
        核查员的判断还要经过来源审核，最终以结果为准。
      </Text>
    </Stack>
  );
}

const RELATION: Record<string, { text: string; color: string }> = {
  support: { text: "支持", color: "teal" },
  contradict: { text: "反驳", color: "red" },
};

function AuditOutput({ view }: { view: RunView }) {
  const out = view.steps.audit.outputs.at(-1);
  if (!out || view.steps.audit.status === "running") return <Stack gap="sm"><Waiting text={view.steps.audit.rounds > 1 ? "正在复核每条来源是支持还是反驳" : "正在确认每条来源是支持还是反驳"} /><ClaimProgress view={view} /></Stack>;
  const read = readableOutput("audit", out) as {
    verified: string[];
    questionable: string[];
    missing: string[];
    notes: string;
    relations: { point: string; url: string; relation: string; reason: string }[];
  };
  const groups: [string, string, string[]][] = [
    ["verified", "可靠来源", read.verified],
    ["questionable", "存疑来源", read.questionable],
    ["missing", "还缺的材料", read.missing],
  ];
  return (
    <Stack gap="sm">
      <Stack gap={6}>
        {read.relations.map((r, i) => {
          const rel = RELATION[r.relation] ?? { text: "相关", color: "gray" };
          return (
            <Paper key={i} withBorder radius="md" px="sm" py={8}>
              <Group gap={6} wrap="wrap" mb={4}>
                <Badge size="sm" color={rel.color} radius="sm">
                  {rel.text}
                </Badge>
                <Text size="xs" c="dimmed">
                  「{r.point}」
                </Text>
                <Group gap={4} wrap="nowrap">
                  <Favicon domain={domainOf(r.url)} size={14} />
                  <Anchor href={r.url} target="_blank" rel="noopener noreferrer" size="xs">
                    {domainOf(r.url)} ↗
                  </Anchor>
                </Group>
              </Group>
              <Text size="sm" className="prose" c="dark.6" lineClamp={3}>
                {r.reason}
              </Text>
            </Paper>
          );
        })}
      </Stack>
      <Accordion variant="separated" radius="md" multiple>
        {groups
          .filter(([, , list]) => list.length)
          .map(([value, title, list]) => (
            <Accordion.Item key={value} value={value}>
              <Accordion.Control>
                <Text size="sm">
                  {title} · {list.length}
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <List size="sm" spacing={4} className="prose">
                  {list.map((item, i) => (
                    <List.Item key={i}>{item}</List.Item>
                  ))}
                </List>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
      </Accordion>
    </Stack>
  );
}

function ComposeOutput({ view }: { view: RunView }) {
  const c = view.snapshot?.conclusion;
  if (!c || view.steps.compose.status === "running") return <Stack gap="sm"><Waiting text="正在从各点推出整句结论" /><ClaimProgress view={view} /></Stack>;
  const label = c.label ?? judgmentToLabel(c.judgment);
  return (
    <Stack gap={6}>
      <Group>
        <Badge size="lg" color={labelColor(label)} radius="sm">
          {LABEL_TEXT[label]}
        </Badge>
      </Group>
      <Text fw={600} className="prose">
        {plainPart(c.verdictLead || c.directAnswer)}
      </Text>
    </Stack>
  );
}

function VisionOutput({ view }: { view: RunView }) {
  if (!view.image) return <Waiting text="正在读图片里的文字" />;
  return (
    <Stack gap={4}>
      {view.image.texts.map((t, i) => (
        <Text key={i} size="sm" ff="monospace" bg="gray.0" px="xs" py={4} style={{ borderRadius: 4 }}>
          {t}
        </Text>
      ))}
    </Stack>
  );
}

export function StepOutput({ view, stepKey, now }: { view: RunView; stepKey: StepKey; now: number }) {
  const step = view.steps[stepKey];
  const meta = STEP_META[stepKey];
  const ms = stepDuration(view, stepKey, now);
  let body;
  if (step.status === "waiting") body = <Text size="sm" c="dimmed">还没轮到这一步</Text>;
  else if (stepKey === "decompose") body = <DecomposeOutput view={view} />;
  else if (stepKey === "search") body = <SearchOutput view={view} now={now} />;
  else if (stepKey === "check") body = <CheckOutput view={view} />;
  else if (stepKey === "audit") body = <AuditOutput view={view} />;
  else if (stepKey === "compose") body = <ComposeOutput view={view} />;
  else body = <VisionOutput view={view} />;
  return (
    <Card withBorder radius="lg" padding="md" shadow="xs">
      <Card.Section withBorder inheritPadding py="sm">
        <Group justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Avatar src={meta.img} alt="" size={40} radius="xl" />
            <Box>
              <Text fw={700}>{meta.title}</Text>
              <Text size="xs" c="dimmed">
                {meta.agent} · {meta.doing}
              </Text>
            </Box>
          </Group>
          {ms !== null ? (
            <Badge variant={step.status === "running" ? "light" : "default"} color={step.status === "running" ? "red" : "gray"} radius="sm" tt="none" fw={500} style={{ flexShrink: 0 }}>
              {step.status === "running" ? "已用 " : "用时 "}
              {seconds(ms)}
            </Badge>
          ) : null}
        </Group>
      </Card.Section>
      <Stack gap="sm" mt="sm">
        {stepKey !== "search" && stepKey !== "vision" ? <ThinkingFold key={stepKey} view={view} stepKey={stepKey} /> : null}
        {step.error ? (
          <Text size="sm" c="orange.8">
            这一步没能完成，核查会按现有材料继续
          </Text>
        ) : null}
        {body}
      </Stack>
    </Card>
  );
}
