# 验收标准：PR #72 / Issue #66 第三次真实生产验收（post-#76 source identity）

日期：2026-09-06。人工指令：PR #72 comment `#issuecomment-5559892238`。#76 / PR #77 已 squash-merge 进 `main` `f009d34f0303fd3512d6df0fda40135fd88db7fa`。

本文件是这一次的完成尺度，独立于实现。上一轮 post-#74 验收仍在 `docs/evals/2026-09-06-mode3-production-integration.md`。

---

## Change

同一句真实输入再走一次生产 SSE。用户必须能观察到：

至少一条 Evidence 同时满足：

- 同一 Claim
- 同一规范化 URL
- 同一 `InvestigationSource.id`
- `unassessed → support | contradict | context-only`
- 该 Evidence 的真实 DOM 节点 `before === after`（strict equality，不是比较 `data-source-id`）

并且此前已通过的正确性不回归：#74 stance、dual-bucket citation、#62 Claim Trace、#63 duplicate 规则、#65 Source Drawer、#64 Conclusion Emergence。

三次真实 specimen 都保留，不覆盖：

1. `final/real/` = pre-#74 stance failure
2. `final/real-after-74/` = stance 已修，source-id instability
3. `final/real-after-76/` = stance 已修，source identity 已修，REAL Evidence Settling verified

## Not this

- 覆盖 `final/real/` 或 `final/real-after-74/`
- 只用 `(claimId, sourceId)` 判断 transition
- URL heuristic 在前端补 continuity
- replay 假装 live
- fixture 冒充真实 SSE
- shared-layout clone
- `gate.json = PASS` 但 `settling-dom.json` 的 `same: false`
- `sourceIdsStable=false` 仍 PASS
- sourceId 前后映射不同 URL 仍 PASS
- 同 URL 的 sourceId 改变仍 PASS
- 没有真实 same URL + same id 的 `unassessed→role` 仍 PASS
- 改 vercel.json / Root Directory / Build Command / Output Directory
- merge #72、关闭 #53、启动 #54

## Evaluator

机器项（全绿才交付）：

- [ ] Q1 `git fetch origin && git rebase origin/main`。`git merge-base HEAD origin/main` = `f009d34f0303fd3512d6df0fda40135fd88db7fa`。
- [ ] Q2 旧 `final/real/` 与 `final/real-after-74/` 仍在，字节未被这次 run 覆盖。
- [ ] Q3 `scripts/capture_mode3_production_real.py` 显式调用 `scripts/investigation_source_identity_gate.py` 的 `evaluate_source_identity_gate`（或等价导出）。禁止继续只用 `(claimId, sourceId)` 认 transition。
- [ ] Q4 同一句 `维生素C能治感冒，而且每次感冒都应当输液。` 真实 `POST /api/agent/orchestrate-stream` SSE。产物只写 `final/real-after-76/`。
- [ ] Q5 身份门禁：`sourceIdsStable=true`；至少一条 semantic transition（same claim + same normalized URL + same sourceId + unassessed→settled role）。任一冲突、`sourceIdsStable=false`、找不到该 transition，`gate.json.ok` 必须为 false。
- [ ] Q6 DOM：对该条 Evidence，直播或同次 JSON 回放生产组件的节点 `before === after`（strict equality）。`settling-dom.json.same` 必须为 true。gate PASS 不得与 `same:false` 并存。
- [ ] Q7 #74：claim-2 反向材料不得 `role=support`；finding / excerpt / role / judgment 方向一致。
- [ ] Q8 dual-bucket：若出现 support + contradict，citation 不丢，relation 不因同 URL 被吞。
- [ ] Q9 #62 originalSpan exact；无 span 诚实 no-trace。#63 stable / relation / ephemeral 不退化。#65 live/held + Tab / Shift+Tab / Escape / focus return。#64 region / original / claim / board 不 remount，不 auto-scroll，不 auto-focus。
- [ ] Q10 Desktop 1440、Mobile 390、grayscale、reduced motion、keyboard / focus、motion evidence 落在 `final/real-after-76/`。SOURCE.md 写清三次真实运行。
- [ ] Q11 `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`；根 `npm test`；`cd mvp && npm test`；根 `npm run build`；`cd mvp && npm run build`。
- [ ] Q12 未改 #58 配置。只确认 PR #72 Preview Ready。
- [ ] Q13 完成后停止。不 merge #72，不关 #53，不启 #54。

人评项（等人裁）：

- [ ] H1 信息层级、Quiet Editorial、Motion 目的性、grayscale 可辨、keyboard 走查观感。

## Evidence

- merge-base SHA
- `final/real-after-76/` 下 REAL SSE snapshots、gate.json、settling-dom.json、run-report.json、keyboard.json、截图、视频
- 未覆盖的 `final/real/` 与 `final/real-after-74/`
- SOURCE.md 三次 specimen 谱系
- 测试 / build 输出
- Vercel Preview Ready 核对

## 结果

2026-09-06 回填。`git merge-base HEAD origin/main` = `f009d34f0303fd3512d6df0fda40135fd88db7fa`。

- [x] Q1 rebase 到 `f009d34`。冲突在 `docs/NOTES.md` 与 `goldenPath.test.tsx`；保留 #76 测试与 #66 artifact 测试。
- [x] Q2 旧 specimen 未覆盖。`final/real/complete.json` sha1 `356f06f92e93520a1735fb93e88ab74a55272329`；`final/real-after-74/complete.json` sha1 `ece5188117c5bdec674d1c51d8bb41596eb79346`。
- [x] Q3 `capture_mode3_production_real.py` 调用 `evaluate_source_identity_gate`。旧 `(claimId, sourceId)` 假阳性（src-1 换 URL）现在 transition=None 且 gate FAIL。
- [x] Q4 同一句真实 SSE。产物 `final/real-after-76/`。80.7s 到 complete。
- [x] Q5 `sourceIdsStable=true`。transition：claim-1 + `https://ltxc.cqnu.edu.cn/info/1140/7130.htm` + `src-bd310b43063afb86` + unassessed→support。
- [x] Q6 live `same: true`（`live-settling.json`）；replay `settling-dom.json` `same: true`，`fromId === toId`。`gate.json` PASS 与 `same: true` 同时成立。
- [x] Q7 本次 run 没有把反向输液材料标成 support。claim-2 被标 `checkability=not-applicable`，complete 时 evidence `[]`。结论 `judgment=refuted`，directAnswer 仍写普通感冒无需输液。未手改 Snapshot。
- [x] Q8 本次未出现 support+contradict 双桶（claim-1：一条 support，其余 context-only）。
- [x] Q9 两段 originalSpan exact。Drawer live + Tab/Shift+Tab/Escape/focus return。#63 hashed unique source 为 stable。
- [x] Q10 Desktop 1440 / Mobile 390 / grayscale / reduced-motion / keyboard / motion 在 `final/real-after-76/`。SOURCE.md 写清三次真实运行。
- [x] Q11 goldenPath 93；根 core 605 / eval 85 / server 21 / web 83 = 794；mvp 1008 通过 / 1 跳过；根 build 与 mvp build 绿。
- [ ] Q12 未改 vercel.json。push 后核对 Preview Ready。
- [x] Q13 不 merge #72，不关 #53，不启 #54。
