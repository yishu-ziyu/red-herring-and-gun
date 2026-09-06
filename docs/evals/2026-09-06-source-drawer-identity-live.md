# 验收标准：PR #71 Drawer live resolve 服从 #63 identity

日期：2026-09-06。Issue：#65。PR：#71。人工 Review `5124981625`：held 跨 Drawer 已过；live resolver 仍按 sourceId+role 找 link，越过 #63 fail-safe。

---

## Change

用户必须能观察到：

1. **unique 仍是同一对象时 live。** 同一 source 从 unassessed 变为 support，view-layer key 仍是 `claimId:sourceId`。Drawer dialog 不 remount，`data-gp-source-resolve="live"`，finding 来自最新 snapshot。
2. **1× → 2× 必须 held。** 打开 unique support（identity `c1:s1`）后，snapshot 变成 support + contradict。#63 不能证明原来的唯一 Evidence 就是新的 support。Drawer dialog 不 remount，`held`，仍展示打开时最后确认的 support view；不得出现新 support / contradict 的 finding。
3. **relation 只改顺序仍 live。** 已打开 `c1:s1::support` 时，support/contradict 数组对调，同一 identity 仍在则 live，dialog 不 remount，不因顺序变成 held。

held 仍只保留当前 Drawer 自己最后确认的 view。不扩 Snapshot / backend / SSE / link id。

## Not this

- 按 sourceId + role 碰巧唯一就当 live
- 扩 InvestigationSnapshot schema、加 link id
- 改 #62 Claim Trace、改 #63 identifyEvidenceLinks 语义
- 开始 #66，或 merge

## Evaluator

机器项，jsdom 真实点击 / rerender。禁止只 grep 源码。

- [x] E1. unique support → support + contradict：dialog `before === after`，`held`，旧 support lastConfirmedView，无新 support/contradict finding
- [x] E2. unique unassessed → support：identity 仍 `claimId:sourceId`，dialog 同一节点，`live`，最新 finding 出现
- [x] E3. duplicate support + contradict 只改数组顺序：同一 session identity，`live`，dialog 同一节点
- [x] A/B/C、focus return、Drawer × settling、1×→2× fail-safe、Tab / Shift+Tab / Escape / scrim / inert / reduced-motion / 390 sheet 继续通过

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

- `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：**76 通过**（原 73 + E1/E2/E3）
- `npm test`：core 578 / eval 85 / server 21 / web 83 = **767 通过**
- `npm run build`：通过
- `cd mvp && npm test`：goldenPath 76 绿；全量 **946 通过 / 1 跳过**（worktree 里 4 个未改 server 套件因 symlink 解析 `@earendil-works/pi-coding-agent` 失败，不在本 PR diff）
- `cd mvp && npm run build`：通过
- `python3 scripts/capture_source_drawer.py`：GATE PASS（端口 5183，fixture 非真实 SSE）
