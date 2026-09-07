# 2026-09-07 · Whole-Claim Audit 第一版（Issue #78）

Change / Not this / Evaluator 三段写在最前；本文同时是 PR（Fixes #78）的验收依据。

## Change

- 拆题之后，完整 originalClaim 继续作为一个「需要被证明 / 被质疑的对象」存在：新增内部 Whole-Claim Audit（Planning + Evaluation + 最多 1 次 audit-driven 补查），以及整句结论收权门。
- normative 不再一刀切 `verifiable=false`：由模型按语义判断是否存在「明确的外部可核查标准」（医学指南、药品说明书、适应症、法规、行业标准、技术规范、公开规则）。有 → `type=normative, verifiable=true`（type 描述语言行为，verifiable 描述外部依据可查性，两个维度独立）；纯价值/政策偏好仍 `verifiable=false → not-applicable`。
- Summary 收权：not-applicable / evidence=[] 的命题不得支撑整句 supported/refuted；A+B 有据不自动推出整句结论成立。

### Evaluator（命令化）

- `npx vitest run server/src/lib/wholeClaimAudit/wholeClaimAudit.test.ts`（17 项，含收权门四条不变量、修订只提升不降级、audit 不是 Evidence、repairGatedConclusion 结构化重建）。
- `npx vitest run server/src/lib/casePipeline/runCasePipeline.wholeClaimAudit.test.ts`（15 项，8 类 case + §14 + composer 输入 + Review 5127740625 三个 blocker 回归）。
- `npx vitest run server/src/lib/casePipeline/runCasePipeline.test.ts`（既有管线行为不回归，含电瓶车短谣 tiny-bound 与 review hooks）。
- 人评项：真实模型下「每次感冒都应当输液」一句的 REAL SSE 一致性回归——按 #78 要求留给 post-#78 的窄回归 PR/Issue，本 PR 不动 #72 artifacts（#72 已 merged，见 §11）。

## 1. 当前 workflow 的真实缺口（审计结论）

- **A. originalClaim 可见性**：`claim` 字符串传遍每一阶段（rumor/fact/source/composer 输入、evidenceLoop、crossExam），但拆题后没有任何阶段对整句做推理；唯一对整句做语义推理的是 ReportComposer——正是黑箱跳变发生地。
- **B. 真正决定检索的字段**：`claimAtomTypes[].verifiable` 是唯一开关。`listAtomsForSearch`（atomSearch.ts）把 verifiable=false 归入 nonVerifiable → `selectAtomsToSearch` 不选 → 不检索、不进 FactChecker 判词 → `assembleFinalReport` 归入 `nonVerifiableAtoms` → 快照 `checkability=not-applicable`。`type` 只影响检索负荷排序；`stanceClaimType` 只影响横幅。救援闸 `forceCheckableAtomTypes` 的 `looksLikeCirculatingClaim` 把「应当」命中 STANCE 正则判为立场 → 不救援（且救援会改写 type 为 fact，#78 明令禁止）。
- **C. #78 失败形状的成因链**：prompt 硬约束「value/normative 的 verifiable 必须为 false」（agentConfigs.ts 拆题工单）→ 「每次感冒都应当输液」标 normative/false；forceCheckable 正则不救 → 不检索、evidence=[]；ReportComposer 输入只带可核查判词、不带 nonVerifiableAtoms/审计上下文 → 用参数知识写出「两条主张均不成立」并置 verdictType=false；快照把 false 映射为整句 refuted、claimIds 全列 → 层间自相矛盾。
- **D. 有没有 Whole-Claim Audit**：没有。ReportComposer 看得到 originalClaim ≠ audit；`reportReviewer` 只查结构（verdictType 合法性、无绑定 URL 的硬判定），不检查「各命题与整句结论的一致性」。

## 2. Whole-Claim Audit 的位置

```
rumor → self-proof → forceCheckable → 【Planning】→ 检索决策 → FactChecker/Source
→ evidenceLoop → crossExam → causal → 【Evaluation → ≤1 次 audit 补查 → 重判 → bounded re-evaluation（仅当补查取得新来源）】
→ ReportComposer（输入带 nonVerifiableAtoms + audit 上下文 + 收权 prompt）
→ assemble → mixedGuard → 【early conclusionGate】→ boundTiny（contract probe，不服从不提）
→ finalizeReport → reviewer → 【final conclusionGate + 结构化 conclusion repair】→ 引用探活 → 快照 complete
```

final gate 是最后一个能改变整体 verdict 的位置；探活只剪死链、不改 verdict。
repair 触发条件："发生过结构化降级（early / final / mixedGuard 任一）且最终强度弱于 composer draft"。
重建只用 gated verdict + 有绑定来源的判词 evidence + nonVerifiableAtoms + audit 缺口，
不读原 conclusion/summary 文本、不做任何关键词匹配（§11 Blocker 1）。

实现层模块：`mvp/server/src/lib/wholeClaimAudit/`（types / planning / evaluation / conclusionGate）。不是新 UI、不是用户可见 Agent、不进 InvestigationSnapshot schema；artifact 只落在 `rumorStep.output.wholeClaimAuditPlan / wholeClaimAudit`（实现层），调用静默、不进 SSE Agent 日志。

## 3. 哪些判断交给 LM

- Planning：整句想推出什么（overallQuestion）；哪条 normative/value 存在明确外部可核查标准（checkabilityRevisions，逐条带 reason）；整句还缺哪些桥接依据（missingJustifications）；最值得验证的 1–3 个问题（auditQuestions）。
- Evaluation：整句现在成立到哪里；最大推理/依据缺口；下一步最值得查什么（≤3 问）。
- 语义一致性：ReportComposer 在收权 prompt + nonVerifiableAtoms + audit 上下文约束下写结论。
- 长尾措辞（「每次感冒都应当输液 / 感冒一律得挂水 / 只要感冒就该打吊瓶」）由同一语义决策覆盖，测试用 mock LM 输出验证管线对模型决策的响应，生产代码不含任何措辞关键词。

## 4. 哪些 invariants 仍由代码守

- 修订只能提升（false→true）、必须命中真实 kept claimAtom（按 claimAtomKey）、type 不改写、不创建新「用户 Claim」、不降级、旧 heuristic 不回压。
- audit 文本（assessment/question/reason/missingJustification/suggestedQuery）永不进入 InvestigationSource / EvidenceLink / support / contradict；只有真实 searchOne 取得并 bind 进 bundle 的来源才是 Evidence。
- 收权门（applyConclusionGate，确定性、不读结论文本）：① 全部命题 not-applicable → 整句不得是任何硬判定；② 有绑定材料但无「判 false 且带绑定 URL」的原子 → 整句 false 收成 mixed_misleading/unverified（#78 真实形状）；③ 无 sourced-true 支撑的整句 true 收权；④ audit 桥接缺口未解决 → 硬 true/false 收成 unverified（A+B 真推不出 C 真）。
- 门执行两次、同一 contract：early（boundTiny 之前）+ final（reviewer 之后、探活之前；最后一个改 verdict 的位置）。legacy boundTiny 提成 false 前先用同一 contract 做 probe，不通过不提（`_tinyBoundSuppressed`）；reviewer 的短谣豁免若与 contract 冲突，final gate 照样收回。
- 结构化 conclusion repair（repairGatedConclusion，§11 Blocker 1）：demote 且终态弱于 composer draft 时，用 gated verdict 的标准答案开头 + 有源判词 evidence（可核查部分保留）+ nonVerifiable 边界句 + 缺口边界句重建 conclusion（≤400 字），同步重建 summaryForPublic（≤200 字）、recommendation，并向 evidenceChain 追加「结论边界（整句收权）」层。`_conclusionGate.repaired=true`。
- 预算：时间不足（`AUDIT_MIN_MS=45s` / `COMPOSER_RESERVE_MS=90s` 之前）fail-open 跳过审计，宁可保守收束不饿死 composer。

## 5. 为什么这不是关键词规则引擎

没有新增任何 SHOULD/MEDICAL/ABSOLUTE 正则；「应当」不再触发任何词面分支——词面只出现在旧 fallback（`forceCheckableAtomTypes`）里，且其语义权被模型结构化决策覆盖（模型说有外部标准，旧 heuristic 无法把它压回 not-applicable：修订在 forceCheckable 之后应用，且 forceCheckable 只提升不降级）。确定性代码只做身份匹配、方向允许（只升不降）、来源绑定、预算与收权门；「这条规范有没有外部标准」始终由模型给结构化 decision + reason。

## 6. Why LM prior ≠ Evidence

模型先验只允许：发现疑点 → 生成 audit question → 选择工具（suggestedQuery）→ 真实 searchOne → 来源进 bundle → FactChecker 重判 → Evidence relation。Case 6 回归：audit 输出「明显不合理」但无工具来源时，不产生任何 Source/Evidence、不产生 refuted，命题保持 unresolved。Planning/Evaluation 的输出对象在类型上就不含来源结构，§14 回归断言快照 sources/evidence 为空。

## 7. audit-driven extra pass 的 budget 上限

- 最多 1 次补查 pass（不重写 orchestration、无自由循环）。
- 每次 Audit 最多 3 个高价值问题；只有能按 claimAtomKey 映射到真实 kept atom 的问题才补查（复用 searchOne + `mergeSourcesIntoBundle` + fact_checker 重判 + `bindAtomEvidenceToVerdicts`）；纯桥接问题只记录为内部 missing justification。
- 补查取得新来源 + 重判后，最多再跑 1 次 bounded re-evaluation（§11 Blocker 3）：用更新后的判词重估，第二次 Evaluation 的 missingJustifications 为准，旧 gap 可被关闭；重评估失败/无新来源/预算不足则保守沿用第一次。
- 新增 LLM 调用：Planning 1 次 + Evaluation 1 次 + 补查取得新证据时 fact_checker 重判 1 次 + bounded re-evaluation 1 次（仅当补查取得新来源）= 最坏 4 次。最坏额外 evidence pass = 1。每次补查前、每个问题前、重评估前检查 `timeLeftMs() > COMPOSER_RESERVE_MS`，超预算即止，不与 composer 抢时间。

## 8. 8 类 regression 结果

| Case | 断言 | 结果 |
|---|---|---|
| 1 纯政策偏好（政府应该禁止短视频） | 不修订 → 不检索、nonVerifiable、整句 false 被收成 unverified、快照 not-applicable | PASS |
| 2 externally-grounded（每次感冒都应当输液） | 提升为 normative+verifiable=true、type 不改写、进入检索、有反证可 refuted、可下钻来源 | PASS |
| 3 说明书型（这个药应该每天服三次） | 允许 normative+true，进入检索 | PASS |
| 4 premises true ≠ conclusion（吃饭升血糖+胰岛素降血糖 ⇒ 人人都注射） | A/B 有据真、C unverified、audit 缺口未解决 → 整句 true 收成 unverified，C 不被写成成立 | PASS |
| 5 #78 真实形状（c1 partial 带源 + c2 not-applicable evidence=[]，composer 写 false） | 整句收成 mixed_misleading（无 sourced-false），c2 保持 not-applicable，整句结论不得 refuted；Blocker 1 加强：最终 directAnswer 以 gated verdict 标准答案开头、不再含越权原文、c2 只作"不适用真假判断"边界、可核查 c1 evidence 保留，summary/recommendation/evidenceChain 同步 | PASS |
| 6 LM prior 不是 Evidence | audit「明显不合理」无来源 → 零 Evidence、零 refuted、快照不含 audit 文本 | PASS |
| 7 长尾表达（应当输液/一律得挂水/就该打吊瓶） | 三种措辞同一 mock 语义决策均提升并检索；无字符串 special-case | PASS |
| 8 旧类型不回归 | 不注入 audit 时 legacy 行为保持（normative 仍立场型、无 artifact）；既有全量套件（含 fact/causal/value/prediction/personal 边界与因果 enrichment）全绿 | PASS |
| R1 Blocker 2（tiny-bound 绕过） | c1 partial 带源 + c2 not-applicable + 聚合来源含 on-topic 辟谣时，legacy tiny-bound 不得把已收权整句推回 false；终态 mixed/unverified，快照非 refuted，c2 保持 not-applicable | PASS |
| R2 Blocker 3（re-evaluation 闭环） | 第一次 Evaluation 有 gap → extra pass 得新来源 → 第二次 Evaluation gap 清零（`reevaluated=true`）→ gate 不再以 audit 缺口收权，有 sourced-false 时允许 false | PASS |

## 9. tests / build

- `npm test`（根）：20 files / 83 tests 全绿。
- `npx vitest run`（mvp 全量）：98 files / 1034 tests 通过、1 skipped、1 failed —— 失败项 `LegacyDesk.test.tsx > uses the clean analysis shell` 为 main 上已存在的负载抖动：单跑 29/29 通过；stash 本分支改动后全量基线同样 1 failed（1007 passed），与本 PR 无关（该测试只 import 前端 `LegacyDesk`/`requestOrchestrateStream`，不在本分支改动依赖图内）。
- `npm run build`（根）与 `cd mvp && npm run build`（tsc + vite）通过；`mvp/server` `tsc --noEmit` 通过。
- 新增定向测试：`wholeClaimAudit.test.ts` 17 项、`runCasePipeline.wholeClaimAudit.test.ts` 15 项。
- eval:gate：见下方记录。

### eval:gate 记录（如实）

`npm run eval:gate` 已运行，gate 以 **既有原因** 失败，与本 PR 无关：

- `baseline missing metricSemver`：`mvp/server/eval/baseline.json` 从未包含 `metricSemver` 字段（gate.ts:85 硬校验），该失败在 main 上同样发生；
- `valid:false / unlabeled qualification`：全部 26 案的资格标签流程（qualify + qualify_review 各 26/25 次调用、0 失败）产出 unlabeled——PRODUCT_SPEC 第八节已声明「旧 eval:gate 的资格标签与基线修订属于另一个待裁决单元」。

对本案有参考意义的运行信号（离线 mock 管线 + 真实模型）：EVAL-TYPEGATE-001 verdictAccuracy=1（类型闸 golden 不回归）；RUMOR-011 mixed_misleading 判准；reportContractPassRate 全局 1.0；citationIntegrityErrorRate 全局 0。环境噪音（DeepSeek 余额不足 / MiMo key 失效 / stepfun_search 降级）另行存在，同样与本案无关。不通过改 baseline / 资格标签为本 PR 换绿灯。

## 10. 已知未做范围

- 不改 #72 及其 REAL artifacts；「每次感冒都应当输液」的 REAL SSE 最终一致性回归按 #78 属于 #72 rebase 后的门禁。
- 不扩 InvestigationSnapshot schema；audit artifact 不进快照（实现层字段够用）。若后续需要把 audit 缺口显式呈现给用户，应另立裁决单元。
- Planning 只允许提升（false→true），不处理「模型认为可核查命题其实纯偏好」的降级方向——避免误伤既有 fact/causal 边界，留待真实误报出现再裁。
- 桥接问题（无法映射到已有 claimAtom 的缺口）第一版只限制结论强度、不补查、不发明新 Claim。
- 结论文本越权：结构化降级触发时由 repair 重建兜底（§11 Blocker 1）；未加独立的 LLM conclusion reviewer（避免每 run 常驻 +1 次模型调用）。reviewer 自身降级（overclaim/unsourced）改 verdict 不改文本的路径仍是 prompt 约束，留白如实声明。
- credibilityScore / credibilityLabel 的 band 仍跟 composer draft 走，gate demote 时不重算（Review 只要求 directAnswer/summary/evidenceChain 与 gated verdict 一致）。
- Composer 对整句 `mixed_misleading` 与 audit 缺口并存时的措辞强度未做更细的确定性约束（依赖 prompt）。

## 11. Review 5127740625 三 blocker 修复（本 PR 内第二轮，不开新 PR）

人工 Review 认定第一版方向成立，但指出三个 correctness blocker（verdictType 修了、用户可见文本没修；gate 会被 legacy tiny-bound 绕过；extra pass 无 re-evaluation）。本轮按 Review 逐条修复，不新增关键词语义规则、不改 Snapshot schema、不改 UI、不碰旧 REAL artifacts、不处理 baseline/LegacyDesk。

- **Blocker 1**：`applyConclusionGate` 只改 verdictType，Case 5 的越权原文（"两条主张均不成立"）仍进 Snapshot directAnswer。修复 = 结构化状态触发的受约束 conclusion repair（`repairGatedConclusion`）：early/final/mixedGuard 任一发生结构化降级、且终态弱于 composer draft 时，用 gated verdict 标准答案开头 + 有源判词 evidence + nonVerifiable 边界 + 缺口边界重建 conclusion/summaryForPublic/recommendation，并向 evidenceChain 追加「结论边界（整句收权）」层。全程不读原文、不做 conclusion 关键词 regex。回归：Case 5 最终 directAnswer 不再含越权原文且保留 c1 部分结论（R1 行不断言措辞、只断言结构：开头= gated 标准答案、不含越权句、含边界句、含 c1 evidence）。
- **Blocker 2**：`boundTinyRumorVerdict` 在 gate 之后把 mixed/unverified 推回 false，且 reviewer 的短谣豁免也可能保留 false。修复 = gate 成为最终 gate：early（boundTiny 前）+ final（reviewer 后、探活前，最后一个改 verdict 的位置），同一 contract；boundTiny 提 false 前先 probe，不通过记 `_tinyBoundSuppressed` 不提；final 照样能把 reviewer 豁免保留的 false 收回。回归：not-applicable + on-topic debunk 来源时终态不得为 false。
- **Blocker 3**：第一次 Evaluation 的 `missingJustifications` 被无条件沿用，新证据永远关不掉旧 gap。修复 = bounded re-evaluation：extra pass 取得新来源 + fact_checker 重判后、且 `timeLeftMs() > COMPOSER_RESERVE_MS` 时，用更新后判词再跑一次 Evaluation，以第二次的 missingJustifications/nextQuestions 为准（`extraPass.reevaluated=true`，`wholeClaimAudit.reevaluation` 落盘，rumorStep 输出同步）；无新来源/重评估失败/预算不足则保守沿用第一次。代价：最坏 LLM 调用 3→4 次（§7），latency 上限不变（各阶段仍受同一 composer reserve 约束，重评估拿不到预算就跳过）。
- 流程事实同步：PR #72 已 merged、Issue #66 已 closed，本 PR 不再执行"rebase #72 跑 REAL SSE"；同一句输入的 Whole-Claim 一致性 REAL 回归留给 post-#78 的窄 PR/Issue。
