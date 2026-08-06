# UI Finish Gate — 红鲱鱼与枪（广西百色洪灾谣言链路）

**日期：** 2026-08-06  
**审查角色：** UI Finish-Gate Reviewer（agency-agents `design-ui-finish-gate-reviewer`）  
**证据：** `mvp/output/uiux-audit/01`–`06*.png` + `2026-08-06-evidence.md`  
**活路径：** 网传广西百色严重洪灾视频是否可信（要不要在微信群转发）

---

## Decision: **HOLD**

第一视口与主工作流都在讲「多 Agent / 工具调用 / 模型在跑」，不在讲「这条谣言现在信不信」。  
对普通中文用户（微信群要不要转）而言，这是 **agent ops 控制台 + 营销落地页**，不是 **案卷 / 调查台**。  
禁止用 PASS 软化。

本轮真跑后（约 4 分 35 秒）后台已产出正确结论：
「网传广西百色遭遇严重洪水灾害的说法不实……相关视频实为外地素材拼接」。
结论内容 OK；**呈现层仍 HOLD**：结论埋在时间线条目与右栏长文，首读仍是 Case Workbench / 事件流 / Agent Team。

---

## Critical findings（不修不能过闸）

### C1. 首读对象错位：工具/Agent 盖过「原句 + 判定」
- 必须：案卷头 = 原句摘要 · 判定徽章 · 一句人话
- 验收：mid 截图不滚动即可读原句 + 判定/线索位

### C2. 关键发现被埋；异案污泥与空 Findings
- 必须：关键发现条升一级；异案不得混主发现
- 验收：广西链路「外地素材拼接」可被指认为主标题级

### C3. 工作台语言是运维台，不是中文案卷
- 必须：去掉默认 CASE WORKBENCH / 子 Agent / Parallel Search / 模型 ID
- 验收：主路径无必读工程英文

### C4. 重复与噪声当主 UI
- 必须：消双标题、双同名 Agent、工具墙
- 验收：同屏无重复主标题

### C5. 首页卖多 Agent 流水线，不卖「查完能不能转」
- 必须：首屏围绕粘贴 + 决策价值
- 验收：3 秒能说出「这是查谣言的」

### C6. 等待态推向重跑，不推向已有证据
- 必须：等待 = 线索态
- 验收：>30s 主区至少 1 条中文线索

### C7. DESIGN.md 深色 canvas vs 活 UI 浅色 workbench 契约分裂
- 必须：统一为 claim→evidence→verdict 案卷 IA

---

## Design Contract（摘要）

User job: 粘贴网传 → 判断信/转。  
First-read: 原句 + 判定徽章。  
Hierarchy: 判定 → 关键发现 → 来源 → 推理摘要(折叠) → 工具/模型(折叠)。  
Forbidden: CASE WORKBENCH 主文案、供应商墙、KPI 事件流作首读、双语 THINKING/HANDOFF 默认、异案混排、空 Findings 占位。

---

## VERDICT

**HOLD** — 不是差润色，是主路径主角选错：现在是 Agent/工具，应是原句与判定。
