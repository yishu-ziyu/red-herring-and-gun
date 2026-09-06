# 验收标准：[Reset 4E] Source Drawer / Bottom Sheet 生产化：可审计来源下钻

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#65。Parent Issue：#53。Depends on：#61。分支：`feat/reset-4e-source-drawer`。

---

## Change

用户从一条 Evidence 行点进去，看到的是**当前命题 + 这条证据链接 + 这条来源**的审计下钻，而不是一份脱离命题的来源摘要。

用户必须能看见（字段存在才出现）：

1. 来源标题与域名等 metadata
2. 针对哪一条命题（编号 + 命题原文）
3. 原文摘录（exact excerpt，有才显示，没有就不画空框）
4. 为什么这条证据重要（`EvidenceLink.finding`，有才显示）
5. 它不能证明什么（`EvidenceLink.limitation`，有才显示）
6. 来源是否可达、必要时间信息
7. 打开原始网页（`target=_blank` 且带安全 `rel`）

关系词（支持 / 反驳 / 相关材料 / 待核对）永远绑在**当前命题**上，不给来源打全局支持/反驳。

Desktop 1440：右侧 Drawer，约 420–460px，叠在文稿上，不把正文压成难读窄条；打开动作从右边缘进来。
Mobile 390：Bottom Sheet，有合理 max-height，内容可滚动，一条阅读流。

真正的 modal：`role="dialog"` + 可访问名称；打开后焦点进入抽屉；背景不可 Tab 穿透；Tab / Shift+Tab 闭环；Escape 关闭；点 scrim 关闭；关闭后焦点回到**原触发 Evidence 行**。抽屉开着时 snapshot 更新不得抢焦点、不得自动关掉。

Quiet Editorial：无蓝摘录块、无黄 limitation 块、无红绿大底、无 card-on-card、无全大写模板标签。摘录最多极淡中性 inset + 1px 发丝线。颜色只用于链接、焦点和极小关系符号。

---

## Not this

- 不实现 Claim Trace（#62）、Evidence Settling 身份重写（#63）、Conclusion Emergence（#64）
- 不改后端内容生成、不改 SSE、不改 `InvestigationEvidenceLink` 契约
- 不新造 `relevanceReason` 或第三套字段；没有 `finding` / `limitation` / `excerpt` 就省略，不编文案
- 不为手势引入新依赖，不强制拖拽关闭
- 不引入两套 UI 库（本期手写 modal，不加 Base UI / Radix）
- 不把 Source 做成全局 verdict
- 不把 `reachable=false` 做成大红警报墙
- 完成后不开始 #66，不 merge

---

## Evaluator

### 机器项（全绿才交付）

以下 15 项必须是 **jsdom 里真实焦点 / 按键 / 点击行为**，或 Playwright 真实页面测量。**禁止**只用 grep 源码冒充通过。

1. 点击 Evidence 行 → 打开对应该 Claim / EvidenceLink / Source 的 Drawer（标题、命题编号与原文、关系词与当前 `role` 一致）。
2. support / contradict / context-only 三种关系分别正确，且文案绑定当前命题。
3. `finding` 有值才出现「为什么这条证据重要」；无值时整节不渲染。
4. `limitation` 有值才出现「它不能证明什么」；无值时整节不渲染。
5. 没有 `excerpt` 时不出现空摘录容器。
6. `reachable=false` 时有「原始链接目前打不开」类说明，且不把来源改写成已核实结论。
7. 打开后 `document.activeElement` 落在 dialog 内。
8. Tab 在 dialog 内闭环（最后一个可聚焦控件再 Tab 回到第一个）。
9. Shift+Tab 在 dialog 内闭环（第一个可聚焦控件再 Shift+Tab 回到最后一个）。
10. Escape 关闭 Drawer。
11. 点击 scrim 关闭 Drawer。
12. 关闭后焦点回到原触发 Evidence 行（同一 `claimId+sourceId` 的那条）。
13. Drawer 打开期间把 snapshot 换成新对象（同一 `claimId+sourceId` 仍在）→ Drawer 仍开着，焦点仍在 dialog 内。
14. `matchMedia(max-width: 768px)` 为真时，抽屉带 Bottom Sheet 结构标记（`data-gp-placement="sheet"`），且 CSS 为贴底、可滚动、max-height 约束。
15. `prefers-reduced-motion: reduce` 时 Drawer 仍可打开、关、焦点行为不变。

命令：

```bash
cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx
npm test
npm run build
cd mvp && npm test
cd mvp && npm run build
python3 scripts/capture_source_drawer.py
```

### 人评项

- [ ] 灰度后仍能回答：原文是什么、它为什么有关、它不能证明什么、来源在哪里
- [ ] Desktop Drawer / Mobile Sheet 像调查稿上的 UI 层，不像彩色卡片堆
- [ ] 打开动作有明确空间来源（右缘 / 底缘），无弹簧回弹、无逐节 stagger

### Evidence

- 行为测试：`mvp/src/goldenPath/goldenPath.test.tsx` Issue #65 段为真实 focus / keydown / click；Issue #62 Claim Trace 与 Issue #63 Evidence Settling 段仍在。rebase 到 `d6507de` 后含 Drawer×Settling 交叉、duplicate fail-safe、held-view identity（A/B/C），以及 live resolve 服从 #63 identity（E1/E2/E3）
- 截图：`docs/design/2026-09-06-source-drawer/`
  - Desktop 1440：`source-drawer.png`、`source-drawer-no-limitation.png`、`source-drawer-unreachable.png`、`source-drawer-grayscale.png`
  - Mobile 390：`source-sheet.png`、`source-sheet-grayscale.png`
- Playwright：`python3 scripts/capture_source_drawer.py`（端口 **5183**）→ `GATE PASS`
- 截图来源是生产 Golden Path + DEV fixture `/?fixture=source-audit`，**不是**真实 SSE（真实 SSE 属 #66）
- `npm test`：core 578 / eval 85 / server 21 / web 83 = **767 通过**
- `npm run build`：通过
- `cd mvp && npm test`：goldenPath **76** 全绿；全量 **946 通过 / 1 跳过**（worktree 里 4 个未改的 server 套件因 symlink 解析 `@earendil-works/pi-coding-agent` 失败，不在本 PR diff）
- `cd mvp && npm run build`：通过

### 复审（held-view identity）

人工 Review：held fallback 未绑定当前 Drawer identity。已做最小修复：打开时用 exact 点击的 EvidenceLink 建该 Drawer 自己的 `initialView`；`lastConfirmedView` 按 session identity 校验；新打开覆盖 held cache。不扩 Snapshot / backend / SSE / link id。

- [x] A. 首次直接点击 duplicate relation → Drawer 打开且展示被点中那条
- [x] B. 打开 A → 关闭 → 点击 ambiguous duplicate B → 不含 A 的 title / claim / finding / limitation / excerpt
- [x] C. B 可解析打开后 snapshot 无法唯一 resolve → dialog 不 remount、held、B 自己最后确认 view
- [x] D. unique settling live update、1×→2× held、focus return、a11y 继续通过

### 复审（live resolve 服从 #63 identity）

人工 Review `5124981625`：held 跨 Drawer 已过；live 仍按 sourceId+role 找 link，1× unique support → 2× support+contradict 会因「还剩一条 support」错误继续 live。已改为：只有 `identifyEvidenceLinks` 中存在且唯一的 `row.key === drawer.identity` 才允许 live。

- [x] E1. unique support → support+contradict：dialog 同节点、held、旧 support lastConfirmedView，无新 finding
- [x] E2. unique unassessed → support：identity 仍 `claimId:sourceId`、live、最新 finding
- [x] E3. relation 只改数组顺序：同一 identity 继续 live，dialog 不 remount
