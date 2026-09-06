# 验收标准：PR #71 Source Drawer held-view identity

日期：2026-09-06。Issue：#65。PR：#71。人工 Review blocker：held fallback 未绑定当前 Drawer identity。

---

## Change

用户必须能观察到：

1. **首次直接点击 duplicate relation**：同一 `sourceId` + 同一 `role` 有两条 relation，但 finding / limitation 可区分。点击其中 B 后，Drawer 打开，展示 B 的 finding / limitation，不展示 A。
2. **禁止跨 Drawer 串数据**：先打开 Source A 并关闭，再点击无法唯一 resolve 的 duplicate Source B。B 的 Drawer 不得出现 A 的 title、claim、finding、limitation、excerpt。
3. **B 自己进入 held**：打开可明确解析的 B 后，snapshot 更新使 B 无法唯一解析。dialog 不 remount；`data-gp-source-resolve="held"`；展示 B 自己最后一次已确认 view；不回退 A。
4. **原有交叉行为仍在**：unique unassessed → support 时 dialog `before === after`、底层 stable Evidence `before === after`、relation/finding 来自最新 snapshot、close 后焦点回原 trigger、1× → 2× 不猜 relation、Tab / Shift+Tab / Escape / scrim / inert / reduced-motion / 390 Bottom Sheet。

held 可以保留**当前这个 Drawer 自己**最后确认的 view。新打开一个 Drawer 必须覆盖 / 重置 held cache。用户刚点击的 exact EvidenceLink 就是这一刻的 initial view，不得先丢掉再去 unique resolve。

## Not this

- 重新设计 Source Drawer
- 改 #62 Claim Trace
- 改 #63 Evidence Settling 的 identity 语义
- 扩 InvestigationSnapshot schema / backend / SSE / link id contract
- 用出现序号或猜测把 duplicate relation 假装成跨 snapshot 同一对象
- 开始 #64 / #66，或 merge

## Evaluator

机器项，全部在 jsdom 真实点击 / 焦点 / rerender 上检查，禁止只 grep 源码。

- [x] A. 同一 `sourceId` + 同一 `role` 两条可区分 relation，直接点击 B → Drawer 打开且只展示 B 的 finding / limitation
- [x] B. 打开 A → 关闭 → 点击 ambiguous duplicate B → B Drawer 不含 A 的 title / claim / finding / limitation / excerpt
- [x] C. 打开可解析的 B → snapshot 变为无法唯一解析 → 同一 dialog 节点、`held`、B 自己最后确认 view，不含 A
- [x] D. 原有 unique settling live update、1×→2× held、dialog no-remount、focus return、a11y 15 项继续通过

命令：

```bash
cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx
npm test
npm run build
cd mvp && npm test
cd mvp && npm run build
python3 scripts/capture_source_drawer.py
```

人评：无新增视觉项。本轮不 merge。

## Evidence

- `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：**73 通过**（原 70 + A/B/C）
- `npm test`：core 578 / eval 85 / server 21 / web 83 = **767 通过**
- `npm run build`：通过
- `cd mvp && npm test`：goldenPath 73 绿；全量 **943 通过 / 1 跳过**（worktree 里 4 个未改 server 套件因 symlink 解析 `@earendil-works/pi-coding-agent` 失败，不在本 PR diff）
- `cd mvp && npm run build`：通过
- `python3 scripts/capture_source_drawer.py`：GATE PASS（端口 5183，fixture 非真实 SSE）
