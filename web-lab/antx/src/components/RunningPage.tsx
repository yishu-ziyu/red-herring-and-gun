// 运行工作台：
// 左侧步骤链照抄自 Ant Design X ThoughtChain「状态」与「可折叠」示例 https://x.ant.design/components/thought-chain-cn#thought-chain-demo-status
// 右侧活动时间线照抄自 antd Timeline「自定义颜色」示例 https://ant.design/components/timeline-cn#timeline-demo-color
// 跟随 / 回放切换照抄自 antd Segmented 基础示例 https://ant.design/components/segmented-cn ，回放进度照抄自 antd Slider 基础示例 https://ant.design/components/slider-cn
// 顶部状态照抄自 antd Card「带标题与额外操作」示例 https://ant.design/components/card-cn#card-demo-basic
import { CheckCircleOutlined, CloseCircleOutlined, LoadingOutlined, ReloadOutlined, StopOutlined, VerticalAlignBottomOutlined } from "@ant-design/icons";
import { ThoughtChain, type ThoughtChainItemType } from "@ant-design/x";
import { Alert, Button, Card, Flex, Segmented, Select, Slider, Tag, Timeline, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { cancelRun, useArrivingEvents, type RunSource } from "../lib/api.ts";
import { navigate } from "../lib/nav.ts";
import { cleanText, domainOf, seconds } from "../lib/scrub.ts";
import type { PublicActivity } from "../lib/types.ts";
import { PHASE_TEXT, phaseOf, reduceEvents, type Step, type Workbench } from "../lib/workbench.ts";
import { ConclusionCard, OcrCard } from "./ResultView.tsx";
import StepOutput, { StepAvatar } from "./StepOutput.tsx";

const JUDGMENT_TEXT: Record<string, string> = {
  supported: "有材料支持", refuted: "被材料反驳", mixed: "只对了一部分", disputed: "来源说法不一", unresolved: "还查不清", "not-applicable": "不适用真假判断",
};

function activityText(a: PublicActivity, pointNo: (id: string) => string): { text: string; color: string } {
  const p = a.payload;
  const pt = a.claimIds[0] ? pointNo(a.claimIds[0]) : "";
  switch (a.kind) {
    case "claim_decomposed": return { text: `拆出${pt}：${p.claimText ?? ""}`, color: "blue" };
    case "search_started": return { text: `开始检索：${p.query ?? ""}`, color: "gray" };
    case "source_found": return { text: `${pt}找到材料：${p.title || p.domain || ""}${p.domain ? `（${p.domain}）` : ""}`, color: "gray" };
    case "source_checked": return { text: `${pt}${p.role === "support" ? "支持" : "反驳"}：${p.title || ""}${p.domain ? `（${p.domain}）` : ""}`, color: p.role === "support" ? "green" : "red" };
    case "evidence_assessed": return { text: `${pt}有了判断：${JUDGMENT_TEXT[p.judgment ?? ""] ?? ""}`, color: "blue" };
    case "judgment_revised": return { text: `${pt}判断改为：${JUDGMENT_TEXT[p.to ?? ""] ?? ""}`, color: "orange" };
    case "conflict_detected": return { text: `${pt}来源之间有冲突：${p.summary ?? ""}`, color: "orange" };
    case "gap_identified": return { text: `${pt}还缺：${p.description ?? ""}`, color: "gray" };
    case "run_completed": return { text: "核查完成", color: "green" };
    default: return { text: "", color: "gray" };
  }
}

function stepDescription(step: Step, wb: Workbench): string {
  if (step.kind === "decompose" && step.status === "success") {
    const n = Array.isArray(step.output?.claimAtoms) ? (step.output!.claimAtoms as unknown[]).length : wb.snapshot?.claims.length ?? 0;
    return n ? `拆成 ${n} 点` : "已拆完";
  }
  if (step.kind === "search") return `${cleanText(step.query)}${step.found.length ? ` · 找到 ${step.found.length} 份材料` : ""}`;
  if (step.kind === "check") return step.status === "loading" ? "逐点对照材料" : "逐点判断已给出";
  if (step.kind === "audit") return step.status === "loading" ? "核对每条来源的方向" : "来源已逐条核对";
  if (step.kind === "compose") return step.status === "loading" ? "合成整句结论" : "整句结论已写成";
  if (step.kind === "vision") return "从图片里读出文字";
  return "";
}

const STATUS_ICON: Record<Step["status"], React.ReactNode> = {
  loading: <LoadingOutlined />, success: <CheckCircleOutlined />, error: <CloseCircleOutlined />, abort: <StopOutlined />,
};

export default function RunningPage({ source }: { source: RunSource }) {
  const [speed, setSpeed] = useState(8);
  const { events, error, fixture, arrivedAt, restart } = useArrivingEvents(source, speed);
  const [mode, setMode] = useState<"follow" | "history">("follow");
  const [cursor, setCursor] = useState(0);
  const [pinned, setPinned] = useState<string | null>(null);
  const [clock, setClock] = useState(Date.now());
  const timelineRef = useRef<HTMLDivElement>(null);

  const visible = mode === "follow" ? events : events.slice(0, Math.min(cursor, events.length));
  const wb = useMemo(() => reduceEvents(visible), [visible]);
  const phase = phaseOf(wb);
  const live = source.kind === "live";

  useEffect(() => {
    if (wb.terminal || mode !== "follow") return;
    const t = setInterval(() => setClock(Date.now()), live ? 1000 : 200);
    return () => clearInterval(t);
  }, [live, wb.terminal, mode]);
  // 真实运行按墙钟走；回放按倍速把上一条事件之后流逝的时间折回原始时间。
  const now = wb.terminal || mode !== "follow"
    ? wb.lastAt ?? 0
    : live
      ? Math.max(clock, wb.lastAt ?? 0)
      : (wb.lastAt ?? 0) + Math.max(0, clock - arrivedAt.current) * speed;

  const latest = [...wb.steps].reverse().find((s) => s.status === "loading") ?? wb.steps.at(-1);
  const selected = (pinned && wb.steps.find((s) => s.key === pinned)) || latest;
  const following = mode === "follow" && !pinned;

  useEffect(() => {
    if (!following || !timelineRef.current) return;
    timelineRef.current.scrollTop = timelineRef.current.scrollHeight;
  }, [following, wb.activities.length]);

  const pointNo = (id: string) => {
    const i = wb.snapshot?.claims.findIndex((c) => c.id === id) ?? -1;
    return i >= 0 ? `第 ${i + 1} 点` : "";
  };

  const backToLatest = () => {
    setPinned(null);
    setMode("follow");
  };

  const items: ThoughtChainItemType[] = wb.steps.map((step) => {
    const took = (step.endedAt ?? now) - step.startedAt;
    return {
      key: step.key,
      icon: <StepAvatar step={step} size={24} />,
      status: step.status,
      blink: step.status === "loading",
      title: (
        <Typography.Link
          onClick={() => setPinned(step.key)}
          strong={selected?.key === step.key}
          style={{ color: selected?.key === step.key ? undefined : "inherit" }}
          data-step-kind={step.kind}
        >
          {step.title}
        </Typography.Link>
      ),
      description: (
        <Flex vertical gap={2}>
          <Typography.Text type="secondary" ellipsis style={{ maxWidth: 240, fontSize: 12 }}>{stepDescription(step, wb)}</Typography.Text>
          <Flex gap={4} align="center">
            <Typography.Text type={step.status === "loading" ? undefined : "secondary"} style={{ fontSize: 12 }}>
              {STATUS_ICON[step.status]} {step.status === "loading" ? `已用 ${seconds(took)}` : `用时 ${seconds(took)}`}
            </Typography.Text>
          </Flex>
        </Flex>
      ),
    };
  });

  const total = (wb.lastAt ?? 0) - (wb.startedAt ?? wb.lastAt ?? 0);
  const ocr = wb.steps.find((s) => s.kind === "vision")?.ocr ?? [];
  const complete = phase === "complete" && wb.snapshot?.conclusion;

  return (
    <Flex vertical gap={16} data-gp-phase={phase}>
      <Card
        size="small"
        title={
          <Flex gap={8} align="center" wrap style={{ padding: "6px 0" }}>
            <Tag color={phase === "complete" ? "success" : phase === "interrupted" ? "default" : "processing"} variant="filled" icon={wb.terminal ? undefined : <LoadingOutlined />}>
              {PHASE_TEXT[phase] ?? "进行中"}
            </Tag>
            <Typography.Text type="secondary" style={{ fontWeight: 400, fontSize: 12 }}>总用时 {seconds(Math.max(0, (wb.terminal ? total : now - (wb.startedAt ?? now))))}</Typography.Text>
            {fixture ? <Tag variant="filled">样例回放</Tag> : null}
          </Flex>
        }
        extra={
          live && !wb.terminal ? <Button size="small" danger onClick={() => cancelRun(source.runId)}>停止</Button> : null
        }
      >
        <Typography.Paragraph style={{ fontSize: 16, margin: 0 }}>
          “{wb.snapshot?.originalClaim ?? fixture?.meta.claim ?? ""}”
        </Typography.Paragraph>
        <Flex gap={8} align="center" wrap style={{ marginTop: 12 }}>
          <Segmented
            size="small"
            value={mode}
            onChange={(v) => {
              const next = v as "follow" | "history";
              if (next === "history") setCursor(events.length);
              else setPinned(null);
              setMode(next);
            }}
            options={[{ label: "实时跟随", value: "follow" }, { label: "历史回放", value: "history" }]}
          />
          {!following ? <Button size="small" icon={<VerticalAlignBottomOutlined />} onClick={backToLatest}>回到最新</Button> : null}
          {fixture ? (
            <>
              <Select
                size="small"
                value={speed}
                onChange={setSpeed}
                style={{ width: 96 }}
                options={[1, 4, 8, 16, 32].map((n) => ({ value: n, label: `${n} 倍速` }))}
              />
              <Button size="small" icon={<ReloadOutlined />} onClick={() => { backToLatest(); restart(); }}>从头回放</Button>
            </>
          ) : null}
        </Flex>
        {mode === "history" ? (
          <Flex gap={12} align="center" style={{ marginTop: 8 }}>
            <Slider style={{ flex: 1 }} min={1} max={Math.max(1, events.length)} value={Math.min(cursor, events.length)} onChange={(v) => setCursor(v)}
              tooltip={{ formatter: (v) => { const t = events[(v ?? 1) - 1]?.timestamp; const s0 = events[0]?.timestamp; return t && s0 ? `+${seconds(t - s0)}` : ""; } }} />
            <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{Math.min(cursor, events.length)} / {events.length}</Typography.Text>
          </Flex>
        ) : null}
      </Card>

      {error ? <Alert type="warning" showIcon title={error} /> : null}
      {wb.error ? <Alert type="error" showIcon title={wb.error} /> : null}
      <OcrCard lines={ocr} />

      {complete ? (
        <ConclusionCard
          snapshot={wb.snapshot!}
          report={wb.finalReport}
          extra={
            <Button type="link" onClick={() => navigate(source.kind === "fixture" ? { part: "result", run: source.name } : { part: "result", live: source.runId })}>
              查看各点依据与分享
            </Button>
          }
        />
      ) : null}

      <div className="wb-grid">
        <Card size="small" title="步骤" styles={{ body: { padding: "12px 12px 4px" } }}>
          {items.length ? <ThoughtChain items={items} line="dashed" /> : <Typography.Text type="secondary">等待开始…</Typography.Text>}
        </Card>
        <StepOutput step={selected} now={now} />
        <Card size="small" title={`活动 · ${wb.activities.length}`} styles={{ body: { padding: 12 } }}>
          <div ref={timelineRef} style={{ maxHeight: 520, overflowY: "auto", paddingTop: 8 }} onWheel={() => { if (mode === "follow" && !pinned && timelineRef.current && timelineRef.current.scrollTop + timelineRef.current.clientHeight < timelineRef.current.scrollHeight - 40) setPinned(selected?.key ?? null); }}>
            {wb.activities.length ? (
              <Timeline
                items={wb.activities.map((a) => {
                  const { text, color } = activityText(a, pointNo);
                  return {
                    key: a.id,
                    color,
                    content: (
                      <Flex vertical gap={0}>
                        <Typography.Text style={{ fontSize: 13 }}>{cleanText(text)}</Typography.Text>
                        <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                          +{seconds(a.at - (wb.startedAt ?? a.at))}
                          {a.sourceIds.length && wb.snapshot ? ` · ${domainOf(wb.snapshot.sources.find((s) => s.id === a.sourceIds[0])?.url ?? "")}` : ""}
                        </Typography.Text>
                      </Flex>
                    ),
                  };
                })}
              />
            ) : (
              <Typography.Text type="secondary">还没有活动</Typography.Text>
            )}
          </div>
        </Card>
      </div>
    </Flex>
  );
}
