# 验收标准：[Reset 3] 重构前端 Golden Path：输入 → 调查 → 判断（Issue #52）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#52。前置：#50（PR #55）、#51（PR #56）均已合并。

## Change

生产前端默认主路径从「固定三栏 AppShell + MissionControlView 执行态 + ResultView 卷宗」重构为一条同画布 Golden Path：

1. 产品壳降为轻量 Chrome（品牌 / 新调查 / 历史 drawer / 账号入口），不再是三栏认知骨架；
2. 输入态只让首次用户理解「放什么、会得到什么、下一步做什么」，AI Ping 品牌、积分、BatchChecker、provider 控制全部退出默认首页；
3. 调查态与完成态共用同一张调查画布：原始说法持续在场，命题按原序展开，证据按 支持/反驳/待核对/相关材料 汇入对应命题，尚缺与争议如实显示；
4. 完成时 `conclusion.directAnswer` 成为第一视觉层级，命题与证据保持原位，来源可从结论逐层下钻到原网页；
5. 数据唯一来源是 SSE `investigation_snapshot`（客户端一等 typed event，直接消费 `@rhg/core/investigation` 的 `InvestigationSnapshotV1`）；raw Agent/tool/search/consensus 事件不参与任何产品语义推导；
6. interrupted 保留已获真实数据、无伪结论、可重试；历史打开走 `/api/case/:id` 的 `investigation`，同画布渲染、不重新核查；
7. `finalReport.imageOrigin` 作为 Snapshot v1 的临时 side-channel：found 显示独立「原图出处」辅助卡，not_found/unavailable 显示「原图出处未查到」全局缺口；不冒充命题证据。

## Not this

- 不做 #53 最终视觉 polish / 完整 Motion 系统 / 品牌高保真；本期是「结构已经漂亮到值得继续打磨」。
- 不做 #54 用户理解实验。
- 不删除后端 raw SSE / telemetry / Agent；只要求生产 UI 不依赖。
- 不迁移或改写核查 pipeline、不改 server 契约（`investigation_snapshot` 已由 #51 提供）。
- 不做大规模旧代码清仓：AppShell / Dashboard / MissionControlView / ResultView / ResultTrace 保留在仓库，退出生产默认路径，经 `?legacy=1` 可进旧三栏调试壳。
- 不动 `ops.sh`、不动 server 部署约束。

## Evaluator

机器项（全绿才交付）：

- [ ] E1 客户端契约：`OrchestrateStreamEvent` 含 `investigation_snapshot` 一等事件与 `investigation: InvestigationSnapshotV1` 字段，类型来自 `@rhg/core/investigation`；web 测试证明消费同一 versioned schema。
- [ ] E2 Golden Path 状态只记录「最新已校验 Snapshot + 连接状态 + complete.finalReport + 错误」；对 `agent_start / agent_complete / agent_error / agent_thought / tool_start / tool_result / tool_error / search_progress / planner_update / speculative_update / consensus_debate_*` 全部忽略——负向测试：只喂 legacy 事件时画布不产生任何 Claim/Evidence/Gap/Conflict/结论。
- [ ] E3 生产主路径源码不出现实现层词汇（Agent / agent 名 / provider / tool call / token / pipeline / RumorDetector / FactChecker / SourceValidator / ReportComposer）；默认首页不出现 AI Ping 品牌与 BatchChecker（源码扫描 + 渲染断言双验）。
- [ ] E4 五类 golden fixture（复用 #51 的 InvestigationSnapshotV1 fixture）：refuted / supported / 半真半假两条独立 / 证据不足 open Gap 无来源且不显示为反驳 / 真实冲突（known 与 unknown reason 各一例，unknown 不渲染虚构原因）——UI 组件测试全过。
- [ ] E5 边界：unassessed 显示中性「待核对」绝不染成支持/反驳；context-only 与 support 文案语义可区分；reachable=false 来源显示不可打开状态；>180 字 claim 完整显示（不用内部键）；interrupted 无 conclusion 且保留已有证据；历史恢复不发 orchestrate 请求（mock 断言零调用）。
- [ ] E6 imageOrigin：found → 独立辅助卡可点开来源且不是任何 Claim 的 evidence；not_found/unavailable → 「原图出处未查到」全局缺口；两种完成态组件测试。
- [ ] E7 现有测试与构建不回归：根 `npm test` + `npm run build`；`cd mvp && npm test` + `npm run build`；`cd mvp/server && npm run build`。

人评项（等人裁，附真实截图）：

- [ ] H1 Desktop 截图：输入态 / 调查态（≥2 Claim 且已有 unassessed、support、contradict 若干）/ 完成态（directAnswer + 下钻入口）/ interrupted 或真实 Conflict 态。
- [ ] H2 Mobile（390px）截图：输入态 / 调查态 / 完成态 / Evidence 下钻。
- [ ] H3 十问自检逐条回答（删掉 Agent 名仍完整 / 能指出核查了哪几句话 / 能指出支持反驳 / 没找到≠反驳 / 冲突来自证据 / 第一眼是答案 / 答案能点到原网页 / interrupted 保留真实内容 / 手机不是缩小后台 / 拿掉装饰信息架构仍成立）。
- [ ] H4 三张参考图采用与刻意不抄之处及理由。

## 结果

2026-09-06 回填。实现落点：

- **新生产路径**（`mvp/src/goldenPath/`）：`ProductShell`（轻量 Chrome：品牌/新调查/历史 drawer/账号菜单，登出态附模型设置入口）、`InputStage`（输入态：kicker+大标题+输入卡+示例，仅用户级状态：服务不可用/次数用尽/登录引导/链接抓取失败）、`InvestigationCanvas`（唯一调查画布，`data-gp-phase` 标注六个相位）、`ClaimSection`（命题证据空间：反驳/支持/待核对/相关材料分组+尚缺+争议+边界）、`EvidenceItem`、`SourceDrawer`（来源下钻）、`ConclusionHero`（完成态第一视觉层级）、`snapshotUi.ts`（Snapshot→UI 纯映射）、`copy.ts`（产品文案，无实现层词汇）、`useInvestigationRun`（唯一 SSE 消费点，纯 reducer `applyRunEvent` 可测）。
- **客户端契约**（E1）：`OrchestrateStreamEvent` 新增 `investigation_snapshot` 一等事件，`investigation` 字段类型来自 `@rhg/core/investigation`；快照进 state 前过 `validateInvestigationSnapshot`，契约外对象拒收。
- **App 重构**：默认渲染 ProductApp（`input | investigation` 两态，细态由 snapshot.phase 决定，不再有「artifact 是否打开」）；完成自动本地留存+登录落库；历史打开本地 KB 优先、服务端 `/api/case/:id` 兜底（都确定性取回快照，零模型零搜索）；同句已查先问「打开旧调查/重新核查」；`scopeVersion` 守卫迟到响应。
- **legacy 隔离**：旧三栏壳整建制搬到 `legacy/LegacyDesk.tsx`，经 `/?legacy=1` 进入；`AppShell / Dashboard / MissionControlView / ResultView / ResultTrace` 保留在仓库、退出生产默认路径；原 `App.test.tsx` 整体迁到 `legacy/LegacyDesk.test.tsx` 继续守护 legacy 行为。
- **imageOrigin side-channel**：完成/历史态从 `finalReport.imageOrigin` 读取，found→独立「原图出处」辅助卡（可点开，不属于任何命题），not_found/unavailable→「原图出处未查到」全局卡；不入 Claim 证据位。
- **DEV 固定装置**：`/?fixture=investigating|judging|complete|conflict|interrupted|image-found|image-missing` 用脚本化快照驱动真实组件树（`devFixture.ts` 仅 DEV 动态 import，生产构建 dead-code eliminate）；用于确定性截图与走查。

逐条验收：

- [x] E1 契约：`agentExpansion.ts` 类型化事件 + `goldenPath.test.tsx` 证明消费共享 schema（fixture 经 `buildInvestigationSnapshot` 构建，与 core 契约同源）。
- [x] E2 负向：`applyRunEvent` 纯 reducer 测试——只喂 `agent_start/agent_complete/tool_start/tool_result/search_progress/consensus_debate/planner_update` 序列时 snapshot 保持 null，不产生任何 Claim/Evidence/结论；`investigation_snapshot` 是唯一能让命题出现的通道；损坏快照（closed schema 外字段）被拒收并保留上一份。
- [x] E3 负向扫描：对 `src/goldenPath/**` 全文扫描，无 legacy 事件名（`useInvestigationRun.ts` 的显式忽略清单除外，由 E2 行为测试约束）、无 RumorDetector/FactChecker/SourceValidator/ReportComposer/AI Ping/BatchChecker/provider/pipeline/credibilityScore；`App.tsx` 无 AI Ping/BatchChecker；渲染断言默认首页无这些词、无「API Key」字段。
- [x] E4 五类 golden fixture UI 测试：refuted（hero 判词+反驳组可下钻）、supported、半真半假（两条独立有对有错/证据反驳）、证据不足（尚缺 open+无反驳组+不显示反驳）、真实冲突（known reason 展示争点；unknown 显示「分歧的原因目前还不清楚」且不渲染虚构原因）。
- [x] E5 边界：unassessed 中性「待核对」（无支持/反驳组）；context-only「相关材料」独立组语义可区分；reachable=false 显示「（打不开）」+drawer 警示；>180 字命题完整显示无省略号；interrupted 无 conclusion、保留 2 命题、可重试；历史打开零 orchestrate 请求（mock 断言）；历史恢复不发起新调查、不重复落库。
- [x] E6 imageOrigin：found 独立卡（href 正确、不在任何 claim 内）；not_found「原图出处未查到」。
- [x] E7 门禁：根 `npm test` core 578 / eval 85 / server 21 / web 83 全绿，根 build 绿；`mvp npm test` 908 过 / 1 跳过（新增 goldenPath 17 + App 7 + history 9，legacy 27 继续守护）；mvp build、mvp/server tsc 绿。

真实端到端取证：本地 dev 环境（真实模型与检索密钥）提交「维生素C能治感冒，而且每次感冒都应当输液。」，真实 SSE `investigation_snapshot` 驱动画布完成 received→investigating（2 命题、5 条真实来源以待核对汇入）→complete（直接回答+边界+反驳/支持/相关分组）。截图 `desktop-8-real-investigating.png` / `desktop-9-real-complete.png`。

人评项（附真实截图，均在 `docs/design/2026-09-06-golden-path/`）：

- [x] H1 Desktop（1440px）：输入态 `desktop-1-input`；调查态 `desktop-2-investigating`（fixture）与 `desktop-8-real-investigating`（真实，含 unassessed+立场条）；完成态 `desktop-3-complete` 与 `desktop-9-real-complete`（真实）；证据下钻 `desktop-5-source-drawer`；争议+尚缺+追索 `desktop-4-conflict-gap`；interrupted `desktop-6-interrupted`；原图出处 `desktop-7-image-origin`。
- [x] H2 Mobile（390px）：`mobile-1-input` / `mobile-2-investigating` / `mobile-3-complete` / `mobile-4-source-drawer`（单列，非三栏缩放；complete 首屏即 directAnswer）。
- [x] H3 十问自检：
  1. 删掉 Agent 名页面完整？——页面本就不含任何 Agent/provider 词汇（E3 扫描+渲染断言）。
  2. 能否指出核查了哪几句话？——命题 1/2/3 序号卡与原句同屏对照（desktop-3/9）。
  3. 能否指出哪条支持哪条反驳？——命题内按 反驳(红)/支持(绿)/待核对(灰)/相关材料(紫) 分组，各绑定来源（desktop-4）。
  4. 没找到证据是否画成反驳？——证据不足命题显示「证据不足+尚缺」，无反驳组（golden case 4 测试）。
  5. Conflict 是否来自证据冲突？——仅由 `snapshot.conflicts` 渲染（builder 端只认证据层双方并存）；unknown reason 如实未知（golden case 5 测试）。
  6. 完成时第一眼是答案还是过程？——directAnswer 为首屏第一视觉层级（desktop-3/9/mobile-3）。
  7. 能否从答案点到原网页？——结论→命题→证据条→SourceDrawer→「查看原文」外链（desktop-5/mobile-4）。
  8. interrupted 是否保留已查内容？——保留真实 claims/sources，无伪结论，可重新调查（desktop-6+测试）。
  9. 手机是否正常产品？——单列画布+全宽 sheet drawer，关键点击区 ≥40px（mobile-1..4）。
  10. 拿掉装饰信息架构是否成立？——装饰仅轻渐变背景与浅阴影；层级由留白/分组/字重承载，去掉后结构不变。
- [x] H4 参考图采用与刻意不抄：
  - 图1（完成态）：采用 directAnswer 大字首层、判词 chip、原句卡+「证据与分析」命题行；不抄灯塔/海面装饰插画与手写体口号，不抄「检索权威资料 12 篇」类营销 chips——换成「命题 N 条/来源 M 条/完成时间」事实性 meta。
  - 图2（调查态）：采用原句置顶+进行中呼吸点+命题序号卡+命题内分组证据空间+状态 chip；不抄固定四列 kanban 网格（改为自适应分组，只显示存在的组，移动端自然堆叠），不抄「3/6」进度环（计数是内部过程感，改「正在追查」轻状态）。
  - 图3（输入态）：采用 kicker+强调色大标题+居中输入卡+示例 chips+大量留白；不抄「文字/链接/图片」三 tab 切换（现有单输入框自动识别链接、图片走附件，切 tab 是多余交互），不抄灯塔插画。

遗留 #53/#54：最终视觉 token 精修、Motion 系统（当前仅 mount 渐入/呼吸点，respect prefers-reduced-motion）、originalSpan 原句高亮渲染、#54 首次用户理解实验。
