# 溯证 Agent MVP Spec

## Superpower

> 让用户像在白板上探索思路一样，先看见观点的问题空间，再选择任一节点继续调用 Agent 能力。

## 一句话定义

溯证 Agent 是一个用户主导的 Agent Reasoning Canvas。用户输入一句观点后，它不直接给真假判断，也不自动走完整个架构，而是先把观点放到白板中心，展开三层问题空间。之后用户选择自己感兴趣的节点，在该节点上用自然语言追问，并按需触发搜索、证据审计、反证生成或局部改写。

## 产品原则

内部存在一个中控 LLM 和多个子 Agent，但中控 LLM 只负责调度，不直接替用户输出最终答案。用户看到的是思考地图：

```text
中心观点
→ 判断层节点
→ 证据需求节点
→ 用户选择某个节点
→ 中控 LLM 调度对应子 Agent
→ 新分支接回 Canvas
```

核心原则：能力存在于系统中，但只有当用户在节点上触发时才发挥作用。

## 当前 MVP 范围

本 MVP 使用预置案例“AI 导致初级内容岗位减少。”证明完整体验闭环：

1. 顶部输入观点并启动 Agent 推理。
2. 左侧 Agent Trace 逐步显示第一人称 reasoning 动作。
3. 中央 Canvas 从中心观点长出判断层节点。
4. 到第三层后自动推进停止，状态变为“等待选择节点”。
5. 用户点击任一节点后，在右侧 Inspector 中输入追问并选择要触发的能力。
6. 中控 LLM 通过本地 API 代理调用真实模型。优先使用 OpenAI Responses API；本地没有 `OPENAI_API_KEY` 时，优先使用 `~/.claude/settings.json` 中的本地 Anthropic-compatible proxy，再兜底到 Codex CLI。
7. 新增分支只接在用户选择的节点附近，避免整张图失控展开。
8. 底部 Conclusion Dock 提醒当前仍是局部发散，暂不收束总答案。

## P0 功能

- 三栏 Canvas 工作台：Agent Trace、Reasoning Canvas、Node Inspector。
- 可推进 revealStage：开始推理和下一步按钮只负责搭出前三层问题空间。
- 可点击节点：点击 trace 或 canvas 节点会高亮对应推理区域。
- Node Inspector：按节点类型展示原句风险、证据需求、可以说/不能说、禁止推断或改写版本。
- Node-triggered Agent：在所选节点上输入自然语言追问，选择“证据审计 / 联网搜索 / 反证生成 / 局部改写”后，前端调用 `/api/agent/expand`，由 Vite 本地代理调用真实大模型。
- Provider 顺序：有 `OPENAI_API_KEY` 时走 OpenAI Responses API；没有 key 时走本机 `ANTHROPIC_BASE_URL` / `ANTHROPIC_MODEL`；再不可用时走本机 `codex exec --output-schema`。
- 联网搜索模式：当用户显式选择“联网搜索”时，OpenAI provider 启用 `web_search`，Codex provider 启用 `codex --search exec`；其他模式不主动联网。
- 配置边界：可在 `mvp/.env.local` 设置 `OPENAI_API_KEY`、`OPENAI_MODEL`、`OPENAI_BASE_URL`、`ANTHROPIC_BASE_URL`、`ANTHROPIC_MODEL`、`ANTHROPIC_AUTH_TOKEN`、`CODEX_BIN`、`CODEX_LOCAL_MODEL`。如果真实 provider 都不可用，界面展示配置/调用错误，不回退到模拟结果。
- Conclusion Dock：始终展示原句强度，并明确当前是否处于局部发散而非最终答案。
- 复用既有 Grader / Report Composer 输出，避免纯视觉假象。

## P1 功能

- 用户粘贴候选材料后运行 Grader。
- 切换使用场景：课程作业、学术研究、新闻核查、内容创作。
- 多案例模板。
- 真正的画布拖拽、缩放和节点折叠。

## P2 功能

- 来源快照归档。
- Markdown / PDF 导出。
- 引用链记录。

## 非目标

- 不做通用搜索引擎。
- 不做大规模爬虫。
- 不做自动二元判真伪。
- 不在浏览器端暴露模型凭证；真实调用必须走本地代理或后续 serverless endpoint。
- 不把内部方法论直接摊给用户。
- 不做真正无限白板或图数据库。
- 不让 AI 自动展开所有链路并直接汇报答案。

## 验收标准

- 首屏出现顶部输入区、左侧 Agent Trace、中间 Canvas、右侧 Inspector 和底部 Conclusion Dock。
- 点击开始后 Canvas 出现中心观点节点“AI 导致初级内容岗位减少”。
- 点击下一步后只展开到第三层问题空间，并停在“等待选择节点”。
- 判断层节点以连线从中心观点自然展开。
- 点击任一节点，Inspector 出现节点追问输入区和能力选择。
- 点击“联网搜索”等能力后，Canvas 只在当前节点上新增真实模型返回的中控 LLM、子 Agent 和局部结果节点。
- 缺少 `OPENAI_API_KEY` 时，系统应尝试本机 Anthropic-compatible proxy 和 Codex provider；只有真实 provider 调用失败时，Node Inspector 才显示错误，不能生成模拟分支。
- 底部 Conclusion Dock 不自动给最终答案，而是显示“正在局部发散，暂不收束总答案”。
- `npm run build` 通过。
- 中文渲染正常。
