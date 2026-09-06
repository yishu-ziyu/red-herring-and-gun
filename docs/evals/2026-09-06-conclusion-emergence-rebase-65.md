# 验收标准：PR #69 rebase 到 Source Drawer main

日期：2026-09-06。Issue：#64。PR：#69。基线：`main @ 2cdba776ef1558ac23830bb8bf9e2165a6b70fef`（#65 已合入）。不创建新 PR，不开 #66，不 merge。

---

## Change

用户必须能观察到：

1. **investigating 时** `[data-gp-conclusion-region]` 已经存在；**complete 时**还是同一个 DOM node（`before === after`），不是新挂一个 ConclusionHero region。
2. **Source Drawer 已打开**时 investigating → complete：dialog 同一节点、不自动关闭、焦点不被抢；live / held 状态保持正确。特别是已经 `data-gp-source-resolve="held"` 的 Drawer，complete 后仍 held，不因 conclusion 出现而误变 live，held 内容不被替换。
3. **Stable Evidence 已 focus**时 investigating → complete：Evidence DOM 与 EvidenceBoard `before === after`，`document.activeElement` 仍是原 Evidence，Conclusion 不抢 focus。
4. **Claim Trace** 在 complete 前后仍工作：原句内容不变，originalSpan mark 仍在，hover/focus 仲裁不被 Conclusion region 展开破坏。
5. **Conclusion region 本身**：investigating 时 future directAnswer 不进可访问 DOM；complete 后 region `before === after`，directAnswer 才出现；`.gp-canvas` / `.gp-original` / ClaimSection / EvidenceBoard 不 remount；不 auto focus、不 auto scroll。

#62 / #63 / #65 生产语义必须仍在。

## Not this

- 为 Conclusion 把 ClaimSection 恢复成按 group map `EvidenceItem`
- 把 Evidence row 换回普通 `<button>`
- 改掉 DrawerSession identity / exact-click initialView / identity-bound live
- 扩 Snapshot / 加 link id
- typewriter、字符动画、success banner、confetti、auto scroll、auto focus
- 开始 #66，或 merge

## Evaluator

- [x] `git merge-base HEAD origin/main` = `2cdba776ef1558ac23830bb8bf9e2165a6b70fef`
- [x] 源码含 `buildClaimTraceSegments`、`gp-trace-mark`、`hoverClaimId ?? focusClaimId ?? expandedTraceClaimId`、`EvidenceBoard`、`identifyEvidenceLinks`、`DrawerSession` / `buildSourceDrawerViewFromClick` / identity-bound `resolveSourceDrawerView`
- [x] 源码不含 ClaimSection 内 `group.links.map` 渲染 EvidenceItem
- [x] investigating 时 conclusion region 存在；complete 后 region `before === after`；directAnswer 此时才出现
- [x] Drawer 打开（含 held）时 complete：dialog `before === after`、不关、不抢焦点、held 仍 held
- [x] Evidence focus 时 complete：同一 Evidence 节点，焦点仍在，不 `scrollIntoView` / 不 `focus` 结论
- [x] Claim Trace hover/focus 在 complete 后仍工作
- [x] Motion：260–420ms、quick-out、6–10px、reduced-motion 立即完整可读

命令：

```bash
git merge-base HEAD origin/main
cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx
npm test
npm run build
cd mvp && npm test
cd mvp && npm run build
python3 scripts/capture_conclusion_emergence.py
```

人评：视觉不重做。本轮不 merge。截图来源是生产 Golden Path + deterministic fixture，不是真实 SSE。

## Evidence

- merge-base = `2cdba776ef1558ac23830bb8bf9e2165a6b70fef`
- 冲突文件：`docs/NOTES.md`（手工）。`InvestigationCanvas.tsx` / `copy.ts` / `golden-path.css` / `goldenPath.test.tsx` 自动合并：保留 DrawerSession identity-bound live/held，并把 `{complete ? ConclusionHero : null}` 换成 persistent `[data-gp-conclusion-region]`
- `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：**86 通过**
- `npm test`：core 578 / eval 85 / server 21 / web 83 = **767 通过**（一次 callJob 时序 flake 复跑绿）
- `npm run build`：通过
- `cd mvp && npm test`：goldenPath 86 绿；全量 **956 通过 / 1 跳过**（worktree 里 4 个未改 server 套件因 symlink 解析 `@earendil-works/pi-coding-agent` 失败，不在本 PR diff）
- `cd mvp && npm run build`：通过
- `python3 scripts/capture_conclusion_emergence.py`：CAPTURE PASS（端口 5184，fixture 非真实 SSE）
