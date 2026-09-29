# 当前状态

2026-09-29 行为保持重写（分支 `rewrite/behavior-preserving`，基线 `f96a37f`，契约 `docs/evals/2026-09-29-behavior-preserving-rewrite.md`）。Phase 1 逆向四份文档：`behavior-spec`、`architecture-current`、`state-model`、`external-contracts`。Phase 2 表征：`apps/golden/` 录音回放 golden master——外部世界录音以 `--import` 预加载进真实服务进程（不改生产代码），虚拟时钟让回放按录下的耗时做时间预算取舍；20 个服务端场景（正常、边界、错误、中断、重启、数据兼容、并发、状态恢复）+ 8 个界面场景（录下的 SSE 帧逐帧喂真实 `<App/>`，假时钟）。基线代码自检：服务端虚拟时钟开、关各回放两次均 20/20 逐项相同，界面三次 8/8 相同；基线标签 `base`、`base-nv`、`ui-base`（`outputs/golden/`，git 忽略，重写中不重录）。场景表与回放差距见 `docs/golden-scenarios.md`。Phase 3 设计：`docs/architecture-target.md`、`docs/rewrite-plan.md`（Slice A 收尾链 → B 管线阶段；C HTTP 处理器；D 前端壳；E 清理）。新发现未修的问题 R9（重启前 5 秒内的会话与额度变化会丢）、R10（本机配置下截图调查必然失败），共 10 条在 `docs/rewrite-issues.md`。apps 全量 **1475 passed / 0 failed / 9 skipped**（其中 8 条是默认跳过的界面 golden）。下一步 Slice A。

2026-09-28 实机缺陷六处修复（未提交、未发布）。一、调查中右栏空白：高 0 的结论区被网格自动排进右栏第 2 行，把命题区挤到「调查动态」下面；现钉在头像格，Ego 实测头像到命题区间距 230–299px → 23px。二、判断阶段头像卡在「核语境」：有命题形成判断后当前角色改为「作判断」。三、短谣辟谣通道整句判「不能信」而唯一命题是「模型未覆盖」，结论写「尚未查清，未计入该判断」、徽章「证据不足」：现唯一可核查命题时把存活对题辟谣挂为反驳出处并判 false，结论重建为「公开材料不支持这条说法。检索到针对这句话的辟谣材料，未见对题的支持材料。」；多条命题时不再放行无绑定整句 false（收为 unverified）。四、来源探活单条超时被当死链（科普中国 4.5s 返回 200 却标「来源无法打开」）：超时改判存活。五、复验时发现「这条说法查过」提示自 9-06 Reset 4A 起没有样式、裸贴左上角，已恢复。六、复验时发现收权后重建结论把证据硬截 120 字、半句接下一句，改为截在句末。实机复验（15:41–15:47）确认一、二；三本轮没触发（模型拆出两条命题），靠单测。apps 全量 **1447 passed / 0 failed / 1 skipped**，前端构建、server tsc、根工作区测试、`git diff --check` 通过；eval:gate 属 packages/（T20 暂停）未跑。3000 端口 API 是 tsx watch，改动已自动加载。契约 `docs/evals/2026-09-28-live-run-defects.md`。

2026-09-28 修复：首页滚到案例区后点「查看这次调查」，结果页沿用首页滚动位置，结论落在视口上方（Ego 实测 -324px）。现在从首页进入调查态时回到页顶；调查态内部（追问、保存后换 caseId）不跳。新增回归先红后绿，apps 全量 **1443 passed / 0 failed / 1 skipped**，构建通过。Ego 脚本两张案例均 scrollY 0、结论 top 143px；Chrome 真人式走查第一屏可见结论。契约 `docs/evals/2026-09-28-case-open-scroll-top.md`。浏览器验收自此分两层（Ego 脚本 + Chrome 走查），写入 `AGENTS.md`。未发布。

2026-09-28 按「代码松散度」复盘后做了两件事（未提交、未发布）。一、删除 `/?legacy=1` 旧三栏壳：前端生产代码 23,666 → 13,853 行，删 61 个文件（含 235 个只测旧壳的测试），`/?legacy=1` 现在显示默认首页（与 `/` 像素一致）；删前打 tag `legacy-desk-final`。apps 全量 **1442 passed / 0 failed / 1 skipped**（删前 1677 / 0 / 1），`apps` 构建与 `git diff --check` 通过。契约 `docs/evals/2026-09-28-remove-legacy-desk.md`。二、暂停 T20：`apps/` 是生产唯一真相，`packages/core` 无守护拷贝不再同步，`investigation/` 字节镜像照旧；`AGENTS.md`、`REPO.md`、`ARCHITECTURE.md`、ADR-007 已改，理由见 `docs/devlog/2026-09-28-pause-t20.md`。

2026-09-22 共享 nginx 的 lcw 路由已修复并防回归：公网 `lcw.yishuziyu.cn` 故障根因不是应用，而是 `scripts/configure-aliyun-ip-api-nginx.sh` 整份重写 `/etc/nginx/conf.d/red-herring-ip-api.conf` 时漏掉 `/lcw/`，导致 Vercel 转发到 `/lcw/*` 后落入默认 8080 服务并返回 404。线上已从 2026-09-18 备份恢复最小 `/lcw/` block，`nginx -t` 与 reload 成功；Docker 8787、nginx 前缀 health、Vercel 公网 health 均 200，公网首页从云主机复验 200 且标题「录成文」。源码 writer 现固定生成 `/lcw/` → `127.0.0.1:8787/`（600s、600m），新增 deploy-pipeline 回归断言先红后绿，定向 6/6 通过。契约 `docs/evals/2026-09-22-shared-nginx-lcw-route.md`。本轮未发布 Red Herring，也未改现有并行工作文件。

2026-09-18 提交者身份已统一（git filter-repo + mailmap，用户裁决「统一改写署名」）：444 个提交里 7 个作者身份（用户本人 4 种拼写 + `dev@local` 26 条 + DevSpace 2 条 + Cursor Agent 2 条，后三者是真实工作只是环境兜底名）全部归一为 `yishu-ziyu <yishuziyu@gmail.com>`。在全新克隆中改写后 force push main 与两个 tag；**改写前后 main 树哈希逐字节相等**（`1fe963dd`，内容零变化），414 提交数不变，回执 tag 平移。本地工作目录已 reset --soft 对齐，未提交改动原样保留。全量备份在仓库外 `../rhg-pre-identity-rewrite-20260918.bundle`（182M），确认无误后可删。GitHub Contributors 面板缓存最长约 24h 刷新，之后应只剩一个头像（人评待看）。旧 refs/pull/* 引用仍指旧提交，不进 Contributors 统计，GitHub 会自行 GC。防复发：只从配好身份 `yishu-ziyu <yishuziyu@gmail.com>` 的本机提交；DevSpace/Cursor 环境要么配同身份要么不再提交；`yishuziyu@gmail.com` 需挂在 GitHub 账号下头像才会合并。契约 `docs/evals/2026-09-18-contributor-identity-rewrite.md`。**未提交改动（测试契约对齐 + 三份 eval 文档 + NOTES）仍在等用户指示落 commit**。

2026-09-18 发布后 live eval 抽查（2 案例）已执行：RUMOR-006 冷冻馒头 PASS（verdict=false、可信度 4、12 URL、「不能信」，242s）；RUMOR-008 奥运空调 FAIL——verdict 判 `false` ≠ 预期 `mixed_misleading`，但可信度 14 落在预期区间 [10,30]，「分数对、标签错」；该案在 26 案例历史基线中即以同因失败、difficulty: hard，**非本次发布退化**。过程中供应商 401/余额不足/坏 JSON 均被降级兜住，两案均出终态报告，记录在 `.ship/evaluation/benchmark-history.jsonl`（`eval-1789700624150`）。契约与结果 `docs/evals/2026-09-18-live-eval-2cases.md`。公网复验全绿（https 200 ×3；明文 http 现为 301 跳转而非 403），等待用户上 `https://gun.yishuziyu.cn` 亲自体验（人评）。RUMOR-008 这类「部分成立」verdict 标签偏严是后续可查的质量问题。**本轮测试契约对齐与 ThinkingDisclosure 清理仍未 commit**，等用户指示。

2026-09-18 已发布：用户确认后 `./ops.sh deploy --yes` 执行成功（本机测试+构建 → 上传 → 远端 Docker 重建 → Nginx 应用 → 公网探针全绿）。线上 `https://gun.yishuziyu.cn` bundle 已确认为本轮新构建（线上 `assets/index-C7ZQN1Fn.js` 与本地 `apps/dist` 指纹一致，含 `gp-hero`/「调整核查重点」标记），首页 / health / models 均 200。9-17 档案式改版、9-18 输入菜单清理与 Issue #90 修复自此全部公网可见。发布验证只到 bundle 指纹与探针层，未在公网再跑一次完整 live 调查（本地 390s 同案已验）；完整 24/26 案例 live eval gate 仍未执行。**本轮测试契约对齐与 ThinkingDisclosure 清理尚未 commit**，等用户指示。

2026-09-18 发布门槛清理已落地（未提交、未发布）：公网探针 `./ops.sh public` 全绿（`https://gun.yishuziyu.cn` 首页/health/models 均 200，线上是旧版 bundle `index-CCIONZ8N.js`，本地最新构建为 `index-BSY9NwPp.js`）。4 个失败测试从 9-13/9-14 旧契约改到现行契约：ThinkingDisclosure 命题出来后整个不再渲染（删掉组件里只服务旧折叠盒的不可达代码、改正头注释，等待区行为不变）；调查中阅读顺序同场景改为「思考区不再出现」；「调整核查重点」入口测试改为终态出现、提交后走 `handleFollowUp` 开新轮保留本轮（`App.tsx` 里 UI 不可达的 `pendingFocus` 停止替换分支未动，另行清理）。契约 `docs/evals/2026-09-18-release-gate-clearing.md`。改后 apps 全量 **1677 passed / 0 failed / 1 skipped**，根工作区测试与构建、apps 前端/API 构建全绿，`git diff --check` 干净。本地完整 live E2E 一例（隔夜菜亚硝酸盐同案、真实供应商）390s 终态 `completed`，2 条命题 15 条来源，直答「直接致癌站不住、超标百倍尚未查清并写明缺口」，最终报告走设计内的确定性收束路径。SSH 到 `121.89.90.68` 可达，远端 `red-herring-api` healthy。

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
- 旧三栏壳与 `/?legacy=1`：2026-09-28 已删除，可从 tag `legacy-desk-final` 找回。

## 还没做完

- 完整 live eval gate 与最终版本完整真实追问理解质量尚未验收；本轮已分别验证真实运行收束、快照重放和停止链路，不合并宣称整版端到端全绿。
- T20：生产切到 `packages/` 脊柱。2026-09-28 起暂停，`packages/` 冻结，见 `docs/devlog/2026-09-28-pause-t20.md`。
- `qa:contracts` 测的是冻结的 `packages/core`，不是生产代码；待定改指 `apps/` 还是移出门禁。
- `apps/src/lib/v4-ui-e2e.test.ts` 的 framer-motion 检查仍指向不存在的 `mvp/` 路径，永远空跑通过。

更早条目见 `docs/devlog/2026-09-status-archive.md`。不要从 `docs/evals/` 里翻已被取代的「未做」句当现状。
