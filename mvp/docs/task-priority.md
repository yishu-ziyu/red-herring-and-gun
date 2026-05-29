# 真探 Agent —— 任务优先级清单（赛道三冲刺版）

> 目标：在演示前完成所有能拿分的功能，按 ROI（投入产出比）排序。

---

## 评分维度回顾

| 维度 | 权重 | 当前预估得分 | 满分策略 |
|------|------|-------------|---------|
| 准确性评估 | 30% | ~5/30 | 接入真实 LLM，确保 4 个 Agent 独立调用 |
| 场景覆盖 | 20% | ~15/20 | 维持 4 类 + 增加政治/娱乐类 |
| 结果闭环 | 20% | ~8/20 | 导出报告 + 复制摘要 + 继续追问 |
| 技术架构 | 10% | ~3/10 | localStorage 记忆 + 知识库复用 |
| Agent 能力（国产模型） | 10% | ~0/10 → **已完成** ✅ | StepFun step-3.7-flash 已接入 |
| 360 生态联动 | 10% | ~0/10 | 360 搜索 API 或 360 AI 浏览器插件 |

---

## 任务总览图

```
P0 ──┬── [T1] StepFun 端到端测试验证
     └── [T2] 准确性兜底（Demo Fallback 兜底逻辑优化）

P1 ──┬── [T3] 记忆/知识库机制（localStorage）
     ├── [T4] 结果闭环动作（导出/复制/追问）
     └── [T5] 增加场景覆盖（政治/娱乐/历史类谣言）

P2 ──┬── [T6] 360 搜索 API 联动
     ├── [T7] Agent 间上下文优化（传递更多上下文）
     └── [T8] 前端交互抛光（动画/响应式/可访问性）
```

---

## P0 —— 必须在演示前完成（阻塞项）

### [T1] StepFun step-3.7-flash 端到端测试验证

**状态**: StepFun API curl 已验证；端到端深度核查流程仍需在 dev server 中验证。

**安全约束**: API key 只能放在本地 `.env.local` 或 shell 环境变量中，不能硬编码进 `vite.config.ts`、文档或 Git。

**验收标准**:
- [ ] 启动 `npm run dev`，输入一条自定义 claim，点击"深度核查"
- [ ] MissionControl 页面显示 `model: stepfun:step-3.7-flash`
- [ ] 4 个 Agent 依次执行（RumorDetector → FactChecker ∥ SourceValidator → ReportComposer）
- [ ] 每个 Agent 返回真实 JSON 输出（非 demo-fallback）
- [ ] 总耗时在 15-60 秒之间
- [ ] 控制台无报错，网络请求无 4xx/5xx

**如果 StepFun 调用失败**:
- 检查 API key 是否有效（curl 测试）
- 检查 reasoning_effort 参数是否被 StepFun 接受
- 检查 JSON 输出格式是否正确解析
- 如果 StepFun 不可用，回退到 DeepSeek/MiMo（但国产模型分会丢）

**测试命令**:
```bash
curl -s https://api.stepfun.com/v1/chat/completions \
  -H "Authorization: Bearer $STEPFUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"step-3.7-flash","messages":[{"role":"user","content":"你好"}]}'
```

**关联文件**:
- `vite.config.ts` — `callStepFunAgent` 函数
- `src/lib/agentConfigs.ts` — Agent system prompts

---

### [T2] Demo Fallback 兜底逻辑优化

**问题**: 当前当 StepFun 调用失败时，会回退到 Demo fallback，返回模拟数据。用户无法区分是真实结果还是模拟结果。

**状态**: 已完成最低可见化：fallback 输出包含 `_source: "demo-fallback"`，MissionControl Agent 卡片在 fallback 时显示灰色虚线和“模拟模式”。Dashboard API 可用性检测仍可后续补。

**验收标准**:
- [ ] Demo fallback 输出中明确标注 `"_source": "demo-fallback"`
- [ ] MissionControl 页面显示 `model: demo-fallback` 时，Agent 卡片边框变为虚线或灰色
- [ ] 用户能一眼看出当前是模拟模式还是真实模式
- [ ] 如果 API key 无效，Dashboard 显示警告提示

**实现方案**:
1. 修改 `buildOrchestrateDemoFallback`，在所有输出中添加 `_source: "demo-fallback"`
2. 修改 `AgentCard.tsx`，当 `model` 包含 "demo-fallback" 时，显示特殊样式
3. 在 `Dashboard.tsx` 顶部添加 API 可用性检测（可选）

**关联文件**:
- `vite.config.ts` — `buildOrchestrateDemoFallback` 函数
- `src/components/v3/phases/mission/AgentCard.tsx`

---

## P1 —— 高价值，能显著提升评分（建议优先做）

### [T3] 记忆/知识库机制（localStorage）

**评分要求**: "Agent 是否有记忆机制和知识库机制，用来存储已识别正确的数据，类似数据是否可以进行数据复用"

**验收标准**:
- [ ] 核查完成后，结果自动保存到 localStorage（claim + 结论 + 时间戳）
- [ ] 再次输入相同或高度相似的 claim，直接返回缓存结果，不再调用 LLM
- [ ] Dashboard 显示"历史核查记录"入口
- [ ] 历史记录页可查看过往核查结果
- [ ] 缓存结果显示"来自历史记录"标签

**实现方案**:
1. 新增 `src/lib/knowledgeBase.ts`
   ```typescript
   interface VerifiedClaim {
     id: string;
     claim: string;
     claimHash: string; // 简化后的 claim hash
     conclusion: string;
     credibilityScore: number;
     timestamp: number;
     steps: HandoffStep[];
   }
   
   export function saveToKnowledgeBase(result: HandoffResult): void;
   export function findInKnowledgeBase(claim: string): VerifiedClaim | null;
   export function getKnowledgeBase(): VerifiedClaim[];
   export function clearKnowledgeBase(): void;
   ```

2. 修改 `App.tsx` 的 `handleStartAnalysis`
   - 先查 knowledge base，命中则直接跳到 result 页
   - 未命中才调用 `requestOrchestrateStream`

3. 新增历史记录组件 `src/components/v3/HistoryPanel.tsx`
   - 显示过往核查列表
   - 点击可重新查看报告

**关联文件**:
- 新增: `src/lib/knowledgeBase.ts`
- 新增: `src/components/v3/HistoryPanel.tsx`
- 修改: `src/App.tsx`
- 修改: `src/components/v3/Dashboard.tsx`

---

### [T4] 结果闭环动作（导出/复制/追问）

**评分要求**: "是否有闭环动作以及闭环是否完整"

**验收标准**:
- [ ] "导出报告"按钮：生成 Markdown/PDF 格式的核查报告并下载
- [ ] "复制摘要"按钮：一键复制 `summaryForPublic` 到剪贴板
- [ ] "继续追问"按钮：在结果页打开输入框，基于当前报告继续提问
- [ ] 追问触发新的 Agent 调用，追加到当前报告中

**实现方案**:
1. **导出报告**:
   ```typescript
   function generateReportMarkdown(handoffResult: HandoffResult): string;
   function downloadMarkdown(filename: string, content: string): void;
   ```
   - Markdown 包含：原始 claim、可信度评分、结论、每个 Agent 的详细分析

2. **复制摘要**:
   ```typescript
   await navigator.clipboard.writeText(summaryForPublic);
   // 显示 toast 提示"已复制到剪贴板"
   ```

3. **继续追问**:
   - 在 ResultWorkspace 底部添加输入框
   - 用户输入问题后，调用 `/api/agent/orchestrate` 追加分析
   - 追加到当前 `handoffResult.steps` 末尾
   - 显示新的 Agent 分析结果

**关联文件**:
- 修改: `src/components/v3/phases/ResultWorkspace.tsx`
- 新增: `src/lib/reportExporter.ts`（扩展）
- 修改: `src/components/v3/phases/result/ReportPanel.tsx`

---

### [T5] 增加场景覆盖（政治/娱乐/历史类谣言）

**评分要求**: "至少满足 3 类谣言的精准识别，越多分值越高"

**当前**: 4 类（健康、社会、科技、财经）
**目标**: 6-8 类

**新增案例**:

| 类型 | 标题 | 谣言特征 |
|------|------|---------|
| 政治 | "某国领导人秘密访问某国，签署秘密协议" | 匿名信源、阴谋论、无法验证 |
| 娱乐 | "某明星离婚内幕曝光，经纪人证实" | 匿名爆料、情绪煽动、无权威来源 |
| 历史 | "历史教科书被篡改，真相被掩盖" | 阴谋论、模糊引用、无证据 |

**验收标准**:
- [ ] Dashboard 显示 7 个 Demo 案例卡片
- [ ] 每个案例都有"快速分析"和"深度核查"两个入口
- [ ] 快速分析使用 Demo pipeline，深度核查使用 StepFun

**关联文件**:
- 修改: `src/components/v3/Dashboard.tsx` — `DEMO_CASES` 数组
- 修改: `src/lib/pipeline.ts` — 新增 case 数据

---

## P2 —— 锦上添花，时间充裕时做

### [T6] 360 搜索 API 联动

**评分要求**: "是否可以和 360 生态进行联动，满足一个产品联动，此项得满分"

**方案 A: 360 搜索 API**（推荐，最容易实现）
- 在 `FactChecker` Agent 的 system prompt 中说明："你可以使用 360 搜索来验证 claim 中的事实"
- 如果 360 有搜索 API，在 `callStepFunAgent` 之前调用 360 搜索获取结果
- 将搜索结果作为 context 传递给 StepFun

**方案 B: 360 AI 浏览器插件**（更亮眼，但复杂）
- 用户选中网页中的文字，右键"用真探 Agent 核查"
- 需要开发浏览器插件

**验收标准（方案 A）**:
- [ ] FactChecker Agent 输出中包含"360 搜索结果"来源
- [ ] MissionControl 显示"已联动 360 搜索"
- [ ] 结果报告中标注 360 搜索来源

**关联文件**:
- 新增: `src/lib/360Search.ts`（或修改 `vite.config.ts`）
- 修改: `src/lib/agentConfigs.ts` — FactChecker system prompt

---

### [T7] Agent 间上下文优化

**问题**: 当前 Agent 间传递的上下文有限，ReportComposer 只能看到前序 Agent 的输出摘要。

**优化方案**:
- RumorDetector → FactChecker: 传递 `rumorIndicators`、`severity`、`analysis`
- RumorDetector → SourceValidator: 传递 `rumorIndicators`
- FactChecker → ReportComposer: 传递 `factCheckResult`、`confidence`、`keyFindings`、`sources`
- SourceValidator → ReportComposer: 传递 `sourceReliability`、`verifiedSources`、`questionableSources`

**验收标准**:
- [ ] ReportComposer 的 `buildAgentInput` 包含所有前序 Agent 的详细输出
- [ ] ReportComposer 的结论基于完整上下文，而非摘要

**关联文件**:
- 修改: `src/lib/agentConfigs.ts` — `buildAgentInput` 函数

---

### [T8] 前端交互抛光

**目标**: 让演示更流畅、更美观

**清单**:
- [ ] 输入态：文本框 placeholder 动画（打字机效果）
- [ ] 执行态：Agent 切换时的平滑过渡动画
- [ ] 执行态：步骤完成时的对勾动画
- [ ] 结果态：报告生成时的淡入动画
- [ ] 全局：添加 Toast 提示（操作成功/失败）
- [ ] 全局：添加加载骨架屏
- [ ] 全局：键盘快捷键（Enter 提交，ESC 取消）

**关联文件**:
- 修改: `src/styles.css`
- 修改: 各 phase 组件

---

## 执行顺序建议

### 第一阶段（今天）—— P0 + T3
1. **[T1]** 启动服务器，验证 StepFun 真实调用
2. **[T2]** 如果 StepFun 有问题，修复；如果正常，标记完成
3. **[T3]** 实现 localStorage 记忆机制（2-3 小时）

### 第二阶段（明天）—— T4 + T5
4. **[T4]** 实现导出/复制/追问闭环（3-4 小时）
5. **[T5]** 增加 3 个新场景案例（1 小时）

### 第三阶段（后天）—— T6 + T8
6. **[T6]** 360 搜索 API 接入（如果有 API key）
7. **[T8]** 前端交互抛光（2-3 小时）

---

## Codex 分工建议

由于 Codex 适合并行处理独立任务，可以将以下任务拆分为独立的 Codex prompt：

**Codex Prompt A**: 实现 [T3] 记忆/知识库机制
- 输入：当前 `App.tsx`、`reasoningStore.tsx`、需要的接口定义
- 输出：`knowledgeBase.ts`、`HistoryPanel.tsx`、修改后的 `App.tsx`

**Codex Prompt B**: 实现 [T4] 结果闭环动作
- 输入：当前 `ResultWorkspace.tsx`、`ReportPanel.tsx`
- 输出：导出报告功能、复制摘要功能、继续追问功能

**Codex Prompt C**: 实现 [T5] + [T6] 场景扩展 + 360 联动
- 输入：当前 `Dashboard.tsx`、`agentConfigs.ts`
- 输出：新增 Demo 案例、360 搜索 API 调用

**Codex Prompt D**: 实现 [T8] 前端交互抛光
- 输入：当前 `styles.css`、各组件
- 输出：CSS 动画、Toast 组件、骨架屏

---

## 风险预警

| 风险 | 概率 | 影响 | 预案 |
|------|------|------|------|
| StepFun API 调用失败 | 中 | 致命（丢 10 分国产模型分） | 回退到 DeepSeek（国产，但效果可能不如 StepFun） |
| StepFun 输出 JSON 格式不稳定 | 中 | 高（导致解析失败） | 加强 system prompt 约束，添加重试逻辑 |
| 演示时网络不稳定 | 高 | 高（所有 API 调用失败） | 预加载几个 Demo 案例的真实结果到 localStorage |
| 360 API 无法获取 | 高 | 中（丢 10 分） | 用 360 搜索网页版作为 fallback |
| 时间不够做完所有 P2 | 高 | 低 | P2 可放弃，P0+P1 已足够拿 70+ 分 |

---

*文档生成时间: 2026-05-29*
*下次更新: 完成 T1 验证后*
