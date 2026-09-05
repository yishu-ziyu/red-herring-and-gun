2026-09-06 PR #56 复审 blocker 修完（改完停止，等人工复审）：`buildInvestigationSnapshot` 改 `{key, text}` 分离——`claimAtomKey`（全角空格规范化 + 180 字截断加省略号）只做 identity join（去重/verdict/bundle/types/crossExam/pursuit），`claim.text` 用 self-proof kept atom 真实文本（仅 trim），`originalSpan` 按真实文本回原句；冲突循环原先 `verdicts.get(claim.text)` 在 text=键 时碰巧成立，改按 assembly 携带的 key join。新增 2 测试：>180 字命题 text 不截断且经键正常 join、全角空格命题键规范化但展示文本原样。验收见 `docs/evals/2026-09-06-investigation-snapshot.md` 复审节：根 core 578 / eval 85 / server 21 / web 83、mvp 885 过 1 跳过、根 build、mvp build、server tsc 全绿；eval:gate 仍未跑（同前次理由，等人裁）。

2026-09-06 Issue #51 白盒调查数据契约实现完（独立 PR 待人工验收）：`InvestigationSnapshotV1` 源文件在 `packages/core/src/investigation/`（schema+确定性 builder+invariants），生产 `mvp/server/src/lib/investigation/` 是字节级镜像（部署只打包 mvp/，server 不能运行时依赖工作区包；两侧漂移守卫测试，改一侧必红）。web 经 `@rhg/core/investigation` 消费同一 schema（契约测试）。生产接线：`runCasePipeline` 新钩子 `onInvestigationSnapshot` 在 received→decomposed→investigating（检索开始/返回，来源 unassessed）→judging（核查/补查/质询）→complete 八个语义里程碑发完整快照；完成态写 `finalReport.investigation`；handlers 发 SSE `investigation_snapshot`，超时/断连/失败补 phase=interrupted 帧（保留已获数据、不补造 conclusion）；`GET /api/case/:id` 对旧历史确定性重建（error-boundary 重建为 interrupted，不启动模型/搜索）。冲突只来自证据层双方并存（crossExam 只补 reason，质询未运行不影响冲突存在），reason 未知如实 unknown。机器验收全绿：根 core 576/eval 85/server 21/web 83，mvp 885 过 1 跳过，根 build、mvp build、server tsc 全过。eval:gate 未跑：本期不改判词/检索/评分逻辑（只加只读快照事件与字段），旧 gate 基线仍 invalid（资格标签缺失，与本改动无关），如需全量回归等人裁。未做 #52/#53/#54；pi agent loop 路径不发实时快照（其历史报告走同一确定性重建）。

2026-09-05 PR #55 人工验收三个 blocker 修完（只改契约文档，未动代码，修完停止等复审）：①ROADMAP 现行规则按宪法修订——五词降为顶层语言与导航骨架、不是封闭词表，证据语义（支持/反驳/仅相关/尚缺/争议）可直出用户面前，「拆分过程不呈现」精确定义为不展示模型推理与中间尝试、必须展示拆分结果可对照原句查改题；②「过程默认收着」全文废止，改为「执行过程默认隐藏；调查逻辑（原句→命题→证据关系→缺口/冲突→判断）默认可见并渐进呈现」；③证据透明不再要求「尚缺」绑出处，尚缺是一等 Evidence Gap，无来源就明确写无来源。PRODUCT_SPEC 第二节「默认隐藏」同步新规则，devlog 歧义清单两条了结。

2026-09-05 Product Reset 宪法落盘（Issue #50，阻塞 #51–54，等人工验收）：PRODUCT_SPEC 第一、二节重写——产品定义脱离 Agent/模型/搜索品牌、Evidence Auditability > Agent Observability（白盒 ≠ 展示所有 Agent 行为，白盒是展示判断为什么成立）、白盒三层（命题/证据/判断透明）、唯一 Golden Path（输入→命题拆解→证据汇入→冲突/缺口→判断→来源下钻）、实现层默认隐藏（Agent 名/provider/tool call/token/RRF/pipeline/内部 verdict enum/调试信息）、视觉体验属产品门禁。README 撤「告诉你能信还是不能信」与旧路径图，CONTEXT 顶部标注全表为实现层词汇；旧主路径图废止，追出处收进证据工作。章节号未动，reviews 旧引用仍有效。五词规则与「拆分过程不呈现」均保留并与宪法衔接（契约词管透明对象，五词管用户面前的字；不呈现过程，呈现拆分结果）。只改契约文档未动代码，方向见 `docs/devlog/2026-09-05-product-constitution.md`，验收见 `docs/evals/2026-09-05-product-constitution.md`。

2026-09-06 搜索策略一期验收通过（机器全绿，人评待补）：npm test、build、mvp 870 项过，定向 46 项过；双路查询、硬超时 2.5 秒、同站限流保支撑反证、新度语义、HopTrace 脱敏兑现。eval:gate 全量误触发一次判 invalid，主因资格标签缺失加配额超时噪声，非本期断言失败，不重跑。人评待看：出处精确到段、过程只挂当前轮、手机可读。

2026-09-06 搜索策略一期实现完定向验证：双路查询、同站限流保支撑反证、新度语义加成、单页硬超时，定向 46 项绿，全量 npm test/build/mvp 验证中，待独立验收。

2026-09-06 截图/转述类合成 20 条试验：直接出处 6、相似线索 7、无抓手 7。约 6 条配得上进回归集，其余当查不清例或太空。形状自查零违反是手写循环论证，不证明生成器行。验收见 `docs/evals/2026-09-06-screenshot-synth.md`。

2026-09-06 搜索策略迭代一期实现中：新建 `semanticRecall.ts`（确定性本地语义，字级 dice，电瓶车→电动车零词交集可召回），`atomSearchQuery` 加双路查询与合集沉底，`retrievalFilter` 加同站限流 2 条保支撑反证、新度、语义加成与 hop trace，`searchAll` 加单页硬超时 2.5 秒与脱敏。46 项定向通过，全量验证跑 `npm test` 中。

2026-09-06 提示词按行家改法重写，规则版换成 5 条硬要求加 8 个例子。5 条标准谣言形状和可查性全对，同一句 3 次同形，代价是单次从 10 秒涨到 13 到 31 秒。`decompose` 26 项通过。证据见 `docs/evals/2026-09-06-atom-split.md`。

2026-09-06 Invent-a-Dataset 模拟试验：10 条合成变体 5 条有直接公开出处、4 条还查不清、1 条立场不查。结论是当 eval 输入可用、当证据不可用，合成句不进证据链。验收见 `docs/evals/2026-09-06-invent-dataset-trial.md`。decompose 26 项通过。

# 当前状态

2026-09-06 用户要求把本地全部改动收进 `main` 并推远端，只留 `main` 一条分支。`dev` 与 `spine` 本地和远端均删除。独立 worktree `argument-structure-obligations` 目录已不在磁盘，未能合入。仓库：https://github.com/yishu-ziyu/red-herring-and-gun

2026-09-06 搜索策略迭代一期实现已提交：双路查询、同站限流保支撑反证、新度语义加成、单页硬超时 2.5 秒、HopTrace 脱敏。验收见 `docs/evals/2026-09-06-search-strategy-iter.md`，方向见 `docs/devlog/2026-09-06-search-strategy.md`。人评待看：出处精确到段、过程只挂当前轮、手机可读。

2026-09-06 提示词调优第一轮。5 条标准谣言量出底：4 条形状对，点图片会中毒那条被标成不可查，后面无东西可查。原因是能力断言被当成未来预测。提示词加一段能力与风险断言按事实或因果标可查，再跑翻成因果可查，空调床垫那条不变。新代码和线上版本同步加。分工：提示词管方向对不对，降温管稳不稳定。

2026-09-06 模型次次不一样的原因找到并修了。填表类调用没传 temperature，用的是服务商默认，同一句 9 次跑出三种样子。行家的做法是填表降温加投票，我们先降温：填表走 temperature 0，写报告保留默认，开 thinking 的不带。新代码和线上版本同步改。同一句再跑 3 次，次次拆成空调床垫两条。`core` 541 项、`mvp` 相关 43 项通过。temperature 0 收的是形状，措辞还会有小差别。

2026-09-06 找到删光的原因。真模型又跑 4 次，有一次自带床垫四个字被长度规则扔了，因为老规则 6 个字以下全扔。现在 6 改 4，4 个字能装下完整意思。长度只用来去掉一到三个字的残渣，是不是完整意思由第二遍检查和原文对照来定。`decompose` 26 项通过。删除原因一共三种：原句没说、太短不成句、命题一半字在原句找不到，每次删都记理由。

2026-09-06 原子拆分第二轮：位置标的不准修完，并列合成一条也修完。`decompose` 25 项通过。真模型连跑 5 次，同一句话出现过拆成两条、合成一条、全部删掉三种样子，现在三种都接得住：拆对的直接过，合成的加一道并列复核拆开，位置标错的校准回床垫二字，原句没说的内容删掉。验收见 `docs/evals/2026-09-06-atom-split.md`。本轮会话优先于历史文档。

2026-09-06 本轮会话定三件事，优先于历史文档，冲突改文档：产品对外只用说法、出处、判断、追问、历史五个词；路线图见 `docs/ROADMAP.md`，说法已定；原子拆分删掉关键词名单，验收见 `docs/evals/2026-09-06-atom-split.md`，`decompose` 20 项通过。下一步按顺序议出处。

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

## 活动

- 脊柱：`runtime/tasks/20260903-casefile-spine.md`（gitignored 细节页）。门槛仍是 eval 门禁。AnySearch 活着之后，门禁在配额上可跑，但会烧 AnySearch + LLM。等人裁。
- 旧任务 `20260902-search-progress-ui` 已 complete。

## 已验证

- 本地 `main`=`dev`=`spine`=`5e3aa69`，已推 `origin`。
- 根 `npm test`：core 508 / eval 34 / server 21 / web 83；`npm run build` 通过（2026-09-05 协调者复核）。
- `mvp`：839 tests 通过、1 跳过；`npm run build` 通过（2026-09-05 协调者复核）。
- `mvp` 有一条 cross-exam 5s 超时，单跑 3.4s 过（合并未改 mvp）。
- 搜索活探测见 `docs/evals/2026-09-04-search-quota.md`。

## 本机坑

- `diff` 被包装，用 `cmp`。
- `git log --oneline` 藏 merge commit。
- `grep` 是 rg，括号要转义。
- eval/server 跑 `packages/*/dist`，core 改完先 `npm run build`。
- 不要并行两个真 key eval。
- vite `--fixture` 会被拒，fixture 走 `/cases/fx-*`。

## 下一步

先请用户判断沿用现有界面的修正版 HTML；批准呈现后再接生产并完成真实调查、五次留存、重开零新增模型/搜索调用及桌面/窄屏验收。旧门禁标签与基线修订另行裁决，T20 继续暂缓。
