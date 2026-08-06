# Agent UI 外壳选型 · 执行与验收计划

日期：2026-08-06  
产品：红鲱鱼与枪（Vite + React + SSE Mission Control）  
对标：Kimi 对话节奏 + 集群式 Agent 过程展示  
调研基线：LobeChat / Ant Design X(+Agentic 件) / assistant-ui / MateChat / CopilotKit / React Flow

---

## 1. 一句结论

**不要整仓 fork LobeChat 当外壳。**  
本项目已是 Vite 事实核查流水线 + 自建 SSE/`MissionControlView`（~6k 行）+ 已有 `@xyflow/react`。  
正确做法是：**组件级外壳接入**，用 **Ant Design X 的过程件 +（可选）assistant-ui 原语** 替换「难看/难维护」的过程层，**后端与编排零迁移**。

---

## 2. 你要对齐的 Kimi 能力（可验收）

```text
┌─────────────────────────────────────────────────────────────┐
│  主栏：Phase 叙事（理解 → 对照 → 整理）                      │
│    · 流式出现，不预铺空壳                                    │
│    · 动作条可点：检索公开材料 | n 条 >                        │
├──────────────────────────┬──────────────────────────────────┤
│  集群：人 × 任务           │  右栏：该步 Computer / 材料       │
│  点角色 → 只看该步         │  底栏：角色切换（可选）            │
└──────────────────────────┴──────────────────────────────────┘
完成态：判决 / 报告置顶，过程可回看
```

映射到组件语义：

| Kimi 体验 | 开源对应能力 | 本仓库现状 |
|-----------|--------------|------------|
| 干净对话与流式生成 | Bubble / Stream Markdown / Sender | 有自研流，视觉未达 |
| Think→Act→Observe | ThoughtChain / CoT | `reactTrace` 已进运行时，UI 未产品化 |
| 工具调用条 | ToolUseBar / tool UI | SSE tool_* 有，文案已人话，视觉弱 |
| 多 Agent 并行 | TaskList / Agent cluster / nested thread | 有 agent_cluster 折叠，非 Lobe 群聊 |
| 材料预览 | Workspace / 右栏 | 有，空态已压过 |
| 大规模 Swarm 看板 | 无现成 300 级 | 不追求；核查只需 4–8 角色 |

---

## 3. 候选对比（对本栈）

| 方案 | 类型 | 与 Vite 契合 | Kimi 集群贴合 | 接入成本 | 判定 |
|------|------|--------------|---------------|----------|------|
| **LobeChat / LobeHub** | 完整应用（偏 Next） | 差：整应用 + 自有 runtime | Agent Groups 强，但是别人的产品 | 极高（换壳=换产品） | **不采用作外壳**；可只截交互参考 |
| **Ant Design X** (`@ant-design/x` ~2.9) | React 组件库 | **好** | ThoughtChain、Think、Sender、Bubble 直接对应过程 | 中 | **主选：过程与对话外壳** |
| **assistant-ui** | Headless React 原语 | **好** | 子 Agent 嵌在 tool call 的 nested messages | 中高（要写皮肤） | **次选：工具/嵌套线程原语** |
| **MateChat** | Vue | 不契合 | 研发工具场景好 | — | **排除** |
| **CopilotKit multi-agent canvas** | 框架+画布 | 中 | 动态对话画布思路 | 中高 | 仅参考，不整包 |
| **@xyflow/react** | 图 | **已依赖** | 集群关系图 / 证据图 | 低 | **保留**，做可选「关系视图」非默认主栏 |

---

## 4. 决策（写死）

```text
                    ┌──────────────────────┐
                    │  红鲱鱼核心逻辑不动   │
                    │  SSE / AgentRuntime  │
                    │  report_reviewer 等  │
                    └──────────┬───────────┘
                               │ 事件适配层
           ┌───────────────────┼───────────────────┐
           ▼                   ▼                   ▼
   Ant Design X          现有 stream 状态      xyflow（可选）
   Bubble/Sender/        controllerEvents      证据/角色关系
   ThoughtChain/         agent_cluster
   Think/附件区          tool_result
```

1. **主选外壳组件：Ant Design X**  
   - 用其「过程可视化」替换 Mission Control 左栏过程条的视觉实现。  
   - **不**引入 Ant 全站主题绑架：可只装 `@ant-design/x`，样式 scope 在 mission 区域。  
2. **可选补强：assistant-ui**  
   - 仅当需要「工具调用内嵌子对话线程」时引入；核查流水线若始终是扁平 SSE，可第二阶段再上。  
3. **禁止：整仓 fork LobeChat**  
   - 与事实核查 DAG、卷宗 IA、stream-first 决策冲突；维护成本 > 视觉收益。  
4. **集群规模目标：5–12 角色**，不是 300 Swarm；并行用列表/芯片 + 点选下钻即可。

---

## 5. 执行阶段（做什么 / 怎样算完）

### Phase 0 · 钉死适配契约（0.5–1 天）

**做什么**

- 定义 `MissionStreamAdapter`：  
  `OrchestrateStreamEvent[]` → Ant Design X 能吃的结构  
  - `agent_start/complete` → ThoughtChain 节点 / Task 项  
  - `tool_start/result/error` → Tool 条（title/status/detail）  
  - `report_reviewer` → 独立「审稿」节点  
  - `complete` → 判决卡片数据  
- 文档化字段表 + 3 条假 SSE fixture。

**怎样算完**

- [ ] 纯函数 adapter 有单测：给定 1 段 fixture，输出稳定的 chain 节点数与 tool 数  
- [ ] 不改后端 SSE 协议

### Phase 1 · 过程外壳（1–2 天）· **MVP 必做**

**做什么**

- 新建 `MissionProcessShell`（新文件，禁止继续膨胀 6k 行主文件）：  
  - 左：`ThoughtChain` / 等价过程链（映射现有 transcript）  
  - 中/主：流式叙事 + 动作条（检索 n 条）  
  - 右：点角色后的材料/Computer（沿用现有数据）  
- 样式：oklch + 现有 `styles.css` token；**克制留白**，不抄 Ant 默认蓝紫皮肤。  
- feature flag：`VITE_MISSION_SHELL=antdx|legacy`，默认可先 antdx。

**怎样算完**

- [ ] 硬刷新后跑 1 案：过程**随 SSE 生长**，开跑时无整页空壳墙  
- [ ] 出现工具条：检索 / 记忆 / **报告审稿** 人话标题  
- [ ] 点「协作核查」某一角色，右栏只显示该步  
- [ ] `legacy` 可回退  
- [ ] 无新增全局 antd 污染首页/落地页（scoped）

### Phase 2 · 对话与生成节奏（1 天）

**做什么**

- 首页输入 + 结果页摘要用 X 的 `Sender` / `Bubble` / Markdown 流式（若 X Markdown 合适）  
- 保持事实核查「卷宗/判决」信息架构，不把产品改成通用聊天

**怎样算完**

- [ ] 流式 token/阶段切换有节奏（motion 已有 framer-motion，可轻用）  
- [ ] 完成态判决仍置顶，不输给聊天气泡

### Phase 3 · 集群增强（可选，1 天）

**做什么**

- 默认：角色芯片/列表集群（Kimi 式）  
- 可选 Tab：`@xyflow/react` 画「分诊→核查→审稿」边（不是默认主视图）  
- 若要 nested 子线程：再评估 assistant-ui `ToolCallMessagePart.messages`

**怎样算完**

- [ ] 4–8 Agent 并行态一眼可读（running/done/fail）  
- [ ] 不出现 12+ 假角色凑数

### Phase 4 · 不做清单（防跑偏）

- 不迁移到 Next.js / 不引入 Lobe 全套 agent-runtime  
- 不把 MateChat（Vue）混进 React  
- 不追求 300 Agent 看板  
- 不重写 `AgentRuntime` 只为换 UI

---

## 6. 验收协议（你试用时点这些）

### A. 视觉 / IA（对照 Kimi，不抄业务）

| # | 操作 | 期望 |
|---|------|------|
| A1 | 打开本地 `http://127.0.0.1:5180/`，新开一案 | 主工作区几乎空，随后事件生长 |
| A2 | 看中段过程 | 有清晰阶段文案，不是 SSE 原始 dump |
| A3 | 点工具结果「检索公开材料」类 | 有条数/摘要，可展开，不像运维日志 |
| A4 | 点某个 Agent | 右栏只出现该步材料与输出 |
| A5 | 跑完 | 判决/报告在显眼位置；可见「报告审稿 · 通过/需补证」 |

### B. 工程

| # | 检查 | 期望 |
|---|------|------|
| B1 | `npm run build`（或至少 mission 路径无红错） | 通过 |
| B2 | feature flag 关外壳 | 旧 UI 可回退 |
| B3 | 依赖体积 | 仅 mission 路径加载 antdx（动态 import 优先） |
| B4 | 无 secrets / 无把 vendor chat 整仓提交 | git 干净策略遵守 |

### C. 产品边界

| # | 检查 | 期望 |
|---|------|------|
| C1 | 仍是事实核查，不是通用 Chat | 首页 claim 入口在 |
| C2 | 书本 Agent 能力（审稿/状态栏/skills）不因换皮丢失 | SSE 仍出 `report_reviewer` |

---

## 7. 建议排期（现实）

| 顺序 | 产出 | 停下来看 |
|------|------|----------|
| 今天–明天 | Phase 0 adapter + fixture 单测 | fixture 绿 |
| +1–2 天 | Phase 1 MissionProcessShell + flag | A1–A5 你手测 |
| 再 +1 天 | Phase 2 生成节奏 | 观感对齐 |
| 有余力 | Phase 3 可选图 | 非阻塞 |

---

## 8. 依赖安装（Phase 1 开工时）

```bash
cd mvp
npm i @ant-design/x antd @ant-design/icons
# 若用 X Markdown（按文档需要再加）
# npm i @ant-design/x-markdown
```

动态 import 示例原则：仅在 `MissionControlView` / shell 入口加载，避免污染 landing。

---

## 9. 风险

| 风险 | 处理 |
|------|------|
| Ant 默认皮肤与卷宗审美冲突 | token 覆盖 + 只取组件行为不取默认色板 |
| MissionControlView 过大难改 | 新 shell 旁路，adapter 喂数据，旧文件只接线 |
| Lobe 视觉诱惑导致大迁移 | 本文件 §4 禁止项 |
| assistant-ui 与自有 SSE 模型不一致 | 第二阶段再引入，先 adapter 稳定 |

---

## 10. 下一步（唯一）

**确认本计划后执行 Phase 0：**  
实现 `MissionStreamAdapter` + 3 条 SSE fixture 单测，**不改视觉**。  
你确认「主选 Ant Design X、禁 Lobe 整仓」即可开工。


## 执行记录

- 用户确认 **A**（Ant Design X 过程层）。
- 半小时线延长至 **1 小时**（至约 20:12）。
- Phase 0 完成：`mvp/src/lib/missionShell/`。
- Phase 1 壳：`MissionProcessShell` + `/shell-preview`；实包 `@ant-design/x` 已安装；当前壳为 token 自绘对齐 X 形状，待 ThoughtChain 原生替换。
- 直播：`?shell=1` 或 `VITE_MISSION_SHELL=antdx`。
