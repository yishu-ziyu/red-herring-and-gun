# CurioCat 对“信息真相猎人”项目的可迁移价值评估

> 日期：2026-05-30
> 参考项目：`/Users/mahaoxuan/Desktop/AI产品经理/因果推理引擎-CurioCat`
> 当前项目：`/Users/mahaoxuan/Desktop/黑客松/01-语境化可核查分解/mvp`

## 结论

CurioCat 最值得借的是“证据驱动的因果审计机制”，不是整套 FastAPI/Postgres/D3 后端。

对当前 hackathon demo 来说，最高 ROI 是把 CurioCat 的以下机制轻量移植到 TypeScript：

1. 原子命题拆解与来源句追踪。
2. 因果/逻辑链校验门：机制不能为空、不能只复述原文、强度不能极端。
3. 支持证据与反驳证据双向搜索。
4. 来源可信度、时效性、来源多样性综合评分。
5. 认知偏差审计：相关不等于因果、幸存者偏差、叙事谬误、反向因果等。
6. 证据不足时降低结论强度，而不是让大模型硬给确定答案。

## 评分项帮助矩阵

| 评分项 | CurioCat 可贡献 | 建议采用度 |
|---|---|---|
| 30% 准确性 | 原子命题拆解、因果校验门、反证搜索、证据调制、偏差审计，能显著降低“看起来合理但证据不足”的误判。 | 高 |
| 20% 场景覆盖 | CurioCat 是通用因果分析，不直接提供谣言类型分类。可复用 claim type 和 bias type，但场景覆盖仍应由当前 6 类谣言体系承担。 | 中 |
| 20% 结果闭环 | CurioCat 有导出、场景分析、what-if，但没有辟谣卡片/存疑归档/分享闭环。只借报告解释深度，不搬闭环流程。 | 中低 |
| 10% 技术架构 | Claim / Edge / Evidence 数据模型、pgvector 记忆、证据复用、增量 discovery，对“Agent 记忆和知识库”很有说服力。 | 高 |
| 10% Agent 能力 | 原项目默认 OpenAI/Anthropic，不符合国产大模型加分方向。只借 provider 抽象，模型仍走 360/StepFun/DeepSeek。 | 低 |
| 10% 360 生态联动 | 原项目用 Brave Search，不符合 360 生态。应把它的双向搜索策略接到当前 `search360.ts`。 | 中 |

## 可迁移模块

### 1. 原子命题与溯源

参考路径：

- `curiocat/pipeline/claim_extractor.py`
- `curiocat/db/models.py`

可迁移点：

- 长文本切片。
- claim 去重。
- `source_sentence` 字段。
- `claim_type` 区分 FACT / ASSUMPTION / PREDICTION / OPINION。

落点：

- `src/lib/schemas.ts`
- `src/lib/rumorDetection.ts`
- `src/lib/knowledgeBase.ts`

当前 MVP 已有 `Subclaim` 和 `ClaimType`，不需要重建类型体系。建议新增 `sourceSentence`、`originEvidenceId`、`claimConfidence` 这类字段，让报告中的每个判断都能回指原文或证据。

### 2. 逻辑链校验门

参考路径：

- `curiocat/pipeline/validation.py`
- `curiocat/pipeline/causal_inferrer.py`

可迁移点：

- 机制描述太短则拒绝。
- 机制只是复述两个 claim 则拒绝。
- 置信强度限制在合理区间。
- 对因果方向显式标注。

落点：

- 新建 `src/lib/causalValidation.ts`
- 接入 `src/lib/reportComposer.ts`
- 接入 `src/lib/confidenceEngine.ts`

建议实现为纯函数，不依赖后端：

```ts
export interface LogicLinkAudit {
  passed: boolean;
  penalties: string[];
  adjustedScore: number;
  blockedInference: string[];
}
```

### 3. 支持/反驳双向证据搜索

参考路径：

- `curiocat/pipeline/evidence_grounder.py`

可迁移点：

- 每条关键判断同时搜 supporting evidence 和 contradicting evidence。
- 弱边不继续深搜，避免浪费 token。
- 每条证据标记 `supporting` / `contradicting`。
- 最终结论由支持与反驳的相对强度决定。

落点：

- `src/lib/search360.ts`
- `src/lib/sherlockStyleSearch.ts`
- `src/lib/graderRules.ts`

这部分应接 360 AI Search，不要接 Brave Search。

### 4. 来源质量评分

参考路径：

- `curiocat/evidence/scorer.py`
- `curiocat/pipeline/evidence_grounder.py`

可迁移点：

- source type：academic / news / blog / forum / social / other。
- source tier：官方/学术最高，自媒体和社交最低。
- freshness：按发布时间衰减。
- source diversity：来源域名过于单一要扣分。

落点：

- 强化 `src/lib/sourceCredibility.ts`
- 强化 `src/lib/confidenceEngine.ts`
- 在 `ResultWorkspace` 的证据图谱节点显示来源等级。

### 5. 偏差审计

参考路径：

- `curiocat/pipeline/bias_auditor.py`
- `curiocat/llm/prompts/bias_detection.py`

可迁移点：

- 相关不等于因果。
- 幸存者偏差。
- 叙事谬误。
- 锚定效应。
- 反向因果。
- 选择偏差。
- 生态谬误。
- 确认偏误。

落点：

- 新建 `src/lib/biasAudit.ts`
- 在 `ReportPanel` 加“逻辑风险”小节。
- 在 `EvidenceMap` 给存在偏差风险的边加 warning 状态。

### 6. 证据调制置信度

参考路径：

- `curiocat/graph/belief_propagation.py`
- `curiocat/graph/sensitivity.py`

可迁移点：

- 没证据的边不应贡献高置信。
- 证据分数越低，结论传播越保守。
- 敏感边可以标记为“结论关键依赖”。

落点：

- `src/lib/confidenceEngine.ts`
- `src/lib/spindleCanvasBuilder.ts`
- `src/components/v3/phases/EvidenceMap.tsx`

不建议完整移植 NetworkX / Noisy-OR。Demo 阶段只需要在 FIRE 置信度里体现“证据不足 -> 降低结论强度”。

## 不建议迁移

| CurioCat 模块 | 不建议原因 |
|---|---|
| FastAPI + Postgres + pgvector 全后端 | 当前 demo 是 Vite middleware + 静态部署思路，整体搬迁会拖慢进度。 |
| Brave Search | 评分明确有 360 生态联动，搜索层应坚持 360 AI Search / mwebsearch。 |
| OpenAI/Anthropic provider 主路径 | 国产大模型评分项要求明确，当前主路径应保持 360/StepFun/DeepSeek。 |
| D3 全量图谱 UI | 当前已有 React Flow / 纺锤体画布。借交互概念，不换画布栈。 |
| 多层 discovery 的完整循环 | 很有价值，但 token 和时间不可控。Demo 可做 1 层“补充证据发现”。 |

## 立即开发优先级

### P0-1：证据质量评分升级

目标：把 CurioCat 的 credibility / freshness / diversity 思路接入当前 FIRE 置信度。

建议文件：

- `src/lib/sourceCredibility.ts`
- `src/lib/confidenceEngine.ts`
- `src/lib/schemas.ts`

验收：

- 每个来源有 category、tier、freshness、domain。
- 报告能解释“为什么这个来源可靠/不可靠”。
- 同一域名来源过多时会降低证据完整度。

### P0-2：支持/反驳双向搜索

目标：让 FactChecker 不只找支持材料，也主动找反证。

建议文件：

- `src/lib/search360.ts`
- `src/lib/sherlockStyleSearch.ts`
- `src/lib/graderRules.ts`
- `src/lib/reportComposer.ts`

验收：

- 每个关键子命题至少展示支持证据和反驳证据中的一种。
- 有反证时，结论从“支持”降为“部分支持/存疑/反驳”。
- 证据图谱能区分支持边和反驳边。

### P0-3：逻辑偏差审计

目标：把“事实核查”升级成“证据 + 推理路径核查”。

建议文件：

- 新建 `src/lib/biasAudit.ts`
- 新建或强化 `src/lib/causalValidation.ts`
- `src/components/v3/phases/result/ReportPanel.tsx`
- `src/components/v3/phases/EvidenceMap.tsx`

验收：

- 报告显示至少 3 类逻辑风险。
- 对因果类谣言明确提示“现有证据只能说明相关，不能推出因果”。
- 逻辑风险能影响最终置信度。

## Agent Team 分工建议

| Agent | 任务 | 写入范围 |
|---|---|---|
| Agent A | 证据质量评分升级 | `sourceCredibility.ts`, `confidenceEngine.ts`, `schemas.ts` |
| Agent B | 360 双向搜索策略 | `search360.ts`, `sherlockStyleSearch.ts`, `graderRules.ts` |
| Agent C | 偏差审计与因果校验 | `biasAudit.ts`, `causalValidation.ts`, `reportComposer.ts` |
| Agent D | UI 展示整合 | `ReportPanel.tsx`, `EvidenceMap.tsx`, `ResultWorkspace.tsx` |

主 agent 负责集成和验证：

- `npx tsc --noEmit`
- 至少跑一个健康谣言和一个社会谣言 demo。
- 确认 360 provider 仍然是主路径。

## AgentNetwork 关注点

参考文档：

- https://docs.agentnetwork.org.cn/docs/
- https://docs.agentnetwork.org.cn/docs/getting-started/quickstart-5-min/
- https://docs.agentnetwork.org.cn/docs/concepts/core-concepts/

当前机器上未发现 `anet` CLI，因此本轮不把 AgentNetwork 作为直接运行依赖，只把它作为架构和 demo 叙事参考。

### 对评分项的帮助

| 评分项 | AgentNetwork 可贡献 | 建议采用度 |
|---|---|---|
| 30% 准确性 | 可用“任务生命周期 + 证据包”表达每个 Agent 输出必须有依据，但准确性仍主要来自 360 搜索、证据评分和偏差审计。 | 中 |
| 20% 场景覆盖 | 对谣言类型覆盖帮助不大。 | 低 |
| 20% 结果闭环 | 可把“辟谣卡片、存疑归档、分享”设计成任务完成后的标准动作。 | 中 |
| 10% 技术架构 | 最有价值。可作为多 Agent 身份、协作协议、知识复用、证据留痕的参考架构。 | 高 |
| 10% Agent 能力 | 本身不是模型提供方。需要继续使用 360/StepFun/DeepSeek 等国产模型。 | 低 |
| 10% 360 生态联动 | 不直接贡献。可让 360 搜索/360GPT 成为其中一个 Agent 工具。 | 中低 |

### 可借鉴机制

1. Agent 身份与能力声明

   当前 MVP 的 RumorDetector / FactChecker / SourceValidator / ReportComposer 可以进一步显式声明：

   - 输入契约。
   - 输出契约。
   - 可调用工具。
   - 必须产出的 evidence bundle。
   - 失败或证据不足时的降级策略。

   落点：

   - `src/lib/agentConfigs.ts`
   - `src/lib/agentExpansion.ts`
   - `src/lib/schemas.ts`

2. 任务生命周期

   MissionControlView 已经有执行态 UI，可以把 AgentNetwork 的任务生命周期思想映射为：

   - queued
   - running
   - tool_calling
   - evidence_attached
   - completed
   - needs_review

   落点：

   - `src/components/v3/phases/MissionControlView.tsx`
   - `src/components/v3/phases/mission/StepTimeline.tsx`
   - `src/lib/agentExpansion.ts`

3. 证据包

   每个 Agent 输出不要只返回文本，应返回结构化 evidence bundle：

   ```ts
   export interface AgentEvidenceBundle {
     agentId: string;
     claimIds: string[];
     supportEvidenceIds: string[];
     contradictEvidenceIds: string[];
     confidenceDelta: number;
     unresolvedQuestions: string[];
   }
   ```

   这能同时支撑结果态报告、证据图谱、知识库复用和评委可解释性。

4. 本地多 Agent 集群叙事

   Demo 里可以把当前系统讲成一个“轻量 AgentNetwork-style team”：

   - RumorDetector 负责分类和风险识别。
   - FactChecker 负责事实与反证。
   - SourceValidator 负责来源分级。
   - ReportComposer 负责结论与闭环动作。
   - KnowledgeAgent 负责历史 case 和证据复用。

   不需要现场真的部署 AgentNetwork runtime，也能体现多 Agent 协作架构。

### 不建议现在做

| 动作 | 原因 |
|---|---|
| 临时安装并重构到 AgentNetwork runtime | 风险高，会打断当前已经可跑的 Vite demo。 |
| 把 AgentNetwork 作为评分卖点中心 | 评分更看重准确性、闭环、国产模型、360 生态。AgentNetwork 只能辅助架构叙事。 |
| 替换现有 `requestOrchestrateStream` | 当前 SSE 执行态已经跑通，先强化输出结构，不换运行时。 |

### 对当前开发顺序的调整

原本 CurioCat 导出的 P0 三件事仍然不变，但需要加一个轻量接口层：

1. `AgentEvidenceBundle` 和 `AgentTaskState` 类型先进入 `schemas.ts`。
2. 360 搜索和偏差审计输出都挂到 evidence bundle。
3. MissionControlView 展示每个 Agent 的证据包进度。
4. ResultWorkspace 从 evidence bundle 生成报告引用和图谱节点。

这样做的好处是：既能保住当前 demo 速度，又能在技术架构评分里明确讲出“多个 Agent 同时部署、证据与知识联动”的实现路径。

## 对当前产品叙事的增强

可以把产品从“多 Agent 搜索核查”升级为：

> 一个面向中文互联网传言的证据链 Agent Team：它不只搜索资料，还会拆解断言、检查推理链、寻找反证、识别认知偏差，并把每个 Agent 的证据包沉淀为可复用知识库。

这句话同时覆盖：

- 准确性：证据链 + 反证 + 偏差审计。
- 场景覆盖：中文互联网多类传言。
- 结果闭环：辟谣卡片 / 存疑归档 / 分享。
- 技术架构：Agent evidence bundle + 知识库 + 历史 case 复用。
- Agent 能力：国产模型驱动。
- 360 生态：360 AI Search + 360GPT 作为核心工具 Agent。
