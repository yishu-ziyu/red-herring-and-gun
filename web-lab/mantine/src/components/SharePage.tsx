// 分享：上半照抄 CopyButton 生成链接（SharePanel），下半是陌生人打开 /s/:id 看到的内容，
// 字段与后端 shareHandlers 的公开白名单一致（同用 shared/investigation/presentation）；排布照抄 Mantine UI「ArticleCardVertical」+ List（https://mantine.dev/core/list/）。
import { Alert, Anchor, AppShell, Badge, Card, Container, Divider, Group, Image, List, Paper, Stack, Text, Title } from "@mantine/core";
import { LABEL_TEXT } from "@shared/domain/labels.ts";
import { domainOf, presentClaim, presentConclusion, publishedDay, shownClaims } from "@shared/investigation/presentation.ts";
import type { Route, ShellProps } from "../App.tsx";
import { AppHeader } from "./AppHeader.tsx";
import { SharePanel } from "./SharePanel.tsx";
import { ResultSkeleton, useResult } from "./ResultPage.tsx";
import { Favicon } from "./SourceBits.tsx";
import type { ResultData } from "../lib/data.ts";
import { displayClaimOf } from "../lib/data.ts";
import { labelColor } from "../lib/derive.ts";
import { plainPart } from "../lib/scrub.ts";

function SharePreview({ data }: { data: ResultData }) {
  const c = presentConclusion(data.snapshot);
  const claims = shownClaims(data.snapshot).map((claim) => presentClaim(claim, data.snapshot.sources));
  const sources = data.snapshot.sources.filter((s) => /^https?:\/\//.test(s.url) && !s.material);
  const claimText = data.image ? "上传的图片" : displayClaimOf(data.snapshot);
  return (
    <Paper withBorder radius="lg" p={{ base: "md", sm: "xl" }} shadow="sm">
      <Stack gap="md">
        <Group gap={8}>
          <Image src="/mark.png" alt="" w={24} h={24} />
          <Text fw={700}>红鲱鱼与枪</Text>
        </Group>
        <Text size="xs" c="dimmed" fw={600}>
          原句
        </Text>
        <Title order={3} fw={600} lh={1.5} mt={-8}>
          {claimText}
        </Title>
        {c ? (
          <Card withBorder radius="md" padding="md" bg="gray.0" data-share-conclusion>
            <Stack gap={8}>
              <Group>
                <Badge size="lg" radius="sm" color={labelColor(c.label)}>
                  {LABEL_TEXT[c.label]}
                </Badge>
              </Group>
              <Text fw={600} className="prose">
                {plainPart(c.lead)}
              </Text>
              {c.rationale ? (
                <Text size="sm" className="prose" c="dark.6">
                  {plainPart(c.rationale)}
                </Text>
              ) : null}
              {c.boundaries.map((b, i) => (
                <Text key={i} size="sm" c="dimmed">
                  仍不能推出：{plainPart(b)}
                </Text>
              ))}
              {c.notCovered ? (
                <Text size="sm" c="dimmed">
                  {plainPart(c.notCovered)}
                </Text>
              ) : null}
            </Stack>
          </Card>
        ) : null}
        {claims.map((claim, i) => (
          <Stack key={i} gap={4}>
            <Group gap="xs" wrap="nowrap" align="flex-start">
              {claim.label ? (
                <Badge color={labelColor(claim.label)} variant="light" radius="sm" style={{ flexShrink: 0 }}>
                  {LABEL_TEXT[claim.label]}
                </Badge>
              ) : null}
              <Text fw={600} size="sm" className="prose">
                {plainPart(claim.text)}
              </Text>
            </Group>
            {claim.reason ? (
              <Text size="sm" className="prose" c="dark.6">
                {plainPart(claim.reason)}
              </Text>
            ) : null}
            {claim.boundary ? (
              <Text size="sm" c="dimmed" className="prose">
                仍不能推出：{plainPart(claim.boundary)}
              </Text>
            ) : null}
          </Stack>
        ))}
        {sources.length ? (
          <>
            <Divider label="来源" labelPosition="left" />
            <List spacing={6} size="sm" listStyleType="none">
              {sources.map((s) => (
                <List.Item key={s.id} icon={<Favicon domain={domainOf(s.url)} />}>
                  <Anchor href={s.url} target="_blank" rel="noopener noreferrer" size="sm">
                    {s.title || s.url}
                  </Anchor>{" "}
                  <Text span size="xs" c="dimmed">
                    {publishedDay(s) ?? "发布日期不详"}
                  </Text>
                </List.Item>
              ))}
            </List>
          </>
        ) : null}
        {c?.checkedDay ? (
          <Text size="xs" c="dimmed">
            核查于 {c.checkedDay}
          </Text>
        ) : null}
      </Stack>
    </Paper>
  );
}

export function SharePage({ route, onOpenHistory, navigate }: { route: Route } & ShellProps) {
  const { data, error } = useResult(route);
  return (
    <AppShell header={{ height: 60 }} padding="md">
      <AppShell.Header>
        <AppHeader onOpenHistory={onOpenHistory} navigate={navigate} />
      </AppShell.Header>
      <AppShell.Main>
        <Container size={720} px={0} pb="xl">
          <Stack gap="lg">
            {error ? <Alert color="red" variant="light">{error}</Alert> : null}
            {!data && !error ? <ResultSkeleton /> : null}
            {data ? (
              <>
                <SharePanel runId={data.runId} complete={data.snapshot.phase === "complete"} />
                <Text size="sm" c="dimmed" fw={600}>
                  打开链接的人看到的内容
                </Text>
                <SharePreview data={data} />
              </>
            ) : null}
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
