# 当前状态

2026-09-18 输入菜单清理与 Issue #90 P0 第一批修复已直接落地、未发布。输入侧已移除技能菜单、斜杠选择器和技能标签；加号仅提供「添加图片或视频」，明确视频抽帧、不读音轨、不支持 PDF/Word。默认/legacy 真实 Chrome 验收通过，用户手写斜杠和 URL 原样提交。#90 侧新增独立 `claimAtom + URL` 关系审计：FactChecker 准备上屏的支持/反驳来源必须先经 SourceValidator 审核，第一份 judging 快照即使用审计后关系；缺审计/审不清/新来源来不及复核时 fail-closed 为仅相关/未核验，不再允许「中途绿色支持、终态再纠正」。evidence loop、cross-exam 和 whole-claim 新来源都会刷新审计；最终分条优先用审计后的 FactChecker 结果。来源 title/snippet 改读检索层 canonical metadata，模型不能借合法 URL 改标题/摘录；EvidenceLink 新增 `sectionTitle/passage/relationReason`，抽屉分开显示真实页标题与命中小节。本 CNR 夹具保留页标题《长期戴眼镜会变金鱼眼？未见得》、小节「喝气泡水可以降尿酸」及「杯水车薪/无法引起人体酸碱变化」完整限制；已有「气泡水可以中和酸」时不再额外生成「所以可以中和酸」残句。P0 Case Pipeline **155 passed / 1 skipped / 0 failed**，Source Drawer/Golden Path **123/123**；apps 前端/API 构建、镜像 drift、`git diff --check` 通过；根工作区 **832 passed** + build 通过。真实 `MiniMax-M2.7-highspeed` SourceValidator 固定 CNR 工单返回 `context-only`，并把胃部不适/苏打水疗效留作缺失证据；真实 Chrome 固定快照显示页标题/小节/passage/关系理由且无错误 support 徽章。完整同案 live pipeline 超过 420s 并遇到多 provider 坏 JSON/不可用，已终止，不能宣称完整 E2E 通过。`apps npm test` 最终 **1673 passed / 4 failed / 1 skipped**，4 个失败均为此前并发过程 UI 工作留下的契约冲突（「调整核查重点」入口 + 3 个 ThinkingDisclosure 旧契约）；#90 自身新增回归已绿。契约 `docs/evals/2026-09-18-issue-90-evidence-relation.md`，实施边界 `docs/tasks/2026-09-17-issue-90-independent-repair-plan.md`。没有提交、推送或发布。

2026-09-17 实机体验排查与重大事实误判（P0 Issue #90）：
- **P0 事实误判归档并提 Issue**：用户实机测试「气泡水可以中和酸，胃不舒服喝苏打水就够了」，发现央广网明确辟谣文章（指出中和能力杯水车薪、无法治病）被误判为绿色「支持」，且抓取了多合一合集头条标题《长期戴眼镜会变金鱼眼?未见得》。已建立深度复盘文档 `docs/devlog/2026-09-17-p0-false-support-audit.md`，并在 GitHub 成功提 Issue [#90](https://github.com/yishu-ziyu/red-herring-and-gun/issues/90)。
- **过程 UI 降噪与去除重复（Lab 待确认）**：
  - 用户指出调查过程面板存在双重命题清单、4 句系统表功废话、原句滥划下划线、标题「刚刚发生」脱离严肃气质（OOC）等体验问题；
  - 依照「先出可交互 HTML 对比再动手」铁律，已完成轻量独立原型页 `apps/public/flow-lab.html`（`http://127.0.0.1:5212/flow-lab.html`），提供方案 A（社论档案式·聚焦单一流）、方案 B（紧凑分栏式）与基线对比，等待用户在浏览器直观体验与确认后合入。

- **按钮与输入卡片体系统一**：
  - 彻底清除全局 `.gp-primary-btn` / `.gp-ghost-btn` 残留的 999px 药丸圆角，全线统一为方案 A 规范的 8px 矩形徽标，主按钮炭墨黑（`#1c1917`）+ 辅按钮极细暖灰发丝边框（`#e7e5df`），消除「黑方块配灰胶囊」的拼贴违和感；
  - 输入大卡片去除残留的 `#d4d0c7` 泥灰色边框，统一为 12px 卡片圆角与微羽化透气投影；
  - 规范 `.gp-input-hint` 弱提示样式，杜绝状态文字侵入造成卡片变形。
- **验证与真机闭环**：
  - `npm --prefix apps run build` 成功；
  - `npm --prefix apps test` 全量 **1655 passed / 1 skipped / 0 failed**；
  - 真实 Google Chrome 产物验证（`docs/design/scheme-a-real-render.png`）：34px 700 粗宋体大标题、8px 规整按钮矩阵、通透纸面完全对齐方案 A 预期。

2026-09-17 事实核查档案（Editorial Dossier）与真实逻辑动效 UI/UX 改版已在 `apps/` 落地，未发布：
- **视觉去 AI 感与专业文稿建构**：去除悬浮彩色大卡片与「命题/边界」等算法/表单术语，重构为严肃的新闻核查档案式（Dignified Fact-checking Dossier）首屏结构。首屏直接展示原句气泡、核心结论直答（24px 书卷宋体）、理由解释以及 1–3 条决定性事实依据。原本占据首屏大面积的来源胶囊墙退居适用边界下方并默认折叠。
- **4 个调查角色头像保留与后端真实逻辑动效**：完整保留「拆问题 / 找出处 / 核语境 / 作判断」四个角色头像。移除假 loading 循环，动作完全绑定真实 SSE 状态：
  - 待命中：低饱和半透明；
  - 执行中：雷达微脉冲呼吸圈（Radar Beacon Ripple）；
  - 找出处抓取实时材料：头像右上角根据 `snapshot.sources.length` 实时弹出 `+N 篇` 弹跳徽标（Ingested Count Badge）；
  - 阶段完成：头像右上角弹出优雅的深翠绿色圆圈对勾（Checkmark Badge）；
  - 终态 complete：全部头像带徽标整齐就绪。
- **视觉规范与层级对齐**：对齐 Notion 设计笔记与《Refactoring UI》原则，采用明确的 Primary / Secondary / Ghost 按钮层级，统一边框细线与浅暖灰纸面基底（Paper-first）；修复 `transition: all` 以符合 Quiet Editorial 测试契约。
- **本轮自动化验证**：`apps` 全量 **1655 passed / 1 skipped / 0 failed**；`apps` 构建 **build 成功**；根工作区全部 **832 passed**；CMUx 双分屏（`surface:12`, `surface:14`）真机渲染核验通过。契约路径：`docs/evals/2026-09-17-editorial-dossier-redesign.md`。

2026-09-17 方案二默认体验已实现、未发布：用户确认「先解决主要疑问，再按需要深入」。拆题可输出主张优先级，仅在已保留且可核查的命题中改变真实检索顺序；快照携带本轮纳入/未覆盖范围。查看已有依据不重新调查，补查在同一线程中保留先前快照与日期；过程可回看前轮，历史归组，停止/刷新恢复不清空原结果。调整重点先等服务端终态，再开新轮。仅有打不开的链接时请补正文/截图，不发起无对象调查。分享排除私人前轮及追问上下文信封，并保留本轮范围。暂不加入未经验证的强度滑条，不改证据门槛、不切 T20。

本轮验证：apps **1655 通过 / 1 skipped / 0 fail**，根工作区 **832 通过**；apps 前端、API、根工作区构建通过；快照两侧镜像一致。固定构建 + 明确标注的 HTTP/SSE 验收夹具在真实 Chrome 走通范围→首轮→已有依据→补查→前轮回看→历史归组/重开→停止，3 次明确提交对应恰好 3 次调查 POST，其余读取不 POST；1280×900 与 390×844 留图，窄屏文档宽 390、视口宽 390，无 page error 或应用 console error。自动化证明接线与交互，不证明真实模型主张优先级选择准确或核查速度提高；24/26 案例 live eval 与真人理解度未执行。契约与证据路径 `docs/evals/2026-09-17-progressive-investigation.md`。

2026-09-17 运行可靠性修复已落地，尚未发布：当前助手直接实施，无子 Agent。取消贯穿模型、BYO、搜索/图搜、报告与来源探活；首调/修复、自证重试共享预算；字段按 schema 校验；调查自身截止不把供应商拉黑；移除结果返回后逐句延时。额外修复重复请求重跑、订阅终态不关流、早于总超时的刷新取消，以及 HTTP「正在停止」回执覆盖 SSE「已停止」的竞态。自动追问只用明确的缺口/未查命题，不再把词面匹配推测的原句片段变成新命题。

验证：apps 全量 **1643 通过 / 1 skipped**，随后最后的预算记账保护及整理经 **102 项受影响回归**与 API 构建通过；根工作区 **832 通过**与构建通过；离线 `qa:gate` 通过。非 watch 浏览器实跑两轮约 **274s / 147s**，首轮证据约 **100s** 已可见；这不是速度提升证明，第二轮还暴露了已修的 URL 追问问题。最终前端用该次真实快照重放验证追问及 390px 布局；真实页面 + 本地挂起 BYO 服务的停止复验约 **0.122s**、连接关闭且不重试。不能把本地断连解释为供应商停止计费。完整 24/26 案例 live eval gate 未跑。T20 **未完成**：兼容探针的六项基础接口检查不通过，未改发布入口或拿另一套界面替换 Golden Path。详细证据/边界见 `docs/evals/2026-09-17-runtime-cancellation-budget.md`。

验收口径补正：上一轮有分项测试/API/浏览器证据，但最终工作树的完整真实浏览器复验曾被开发服务热重启打断，不能表述为最终端到端全绿；本轮收尾使用固定版本、非 watch 进程。

2026-09-17。真实「隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？」复验暴露的四个产品问题已修：`partial/exaggerated` 不再统一写成「站得住」；`真的假的/真的吗/属实吗` 这类元问句不再进入「这次没查」和追问；调查中命题从 pending 进入搜索/证据到达时自动展开一次，用户手动收起后不再强开；登录墙提示由调查态唯一常驻 notice 接管，来源 popover 隐藏态不再制造内部超宽。真实 API 复验只保留两条事实命题，最终两条均为 `refuted`。同时删掉 `factDeskPostProcess` 强制在结论前塞「流传说法是：<原输入>」的旧逻辑，避免 URL 占据第一句。契约 `docs/evals/2026-09-17-real-walkthrough-p0-repair.md`。修后定向 85 绿，`npm run build` 与 `git diff --check` 绿，全量 `apps` **1625 绿 / 1 skipped / 0 fail**。1280px 离线浏览器复看未出现页面横向滚动；登录墙重复提示有单实例回归断言。未切 T20。生产壳仍是 `apps/`，执行仍只有 `casePipeline`。本地：`cd apps && npm run dev` → 页面 `http://127.0.0.1:5173/`，接口 `:3000`。发布 `./ops.sh`。

## 刚落地、仍然有效

- **`packages/core` 未同步 Shannon 修补**：没有 `textbookAtoms.ts` / `wholeClaimAudit/conclusionGate.ts`，也没有 `extractLeapAtoms` / `repairGatedConclusion`。`stages/decompose` 是模型拆题，不是剥连词。契约 `docs/evals/2026-09-15-core-shannon-sync.md`。
- **真实用户路径（Issue E）**：提交混合说法 → 点关键依据 → 抽屉命题/摘录/原文 URL 对上该条 → 保存后历史重开日期不变、不 POST 新调查。分享预览只渲染 GET 脱敏投影；撤销后 `/s/` 明确不可用。进行中指针走 resume GET，不重开、不扣额。五类输入：混合 / 无实质争议 / 证据不足 / 中断已覆盖；链接失败纳入已有 `inputStageLinkScrape`。人评 5 人未做。契约 `docs/evals/2026-09-15-presentation-issue-e.md`。

- **首页案例、简报、历史、分享（Issue D）**：输入下方案例卡用生产 fixture（混合说法 / 语境错位 / 证据不足），主操作「查看这次调查」走同一套结果组件、不发起调查、不扣额；次要「用同一说法重新查」。复制简报含原句、判断、边界、日期、来源 URL，失败可见，不用产品署名当证据。历史重开保持原日期、不 POST 新调查；抽屉写清本机与账号留存范围；保存失败可重试且不改原日期。分享预览渲染 GET 公开投影正文；`/s/` 不存在或已撤销不静默回首页；Vite 代理 `/s/`。契约 `docs/evals/2026-09-15-presentation-issue-d.md`。
- **B+C 并行核对**：同一文件里 C 的停止总答（`closedAnswer` / `data-gp-interrupted-answer`）和 B 的完成态顺序（结论区关键依据 → 详情 → 追问/案卷）并存。前端 24 文件 284 绿；C 服务端 3 文件 31 绿。
- **收束时限（Issue C）**：judging 之后、写报告之前，可核查命题都有判断且剩余时间不够一次写报告（约 90s 窗口 / MiniMax 单次 180s）则走确定性报告再 complete，不把 interrupted 标成 complete。`timeout_pending` 后流结束无 finalReport 用 `interruptedInvestigationSnapshot` 收口。停止信号仍只在阶段边界生效（未接入 runAgent/检索）；点停止且分条已齐时总答仍可见，不重复说「中断」。刷新 GET 未改额度。契约 `docs/evals/2026-09-15-presentation-issue-c.md`。
- **完成态阅读顺序（Issue B）**：结论区先原句再 24px 直答；1–3 条可点关键依据（无决定性证据则为零，不拿相关材料凑数）；缺口与适用边界在依据之后；追问与案卷排在逐条核查详情之后；来源目录默认折叠且在边界之后，首屏不是胶囊墙。追问不编「双方」模板。未改停止/中断/超时显示条件。契约 `docs/evals/2026-09-15-presentation-issue-b.md`。2026-09-15 人评：`127.0.0.1:5173` 的 `?fixture=mixed` / `complete` / `conflict` 在 1440 与 390 均为 PASS（Cursor 内置浏览器标签建完即消失，改对同一地址用本机 Chrome 走查）。
- **完成态展示（Issue A）**：案卷默认材料 / 分歧 / 缺口，没有公共活动就不写调查经历；禁止固定秒数与疾控/永久保留；`ConclusionHero` 不再替换混合判断原句；顶部来源用原始 EvidenceLink 与真实 claimId；外链默认「打开原文」，不写「已查验」「前往官方原文核验」「权威材料」。契约 `docs/evals/2026-09-15-presentation-issue-a.md`。
- **调查界面字阶**：SF Pro Regular/Medium，字距 `-0.15px`；字号只 12/13/14/24px；墨 `#292929` / `#5D5D5D` / `#9E9E9E`；导航圆角 8px、卡片 16px、主按钮药丸。24px 只给首页标语和结论第一句；调查中原句 14px。活动流在左栏原句下，角色标签无色块。契约 `docs/evals/2026-09-15-type-and-salt-run.md`。
- **阅读顺序**：空等有正文，不数秒当标题；命题只在主列出现一次；思考默认折叠。契约 `docs/evals/2026-09-14-investigation-reading-order.md`。
- **中断**：没有分条判断 → 「还没有写成总判断」，不编第一句。分条判断已齐 → 「收束时中途停了」并按判断拼总答。契约 `docs/evals/2026-09-15-salt-followthrough.md`。
- **这次没查**：原句里没进命题的整句留下，不按逗号切碎。同一 finding 只挂一次；摘录约 80 字。
- **作判断时限**：MiniMax-M2.7 单次 180s；M2.7 超时两次才跳过（M3 一次仍跳过）；密钥无效跳过；管道总时限 420s。盐说法 `23799fa5` 作判断 29/38/47s 完成，终态有总答。契约 `docs/evals/2026-09-15-fact-checker-timeout.md`。
- **拆题**：所以/因此后的跳跃强制进命题；同一 URL 不得同时当支持和反驳。契约 `docs/evals/2026-09-14-salt-p1-p2.md`。

## 已经否定、不要再当现行

- `agentLoop` / `AGENT_LOOP=1` / `?loop=1`：代码已删，ADR-006 废止。
- 调查中原句 24px、空等只显示秒数、假三步 01/02/03、中断清掉已有结论、MiniMax 一次 90s 超时就当额度耗尽：都已改掉。
- 生产目录不是 `mvp/`。
- 旧三栏只走 `/?legacy=1`，不是默认产品。

## 还没做完

- 完整 live eval gate 与最终版本完整真实追问理解质量尚未验收；本轮已分别验证真实运行收束、快照重放和停止链路，不合并宣称整版端到端全绿。
- T20：生产切到 `packages/` 脊柱。现在发布仍走 `apps/`。

更早条目见 `docs/devlog/2026-09-status-archive.md`。不要从 `docs/evals/` 里翻已被取代的「未做」句当现状。
