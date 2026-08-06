# UX/UI 大改方向（可执行）— 2026-08-06

> 对象：`yishu-ziyu/red-herring-and-gun` · 分支 `dev`  
> 基线 commit：`69236d6`（过程区单一叙事流）  
> 既有审计：`docs/uiux-audit/2026-08-06-SYNTHESIS.md`（HOLD）  
> 外壳选型：`docs/uiux-audit/2026-08-06-AGENT-SHELL-PLAN.md`  
> 写给：产品主理人 + coding agent（可直接按 P0 开工）

---

## 0. 我理解的产品（先对齐，再谈 UI）

**红鲱鱼与枪**不是聊天机器人，也不是「搜索总结」。它是：

> **先别转发，先看证据链。**  
> 把一条半真半假的说法拆成可核查原子 → 多源取证 → 逐条定罪 → 给出 can say / cannot say。

用户真正要的答案只有四层（按优先级）：

| 优先级 | 用户问题 | 产品必须露在一级 |
|--------|----------|------------------|
| 1 | **转不转？** | 判定 + 人话转发建议 |
| 2 | **哪部分真/假？** | 逐命题定罪清单 |
| 3 | **凭什么？** | ≤3 关键来源 + 可展开证据 |
| 4 | **你们查了啥？** | 过程叙事（可折叠回看） |

后端已经能在真案上给出正确结论（如百色洪灾视频 = 外地素材拼接）。  
**死结在暴露层级：把「判决」做成了「刑侦指挥中心直播」。**

今日三方审计一致：**HOLD — 必须改 IA，不是换皮。**

---

## 1. 当前 UI 为什么「像屎」（诊断，不人身攻击）

### 1.1 信息架构错位

| 用户要 | 现状常给 |
|--------|----------|
| 判决书 | Case Workbench / 模型 ID / 事件 KPI |
| 一条人话结论 | 嵌在时间线按钮文案里 |
| 关键发现（拼接） | 埋在墙里或二级折叠 |
| 等待时的安心 | 空 Sources、双「立案分诊」、假模块 |

### 1.2 过程层噪音（`69236d6` 之前更重）

- 三层重复：claim 条 + phase 胶囊 + 角色芯片 + 工具条 + 日志墙  
- 文案运维腔：「中控 / 派发 / handoff / tool result」  
- Agent 被当成运维对象，而不是「谁在做哪步语义动作」

`69236d6` 做对的事（**必须保留**）：

- `buildVisibleProcessRows`：tool 嵌进步骤、agent 仅署名  
- 单一叙事流，去掉壳内 claim/phase/胶囊/顶层工具条/角色排  
- 运行中不预留空右栏；点选工具才挂检查器  
- token / antdx 共用同一叙事模型

### 1.3 视觉语言分裂

- `mvp/DESIGN.md` 仍是 **Flowith 空间画布** 黄环/蓝节点（适合「空间推理玩具」）  
- 产品真实路径已是 **stream-first 过程壳**（Kimi 式叙事 + 判决）  
- 两套语言叠在同一产品 → 像半成品拼接

### 1.4 代码结构拖累体验

- `MissionControlView.tsx` ~**6100+ 行** — 任何「小修样式」都会被旧布局拖死  
- 默认路径仍可能掉进 legacy 流（无 `?shell=1`）  
- 壳已有 `?shell=1` / `VITE_MISSION_SHELL`，但 **默认入口未强制叙事壳**

---

## 2. 改的方向（一句）

```text
默认路径 = 判决工作台（stream-first）
过程 = 单一叙事 ThoughtChain（保留 69236d6 模型）
Agent = 步骤署名 + 状态点（不是运维看板）
空间画布 / xyflow = 可选「关系视图」Tab，永不默认主栏
视觉 = 深色 mono 卷宗 + 过程呼吸（参考 thinking-orbs / Kimi）
```

**不要**：整仓 fork LobeChat、Next 化、300 Agent 看板、重写 AgentRuntime 只为换皮。

---

## 3. 目标体验（可验收故事板）

### 3.1 首页（开案前）

```text
[ 红鲱鱼与枪 · 先别转发 ]
[ 大输入：贴链接 / 说法 / 截图转写 ]
[ 一键核查 ]
次要：示例案 · 最近卷宗（若有）
禁止：Case Workbench、模型列表、Agent 团队花名册作首屏
```

参考气质：thinking-orbs 落地页的 **克制标题 + 单一焦点 + 深底**。

### 3.2 运行中（开案后）

```text
┌─ 顶栏一次：原句（可截断） · 阶段人话（理解/对照/整理） · 取消 ─┐
│                                                                │
│  主列 · 叙事流（mps）                                          │
│  · 当前步标题（语义动作）+ 状态点（loading 用呼吸/点阵）       │
│  · 摘要（人话，无中控腔）                                      │
│  · 嵌套活动：检索公开材料 · 12 条  >  （点开才出检查器）       │
│  · 署名：立案分诊 / 事实核查 …（小字，非主标题）              │
│                                                                │
│  右栏 · 仅在用户点活动后出现（运行中默认不占空栏）             │
└────────────────────────────────────────────────────────────────┘
```

**10 秒内**用户应能说：  
「系统在对照公开材料 / 还没出最终结论 / 关键发现若有会顶上。」

### 3.3 完成态（判决首屏）

```text
┌ 判定徽章：不实 / 部分属实 / … + 可信度分档 ─────────────┐
│ 人话结论（2–4 句，可转发边界）                          │
│ 转发建议：不建议转发 / 可转但须注明…                      │
│ 关键发现 chip：外地素材拼接 · …                          │
│ 来源 ≤3 条可点开                                        │
│ [ 打开完整报告 ]  [ 回看核查过程 · N 步 ]                 │
└─────────────────────────────────────────────────────────┘
```

过程默认折叠；**禁止**结论只活在时间线按钮上。

---

## 4. 视觉系统（替换 Flowith 默认）

### 4.1 Token 方向（mission 区域 scope）

```css
/* 卷宗深色 — 与 thinking-orbs 同族，不绑架全局 Ant 蓝 */
--rh-bg: #070707;
--rh-surface: rgba(217, 217, 217, 0.05);
--rh-panel: #121212;
--rh-text: #fbfbfb;
--rh-muted: rgba(251, 251, 251, 0.55);
--rh-line: rgba(255, 255, 255, 0.08);
--rh-ok: #83e6b0;
--rh-warn: #f5c542;
--rh-bad: #f07178;
--rh-accent: #e8e4d9; /* 暖白点缀，少用彩 */
```

### 4.2 过程状态视觉（对接 multi-agent）

| 产品语义 | 视觉参考 | 实现建议 |
|----------|----------|----------|
| Agent 思考中 | **thinking-orbs** `working/searching/solving…` | 步骤 `status=loading` 旁 20px orb，映射 `AGENT_ACTION` |
| 步骤链 | Ant Design X ThoughtChain 形 | 已有 token 自绘 `mps-chain`，加深呼吸与当前步高亮 |
| 工具结果条 | 可点活动 pill | 保持 69236d6 嵌套 activities |
| 终局判决 | 大卡片，不是 bubble | 强化 `mps-verdict` + 转发建议块 |
| 可选「炫技」 | Midjourney Medical ASCII CRT | **仅** `/shell-preview` 或完成彩蛋，不进主路径 |

**状态 → orb 映射（建议常量）**

| `OrbState`（thinking-orbs） | 本产品步骤 |
|----------------------------|------------|
| `listening` | 收材料 / 用户 claim |
| `shaping` | 命题拆解 / 切入点 |
| `searching` | 原子检索 / 对照公开材料 |
| `working` | 事实核查进行中 |
| `connecting` | 信源评估 |
| `weaving` | 交叉 / 调解 / 冲突 |
| `composing` | 报告收束 |
| `solving` | 逐条定罪 / 审稿 |
| `breathing` | 等待 / 空闲 |

实现路径：**先用 CSS 点阵/呼吸替代**，不必立刻 npm 装 `thinking-orbs`；第二步可 vendoring 2D canvas 组件进 `mvp/src/components/v3/mission/ThinkingStatusOrb.tsx`。

### 4.3 排版

- 正文 Inter / system-ui；代码/ID 才用 mono  
- 步骤标题 15–16px medium；摘要 13–14px muted  
- 判决标题 22–28px；禁止满屏 11px 运维字

---

## 5. 工程落点（coding agent 照此改）

### 5.1 保护域（禁止砍）

- SSE 协议、`casePipeline`、逐命题定罪、`report_reviewer`、排除层、导出  
- `visibleProcessRows.ts` 叙事选择器与单测  
- `streamAdapter` 与 fixtures  

### 5.2 默认入口（P0-A）

| 文件 | 改动 |
|------|------|
| `mvp/src/App.tsx` / mission 路由 | **默认** `shell=token`（或 env 默认 token），legacy 需 `?shell=legacy` |
| `MissionControlView.tsx` | 砍掉默认 Workbench 主信息：模型 ID、Agent Team 花名册、空 Sources 假模块 |

### 5.3 等待屏 / 一级锚点（P0-B）

| 文件 | 改动 |
|------|------|
| `MissionControlView.tsx` 顶栏 | 只保留：原句 + 三态阶段（理解/对照/整理）+ 取消 |
| 关键发现 | 有则 **一级 chip**（含等待预告文案），不得只在报告里 |
| 空态 | Sources 无数据 → 不渲染模块，或「材料汇集中」诚实文案 |

### 5.4 判决首屏（P0-C）

| 文件 | 改动 |
|------|------|
| `MissionProcessShell.tsx` `VerdictBlock` | 扩成：判定徽章 · 人话 · **转发建议** · 关键发现 · ≤3 来源 · 打开报告 |
| 完成态 | 过程默认 `expandAll=false`（已有 fold）；判决永远在过程之上 |

### 5.5 过程壳 polish（P0-D，在 69236d6 上）

| 文件 | 改动 |
|------|------|
| `MissionProcessShell.tsx` | loading 行接入状态点/orb；当前步加强对比 |
| `styles.css` `.mps-*` | 对齐 §4 token；去掉黄环画布感（mission scope） |
| `MissionProcessShellAntd.tsx` | 与 token 共用 narrative，仅渲染差 |

### 5.6 大重构（P1，可并行但别阻塞 P0）

```text
MissionControlView.tsx (6k)
  → 拆：
     MissionChrome.tsx      // 顶栏
     MissionStreamColumn.tsx // 嵌 mps
     MissionInspector.tsx   // 右栏按需
     MissionCompleteHero.tsx // 判决首屏（可复用 VerdictBlock）
```

**验收 case（固定）**：广西百色洪灾视频类 claim  
**验收句**：完成态 **10 秒内**能回答「转不转 + 为何（拼接）」。

---

## 6. 明确不做（防 coding agent 跑偏）

1. 不默认展示 Case Workbench / Agent 运维台  
2. 不 fork LobeChat / 不引入 Vue MateChat  
3. 不把产品改成通用 Chat（Bubble 仅服务核查节奏）  
4. 不把 xyflow 做成默认主视图  
5. 不在过程主标题写 Agent 角色名（角色只署名）  
6. 不恢复「中控/派发/handoff」文案  
7. 不改 SSE 字段名来「迁就 UI」— 只在 adapter/selector 层映射  

---

## 7. 分阶段验收清单

### Phase A — 去控制台化（1 天）

- [ ] 默认 `?shell` 叙事壳  
- [ ] 首屏无模型 ID / 双分诊卡 / 空 Sources 墙  
- [ ] 顶栏仅原句 + 阶段 + 取消  

### Phase B — 判决首屏（1 天）

- [ ] 完成态判决在 fold 之上  
- [ ] 转发建议 + ≤3 来源  
- [ ] 关键发现一级可见  
- [ ] 百色类 case：10 秒答转不转  

### Phase C — 过程 polish（0.5–1 天）

- [ ] loading 呼吸/orb  
- [ ] mps token 深色 mono  
- [ ] 活动条可点出检查器，无空右栏  

### Phase D — 结构拆分（可选 1–2 天）

- [ ] MissionControlView 拆文件，单文件 <800 行  
- [ ] 单测绿：`missionShell/*` + shell UI  

---

## 8. 与今日已有文档的关系

| 文档 | 关系 |
|------|------|
| `2026-08-06-SYNTHESIS.md` | P0 五条 **原样继承**，本文件给落点与视觉 |
| `2026-08-06-AGENT-SHELL-PLAN.md` | 外壳选型不变；执行顺序改为 **A→B→C** 优先于「装更多 antdx」 |
| `SHELL_TRIAL.md` | 预览路径保留；默认 live 应对齐预览质量 |
| `69236d6` | 叙事模型 **冻结为正确方向**；上面只做默认入口 + 判决 + 视觉 |

---

## 9. 给主理人的决策拍板（需要你回一句）

1. **默认壳**：是否同意 live 默认 `token` 叙事壳，legacy 仅 `?shell=legacy`？  
2. **画布**：是否同意 Flowith 空间画布降级为可选 Tab / 隐藏？  
3. **thinking-orbs**：是否接受「先 CSS 呼吸点，后引入 canvas orb」两阶段？  

未拍板前，coding agent 应按 **§5 P0-A→C + §7 Phase A–C** 执行，不碰画布重写。

---

## 10. Coding agent 启动提示词（可复制）

```text
你在 yishu-ziyu/red-herring-and-gun 的 dev 分支工作。
先读：
- docs/PRODUCT_SPEC.md
- docs/uiux-audit/2026-08-06-SYNTHESIS.md
- docs/uiux-audit/2026-08-06-REDESIGN-DIRECTION.md
- mvp/docs/SHELL_TRIAL.md
- mvp/src/lib/missionShell/visibleProcessRows.ts
- mvp/src/components/v3/phases/mission/MissionProcessShell.tsx

硬约束：
1) 不改 SSE 协议与 casePipeline；只改前端暴露层级与样式
2) 保留 buildVisibleProcessRows 叙事模型与单测
3) 默认路径去控制台化 + 判决首屏 + mps polish
4) 验收：百色洪灾视频类 claim，完成态 10 秒内能答「转不转」
5) 提交前 npm test / 相关 vitest 绿；feature flag 可回退 legacy

按 REDESIGN-DIRECTION §7 Phase A → B → C 顺序改，每阶段可独立 commit。
```
