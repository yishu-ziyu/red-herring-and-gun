// 当前 agent 的产出面板：
// 思考折叠照抄自 Ant Design X Think「状态」示例 https://x.ant.design/components/think-cn#think-demo-status
// 产出卡片照抄自 antd Card 基础示例 https://ant.design/components/card-cn 、List 简单列表示例 https://ant.design/components/list-cn#list-demo-simple
// 头像与标题照抄自 antd Card.Meta 示例 https://ant.design/components/card-cn#card-demo-meta
import { GlobalOutlined, PictureOutlined, SearchOutlined } from "@ant-design/icons";
import { Think } from "@ant-design/x";
import { Avatar, Card, Empty, Flex, List, Tag, Typography } from "antd";
import { isLabelKey, labelForVerdict } from "@shared/domain/labels.ts";
import { cleanCitedText, cleanList, cleanText, domainOf, seconds } from "../lib/scrub.ts";
import { STEP_AVATAR, type Step } from "../lib/workbench.ts";
import { Favicon } from "./Cite.tsx";
import LabelTag from "./LabelTag.tsx";

const ROLE_TEXT: Record<string, string> = { main: "主要说法", premise: "前提", background: "背景" };

export const STEP_HINT: Record<Step["kind"], string> = {
  vision: "从图片里读出文字",
  decompose: "把原句拆成几点，分清主要说法、前提和背景",
  search: "为这一点检索公开材料",
  check: "逐点对照材料，给出判断和理由",
  audit: "逐条检查来源是否真的支持或反驳",
  compose: "把各点判断合成整句结论并复核",
  other: "处理中",
};

export function StepAvatar({ step, size = 40 }: { step: Step; size?: number }) {
  const src = STEP_AVATAR[step.kind];
  if (src) return <Avatar src={src} size={size} shape="square" />;
  return <Avatar size={size} shape="square" icon={step.kind === "vision" ? <PictureOutlined /> : <SearchOutlined />} />;
}

const asList = (v: unknown) => (Array.isArray(v) ? (v as Record<string, unknown>[]).filter((x) => x && typeof x === "object") : []);

function Section({ title, items, type }: { title: string; items: string[]; type?: "secondary" }) {
  if (!items.length) return null;
  return (
    <List
      size="small"
      header={<Typography.Text strong>{title}</Typography.Text>}
      dataSource={items}
      renderItem={(item) => <List.Item><Typography.Text type={type}>{item}</Typography.Text></List.Item>}
    />
  );
}

function OutputBody({ step }: { step: Step }) {
  const out = step.output ?? {};
  switch (step.kind) {
    case "decompose": {
      const types = asList(out.claimAtomTypes);
      const atoms = types.length ? types : cleanList(out.claimAtoms).map((text) => ({ text }));
      return (
        <Flex vertical gap={12}>
          {atoms.length ? (
            <List
              size="small"
              header={<Typography.Text strong>拆出的点</Typography.Text>}
              dataSource={atoms}
              renderItem={(atom, i) => (
                <List.Item>
                  <Flex gap={8} align="baseline" wrap>
                    <Typography.Text type="secondary">第 {i + 1} 点</Typography.Text>
                    <Typography.Text>{cleanText(atom.text)}</Typography.Text>
                    {typeof atom.role === "string" && ROLE_TEXT[atom.role] ? <Tag variant="filled">{ROLE_TEXT[atom.role]}</Tag> : null}
                    {atom.verifiable === false ? <Tag>不可核对</Tag> : null}
                  </Flex>
                </List.Item>
              )}
            />
          ) : null}
          {typeof out.analysis === "string" ? <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{cleanText(out.analysis)}</Typography.Paragraph> : null}
        </Flex>
      );
    }
    case "search":
      return step.found.length ? (
        <List
          size="small"
          header={<Typography.Text strong>找到 {step.found.length} 份材料</Typography.Text>}
          dataSource={step.found.slice(0, 12)}
          footer={step.found.length > 12 ? <Typography.Text type="secondary">还有 {step.found.length - 12} 份未列出</Typography.Text> : null}
          renderItem={(s) => (
            <List.Item>
              <Flex gap={8} align="center" style={{ minWidth: 0, width: "100%" }}>
                <Favicon url={s.url} />
                <Typography.Link href={s.url} target="_blank" rel="noopener noreferrer nofollow" ellipsis style={{ flex: 1, minWidth: 0 }}>
                  {cleanText(s.title) || domainOf(s.url)}
                </Typography.Link>
                <Typography.Text type="secondary" style={{ fontSize: 12, flexShrink: 0 }}>{domainOf(s.url)}</Typography.Text>
              </Flex>
            </List.Item>
          )}
        />
      ) : (
        <Empty image={<GlobalOutlined style={{ fontSize: 32, color: "rgba(0,0,0,0.25)" }} />} description={step.status === "loading" ? "正在检索…" : "这一点没有找到材料"} />
      );
    case "check": {
      const verdicts = asList(out.subclaimVerdicts);
      return (
        <Flex vertical gap={12}>
          {verdicts.length ? (
            <List
              size="small"
              header={<Typography.Text strong>逐点判断</Typography.Text>}
              dataSource={verdicts}
              renderItem={(v) => {
                const label = isLabelKey(v.label) ? v.label : labelForVerdict(String(v.verdict ?? ""));
                return (
                  <List.Item>
                    <Flex vertical gap={4}>
                      <Flex gap={8} align="baseline" wrap>
                        <Typography.Text strong>{cleanText(v.claimAtom)}</Typography.Text>
                        <LabelTag label={label} />
                      </Flex>
                      <Typography.Text>{cleanText(v.reason)}</Typography.Text>
                      {typeof v.evidence === "string" ? <Typography.Text type="secondary">{cleanCitedText(v.evidence).replace(/\[\d+\]/g, "")}</Typography.Text> : null}
                    </Flex>
                  </List.Item>
                );
              }}
            />
          ) : null}
          <Section title="主要发现" items={cleanList(out.keyFindings)} />
          <Section title="反面材料" items={cleanList(out.counterEvidence)} />
        </Flex>
      );
    }
    case "audit":
      return (
        <Flex vertical gap={12}>
          <Section title="可以采信的来源" items={cleanList(out.verifiedSources)} />
          <Section title="存疑的来源" items={cleanList(out.questionableSources)} type="secondary" />
          <Section title="还缺的来源" items={cleanList(out.missingSources)} type="secondary" />
          {typeof out.verificationNotes === "string" ? <Typography.Paragraph type="secondary" style={{ margin: 0 }}>{cleanText(out.verificationNotes)}</Typography.Paragraph> : null}
        </Flex>
      );
    case "compose":
      return step.status === "loading" ? (
        <Typography.Text type="secondary">正在把各点判断合成整句结论…</Typography.Text>
      ) : (
        <Typography.Text>{step.review?.passed === false ? "结论已写成，复核提出了需要注意的地方。" : "结论已写成并通过复核，见上方整句结论。"}</Typography.Text>
      );
    case "vision":
      return step.ocr?.length ? (
        <Section title="从图片里读出的文字" items={step.ocr.map(cleanText)} />
      ) : (
        <Typography.Text type="secondary">{step.status === "error" ? "图片没能读出来" : "图片里没有读出文字"}</Typography.Text>
      );
    default:
      return null;
  }
}

export default function StepOutput({ step, now }: { step: Step | undefined; now: number }) {
  if (!step) return <Card><Empty description="还没有开始" /></Card>;
  const running = step.status === "loading";
  const took = (step.endedAt ?? now) - step.startedAt;
  const thinking = step.thoughts.length > 0 && !step.thoughtDoneAt && running;
  const thinkMs = (step.thoughtDoneAt ?? now) - step.startedAt;
  return (
    <Card>
      <Card.Meta
        avatar={<StepAvatar step={step} />}
        title={
          <Flex gap={8} align="center" wrap>
            <span>{step.title}</span>
            {step.query ? <Typography.Text type="secondary" style={{ fontWeight: 400 }}>{cleanText(step.query)}</Typography.Text> : null}
          </Flex>
        }
        description={
          <Flex gap={8} wrap>
            <span>{STEP_HINT[step.kind]}</span>
            <Tag color={running ? "processing" : step.status === "success" ? "success" : step.status === "error" ? "error" : "default"} variant="filled">
              {running ? `进行中 · 已用 ${seconds(took)}` : step.status === "success" ? `完成 · 用时 ${seconds(took)}` : step.status === "error" ? `出错 · 用时 ${seconds(took)}` : "已停止"}
            </Tag>
          </Flex>
        }
      />
      <Flex vertical gap={16} style={{ marginTop: 16 }}>
        {step.thoughts.length > 0 || (running && step.kind !== "search" && step.kind !== "compose") ? (
          <Think
            key={`${step.key}:${thinking ? "on" : "off"}`}
            title={thinking || (running && !step.thoughtDoneAt) ? "思考中" : `思考已完成 · ${seconds(thinkMs)}`}
            loading={thinking || (running && !step.thoughtDoneAt)}
            blink={thinking}
            defaultExpanded={thinking}
          >
            <div className="thought-text">{step.thoughts.length ? step.thoughts.map(cleanText).join("\n") : "等待第一段思考…"}</div>
          </Think>
        ) : null}
        <OutputBody step={step} />
      </Flex>
    </Card>
  );
}
