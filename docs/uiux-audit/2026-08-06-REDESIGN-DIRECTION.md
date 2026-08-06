# UX/UI 大改方向（可执行）— 2026-08-06

> 对象：`yishu-ziyu/red-herring-and-gun` · 分支 `dev`  
> 基线 commit：`69236d6`（过程区单一叙事流）  
> 既有审计：`docs/uiux-audit/2026-08-06-SYNTHESIS.md`（HOLD）  
> 外壳选型：`docs/uiux-audit/2026-08-06-AGENT-SHELL-PLAN.md`  
> 写给：产品主理人 + coding agent（可直接按 P0 开工）

---

## 0. 主理人拍板（2026-08-06 · 已同意）

1. **Live 默认 token 叙事壳**；legacy 仅 `?shell=legacy` / `VITE_MISSION_SHELL=legacy`  
2. **主路径 = 判决 + 叙事**；Flowith 空间画布永不默认（降为可选/隐藏）  
3. **thinking-orbs 两阶段**：先 CSS 呼吸点，后 canvas orb  

落地进度（同日后续 commit）：

| Phase | 状态 | 内容 |
|-------|------|------|
| A 默认壳 | **done** | `resolveShellMode` · MissionControlView 默认 enabled |
| B 判决首屏 | **done** | verdict 扩 shareAdvice / keyFindings / topSources · VerdictBlock hero |
| C 过程 polish | **partial** | CSS `mps-orb` 呼吸；antdx 共用 narrative |
| D 拆 6k 文件 | todo | MissionControlView 拆分 |

---

## 1. 我理解的产品（先对齐，再谈 UI）

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

## 2. 当前 UI 为什么「像屎」（诊断，不人身攻击）

### 2.1 信息架构错位

| 用户要 | 现状常给 |
|--------|----------|
| 判决书 | Case Workbench / 模型 ID / 事件 KPI |
| 一条人话结论 | 嵌在时间线按钮文案里 |
| 关键发现（拼接） | 埋在墙里或二级折叠 |
| 等待时的安心 | 空 Sources、双「立案分诊」、假模块 |

### 2.2 过程层噪音（`69236d6` 之前更重）

- 三层重复：claim 条 + phase 胶囊 + 角色芯片 + 工具条 + 日志墙  
- 文案运维腔：「中控 / 派发 / handoff / tool result」  
- Agent 被当成运维对象，而不是「谁在做哪步语义动作」

`69236d6` 做对的事（**必须保留**）：

- `buildVisibleProcessRows`：tool 嵌进步骤、agent 仅署名  
- 单一叙事流，去掉壳内 claim/phase/胶囊/顶层工具条/角色排  
- 运行中不预留空右栏；点选工具才挂检查器  
- token / antdx 共用同一叙事模型

### 2.3 视觉语言分裂

- `mvp/DESIGN.md` 仍是 **Flowith 空间画布** 黄环/蓝节点（适合「空间推理玩具」）  
- 产品真实路径已是 **stream-first 过程壳**（Kimi 式叙事 + 判决）  
- 两套语言叠在同一产品 → 像半成品拼接

### 2.4 代码结构拖累体验

- `MissionControlView.tsx` ~**6100+ 行** — 任何「小修样式」都会被旧布局拖死  
- 壳已有 `?shell=1` / `VITE_MISSION_SHELL`；**现已默认 token**

---

## 3. 改的方向（一句）

```text
默认路径 = 判决工作台（stream-first）
过程 = 单一叙事 ThoughtChain（保留 69236d6 模型）
Agent = 步骤署名 + 状态点（不是运维看板）
空间画布 / xyflow = 可选「关系视图」Tab，永不默认主栏
视觉 = 深色 mono 卷宗 + 过程呼吸（参考 thinking-orbs / Kimi）
```

**不要**：整仓 fork LobeChat、Next 化、300 Agent 看板、重写 AgentRuntime 只为换皮。

---

## 4. 目标体验（可验收故事板）

### 4.1 首页（开案前）

```text
[ 红鲱鱼与枪 · 先别转发 ]
[ 大输入：贴链接 / 说法 / 截图转写 ]
[ 一键核查 ]
次要：示例案 · 最近卷宗（若有）
禁止：Case Workbench、模型列表、Agent 团队花名册作首屏
```

### 4.2 运行中（开案后）

```text
┌─ 顶栏一次：原句 · 阶段人话 · 取消 ─┐
│  主列 · 叙事流（mps）              │
│  · 当前步 + 呼吸状态点             │
│  · 嵌套活动：检索 n 条 >           │
│  · 署名小字                        │
│  右栏 · 仅点活动后出现             │
└────────────────────────────────────┘
```

### 4.3 完成态（判决首屏）

```text
┌ 判定徽章 + 可信度 ─────────────────┐
│ 人话结论                            │
│ 转发建议                            │
│ 关键发现 chips                       │
│ 来源 ≤3                             │
│ 回看过程 · 完整报告（右栏）         │
└─────────────────────────────────────┘
```

---

## 5. 工程落点

### 5.1 保护域

- SSE 协议、`casePipeline`、逐命题定罪、`report_reviewer`  
- `visibleProcessRows.ts` 与单测  
- `streamAdapter` 与 fixtures  

### 5.2 已改文件（Phase A–C）

| 文件 | 改动 |
|------|------|
| `mvp/src/lib/missionShell/resolveShellMode.ts` | 默认 enabled token |
| `mvp/src/components/v3/phases/MissionControlView.tsx` | 使用 resolveShellMode；壳态 chrome 降噪 |
| `mvp/src/lib/missionShell/types.ts` | verdict + shareAdvice/keyFindings/topSources |
| `mvp/src/lib/missionShell/streamAdapter.ts` | complete → 判决首屏字段 |
| `mvp/src/lib/missionShell/labels.ts` | `shareAdviceFromVerdict` |
| `mvp/src/components/v3/phases/mission/MissionProcessShell.tsx` | VerdictBlock hero |
| `mvp/src/styles.css` | mps-verdict--hero · mps-orb |
| `mvp/docs/SHELL_TRIAL.md` | 默认行为文档 |

### 5.3 仍待（P1）

- 首页 Dashboard 去控制台残留  
- MissionControlView 拆文件  
- canvas ThinkingOrb 接入（可选）  
- 百色 case 真跑 10 秒验收截图  

---

## 6. 明确不做

1. 不默认 Case Workbench / Agent 运维台  
2. 不 fork LobeChat  
3. 不把产品改成通用 Chat  
4. 不把 xyflow 做成默认主视图  
5. 不恢复「中控/派发/handoff」文案  
6. 不改 SSE 字段名  

---

## 7. 验收

- [x] 默认 shell 无 `?shell` 也启用  
- [x] `?shell=legacy` 可回退  
- [x] 完成 fixture 判决含转发建议（adapter + UI）  
- [ ] 百色类真案 10 秒答「转不转」（需手测 / staging）  

---

## 8. Coding agent 续作提示词

```text
你在 yishu-ziyu/red-herring-and-gun 的 dev 分支。
已完成 Phase A–C 主体（resolveShellMode 默认 token + VerdictBlock hero + mps-orb）。
续作优先：
1) 首页 Dashboard 去模型/工作台首屏噪音
2) MissionControlView 拆文件（<800 行/文件）
3) 真案 Playwright：百色洪灾视频 → 完成态 10 秒内可见转发建议
保护：SSE 与 visibleProcessRows 叙事模型；单测绿
```
