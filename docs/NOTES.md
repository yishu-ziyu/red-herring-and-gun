# 当前状态

2026-09-10 完成态结果页第一视觉稿（P0+P1）实现中：独立分支 `cursor/result-page-memo-dd88`，验收 `docs/evals/2026-09-10-result-page-memo.md`。P0 加强 ConclusionHero 文书层级（衬线 700 + clamp 字号 + 墨色 + 判断色细下划线）；P1 证据行左侧固定关系标签并默认展示已有 excerpt，SourceDrawer 把摘录提前并加重。P2 并排冲突卡未做。机器项待跑。

2026-09-09 模型设置页（ApiKeySettings）视觉重构完成（独立 PR 待人工验收）：按 `docs/evals/2026-09-09-api-key-settings-redesign.md` 契约把 `/settings/api-key` 从旧 `--zt-*` 表单样式换成主站 `--gp-*`（Quiet Editorial / Golden Path）设计语言，结构化卡片分区（页头导航与说明、服务商药丸卡片组、端点与凭证表单、操作与测试状态徽标、底部安全 Callout），Key 显隐切换、测试 loading 与成功/失败状态徽标；`gun-byo-key` 本地持久化、`/api/agent/test-llm`、既有业务契约零变更。底部安全 Callout 文案经用户裁决换成说人话方案 A（旧「base64 不是加密」披露是 7-06 a8d0987 引入的实现层行话，违反宪法实现层默认隐藏，已换并同步测试断言）。样式解耦为专属 `mvp/src/components/v3/settings/ApiKeySettings.css`（`styles.css` 中 `api-key` 引用归零，`prefers-reduced-motion` 三条规则随迁专属段）。门禁：根 core 612 / eval 85 / server 21 / web 83 全绿，根 build 通过，mvp 1011 过 / 1 跳过 / 0 失败（含 ApiKeySettings 17 项；上次会话 npm test 后台复跑中断，本结果为完整复跑），mvp build 通过；文案更换后 ApiKeySettings 17 项复跑全绿。真实浏览器截图取证归档 `docs/design/2026-09-09-api-key-settings/`（桌面整页 / 390 手机整页 / 首页对照；手机整页截图底部第二份页头经 DOM 核查为 fullPage 截屏伪影，非产品缺陷）。已查明密钥流：BYO key 目前只用于本地保存与 test-llm 连接探针，真实调查管线用服务端 env 密钥；用户已裁决「key 真接管」方向，另立工作包实现。

2026-09-09 输入卡片双重焦点环修复：用户点击输入框出现外层卡片蓝框与内层可编辑框蓝框嵌套问题已定位并修复。在 golden-path.css 中收口 .gp-input-card #claim-input:focus-visible 及 [contenteditable="true"]:focus-visible 消除内层重复 box-shadow 与 outline，由外层卡片统一承担聚焦反馈；保留卡片内按钮独立 focus 环。新增单元测试保护；cmux 真实聚焦截图连通域分析证实蓝色块从 2 降为 1。根 core 612 / eval 85 / server 21 / web 83 全绿，根 build 全绿，goldenPath 94 项全绿，mvp 1008 过 1 跳过 1 失败（LegacyDesk 已知项维持）。验收见 docs/evals/2026-09-09-input-focus-ring.md。

2026-09-08 PR #81 复审 5137757199：投机预取改为显式消费 rejection，loader 失败仍清缓存并拒绝。独立冷加载测试覆盖挂载预取、fallback、apodex-run、失败复位。transform 争用标成候选解释；本轮改动前 main 全量已通过。LIVE 方案已定义尚未接线验证，未执行。不合并、不关 #53/#54。

2026-09-08 从 main `861386d` 开独立窄分支 `fix/legacy-desk-full-suite`：定位 LegacyDesk 全量「missing apodex-run」。历史失败 DOM 停在「正在打开核查工作台…」。本轮改动前同一机器 main 全量通过，transform 争用是候选解释不是已证唯一根因。定向防护为挂载预取 + 失败清缓存；业务套件 beforeAll 预热属测试隔离。HEAD 收据以 GitHub pre-release 交付，不改 #79/#80 SHA。LIVE 四次仍待批准。不合并、不关 #53/#54。

# 当前状态

2026-09-08 Shannon 增量已落地，两个原 PR 待人工复审，均不合并：#80 报告覆盖/执行/验收分开，完整 Python 26项自检通过；原5负例与追加4完整性负例分别有独立旧红新绿。收据绑定 candidate/campaign/dirty/diff、instrument/inventory/result hash、允许命令与必要检查，LIVE需后端真实绑定JSON，回放需可解析PNG/ZIP与evaluation。qa:gate明确包含Python自检，依赖安装见docs/qa/README.md。

qa:replay使用未改写的real-after-76 complete.json和生产DEV adapter；首跑27项机械通过但独立截图复核判取证不合格，已修recorder并重跑27/27，sandbox错绑被抓6项FAIL。独立Simulator完成18动作/五問，指出历史输液无证据却被整体否定的矛盾；该历史失败保留，不能算医学语义通过。证据在docs/qa/artifacts/shannon-replay，f3b9901候选的实际机器/回放收据归档于docs/qa/artifacts/shannon-80-candidate-f3b9901；后续纯证据提交的最终HEAD复验收据输出out/shannon-80-review-head（以各自候选绑定为准）。全清单未测项继续可见，真人HUMAN_VALIDATION_PENDING。

#79在/tmp/rhg-79-shannon单独修改，冻结17项10红→17绿，独立同版61项旧11红→全绿。稳定最终全量仍出现LegacyDesk apodex-run缺失；当前main、#79、#80全量均复现，聚焦单跑main/#79各29通过。#80根801、两处build、server tsc、qa:gate通过，mvp1007通过/1失败/1跳过；机器总门仍GATE_NOT_MET，不自动豁免。LIVE四次额度申请尚未批准，未执行；金额unknown、调用取消硬上限准入尚待实现。根因修复预算到限后仅交证据等复审；不关#53/#54。现存.omo/.statamcp/out未清理。

2026-09-08 工作包 B「QA 基础」实现完（独立分支 `qa/product-acceptance-foundation` 基于 main `861386d`，独立 PR 待人工验收；不替 #79 宣告通过，不启 #54，qa:live 未实现未获批）：新建 `docs/evals/2026-09-08-product-qa-contract.md`（QA 契约与工作包 B 验收标准：状态语义/运行模式×driver/缺陷字段/预算/隔离等级如实 logical-only）、`docs/qa/behavior-inventory.yaml`（13 条必需行为，每条含任务书要求的 10 字段；3 covered（repo-suite 证据）/5 partial/2 pending-audit/3 blocked，不把已实现当分母）、`docs/qa/public-scenarios.yaml`（两条历史诊断输入 + #54 五类案例骨架，dossier 全部 PENDING 不伪造）、`docs/qa/pending-after-79.yaml`（依赖 PR #79 的 14 个高风险组合逐条登记对应回归，合入后转公开回归）、`docs/qa/lessons.md`（空脚手架）。三个 npm 入口：`qa:report`（scripts/qa/qa_report.py，fail-closed：行为 schema 强制 10 字段、trial 记录强制 execution_mode×driver×版本绑定字段、PASS 必须有 evidence_refs、backend_sha unverified 不产生 PASS、报告门 GATE_NOT_MET/AUTOMATION_PASSED_HUMAN_PENDING；unittest 10 项自检含「评分器抓住已知错误」反例）、`qa:contracts`（packages/core/src/text/qa/contracts.test.ts，7 项 main 不变量：#74 分桶/双桶关系/marker clamp/merge 纪律/全局归一）、`qa:smoke`（scripts/qa/qa_smoke.py，浏览器工具探针实测通过，缓存 Chromium 回退，TOOL_PROBE_ONLY 不对产品断言）。`qa:replay`/`qa:live` 只登记未实现，无同名假脚本。实测：qa:report 空证据 exit 1（7 NOT_RUN/3 PASS/3 BLOCKED），根 612+85+21+83 全绿，根 build 0，mvp/生产源码零改动。与 PR #79 的 NOTES 顶部条目并行，两分支合并时按时间序保留两条。


# 当前状态

2026-09-08 Shannon #79 修复后停止等复审：冻结17项10红→17绿，同版独立61项旧11红→全绿。仅修必要命题支持覆盖、partial真侧方向、merge/rebind保留related-only；未改UI/Schema/Audit架构。根794、两处build、server tsc通过。最终稳定mvp全量1101过1失败1跳过；当前main全量1007过同1失败1跳过，均LegacyDesk缺apodex-run，main/candidate聚焦单跑均29过。失败收据保留，机器总门仍未通过，未改Legacy、未作自动豁免。费用未授权，LIVE与eval:gate未跑；不合并、不关#53/#54。证据见docs/qa/artifacts/shannon-79/final-mvp-comparison.json及validator-after-receipt.json。最大2次根因修复已用，交证据等人裁。

2026-09-08 #79 独立最终 Validator：同版三套纠正后测量器，旧 HEAD 11 失败/50 通过，修复候选 61/61 通过。冻结 Shannon 17 项 hash 未变，完整 Snapshot/directAnswer 与引用落点通过；证据 `docs/qa/artifacts/shannon-79/validator-{before,after}-receipt.json`。合成生产管线、logical-only；不等同浏览器或 LIVE 验收。

# 当前状态（2026-09-08 Shannon #79 实现）

第 1 次修复测量 15/17（related-only 管线 2 红）；第 2 次补齐 merge 丢失 related-only 标记的源头后冻结 17/17 全绿。根因修复：必要原子逐条有支持方向证据才可 true；partial 真侧只认 support；merge/bind 保留显式 related-only，不得重绑升级；缺判词也进入未知边界。生产镜像同步。邻接 99 项通过，根 794 项、根/mvp build、server tsc 通过。mvp 首轮缺依赖与旧规则断言失败保留；补既有依赖后最后全量 1101 过、1 失败、1 跳过（失败套件在启动后被 Validator 最终校正，旧测量已加载）。最终版该套件单独 28/28 通过；因此当前候选所有已执行机器项均通过，但没有将最后全量 exit 1 改称 exit 0。独立 Validator 同版 61 项：旧 HEAD 11 红50绿，当前61全绿；冻结 Shannon 测试hash不变17/17。所有记录在 `docs/qa/artifacts/shannon-79/implement-attempt-{1,2}/`。未跑 LIVE/eval:gate，未提交、推送、合并。

# 当前状态（2026-09-08 Shannon 独立 Validator）

#79 独立合取测试已冻结：17 项，修复前 10 失败、7 通过。旧验收“至少一条 true 有据即可整体 true”已依附件 §3 独立纠正；纠正后的同版测量器在独立旧 HEAD worktree 复测为 33 项、11 失败/22 通过（corrected-before.log）。真实生产管线使用 synthetic 模型/搜索输出和 alive 注入，完整输出与失败日志在 `docs/qa/artifacts/shannon-79/`，验收在 `docs/evals/2026-09-08-shannon-conjunction.md`。独立代理但共享账户，隔离仅 logical-only；无 LIVE 或 eval:gate。未改生产代码，交 Implementer 修复后使用相同测试 hash 重验。

2026-09-08 PR #79 人工 Review（review_id 5128449568）三个 correctness blocker 修完并推回同一分支，未开新 PR（修完停止，等人工复审，不 merge，不启动 #54，不做 QA 平台）：Blocker 3 先立共享方向契约 `citationBinding.hasDirectionalBoundHttpUrl`（mvp/server 与 packages/core/src/text 字节镜像）——true/trueish 只认 supportingSources、false 只认 contradictingSources（#74 alignment 先行）、related-only 永远不算，merge guard（demoteUnsourcedTrueFalse）、deriveOverallVerdict、applyConclusionGate 的 hasSourcedFalseVerdict 三处同换，verdictHasBoundHttpUrl 并集仅留给「完全无绑定 vs 有绑定」区分；Blocker 1 needsConstrainedConclusion 新增第四触发——终态硬 verdict 但存在 unresolved/方向无据 checkable 原子（listUnresolvedCheckableAtoms）时重建，规则 hard-verdict-with-unverified-boundary，overall 由有据 Claim 支撑时保留，repair 文本带「「X」尚未查清，未计入该判断」边界，弱 verdict 的 hasSourced 同步改方向契约；Blocker 2 audit 改 fail-closed——Planning 的 missingJustifications 一旦产出立即成为保守 gap 基线，Evaluation 失败（null）记 evaluationStatus="failed"、预算不足记 "skipped-budget"，两态都写结构化 rumorStep.output.wholeClaimAudit artifact 且缺口不静默清空，只有成功 Evaluation/authoritative re-evaluation 能更新或关闭；WholeClaimAuditRun 加可选 evaluationStatus（实现层字段，非 Snapshot schema）。新增回归 12 项，反例先行（修复前单测 9 红 + 管线 5 红）。机器：根 605 加 85 加 21 加 83 全绿，mvp 1085 过 1 跳过零失败（LegacyDesk 本轮未复现，仍是已知抖动），根 build、mvp build、server tsc 全绿，镜像 diff 为空，无 schema/UI 触碰。eval:gate 未重跑（基线既有原因且需模型费用授权，等人裁）。验收见 `docs/evals/2026-09-08-review-5128449568-blockers.md`。

2026-09-07 PR #79 人工 Review（review_id 5128220693）三个发布一致性 blocker 修完并推回同一分支，未开新 PR（修完停止，等最终复审，不 merge，不启动 #54；本轮禁止重新设计 Whole-Claim Audit）：Blocker 1 给 needsConstrainedConclusion 增加第三触发条件，终态仍是合法硬 verdict 但存在 nonVerifiableAtoms 时同样 repair，只补边界不降级，overall false 与 true 继续由有据 Claim 支撑；Blocker 2 新增 buildScopedEvidence，按判词顺序建全局 source index，把每段判词 evidence 的局部 marker 显式映射到全局编号，映射不到的删除，repair 不再直接复制局部 marker；Blocker 3 修 pruneDeadCitations 的 evidenceChain 层，网址与非网址来源分开处理，全死时 sourceRefs 保持空数组不再恢复原始死链，chain-only 网址纳入探活候选。新增回归 8 项（触发判断 2、作用域转换 3、硬保留 repair 1、管线 1、探活 1）。机器：根 605 加 85 加 21 加 83 全绿，mvp 1067 过 1 跳过 1 失败（LegacyDesk 已知抖动，基线对照同失败），根 build、mvp build、server tsc 全绿。约束保持：无关键词规则、无 Schema 改动、无 UI、无 Planning 与 Evaluation 改动、无 extra-pass 数量改动、无旧 REAL artifacts、无 baseline 与 LegacyDesk 改动。验收见 `docs/evals/2026-09-07-whole-claim-audit.md` §13。
2026-09-07 PR #79 人工 Review（review_id 5128022550）三个 blocker 修完并推回同一分支，未开新 PR（修完停止，等人工复审，不 merge，不启动 #54）：Blocker 1 把权威 final gate 移到探活之后，以存活证据为准，探活改为双桶对称（support 与 contradict 各自独立过滤去重，同跨桶保留两条 relation，本地编号按过滤后 support 再 contradict，不破坏 #74），死证剔除后无支撑的硬 true 与硬 false 直接收为 unverified，短谣豁免只看按 deadUrls 过滤后的聚合来源是否仍成立；Blocker 2 新增重判提交状态（recheckCommitted 加 newlyBoundEvidenceUrlsByAtomKey），只有 search 得新来源、重判成功、目标判词合法、bind 后形成非 related-only relation 且实际引用新 URL 时，第二次 Evaluation 才有权关闭旧 gap，否则保守沿用第一次，compactVerdicts 区分 support 与 contradict 与 relatedOnlyCount，Evaluation prompt 同步声明 related-only 不是支持证据；Blocker 3 新增 needsConstrainedConclusion，只读最终结构状态决定是否重建用户可见文本，覆盖 reviewer 与 finalize 降级、弱 draft 越权、无 audit 旧流程，结构干净的弱结论保留 composer 原文，repair 后重放幂等的原图出处落点。新增回归 14 项（探活双桶 2、gate 与触发判断 12、管线 6），既有两处硬结论测试与电瓶车短谣测试注入 alive 探活使其 hermetic（意图不变），investigation 完成帧断言同步为重建后的一致文本。机器：根 605 加 85 加 21 加 83 全绿，mvp 1060 过 1 跳过零失败，根 build、mvp build、server tsc 全绿；LegacyDesk 单跑在本轮与基线下同样失败一例，属已知负载抖动。约束保持：无关键词规则、无 Schema 改动、无 UI、无旧 REAL artifacts、无 baseline 与 LegacyDesk 改动。验收见 `docs/evals/2026-09-07-whole-claim-audit.md` §12。
2026-09-07 PR #79 人工 Review（review_id 5127740625）三个 blocker 修完并推回同一分支，未开新 PR（修完停止，等人工复审，不 merge）：Blocker 1 用结构化状态触发的受约束 conclusion repair（repairGatedConclusion，不读原文、不做关键词匹配）让 gated verdict 与最终用户可见 directAnswer、summaryForPublic、evidenceChain 一致，Case 5 最终 directAnswer 不再把 not-applicable Claim 写成已证伪；Blocker 2 让 Whole-Claim consistency gate 成为最终 gate（early 在 boundTiny 之前加 final 在 reviewer 之后、探活之前，legacy tiny-bound 提 false 前先用同一 contract 做 probe，不通过不提），mixed 与 unverified 不能再被后续 legacy mutator 推回 false；Blocker 3 在 extra pass 取得新来源加 fact_checker 重判后加一次 bounded re-evaluation，第二次 Evaluation 的 missingJustifications 为准，旧 gap 可以关闭，重评估失败或者无新来源或者预算不足就保守沿用第一次。最坏 LLM 调用从 3 次变成 4 次，latency 上限不变（同一 composer reserve 约束）。新增回归 5 项（repair 单元 2 项、Case 5 directAnswer 一致性、tiny-bound 绕过、re-evaluation 闭环），验收文档见 `docs/evals/2026-09-07-whole-claim-audit.md` §11。机器：根 605 加 85 加 21 加 83 全绿，mvp 1040 过 1 跳过零失败，根 build、mvp build、server tsc 全绿。不改 Snapshot schema，不改 UI，不碰旧 REAL artifacts，不处理 baseline 与 LegacyDesk。

2026-09-09 BYO key 接管调查管线（key 真接管）实现完（独立分支 feat/byo-key-takeover，验收 ACCEPT，独立 PR 待人工验收）：用户已裁决「key 真接管」——orchestrate-stream 请求携带设置页保存的密钥（localStorage gun-byo-key），服务端四个主力 LLM 调用（runAgent/自证/改写/交叉质询）改烧用户 key（request-scoped，不落盘不进日志不进公开流），MiniMax/阶跃 key 同时供该家检索额度（token plan 复用，其他家检索仍走服务端 env 预置），fail-closed：凭证失败以用户可读错误收尾、零 env 回退，配额闸 requireQuota 不变，历史重放不需要 key。新增 mvp/server/src/lib/orchestrateByo.ts（校验+SSRF 防线+直调+检索凭证绑定）与前端 byoKeyRequest/请求体接线，27 项新测试。独立验收官 ACCEPT；其单列安全观察第 2 条（http://localhost.evil.com 前缀穿透明文收密钥）已在本分支修复（共享 isLocalHttpUrl 按 hostname 精确判定，parseByoConfig 与 test-llm 同口径），第 1 条（?execution=loop 调试路径绕过 BYO，UI 不可达）与第 3 条（byo_key_failed 白名单帧将来不得挂 error 字段）登记为后续项。门禁：mvp 1035 过 / 1 跳过 / 0 失败，根 core 605 / eval 85 / server 21 / web 83 全绿，两处 build exit 0。验收见 docs/evals/2026-09-09-byo-key-takeover.md。

2026-09-06 Issue #66 生产集成验收进行中（独立 PR 待人工验收，不 merge、不关 #53、不启 #54）：从 main `e560485` 开独立分支 `feat/reset-4f-production-integration`。真实输入「维生素C能治感冒，而且每次感冒都应当输液。」走完 received→decomposed→investigating→judging→complete（193s，REAL SSE）。Claim Trace 两段 exact span；Evidence Settling `claim-1:src-1` unassessed→support 且回放 DOM before===after；Conclusion region 不 remount、scrollY=0；Source Drawer live + keyboard 闭环。产物 `docs/design/2026-09-06-mode3-production/final/`，SOURCE.md 分清 REAL SSE / REAL SNAPSHOT REPLAY / FIXTURE。直播 DOM 跳过 decomposed 一帧，用同次 JSON 回放补截图。Producer gap：claim-2 否定输液的 finding 被标 support，未手改数据、未改 backend。Vercel #58 不混本分支。

2026-09-06 Issue #52 Golden Path 前端重构实现完（独立 PR 待人工验收）：生产默认路径换成 `goldenPath/`（ProductShell 轻量 Chrome、InputStage 输入态、InvestigationCanvas 同画布调查→完成、ClaimSection 证据空间、SourceDrawer 下钻、ConclusionHero 直接回答首层）；`investigation_snapshot` 一等 typed 事件，`useInvestigationRun.applyRunEvent` 纯 reducer 只认 snapshot/complete/error，legacy Agent/tool/search/consensus 事件显式忽略（负向测试：只喂 legacy 事件不产生任何产品语义；goldenPath 源码扫描无实现层词汇）；旧三栏壳整建制退 `/?legacy=1`（LegacyDesk.tsx，原 App 测试随迁继续守护）；imageOrigin 从 finalReport 读（found 独立卡/not_found 全局缺口，不进命题证据）；历史打开本地 KB 优先+服务端兜底、零重跑；DEV `?fixture=` 脚本化快照驱动真实组件树（生产 dead-code eliminate）。真实端到端跑通（维生素C句：received→investigating 2命题5来源待核对→complete 直接回答）。13 张真实运行截图在 `docs/design/2026-09-06-golden-path/`。门禁：根 core 578/eval 85/server 21/web 83、mvp 908 过 1 跳过、三处 build 全绿。坑：IAB 截图 goto 会重置视口（先 goto 再 setViewport）；窗格缩放使 Playwright 坐标 click 落点偏移，交互用原生 evaluate click。

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

2026-09-09 BYO key 接管调查管线实现完（分支 `feat/byo-key-takeover`，验收契约 `docs/evals/2026-09-09-byo-key-takeover.md`，机器项全绿，等提交与人工验收）：用户在模型设置页保存的密钥现在随 `/api/agent/orchestrate-stream` 请求上行（`payload.byoKey`，前端新增 `mvp/src/lib/byoKeyRequest.ts` 读 localStorage `gun-byo-key`，未保存时请求体与现状零差异）；服务端新增 `mvp/server/src/lib/orchestrateByo.ts`（配置校验含 https-only 与内网 SSRF 防线、OpenAI 兼容直调、检索凭证绑定、ByoKeyError），`orchestrate.ts` 四个主力调用器（runAgent/自证/改写/交叉质询）在 BYO 存在时全部直调用户端点并忽略 modelChoice 的主力模型语义（endpoint 与 model 成对）；检索凭证按 BYO 域名命中换用户密钥（MiniMax 含 minimaxi.com/.minimax.io/.minimax.cn 域族、阶跃 api.stepfun.com，其余端点检索仍全走服务端 env）；失败语义 fail-closed：鉴权/网络失败经独立 abort 源中止管线，流以 `code=byo_key_failed` 的用户可读密钥错误收尾并退还名额（`toPublicStreamEvent` 为该服务端手写固定文案开白名单，不含密钥与诊断），零 env 回退；畸形 byoKey 回 400 并先退名额；配额闸 `requireQuota` 与 `index.ts` 零改动。密钥只存在于请求内：案例存档形状、console 输出、公开流事件均经测试断言不含密钥值。新增 26 项测试（`server/src/lib/orchestrateByo.test.ts` 20 项覆盖契约 Evaluator 1-4 含接管两向断言、检索绑定、整流 fail-closed、不落盘；`src/lib/agentExpansion.byo.test.ts` 6 项覆盖请求体携带与零变化），门禁：mvp 1034 过 1 跳过（1008 基线 + 26 新增，零失败）、根 794 过（core 605/eval 85/server 21/web 83）、根 build、mvp build、两侧 tsc 全绿；eval:gate 未跑（本期不改判词/检索/评分逻辑）。已知边界：`?execution=loop` 调试路径的主模型调用仍走 env（pi 会话不在本期四个主力调用器范围，UI 不可达）；设置页「保存后，你的调查将使用这把密钥的额度」说明句留给 PR #83。

2026-09-07 分支收拢完成（用户裁决：以 GitHub PR 记录为准，过审内容全部进 main，未过审内容不推）：PR #72 已 squash-merge 进 main（`695bd8e`），Issue #66 随之关闭。13 个已合并分支（Reset 2/3、4A–4E、infra #58、fix #74/#76、design #60、docs #55/#59）的本地与远程副本已删除，5 个辅助 worktree 已移除，仓库只剩 main 一条分支、一个主 worktree，本地与 origin/main 同步。未过 PR 的内容没有推主线：`feat/reset-3-golden-path` 分支尖的 #53 Phase A 设计规格与交互原型（约 2400 行，从未经过任何 PR；生产实现已由 4A–4E 交付，设计稿已由 PR #60 的 reference-exploration 覆盖）、`fix/76-source-identity-stability` 分支尖的一行 NOTES 改动。这两处对象约 30 天内仍可从本地 reflog 找回。

2026-09-06 PR #72 / Issue #66 已 rebase 到 main `f009d34`（#76 squash-merge），第三次 REAL SSE 完成。`git merge-base HEAD origin/main` = `f009d34f0303fd3512d6df0fda40135fd88db7fa`。旧 `final/real/` 与 `final/real-after-74/` 未覆盖。新 run 在 `final/real-after-76/`：hashed sourceId 稳定；claim-1 `src-bd310b43063afb86` 同 URL unassessed→support，live 与 replay DOM `before === after`。`gate.json` PASS 且 `settling-dom.json same:true`。机器：goldenPath 93；根 794；mvp 1008/1 skipped；两处 build 绿。不 merge，不关 #53，不启 #54。

2026-09-06 Issue #76 / PR #77 已 squash-merge 进 main（`f009d34`）：`InvestigationSource.id` 改为规范化 URL 的确定性派生，不再按 `src-${sources.length+1}` 随 phase / evidence 排序重编号。同 URL 仍一个 Source，support+contradict 仍是两条 EvidenceLink。#66 capture gate 改为按 URL+sourceId 判断 transition，`sourceIdsStable=false` 必须 FAIL。

2026-09-06 PR #72 / Issue #66 曾 rebase 到 main `7ad8103`（#74 squash-merge），同一句 REAL SSE 复验完成。旧 `final/real/` 保留为 pre-#74 failure specimen。那次 run 在 `final/real-after-74/`（184.8s，MiniMax-M2.7-highspeed，cross_examiner step-3.7-flash 无 fallback）。claim-2 反向证据现为 contradict，judgment=refuted。source-id 在 investigating `src-3` → judging `src-1` 不稳定，已如实记录。

2026-09-06 PR #75 / Issue #74 已 squash-merge 进 main（`7ad8103`）：证伪材料不得被标成 support；dual-bucket citation 分桶独立 filter/dedupe/cap，再按 supporting → `[1..S]`、contradicting → `[S+1..S+C]` remap。同 URL 跨桶两条 relation 都保留。不用 finding 文本猜 stance。

2026-09-06 PR #75 Review `5125346321`：stance-preservation binder。`bindDualBucketCitations` 对 supporting / contradicting 各自独立 filter、按 URL dedupe、每桶最多 5 条；再按 filtered supporting → `[1..S]`、filtered contradicting → `[S+1..S+C]` 一次性 remap evidence。同 URL 跨桶两条 relation 都保留。已 rebase 到 origin/main `d404701`（#73）。不 merge。机器：根 783，mvp 1000/1 skipped，两处 build 绿。

2026-09-06 PR #75 Review：dual-bucket citation binder。`bindDualBucketCitations` 按 `[...supporting, ...contradicting]` 原始顺序 filter/dedupe/remap 再拆回两桶；merge / bindAtomEvidenceToVerdicts / normalizeReportCitations 共用。`alignFalseEvidenceBuckets` 仍先改桶再绑定。不 merge。机器：根 778，mvp 992/1 skipped。

2026-09-06 Issue #74 Evidence role 正确性修复：producer 合同把证伪材料塞进 `supportingSources`（`[n]` 曾不绑 contradictingSources），Snapshot 忠实映射成 `support`。已在 merge/bind 按 `verdict=false` 改桶，prompt/schema 禁止为了 `[n]` 把反驳写入 supporting；Snapshot 只做同向读取兜底，不用 finding NLP。独立 PR 待人工 Review。不 merge，不关 #66/#53，不启 #54，不碰 #72 artifact。机器：根 773，mvp 983/1 skipped，两处 build 绿。

2026-09-06 Issue #58：Git 集成 Vercel 项目应对准 `mvp/dist`（生产壳仍是 mvp），仓库根 Install + 先 build `@rhg/core` 再 `mvp` Vite。不能把 Root Directory 设成 mvp 后丢掉 `@rhg/core`。不改 Mode 3 输出结构。独立 PR，不与 #66 混。

2026-09-06 PR #69 rebase 到 main `2cdba77`（#65 Source Drawer 已合入）。完整保留 Claim Trace、EvidenceBoard identity、DrawerSession identity-bound live/held。Conclusion Emergence 不 remount `.gp-canvas` / Original Claim / ClaimSection / EvidenceBoard，不抢走已 focus 的 Evidence，不自动关 Drawer / scroll / focus 结论。held Drawer 在 complete 后仍 held。goldenPath 86；根 767；mvp 956/1 skipped（4 个未改 server 套件仍是 worktree symlink）；三处 build 绿；capture_conclusion_emergence CAPTURE PASS（5184，fixture 非真实 SSE）。不 merge，不开 #66。

2026-09-06 Issue #64 Conclusion Emergence 生产化（独立 PR 待人工验收）：investigating→complete 共用 `[data-gp-conclusion-region]` 同一 DOM 节点（`before === after`）；调查中容器高度为 0 且不预渲染答案；完成后同一容器显现 `directAnswer` lede（24px/700），judgment/计数/时间降为 12px 弱 metadata，unresolved 用句子写「现有证据还不够」。Emergence 320ms quick-out、directAnswer 最多 8px；不 focus / 不 scrollIntoView / 不关 Drawer。Boundary 中性 inset + hairline，无 warning role。取证在 `docs/design/2026-09-06-conclusion-emergence/`（fixture，真实 SSE 留给 #66）。

2026-09-06 PR #71 / Issue #65 已 squash-merge 进 main（`2cdba77`）：DrawerSession identity、exact-click initialView、live 服从 `identifyEvidenceLinks`。

2026-09-06 PR #70 / Issue #63 已 squash-merge 进 main（`d6507de`）：EvidenceBoard 稳定父容器、`identifyEvidenceLinks`、unique source `before === after`。

2026-09-06 PR #68 Review blocker 已修并 squash-merge 为 #62 进 main：pointer hover 优先于残留 click-focus；keyboard focus 开始时清陈旧 hover；touch 仍走 expanded-active。

2026-09-06 PR #67 第三轮：生产代码与浏览器门禁已通过，本轮只收口文档真相源，未改 `mvp/` / CSS / 截图。Production Spec 把字阶/行高/间距标为 spec-only（不是 `--gp-type-*` / `--gp-lh-*` / `--gp-space-*` 变量）；`--gp-surface-inset` 不再写成 Original Claim 默认背景；Topbar 记为内联实现值，没有 `--gp-chrome-*`；墨色对比按 primary/secondary 与 tertiary/muted 分层，不再全局声称 WCAG AAA。Evaluator 合并为一套当前机器门禁（E3 为 Playwright computed-style；goldenPath 23；mvp 914/1 skipped）。等待最终验收，不 merge，不开 #62–#66。

2026-09-06 PR #60 人工 Review 第三轮最终 Evidence Honesty 收口完成（独立分支 `design/reference-exploration`，严格采用 Review 推荐的方案 B）：①区分实测与推论：将未真正由代码在运行时执行并测量的部分从 Actual Runtime Evidence 降级为 Structural inference 与 Risk analysis；②Case 5 实测仅保留原生 textWrap 读取、拆行与初始行宽记录，跨元素重排破坏归入 DOM 封装结构推论（Structural inference，未执行 resize 实测）；③Case 6 实测仅保留 document.fonts.ready 就绪等待与就绪后几何测量，font swap 溢出归入时序时机风险分析（Risk analysis，未执行真实字体替换前后测量）；④屏幕阅读器无障碍诚实维持 Not tested，kugiri 动效维持 Not applicable；⑤同步修正 5 处文件（kugiri-spike-test.html、kugiri-spike-evaluation.md、2026-09-06-design-reference-exploration.md、reference-pack/index.html、PR #60 description）。自动化回归 verify_reference_exploration.py 10/10 PASS，根 npm test（767 绿）、npm run build、cd mvp && npm test（908 绿 / 1 跳过）全绿。零生产代码触碰，停止等待人工最终验收。

2026-09-06 PR #59 复审意见处理完成（只改契约文档，未动代码，改完停止等复审）：按人工 review 逐条修正 3 个阻塞项与 1 个文档准确性项：①`docs/PRODUCT_SPEC.md` 第八节如实基于 GitHub main、已合并 PR 与 Issue 状态重写，严格区分“计划依赖关系”与“当前工程事实”，明确标注 #51 与 #52 均已合并至 main，避免后续重复执行；②删除将“五词”升级为产品宪法的硬性约束，明确其为历史探索用语/非约束性现状，避免反向约束 #52 信息架构，证据语义（支持/反驳/仅相关/尚缺/争议）直接可见；③`docs/PRODUCT_SPEC.md` 文件头收敛为唯一真相源，明确区分当前产品规则、当前工程事实、设计背景与历史决策，devlog 明确标注为历史参考而非并列权威；④明确说明 `README.md` 与 `CONTEXT.md` 经检查后确认与宪法一致，因此零修改，消除产生未存在 diff 的暗示。验收见 `docs/evals/2026-09-06-product-constitution-contract.md`。npm test、npm run build、cd mvp && npm test 全绿，未动生产代码，等待人工 review。

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
