# 状态档案（2026-09-06 之前）

从 `docs/NOTES.md` 迁出的历史条目。原文照录，未改写；只按日期重排。
新的当前状态仍写 `docs/NOTES.md` 头部。

2026-09-05 PR #55 人工验收三个 blocker 修完（只改契约文档，未动代码，修完停止等复审）：①ROADMAP 现行规则按宪法修订——五词降为顶层语言与导航骨架、不是封闭词表，证据语义（支持/反驳/仅相关/尚缺/争议）可直出用户面前，「拆分过程不呈现」精确定义为不展示模型推理与中间尝试、必须展示拆分结果可对照原句查改题；②「过程默认收着」全文废止，改为「执行过程默认隐藏；调查逻辑（原句→命题→证据关系→缺口/冲突→判断）默认可见并渐进呈现」；③证据透明不再要求「尚缺」绑出处，尚缺是一等 Evidence Gap，无来源就明确写无来源。PRODUCT_SPEC 第二节「默认隐藏」同步新规则，devlog 歧义清单两条了结。
2026-09-05 Product Reset 宪法落盘（Issue #50，阻塞 #51–54，等人工验收）：PRODUCT_SPEC 第一、二节重写——产品定义脱离 Agent/模型/搜索品牌、Evidence Auditability > Agent Observability（白盒 ≠ 展示所有 Agent 行为，白盒是展示判断为什么成立）、白盒三层（命题/证据/判断透明）、唯一 Golden Path（输入→命题拆解→证据汇入→冲突/缺口→判断→来源下钻）、实现层默认隐藏（Agent 名/provider/tool call/token/RRF/pipeline/内部 verdict enum/调试信息）、视觉体验属产品门禁。README 撤「告诉你能信还是不能信」与旧路径图，CONTEXT 顶部标注全表为实现层词汇；旧主路径图废止，追出处收进证据工作。章节号未动，reviews 旧引用仍有效。五词规则与「拆分过程不呈现」均保留并与宪法衔接（契约词管透明对象，五词管用户面前的字；不呈现过程，呈现拆分结果）。只改契约文档未动代码，方向见 `docs/devlog/2026-09-05-product-constitution.md`，验收见 `docs/evals/2026-09-05-product-constitution.md`。
2026-09-05 用户要求到此暂停并提交推送。收尾复核：根测试 core 538 / eval 85 / server 21 / web 83 通过，根 build 通过；mvp 869 通过 / 1 跳过。提交保存现有工程进度、设计裁决与清理；不代表真实调查完整路径或旧 eval:gate 通过，不开 PR、不部署。两份认可设计及必要素材、结果修正版和总览源码纳入版本控制，本地生成清单与清理哈希记录不上传。后续仍先按认可基准对齐原型，再评新增质询位置。
2026-09-05 用户确认设计基准后，进一步要求删除其他旧界面材料。已删除 551 个文件（约 69.4 MiB），包括旧 HTML、截图、参考视频和被否定的首版；两份认可稿及依赖的 57 个文件保持不变。总览已精简为 142 项，当前入口见 `docs/design/2026-09-05-interface-index.md`。前述全量盘点数量属于清理前记录，已删除附件不再作为可打开入口。结果修正版仍待按认可基准对齐并评审，生产接线未推进。
2026-09-05 用户看过界面总览后，明确认可 `packages/web/output/show-me-parts/index.html`（既有零件展示：要 / 不要）和 `packages/web/output/show-me-walk/index.html`（既有用户路径走查：桌面与手机）的设计。后续原型以这两份为具体视觉与交互基准：前者参考零件呈现，后者参考整体界面及桌面/手机路径。此次认可不等于逐项选中了零件页的所有候选，也不等于认可本轮新增质询的 A/B 位置；原稿内的旧开发状态不因此恢复为当前事实。 总览已将这两份置顶并标注「用户已认可设计」。下一步按此基准对齐结果页原型，再评新增质询的呈现。
2026-09-05 用户后续决定：已卸载 Creative Production；安装列表、缓存及独立 MCP 残留检查通过，其他插件状态保持不变。此前修复记录保留，当前以卸载决定为准。
2026-09-05 用户要求展示项目现有设计与界面，已整理本地总览 `http://127.0.0.1:51911/`：当前 mvp、新版五种固定案件、15 份 HTML、历史截图、设计说明、界面源码和视觉素材；参考视频帧单列。709 个原件资源可读取；浏览器已验证主要打开/搜索/关闭路径和新版结果页 390px 展示。原件保持不变，未推进生产质询接线。索引及重启方式见 `docs/design/2026-09-05-interface-index.md`，验收见 `docs/evals/2026-09-05-design-inventory.md`。
2026-09-05 本机 MCP 启动修复：Brilliant 启动本地应用；Cloudflare / Flomo 完成重新授权；Creative Production 同版本重装补齐缺失看板文件。四项握手及工具列表均通过（17 / 3 / 13 / 1 个工具）；尚未在新桌面会话复核启动提示，Brilliant 需保持运行。未改产品代码，详见 `docs/evals/2026-09-05-mcp-startup.md`。
2026-09-05 复合工程技能精简完成：原 33 技能包保留安装、默认停用；本地 ce-handoff 与 ce-compound 改为渐进式披露。新 CLI 总入口 55 → 24，其他技能不变；四个隔离行为场景及格式、引用、包文件哈希检查通过。仅影响本机技能配置，产品工作按下文继续；详情见 `docs/evals/2026-09-05-compound-engineering-opt-in.md`。
2026-09-05 本机 Codex 技能审查：已卸载用户指定的 Data Analytics，停用重复的项目 show-me 入口，并修订五份本地技能；全局和项目 AGENTS.md 均保留。配置/技能格式/CLI 目录验证通过；桌面新会话及模型行为对照未运行，不宣称截断提示或误触发已经解决。详见 `docs/evals/2026-09-05-codex-skills-audit.md`。以下产品状态保持原记录。
2026-09-05 新一轮：用户要求先用临时 HTML 看完成后的结果和关键操作，满意后再继续生产接线；同时同步修订已过时的产品与运行文档。首版独立阅读页被用户指出偏离既有设计，已改为沿用现有 AppShell、品牌、ResearchMemo 排版及右侧卷宗的原型；A/B 只比较新增质询位置；桌面与390px窄屏的卷宗切换、质询展开和出处返回已操作复核，尚待用户认可。预览 `http://localhost:51909/index.html`，本地文件 `.context/compound-engineering/ce-prototype/2026-09-05-investigation-result/01-result/screens/index.html`，验收见 `docs/evals/2026-09-05-investigation-result-prototype.md`。原型不代表真实调查或生产历史验收通过。
2026-09-05 上一轮已按用户要求收尾并暂停，不再派发下一批任务。历史、评论及追加输入账号隔离、有界质询后端已实现；协调者另修了报告摘要/兜底读取首次判断、质询回应遗漏命题或没有说明仍覆盖原调查的问题。公开交锋记录尚未在界面呈现，完整用户路径尚未验收，不能称产品完成。根测试与构建通过；mvp 全量首跑出现一项懒加载等待超时，未改断言原样复跑 869 通过 / 1 跳过；mvp 前后端构建和 diff 检查通过。旧 eval:gate 真跑 eval-1788576784807 留存 15 份 JSONL，现有基线独立解析报 baseline missing metricSemver，已停止剩余调用（exit 143）；没有有效全量门禁结论。未提交、未发布。详细结果及续做项见 `docs/evals/2026-09-05-investigation-continuity.md` 的「结果」。

新方向：生产 mvp 上实现“有证据的质询 → 关键交锋与出处可见 → 调查自动留存并可显式复用”。不再比较 Google/Perplexity，不以旧分数区间驱动设计。验收文档已写明价值优先次序与工程判断；转向记录为 `docs/devlog/2026-09-05-debate-and-history.md`。Grok 已取消；原生 gpt-5.3-codex-spark / xhigh 已实际完成极小空白规范化单元，GPT-6 medium 完成较大的历史与质询单元。现有未提交改动保留，写入串行；协调者负责独立复核。续做顺序更新为先评临时 HTML，用户认可后再接真实质询界面，随后完成真实调查及历史复用浏览器验收。providerRouter 尚无在途取消接口，不要把步骤边界停止说成硬超时保证。

脊柱 T01–T19、T21–T24 已在 `main` / `dev` / `spine`。只剩 T20（上线切换）。生产仍走 `mvp/`，`ops.sh` 未改。

检索：AnySearch 预置。现有 MiniMax Token Plan 与阶跃 Step Plan 已接入 `packages/core` 和生产 `mvp/` 的默认并行检索，复用模型套餐密钥；2026-09-05 协调者从项目适配器活测，两路各返回 8 条带 URL 的结果，生产检索事件同时显示两路完成并保留 provider 归属。设置页把两路列在「已预置」，不要求第二套搜索密钥。360 / Metaso 余额不足，Tavily 超套餐上限，Exa 额度耗尽。接入标准见 `docs/evals/2026-09-05-token-plan-search.md`。首页已按 mvp 排版搬回。案件页有引用芯片、过程折起、检索仪器。走查不满意项已改：立案先出原句、不写 0 条、四字章不当卷宗头、过程不漏 e4、过程只挂当前轮、手机过程能读完。

资格闸目标路径已由协调者复核：嵌入请求的公开事实、请求在前/后、普通类别比较、称呼专名共指、首轮双断言均进入；纯请求和匿名占位停在检索前。旧 `eval:gate` 仍红：最新全量 `eval-1788549137105` 有 19/26 进入最终判断、1 例超时；按固定 26 例看，正确判词为 15/26。失败已定位成四簇：7 例停在资格阶段但缺少独立的 proceed/stop 标签；RUMOR-005 的第二命题遭 MiniMax 敏感内容拦截且 StepFun 无可解析文本后超时；RUMOR-008 把可部分成立的并列内容压成单命题；RUMOR-013/014 出现前提未核实、因果结论已证伪却整句聚合成未核实。旧数据分母漂移，修订标准见 `docs/evals/2026-09-05-qualification-aware-gate.md`。模型候选顺序已改为读取本次 env 中实际配置的 MiniMax、StepFun、DeepSeek、MiMo 和各自模型名，前两家失败后能继续尝试后两家；core 聚焦 20 项、全量 514 项与 build 已由协调者复核通过。真实回归 `eval-1788553228892` 中 RUMOR-005 用 `MiniMax-M2.7-highspeed` 在 51.3 秒内完成，判词 false、分数 2，判词/区间/报告契约/幻觉检查通过；运行因资格标签缺失而明确标为 invalid。该回归又暴露评测器把 hedge 胜出后的备用模型预期取消误记成 4 次 model_failure；修正后 eval 73 项与 build 通过，重放该 JSONL 的 fault 列表为空，原始 attempts 仍保留。

搜索失败已进入内部案件轨迹：每个 claim/query/provider 有 started 和成功、失败或取消终态，记录命中数、耗时与安全错误类别；公开流清除 provider、模型、原始错误、请求标识和耗时。评测区分 healthy/degraded/empty/failed/unknown，只有预期进入核查的 unknown/failed 使运行无效。协调者复核相关 65 项、core 528 项、eval 83 项、根测试与 build 全绿。真实回归 `eval-1788555004931` 在 31.5 秒完成 RUMOR-005，搜索为 degraded：AnySearch、MiniMax、StepFun 正常，4 个旧收费源失败；轨迹同时暴露同一 query 被重复调度。相同 query 的初始检索现已按规范化文本去重，`SEARCH_DISABLED_PROVIDERS` 可在保留密钥时排除明确停用源；本机已停用 360、秘塔、Tavily、Exa，协调者复核聚焦 29 项、core 531 项与 build 通过。报告出口已改为原始 case/claim + 判词 + 该 claim 合法引用的确定性模板，不再调用未使用的 compose LLM；RUMOR-005 不再扩写“图片和视频本身不含恶意代码”。同事实证据相关性仍未解决。真实回归 `eval-1788555347540` 在资格阶段提前停止，同一输入出现一次进入、一次误停；现在首次合法停止会再经一次独立检查，只有原文依据合法且主体明确才翻转进入，协调者复核聚焦 48 项与 build 通过。后续真实回归 `eval-1788555875259` 进入核查并把原句拆成“中毒”“信息被盗”两条，所有 claim/query/provider 只调用一次，且只调 AnySearch、MiniMax、StepFun；StepFun 6 次中 2 次失败，因此 searchHealth 仍为 degraded。该轮 65.6 秒、10 次 LLM 调用、判词 false、引用完整性错误率 0，但 quoteFidelity 仅 0.213、provenanceDepth 仅 0.2，运行仍因资格标签缺失 invalid。原 `hallucinationRate` 已准确改名为 `citationIntegrityErrorRate`，指标版本升至 4.0.0，旧基线拒绝比较；它不再冒充语义幻觉指标。

论证关系的保守锚定修复位于独立 worktree `argument-structure-obligations`，尚未合入当前分支：同一句两段“所以”只接受各自分句内的甲→乙、丙→丁，拒绝跨段补边、无法唯一定位的命题、标点冒充连接词及 cue/kind 冲突。协调者已复核聚焦 14 项与 core build 通过。它只解决“不得编造关系”这一层；关系抽取、关系独立裁决和后续检索执行仍未闭环。

案件页句内原句已接入安全子集：只展示能在单条用户消息中精确锚定的命题和就近出处，墨色中性；没有 relation/cueSpan 时不标推断、不编“系统还要核”。Web 83 tests 和真实多轮 fixture 已复核，窄屏视觉仍等人评。

生产壳判词已从“只能信一部分”拆成“有真有假 / 部分成立”；旧报告、分享区和批量列表都在显示边界兼容，`mvp` 835 tests 与 build 已由协调者复核通过，视觉仍等人评。
2026-09-05 再验生产壳：`mvp` 839 tests 通过、1 跳过，build 通过；但 CMUX 的 5174 首页在 `/api/models/health` 实际返回 `available` 时仍先后显示“无法确认/暂时不可用”，一次 reload 被已注册 service worker 变成白页，注销该本地注册后页面恢复。CMUX WebView 随后又在输入时恢复表面，真实提交未完成。这条用户路径仍是未验收故障，不能用 core eval 通过替代。

本会话把 SCLN 协作层写进仓库：协议 `AGENTS.md`，验收标准 `docs/evals/`，记忆本页，转向 `docs/devlog/`，可迁走包 `docs/METHODOLOGY.md`。不叫「验收卡」：那是独立于实现的完成尺度，不是一张要填的表。`runtime/STATE.md` 不再当工作记忆，hook 不再覆盖它。

## 未标注日期的段落（原文照录）

# 当前状态
# 当前状态
#79在/tmp/rhg-79-shannon单独修改，冻结17项10红→17绿，独立同版61项旧11红→全绿。稳定最终全量仍出现LegacyDesk apodex-run缺失；当前main、#79、#80全量均复现，聚焦单跑main/#79各29通过。#80根801、两处build、server tsc、qa:gate通过，mvp1007通过/1失败/1跳过；机器总门仍GATE_NOT_MET，不自动豁免。LIVE四次额度申请尚未批准，未执行；金额unknown、调用取消硬上限准入尚待实现。根因修复预算到限后仅交证据等复审；不关#53/#54。现存.omo/.statamcp/out未清理。
# 当前状态
# 当前状态（2026-09-08 Shannon #79 实现）

第 1 次修复测量 15/17（related-only 管线 2 红）；第 2 次补齐 merge 丢失 related-only 标记的源头后冻结 17/17 全绿。根因修复：必要原子逐条有支持方向证据才可 true；partial 真侧只认 support；merge/bind 保留显式 related-only，不得重绑升级；缺判词也进入未知边界。生产镜像同步。邻接 99 项通过，根 794 项、根/mvp build、server tsc 通过。mvp 首轮缺依赖与旧规则断言失败保留；补既有依赖后最后全量 1101 过、1 失败、1 跳过（失败套件在启动后被 Validator 最终校正，旧测量已加载）。最终版该套件单独 28/28 通过；因此当前候选所有已执行机器项均通过，但没有将最后全量 exit 1 改称 exit 0。独立 Validator 同版 61 项：旧 HEAD 11 红50绿，当前61全绿；冻结 Shannon 测试hash不变17/17。所有记录在 `docs/qa/artifacts/shannon-79/implement-attempt-{1,2}/`。未跑 LIVE/eval:gate，未提交、推送、合并。
# 当前状态（2026-09-08 Shannon 独立 Validator）
#79 独立合取测试已冻结：17 项，修复前 10 失败、7 通过。旧验收“至少一条 true 有据即可整体 true”已依附件 §3 独立纠正；纠正后的同版测量器在独立旧 HEAD worktree 复测为 33 项、11 失败/22 通过（corrected-before.log）。真实生产管线使用 synthetic 模型/搜索输出和 alive 注入，完整输出与失败日志在 `docs/qa/artifacts/shannon-79/`，验收在 `docs/evals/2026-09-08-shannon-conjunction.md`。独立代理但共享账户，隔离仅 logical-only；无 LIVE 或 eval:gate。未改生产代码，交 Implementer 修复后使用相同测试 hash 重验。
# 当前状态

## 活动

- 脊柱：`runtime/tasks/20260903-casefile-spine.md`（gitignored 细节页）。门槛仍是 eval 门禁。AnySearch 活着之后，门禁在配额上可跑，但会烧 AnySearch + LLM。等人裁。
- 旧任务 `20260902-search-progress-ui` 已 complete。

## 已验证

- 本地 `main`=`dev`=`spine`=`5e3aa69`，已推 `origin`。
- 根 `npm test`：core 508 / eval 34 / server 21 / web 83；`npm run build` 通过（2026-09-05 协调者复核）。
- `mvp`：839 tests 通过、1 跳过；`npm run build` 通过（2026-09-05 协调者复核）。
- `mvp` 有一条 cross-exam 5s 超时，单跑 3.4s 过（合并未改 mvp）。
- 搜索活探测见 `docs/evals/2026-09-04-search-quota.md`。

## 下一步

先请用户判断沿用现有界面的修正版 HTML；批准呈现后再接生产并完成真实调查、五次留存、重开零新增模型/搜索调用及桌面/窄屏验收。旧门禁标签与基线修订另行裁决，T20 继续暂缓。

## 2026-09-29 从 NOTES 头部迁出的「当前状态」段落

原文照录，未改写，保留日期；新的头部只留三行，见 `docs/NOTES.md`。

2026-09-29 修 R11、R12（用户已批准）：接回流与重复提交的订阅写帧前过 `toPublicStreamEvent`；缺 claim、modelChoice 非法、JSON 解析失败三种 400 退还额度名额（R5 随之在这几条路径上恢复 remaining、used 不变）。新增 `handlers.publicScrub.test.ts`、`handlers.earlyRejectQuota.test.ts`（先红后绿），apps 全量 **1498 passed / 0 failed / 13 skipped**（此前 1491），构建通过；golden 相对 `base` 19/20 相同，只有 `g12-duplicate` 少了 `latencyMs`/`systemPrompt`/`model`。契约 `docs/evals/2026-09-29-r11-r12-fixes.md`。未推送。

2026-09-29 行为保持重写（分支 `rewrite/behavior-preserving`，基线 `f96a37f`，契约 `docs/evals/2026-09-29-behavior-preserving-rewrite.md`，计划 `docs/rewrite-plan.md`）。Phase 1 逆向四份文档；Phase 2 录音回放 golden master（`apps/golden/`，20 个服务端场景 + 8 个界面场景，基线标签 `base`、`base-nv`、`ui-base`，见 `docs/golden-scenarios.md`）；Phase 3 目标架构与切片计划。**Slice A 完成**：报告收尾链 → `casePipeline/finalizeReport.ts`（影子差分 116/116 相同）。**Slice B 完成**：`runCasePipeline.ts` 1,541 → 454 行，阶段在 `casePipeline/stages/`，进行态、预算、快照、来源审计刷新各一个模块。**Slice C 完成**：`handlers.ts` 1,337 → 446 行，调查生命周期在 `http/investigationRun.ts`，结局与额度结算表在 `http/runOutcome.ts`。每片都做了变异检查并补了表征测试（`finalizeReport.test.ts`、`runCasePipeline.stageOrder.test.ts`、`sourceAudit.test.ts`、`runOutcome.test.ts`）。golden 与 `base`、`base-nv` 20/20 相同，界面 golden 与 `ui-base` 8/8 相同，apps 全量 **1491 passed / 0 failed / 13 skipped**（删掉 reasoningStore 自己的 4 条测试），前端构建、server tsc、根工作区测试与构建通过。未修的问题 12 条在 `docs/rewrite-issues.md`（新增 R11：接回与重复提交的流不做公开清洗；R12：被拒绝的请求也占掉访客当天的免费次数，已实测）。**Slice D 完成**：App.tsx 923 → 558 行，账户水合、刷新接回、结果落库各一个 hook（`apps/src/app/`）；先补了 4 条界面交互流程 golden。浏览器验收 Ego 7/7 + Chrome 走查通过（回放后端 `golden.ts serve`）。**Slice E 完成**：删无消费者的 `reasoningStore`（722 行）与 handlers 里没被读过的配置变量，更正 R4 注释。下一步 Phase 6 收尾报告，等用户裁决 `docs/rewrite-issues.md` 的 12 条。

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
