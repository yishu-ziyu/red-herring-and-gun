# 迭代实施计划：2026-07-04

## 目标

围绕「信息真相猎人」主线叙事，同时推进三件产品迭代：

1. **Mission Control 表现层优化**：UI 体验打磨，不动 Agent 逻辑。
2. **证据链 / Grader 输出可规约化**：把方法论承诺的 inference_allowed / inference_blocked / 反证检索、来源独立性检查接入产品输出。
3. **Agent reasoning trace 可视化白板**：让用户感知到 Agent 在思考，而不是看一个静态报告。

## 设计原则（来自 HANDOFF.md）

- 优先解决思考质量，不优先写作质量。
- 产品是用户体验流程，不是内部方法论仪表盘；模块隐藏在流程之后。
- 每个 Agent 模块都要绑定真实状态，不能只做装饰。
- 失败的搜索或模型调用要在证据链里可见，不能被静默抹平。
- 报告必须说明 can say / cannot say。

## 文件改动范围

**新增：**

- `mvp/src/lib/inferenceLicense.ts` —— 推理许可聚合（inference_allowed / inference_blocked 跨子命题合并）
- `mvp/src/lib/sourceLineage.ts` —— 来源谱系追踪（10 个来源 ≠ 10 个独立证据）
- `mvp/src/components/v3/panels/InferenceLicensePanel.tsx` —— 推理许可可视化
- `mvp/src/components/v3/panels/ReasoningTracePanel.tsx` —— Agent reasoning trace 时间线
- `mvp/src/lib/reasoningTrace.ts` —— 推理 trace 收集器
- `mvp/test/inferenceLicense.test.ts` —— 推理许可单测
- `mvp/test/sourceLineage.test.ts` —— 来源谱系单测
- `mvp/test/reasoningTrace.test.ts` —— 推理 trace 单测

**修改：**

- `mvp/src/lib/schemas.ts` —— 扩展 schema，加 inferenceLicense / sourceLineage / reasoningTrace 字段
- `mvp/src/lib/reportComposer.ts` —— 调用 inferenceLicense 聚合
- `mvp/src/lib/evidenceConsensus.ts` —— 调用 sourceLineage 修正独立性评分
- `mvp/src/components/v3/ConclusionDockV3.tsx` —— 接入 InferenceLicensePanel
- `mvp/src/components/v3/panels/AgentPanel.tsx` —— 接入 ReasoningTracePanel
- `mvp/src/components/v3/phases/MissionControlView.tsx` —— 表现层 UX 优化（状态更可见、加载态、错误态、空态）

## 阶段拆分（按 yishuship 工作流）

### Stage 1 — PM Intake & 设计对齐

**产出：** 本文件完成（含三阶段验收标准）

**验收：**

- 三阶段边界清楚，文件改动清单具体到路径
- 每阶段给出可验证 QA 信号
- 包含 evidence-license / lineage / trace 三个数据流的字段定义草案

### Stage 2 — Evidence License + Source Lineage（数据基础）

**范围：**

- `inferenceLicense.ts`：跨子命题聚合 inference_allowed / inference_blocked，输出可规约化的报告级许可清单
- `sourceLineage.ts`：根据 URL / 出处解析检测来源是否转引自同一上游；独立性评分修正
- `evidenceConsensus.ts` / `reportComposer.ts` 调用上述两个新模块
- schemas.ts 加 inferenceLicense / sourceLineage 字段

**验收：**

- `npx tsc --noEmit` 通过
- 新增 inferenceLicense.test.ts / sourceLineage.test.ts 全绿
- `npm test` 全部通过
- 一个真实 Demo 数据走完，能输出：合并后的 inference_allowed (≥1) / inference_blocked (≥1) / sourceLineage 独立来源计数 ≥ 1

### Stage 3 — Reasoning Trace 收集与可视化

**范围：**

- `reasoningTrace.ts`：在 Agent 编排过程中收集 step / path / branching 事件
- Agent 编排入口（`pipeline.ts` / `agentConfigs.ts`）插入 trace 钩子
- `ReasoningTracePanel.tsx`：时间线 + 当前步骤 + 分叉点可视化
- `AgentPanel.tsx` / `MissionControlView.tsx` 接入

**验收：**

- 一个 Demo 走完后，trace 至少包含：原句诊断 → 子命题拆分 → 证据检索 → Grader 评分 → 报告收束 5 个步骤
- 失败步骤（如搜索失败）在 trace 上有 visible error state，不被静默
- 视觉 QA：trace panel 不挤压 Mission Control 主区

### Stage 4 — Mission Control 表现层优化

**范围：**

- 加载态：避免空白屏；显示「正在拆解原句」/「正在搜索证据」/「正在交叉验证」等带状态的进度
- 错误态：失败时显示具体错误位置和重试入口
- 空态：用户没输入材料时显示引导
- 状态更可见：每个 Agent 模块显示其运行 / 完成 / 失败状态

**验收：**

- 输入态：明显的「贴文字 / 贴链接 / 上传截图」入口
- 执行态：Mission Control 各 Agent 模块显示状态点
- 失败态：错误出现在视野内，可点击重试
- 视觉 QA：状态点颜色 / 动画在浅色 / 深色背景下都清晰

### Stage 5 — Ship QA

**范围：**

- 跑 `npx tsc --noEmit` / `npm test` / `npm run build`
- 起 preview server (vite preview)，做端到端浏览器 QA
- 三个状态（输入态 / Mission Control / 结果态）截图归档
- DEVELOPMENT_LOG.md 加一条本次迭代记录
- 不发版到阿里云（按用户偏好：部署单独走 ops.sh）

**验收：**

- 三个状态截图清晰、能反映核心功能
- 测试覆盖率 ≥80%（新增模块）
- TS / build / test 全绿
- 一个端到端 Demo：从输入材料到报告收束，结果页能同时看到推理许可 + 来源谱系 + Agent trace

## 依赖关系

```
Stage 1 (本文件)
   ↓
Stage 2 (数据基础) ← 独立
   ↓
Stage 3 (trace 收集需要 schemas) ← 依赖 Stage 2
   ↓
Stage 4 (表现层打磨) ← 依赖 Stage 2 / 3 数据流
   ↓
Stage 5 (Ship QA)
```

## 决策记录（2026-07-04 用户拍板）

- **sourceLineage 启发**：URL 主机名 + 名称 / 出处 / 作者关键词匹配。需要 LLM 调用辅助判断。
- **Reasoning Trace 接入**：在 Agent 入口插入 `emit('trace', step)` 钩子，orchestrator subscribe 写入 reasoningTrace store。

## 风险与权衡

- **Risk 1：trace 收集插入太深，影响 Agent 性能。** Mitigation：trace 收集器用 event bus 异步写入，不在关键路径上同步等待。
- **Risk 2：sourceLineage 误判独立来源。** Mitigation：先用 URL 域名匹配作为粗信号，再加 manual override 字段；不要把这一项做成最终判定。
- **Risk 3：Mission Control UX 改动影响现有 review 截图。** Mitigation：表现层改动集中在状态点，不重排布局；保留现有 NodeInspectorV3 / ConclusionDockV3 入口。

## 不在本轮范围

- 新增外部搜索 provider
- 重写后端 handlers.ts
- 重新部署到 gun.yishuziyu.cn
- 加新依赖（package.json 改动）