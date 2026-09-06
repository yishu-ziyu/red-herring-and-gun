# 验收标准：[Reset 4F] 生产集成验收：真实 SSE、Motion 取证与视觉回归门禁

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#66。Parent：#53。Depends：#61（PR #67）、#62（PR #68）、#63（PR #70）、#64（PR #69）、#65（PR #71），均已 squash-merge 进 `main`。

基线 SHA：`e5604853704326cf1bd9e2b1191132633ad88487`。独立分支 `feat/reset-4f-production-integration`，不从任何旧 feature branch 继承。

设计判断对照 Will's S Design Note（工作区 `Will's S Design Note`，`yishuziyu@gmail.com`）：

- **Creating Usability with Motion**：Object Continuity / Transformation——同一证据改角色时是同一对象归位，不是 clone / fade。
- **The Role of Animation and Motion in UX**：动效解释状态切换与空间位置；无关动效是干扰。
- **Apple Motion**：目的性动效；动效应是可选的；用户不必等动画结束才能阅读或点击。
- **Emphasize by de-emphasizing**：完成态第一视觉层级是 directAnswer，靠弱化 chrome / 计数 / 时间，而不是给结论加色块。
- 生产视觉仍遵守 PR #60 / Production Spec：**Paper-first. Semantics by structure, not by paint.**

Vercel Infra #58 是独立问题，不混进本 Issue 的产品代码。本文件只记录 #66 对它的核对要求。

---

## Change

真实用户输入进入生产 Golden Path 后，一次真实 SSE `investigation_snapshot` 流必须走完：

```text
received → decomposed → investigating → judging → complete
```

并证明已合入 `main` 的 Claim Trace、Evidence Settling、Conclusion Emergence、Source Drawer 在同一条生产 Snapshot 流里一起成立。

可观察结果：

1. **真实 SSE，不是 fixture。** 所有截图、视频、snapshot artifact 标明 `REAL SSE` 或 `DETERMINISTIC FIXTURE`。禁止用 fixture 冒充真实流。
2. **Evidence Settling：** 至少一条真实 Evidence 发生 `unassessed → support / contradict / context-only`。identity 为 `stable` 时 DOM `before === after`；Motion 是同一节点归位，不 fade clone、不闪烁、focus 不丢。duplicate identity 继续服从 `stable / relation / ephemeral`。若真实运行没有可观察 role transition：不造数据，记录真实结果，再换一个合理真实案例。
3. **Conclusion Emergence：** `investigating/judging → complete` 时 `[data-gp-conclusion-region]` `before === after`；`directAnswer` 只在真实 complete 后出现；不 page replace、不 auto scroll、不 auto focus；Evidence / Claim / Original Claim 不 remount。Source Drawer 若打开：live 在 complete 后仍 live（除非 evidence identity 真实变化）；held 仍 held，不因 conclusion 错误恢复 live，held 内容不被替换，dialog 不 remount。
4. **Claim Trace：** 若 `claim.originalSpan` 存在，`originalClaim.slice(start,end)` 精确对应，hover / keyboard focus / pointer-focus 仲裁正确。若真实 case 没有 span：诚实记录 `no-trace`，禁止 fuzzy match。
5. **Source Drawer：** 从真实 Evidence 打开。Claim + EvidenceLink + Source 都来自真实 Snapshot；finding / limitation / excerpt 有才显示。live resolution 服从 `identifyEvidenceLinks` identity；identity 消失 → held。Tab / Shift+Tab / Escape / scrim / focus return 全部成立。
6. Desktop 1440 / Mobile 390 screenshot matrix、grayscale、reduced-motion、keyboard / focus E2E、Motion evidence、真实 Snapshot artifacts 全部落在 `docs/design/2026-09-06-mode3-production/final/`。
7. 允许修真实集成暴露的 HIGH / MEDIUM bug。禁止新信息架构、Agent/Mission Control UI、新视觉模式、大规模 backend 重构、为截图手改真实调查数据。

---

## Not this

- 不再做组件 fixture 当作本 Issue 的完成证明（既有 #61–#65 fixture 回归可以跑，必须标 FIXTURE）。
- 不发明第四套视觉方案，不重写 Quiet Editorial tokens。
- 不为了让 Vercel check 变绿篡改 Mode 3 app 输出结构。
- 不自己关闭 #53，不启动 #54，不 merge 本 PR。
- 不把 `@rhg/web` 脊柱前端冒充当前生产 Golden Path。

---

## Evaluator

机器项（全绿才交付）：

- [ ] E1 基线：`git rev-parse HEAD` 的起始点是 `e5604853704326cf1bd9e2b1191132633ad88487` 的独立分支。
- [ ] E2 至少一次真实生产调查：用户输入 → `POST /api/agent/orchestrate-stream` → SSE `investigation_snapshot` 出现 `received / decomposed / investigating / judging / complete`（缺相位必须诚实记录，不得补造）。保存脱敏 Snapshot artifacts。
- [ ] E3 Evidence Settling：真实流里至少一条 `unassessed → support|contradict|context-only`；`stable` identity 的真实 DOM `before === after`；录屏或连续帧标 `REAL SSE`。若未发生 role transition：记录后换案例，仍无则诚实 no-transition，不造数据。
- [ ] E4 Conclusion Emergence：conclusion region 节点 `before === after`；complete 前无 `[data-gp-direct-answer]`；complete 后出现；脚本断言无 `scrollIntoView` / 无 conclusion `focus()`；Claim / EvidenceBoard / Original 节点不 remount。Drawer live/held 交叉若真实打开则断言。
- [ ] E5 Claim Trace：对每个有 `originalSpan` 的 claim 断言 `originalClaim.slice(start,end) === claim.text`；hover / keyboard 只高亮对应 mark。无 span 标 `no-trace`。
- [ ] E6 Source Drawer：从真实 Evidence 打开；字段有才渲染；Tab 闭环、Escape、scrim、focus return。
- [ ] E7 Screenshot matrix 文件存在且 README 标明 REAL / FIXTURE：
  Desktop 1440：`desktop-input.png`、`desktop-real-decomposed.png`、`desktop-real-investigating.png`、`desktop-real-complete.png`、`desktop-conflict-gap.png`、`desktop-source-drawer.png`、`desktop-complete-grayscale.png`。
  Mobile 390：`mobile-input.png`、`mobile-real-investigating.png`、`mobile-real-complete.png`、`mobile-source-sheet.png`、`mobile-complete-grayscale.png`。
  Reduced motion：`desktop-reduced-motion-complete.png` + settling / conclusion 连续帧或录屏。
- [ ] E8 既有回归：`cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`；根 `npm test`；根 `npm run build`；`cd mvp && npm test`；`cd mvp && npm run build`。既有 capture fixture 脚本可跑，结果标 FIXTURE。
- [ ] E9 无 Mission Control / Agent UI / semantic rainbow / card-on-card 回潮：`mvp/src/goldenPath/` 扫描无实现层词汇回潮；complete 截图 computed-style 无大面积语义底色块。

人评项（等人裁）：

- [ ] H1 信息层级：directAnswer 是完成态第一视觉层级；原句持续在场；Claim / evidence relation 比 chrome 重要；source count / time / badge 退居次级。对照 Will's S「想要突出重点，先弱化次要内容」。
- [ ] H2 Quiet Editorial：仍像调查稿，不是 SaaS Dashboard；无 semantic rainbow / 蓝块 excerpt / 黄块 Gap / card-on-card。
- [ ] H3 Motion：每个明显 Motion 能回答「它解释了什么」；Settling 解释关系变化；Emergence 解释结论形成；没有只是看起来高级的动画。对照 Apple「目的性动效」与 NN/g「动效用于状态切换」。
- [ ] H4 低摩擦：用户不必等动画结束就能阅读 / 点击；Source 1–2 次点击到原网页；Mobile 像可交互长文。
- [ ] H5 Grayscale：去掉颜色后仍能分辨原句、Claim、support / contradict / context-only / unassessed、gap / conflict、directAnswer、source drill-down。失效时先修文字 / 符号 / 层级，不加更深颜色。
- [ ] H6 Reduced-motion 与 keyboard 走查观感。

Vercel #58（独立，不作为 #66 产品完成条件，但最终 PR 必须说明状态）：

- [ ] V1 生产部署目标判定：当前 Reset 生产壳是 `mvp/`（T20 之前），不是根 `@rhg/web`。Vercel 静态前端应对准 `mvp` 的 Vite `dist/`，`/api` 仍走已有 rewrite，不改 Mode 3 输出结构。
- [ ] V2 独立 PR 校准 Root Directory / Build Command / Output Directory。
- [ ] V3 用一次 main deployment + 一次 PR Preview 证明恢复。未完成则在 #66 PR 如实写当前状态。

---

## Evidence

- 真实调查输入（不含密钥 / 账号）。
- `docs/design/2026-09-06-mode3-production/final/` 下 REAL / FIXTURE 清单。
- Snapshot JSON（脱敏：可留 claim 文本、span、role、source title/domain；去掉原始 key / provider / tool log）。
- Motion 录屏或连续帧。
- Keyboard 走查记录。
- 测试 / build 输出。
- 发现并修复的 HIGH / MEDIUM 列表；无则写「真实集成未再暴露需修的 HIGH / MEDIUM」。

---

## 结果

2026-09-06 回填。基线 `e560485`，分支 `feat/reset-4f-production-integration`。

真实调查输入：`维生素C能治感冒，而且每次感冒都应当输液。` 本地 `mvp npm run dev -- --port 5186`，真实模型 MiniMax-M2.7-highspeed（cross_examiner 一次 StepFun 失败后回落到 MiniMax）。耗时 193.2s。

逐条：

- [x] E1 基线独立分支，起始 SHA `e5604853704326cf1bd9e2b1191132633ad88487`。
- [x] E2 真实 SSE phases：`received, decomposed, investigating×3, judging×3, complete`。快照在 `docs/design/2026-09-06-mode3-production/final/real/snapshots/`。DOM 直播跳过 decomposed 一帧（received 后直接 investigating）；decomposed 截图用同一份实时 JSON 回放，标 REAL SNAPSHOT REPLAY。
- [x] E3 Evidence Settling：snapshot `claim-1/src-1 unassessed → support`。直播 pin 时源尚未入 DOM。用同一对 JSON 回放生产组件：`claim-1:src-1` identity=stable，DOM `before === after`（`real/settling-dom.json`）。直播 webm + replay gif。未造数据。
- [x] E4 Conclusion Emergence：直播 `sameAfterComplete.region/original/claims/board === true`，complete 前无 directAnswer，scrollY=0。Drawer 打开为 live。
- [x] E5 Claim Trace：两命题 `slice === claim.text`（维生素C能治感冒 / 每次感冒都应当输液）。hover 仲裁 `traced=claim-1`。
- [x] E6 Source Drawer：真实 src-1，live，excerpt+finding 有则显示，limitation 无则不显示。Keyboard：Tab 闭环、Escape、focus return 到 `claim-2:src-5`。
- [x] E7 screenshot matrix 见 `final/SOURCE.md`。conflict 真实未出现，gap 真实出现；`desktop-conflict-gap.png` 是 REAL complete 的尚缺，不是伪造 conflict。
- [x] E8 `goldenPath.test.tsx` 88 通过（含两条 REAL artifact 测试）。其余测试/build 见 PR。
- [x] E9 无 Agent UI 回潮。complete computed-style：hero 透明、无 shadow、radius 0。support 行 `rgba(15,23,42,0.03)` 不是语义彩虹底。

发现但未在本 PR 改 producer：claim-2 的 finding 明文否定「每次感冒都应当输液」，Snapshot 仍标 `role: support`，judgment=`unresolved`。这是 builder/pipeline 映射问题，不是 UI 撒谎。禁止手改真实调查数据。记为独立 contract gap，不在 #66 做 backend 重映射。

人评项 H1–H6 附截图，等人裁。Vercel #58 独立 PR，不混进本分支产品代码。
