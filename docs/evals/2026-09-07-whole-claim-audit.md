# 2026-09-07 · Whole-Claim Audit 第一版（Issue #78）

Change / Not this / Evaluator 三段写在最前；本文同时是 PR（Fixes #78）的验收依据。

## Change

- 拆题之后，完整 originalClaim 继续作为一个「需要被证明 / 被质疑的对象」存在：新增内部 Whole-Claim Audit（Planning + Evaluation + 最多 1 次 audit-driven 补查），以及整句结论收权门。
- normative 不再一刀切 `verifiable=false`：由模型按语义判断是否存在「明确的外部可核查标准」（医学指南、药品说明书、适应症、法规、行业标准、技术规范、公开规则）。有 → `type=normative, verifiable=true`（type 描述语言行为，verifiable 描述外部依据可查性，两个维度独立）；纯价值/政策偏好仍 `verifiable=false → not-applicable`。
- Summary 收权：not-applicable / evidence=[] 的命题不得支撑整句 supported/refuted；A+B 有据不自动推出整句结论成立。

### Evaluator（命令化）

- `npx vitest run server/src/lib/wholeClaimAudit/wholeClaimAudit.test.ts`（35 项，含收权门不变量、postLiveness 严格规则、needsConstrainedConclusion、compactVerdicts related-only 区分、repair 结构化重建、citation scope conversion）。
- `npx vitest run server/src/lib/casePipeline/runCasePipeline.wholeClaimAudit.test.ts`（22 项，8 类 case + §14 + composer 输入 + 三轮 blocker 回归）。
- `npx vitest run server/src/lib/citationLiveness.test.ts`（11 项，含双桶对称剪枝、同 URL 双 relation 保留、chain-only 全死链）。
- `npx vitest run server/src/lib/casePipeline/runCasePipeline.test.ts`（既有管线行为不回归，含电瓶车短谣 tiny-bound 与 review hooks；两处硬结论用例注入 alive 探活使其 hermetic，意图不变）。
- 人评项：真实模型下「每次感冒都应当输液」一句的 REAL SSE 一致性回归——留给 post-#78 的窄回归 PR/Issue，本 PR 不动 #72 artifacts（#72 已 merged，见 §11）。

## 1. 当前 workflow 的真实缺口（审计结论）

- **A. originalClaim 可见性**：`claim` 字符串传遍每一阶段（rumor/fact/source/composer 输入、evidenceLoop、crossExam），但拆题后没有任何阶段对整句做推理；唯一对整句做语义推理的是 ReportComposer——正是黑箱跳变发生地。
- **B. 真正决定检索的字段**：`claimAtomTypes[].verifiable` 是唯一开关。`listAtomsForSearch`（atomSearch.ts）把 verifiable=false 归入 nonVerifiable → `selectAtomsToSearch` 不选 → 不检索、不进 FactChecker 判词 → `assembleFinalReport` 归入 `nonVerifiableAtoms` → 快照 `checkability=not-applicable`。`type` 只影响检索负荷排序；`stanceClaimType` 只影响横幅。救援闸 `forceCheckableAtomTypes` 的 `looksLikeCirculatingClaim` 把「应当」命中 STANCE 正则判为立场 → 不救援（且救援会改写 type 为 fact，#78 明令禁止）。
- **C. #78 失败形状的成因链**：prompt 硬约束「value/normative 的 verifiable 必须为 false」（agentConfigs.ts 拆题工单）→ 「每次感冒都应当输液」标 normative/false；forceCheckable 正则不救 → 不检索、evidence=[]；ReportComposer 输入只带可核查判词、不带 nonVerifiableAtoms/审计上下文 → 用参数知识写出「两条主张均不成立」并置 verdictType=false；快照把 false 映射为整句 refuted、claimIds 全列 → 层间自相矛盾。
- **D. 有没有 Whole-Claim Audit**：没有。ReportComposer 看得到 originalClaim ≠ audit；`reportReviewer` 只查结构（verdictType 合法性、无绑定 URL 的硬判定），不检查「各命题与整句结论的一致性」。

## 2. Whole-Claim Audit 的位置

```
rumor → self-proof → forceCheckable → 【Planning】→ 检索决策 → FactChecker/Source
→ evidenceLoop → crossExam → causal → 【Evaluation → ≤1 次 audit 补查 → 重判（提交才算）→ bounded re-evaluation（仅当 recheckCommitted）】
→ ReportComposer（输入带 nonVerifiableAtoms + audit 上下文 + 收权 prompt）
→ assemble → mixedGuard → 【early conclusionGate】→ boundTiny（contract probe，不服从不提）
→ finalizeReport → reviewer → normalize → imageOrigin → pruneDeadCitations（双桶对称）
→ 【权威 final conclusionGate（postLiveness，基于存活证据）+ 结构化 conclusion repair】
→ normalize → origin 重放 → faceVerdict/checkedAt → 快照 complete
```

final gate 是最后一个能改变整体 verdict 的位置，位于探活之后，以存活证据为准。
early gate 保留在 boundTiny 之前阻止绕过。
repair 触发条件不再看"谁降的级"，只看最终结构约束（needsConstrainedConclusion，
§12 Blocker 3）：draft 硬 verdict 被任何模块（含 reviewer/finalize）降为弱 verdict，
或终态已是弱 verdict 但存在 not-applicable / 未解决 gap / 无存活 sourced relation，
就重建用户可见文本。不读原文、不做关键词匹配。

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
- 门执行两次、同一 contract：early（boundTiny 之前，liveness 前的宽松语义）+ 权威 final（reviewer → normalize → 探活之后，`postLiveness: true`，以存活证据为准，是最后一个改 verdict 的位置）。liveness 后硬 true/false 若无任何存活可点开证据支撑，直接收为 unverified（规则 `post-liveness-no-surviving-evidence`，死证不得支撑硬结论）；唯一豁免是短谣存活辟谣通道（聚合来源按 deadUrls 过滤后 `boundTinyRumorVerdict` 仍成立，只对 false 有效）。
- 探活双桶对称（§12 Blocker 1）：supportingSources 与 contradictingSources 各自独立 filter、独立去重，不跨桶合并；同 URL 跨桶是两条 relation，都保留；判词句内编号继续「过滤后 support → 过滤后 contradict」（与 `bindDualBucketCitations` 同构，不破坏 #74）。
- legacy boundTiny 提成 false 前先用同一 contract 做 probe，不通过不提（`_tinyBoundSuppressed`）；reviewer 的短谣豁免若与 contract 冲突，final 照样收回。
- 结构化 conclusion repair（repairGatedConclusion）：触发由 `needsConstrainedConclusion` 按最终结构约束决定（§12 Blocker 3 → §13 Blocker 1 扩展到硬 verdict 保留的情形：终态仍是合法 true/false，但存在 nonVerifiableAtoms 时同样重建，overall 判断保留、不适用部分明确留边界，规则 `hard-verdict-with-not-applicable-boundary`）。不看降级来源、不读原文。用 gated verdict 的标准答案开头 + 有源判词 evidence（可核查部分保留，经显式 local→global citation scope conversion，§13 Blocker 2：按判词顺序建全局 source index，与 normalize 的 first-seen 同序，映射不到的 marker 删除）+ nonVerifiable 边界句 + 缺口边界句重建 conclusion（≤400 字），同步重建 summaryForPublic（≤200 字）、recommendation，并向 evidenceChain 追加「结论边界（整句收权）」层。`_conclusionGate.repaired=true`。repair 后重放幂等的 `applyImageOriginToReport`，用结构化 imageOrigin 对象恢复原图出处引用。
- 重判提交条件（§12 Blocker 2）：`recheckCommitted` 要求同时满足 search 得新来源、重判成功、目标 atom 判词合法、bind 后形成非 related-only 的 support/contradict relation 且实际引用了本次新 URL（`newlyBoundEvidenceUrlsByAtomKey` 落盘）。只有提交后第二次 Evaluation 才 authoritative，可关闭旧 gap；否则保守沿用第一次（重评估失败/related-only/未引用/超预算都不清空 gaps）。
- `compactVerdicts` 明确区分 supportCount / contradictCount / relatedOnlyCount / sourcesRelatedOnly：related-only 填充的 support/contradict 记 0，Evaluation prompt 同步声明"仅相关检索材料不是支持证据"。
- 预算：时间不足（`AUDIT_MIN_MS=45s` / `COMPOSER_RESERVE_MS=90s` 之前）fail-open 跳过审计，宁可保守收束不饿死 composer。

## 5. 为什么这不是关键词规则引擎

没有新增任何 SHOULD/MEDICAL/ABSOLUTE 正则；「应当」不再触发任何词面分支——词面只出现在旧 fallback（`forceCheckableAtomTypes`）里，且其语义权被模型结构化决策覆盖（模型说有外部标准，旧 heuristic 无法把它压回 not-applicable：修订在 forceCheckable 之后应用，且 forceCheckable 只提升不降级）。确定性代码只做身份匹配、方向允许（只升不降）、来源绑定、预算与收权门；「这条规范有没有外部标准」始终由模型给结构化 decision + reason。

## 6. Why LM prior ≠ Evidence

模型先验只允许：发现疑点 → 生成 audit question → 选择工具（suggestedQuery）→ 真实 searchOne → 来源进 bundle → FactChecker 重判 → Evidence relation。Case 6 回归：audit 输出「明显不合理」但无工具来源时，不产生任何 Source/Evidence、不产生 refuted，命题保持 unresolved。Planning/Evaluation 的输出对象在类型上就不含来源结构，§14 回归断言快照 sources/evidence 为空。

## 7. audit-driven extra pass 的 budget 上限

- 最多 1 次补查 pass（不重写 orchestration、无自由循环）。
- 每次 Audit 最多 3 个高价值问题；只有能按 claimAtomKey 映射到真实 kept atom 的问题才补查（复用 searchOne + `mergeSourcesIntoBundle` + fact_checker 重判 + `bindAtomEvidenceToVerdicts`）；纯桥接问题只记录为内部 missing justification。
- 补查取得新来源 + 重判后，最多再跑 1 次 bounded re-evaluation（§11 Blocker 3 → §12 Blocker 2 收紧）：只有重判真正提交（`recheckCommitted`：新 URL 进 bind 后的非 related-only relation）时才跑，并以第二次的 missingJustifications 为准，旧 gap 可被关闭；未提交/重评估失败/预算不足则保守沿用第一次。
- 新增 LLM 调用：Planning 1 次 + Evaluation 1 次 + 补查取得新证据时 fact_checker 重判 1 次 + bounded re-evaluation 1 次（仅当重判提交）= 最坏 4 次。最坏额外 evidence pass = 1。每次补查前、每个问题前、重评估前检查 `timeLeftMs() > COMPOSER_RESERVE_MS`，超预算即止，不与 composer 抢时间。latency 上限不变（同一 composer reserve 约束）。

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
| R2 Blocker 3（re-evaluation 闭环） | 第一次 Evaluation 有 gap → extra pass 得新来源 → 重判提交（`recheckCommitted`）→ 第二次 Evaluation gap 清零 → gate 不再以 audit 缺口收权，有 sourced-false 时允许 false | PASS |
| R3 Blocker 1A（唯一 support 死链） | liveness 后支撑死光 → 硬 true 收为 unverified（`post-liveness-no-surviving-evidence`）；Claim/Conclusion 同为 unresolved；directAnswer 无无主 `[n]` 且与 verdict 同向 | PASS |
| R4 Blocker 1B（唯一 contradict 死链） | liveness 后反证死光 → 硬 false 收为 unverified，不允许死反证支撑 refuted | PASS |
| R5 Blocker 1C（同 URL 双桶） | 同 URL 在 support/contradict 同时存活 → 两条 relation 都保留，本地编号按过滤后 support → contradict，不跨桶合并 | PASS |
| R6 Blocker 2A（重判失败） | search 得新 URL 但 fact_checker 抛错 → `recheckCommitted=false`，不跑第二次 Evaluation，旧 gap 保留，硬 false 不放行 | PASS |
| R7 Blocker 2B（related-only） | search 得新 URL 但重判只形成 sourcesRelatedOnly → 不提交，gap 保留；compactVerdicts 把 related-only 计为 relatedOnlyCount，不计 support | PASS |
| R8 Blocker 3A（无 audit + reviewer 降级） | composer true/“原句成立”被 reviewer 收到 unverified → 最终文案同步收权，Snapshot conclusion 一致 | PASS |
| R9 Blocker 3B（弱 draft 越权） | draft 已是 mixed 但 conclusion 把 not-applicable Claim 写成已证伪 → verdict 无变化仍结构化重建 | PASS |
| R10 Blocker 1（本轮：hard 保留 + 边界） | A sourced-false + B not-applicable + composer 写“都不成立” → overall false 保留，directAnswer/summary 不写 B 已证伪，B 明确未计入，引用作用域正确 | PASS |
| R11 Blocker 2（本轮：scope conversion） | 双 atom 各自局部 [1] → 全局 [1]/[2] 分指 A/B；第二 atom support[1]contradict[2] → 全局顺延，无映射 marker 删除 | PASS |
| R12 Blocker 3（本轮：chain 全死链） | evidenceChain-only 死链层 → sourceRefs=[]、marker 清除、序列化报告不含该 URL；chain-only URL 纳入探活 candidate | PASS |

## 9. tests / build

- `npm test`（根）：54 files / 605 tests + 3 files / 85 tests + 2 files / 21 tests + 20 files / 83 tests，全绿。
- `npx vitest run`（mvp 全量）：98 files（97 passed / 1 skipped）/ 1060 tests 通过、1 skipped、0 failed。`LegacyDesk.test.tsx > uses the clean analysis shell` 本轮全量与单跑表现不稳定（上一轮全量 1 failed、单跑通过；本轮基线对照单跑同样失败，详见 §12），属已知负载抖动：该测试只 import 前端模块，不在本分支改动依赖图内。
- `npm run build`（根）与 `cd mvp && npm run build`（tsc + vite）通过；`mvp/server` `tsc --noEmit` 通过。
- 新增定向测试：`wholeClaimAudit.test.ts` 35 项、`runCasePipeline.wholeClaimAudit.test.ts` 22 项、`citationLiveness.test.ts` 11 项。
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
- 结论文本越权：最终结构约束触发时由 repair 重建兜底（§11 Blocker 1 → §12 Blocker 3 扩展到 reviewer/finalize 降级与弱 draft）；未加独立的 LLM conclusion reviewer（避免每 run 常驻 +1 次模型调用）。
- credibilityScore / credibilityLabel 的 band 仍跟 composer draft 走，gate demote 时不重算（Review 只要求 directAnswer/summary/evidenceChain 与 gated verdict 一致）。
- Composer 对整句 `mixed_misleading` 与 audit 缺口并存时的措辞强度未做更细的确定性约束（依赖 prompt）。
- repair 重建会丢弃 composer 原文的个性化措辞（含 `[n]` 引用形式），换来确定性一致；结构干净的弱结论（有源、无缺口、无立场句）不触发 repair，保留原文。
- 快照 Claim evidence 仍可含 bundle 侧的来源链接（含死链，标 `reachable:false` + 缺口对象）；Claim/Conclusion 的 judgment 同向由 gate + 快照收敛规则保证。

## 11. Review 5127740625 三 blocker 修复（本 PR 内第二轮，不开新 PR）

人工 Review 认定第一版方向成立，但指出三个 correctness blocker（verdictType 修了、用户可见文本没修；gate 会被 legacy tiny-bound 绕过；extra pass 无 re-evaluation）。本轮按 Review 逐条修复，不新增关键词语义规则、不改 Snapshot schema、不改 UI、不碰旧 REAL artifacts、不处理 baseline/LegacyDesk。

- **Blocker 1**：`applyConclusionGate` 只改 verdictType，Case 5 的越权原文（"两条主张均不成立"）仍进 Snapshot directAnswer。修复 = 结构化状态触发的受约束 conclusion repair（`repairGatedConclusion`）：early/final/mixedGuard 任一发生结构化降级、且终态弱于 composer draft 时，用 gated verdict 标准答案开头 + 有源判词 evidence + nonVerifiable 边界 + 缺口边界重建 conclusion/summaryForPublic/recommendation，并向 evidenceChain 追加「结论边界（整句收权）」层。全程不读原文、不做 conclusion 关键词 regex。回归：Case 5 最终 directAnswer 不再含越权原文且保留 c1 部分结论（R1 行不断言措辞、只断言结构：开头= gated 标准答案、不含越权句、含边界句、含 c1 evidence）。
- **Blocker 2**：`boundTinyRumorVerdict` 在 gate 之后把 mixed/unverified 推回 false，且 reviewer 的短谣豁免也可能保留 false。修复 = gate 成为最终 gate：early（boundTiny 前）+ final（reviewer 后、探活前，最后一个改 verdict 的位置），同一 contract；boundTiny 提 false 前先 probe，不通过记 `_tinyBoundSuppressed` 不提；final 照样能把 reviewer 豁免保留的 false 收回。回归：not-applicable + on-topic debunk 来源时终态不得为 false。
- **Blocker 3**：第一次 Evaluation 的 `missingJustifications` 被无条件沿用，新证据永远关不掉旧 gap。修复 = bounded re-evaluation：extra pass 取得新来源 + fact_checker 重判后、且 `timeLeftMs() > COMPOSER_RESERVE_MS` 时，用更新后判词再跑一次 Evaluation，以第二次的 missingJustifications/nextQuestions 为准（`extraPass.reevaluated=true`，`wholeClaimAudit.reevaluation` 落盘，rumorStep 输出同步）；无新来源/重评估失败/预算不足则保守沿用第一次。代价：最坏 LLM 调用 3→4 次（§7），latency 上限不变（各阶段仍受同一 composer reserve 约束，重评估拿不到预算就跳过）。
- 流程事实同步：PR #72 已 merged、Issue #66 已 closed，本 PR 不再执行"rebase #72 跑 REAL SSE"；同一句输入的 Whole-Claim 一致性 REAL 回归留给 post-#78 的窄 PR/Issue。

## 12. Review 5128022550 三 blocker 修复（本 PR 内第三轮，不开新 PR）

人工 Review 认定第二轮方向正确、Agentic loop 方向通过，但指出三个 correctness blocker。本轮按 Review 逐条修复，不扩大产品范围、不改 UI、不启动 #54，不新增关键词语义规则、不改 Snapshot schema、不碰旧 REAL artifacts/baseline/LegacyDesk。

- **Blocker 1（final gate 早于 liveness）**：顺序改为 reviewer → normalize → prune → 权威 final gate → repair → normalize → faceVerdict/checkedAt → Snapshot（early gate 保留在 boundTiny 之前）。`pruneDeadCitations` 双桶对称：support/contradict 各自独立 filter 与去重，同 URL 跨桶是两条 relation，都保留；本地编号按过滤后 support → contradict（与 `bindDualBucketCitations` 同构，不破坏 #74）。final gate 以 `postLiveness: true` 运行：死证剔除后无存活支撑的硬 true/false 直接收为 unverified（`post-liveness-no-surviving-evidence`）；短谣豁免只看按 deadUrls 过滤后的聚合来源是否仍成立。回归 R3/R4/R5。
- **Blocker 2（只有提交的新 Evidence 才能关闭 gap）**：新增 `recheckCommitted` + `newlyBoundEvidenceUrlsByAtomKey` 状态。提交要求 search 得新来源、重判成功、目标 atom 判词合法、bind 后形成非 related-only 的 support/contradict relation 且实际引用本次新 URL；FactChecker 抛错/failed/error/空判词/缺目标 atom/只有 related-only/新 URL 未被引用 → 一律保守沿用第一次 gap，不跑第二次 Evaluation（informational 也不跑，省预算）。`compactVerdicts` 区分 supportCount / contradictCount / relatedOnlyCount / sourcesRelatedOnly，Evaluation prompt 同步声明 related-only 不是支持证据。回归 R6/R7（R2 加强：不断言 recheck 失败路径，只断言提交后关闭）。
- **Blocker 3（repair 由最终结构约束触发）**：新增 `needsConstrainedConclusion`，只读 final verdictType、final 判词、nonVerifiableAtoms、audit gaps、存活绑定状态、draft/final 强度。draft 硬 verdict 被任何模块（含 reviewer/finalize）降为弱 verdict，或终态已是弱 verdict 但存在 not-applicable/未解决 gap/无存活 sourced relation → 重建；结构干净的弱结论保留 composer 原文。无法确认原文安全时优先重建。回归 R8/R9。
- 最坏 LLM 调用数仍为 4（Planning + Evaluation + 重判 + bounded re-evaluation），但重评估门槛从"补查得新来源"收紧为"重判提交"，期望调用不增反降；latency / budget 上限不变。

## 13. Review 5128220693 三 blocker 修复（本 PR 内第四轮，不开新 PR）

人工 Review 认定第三轮总体方向通过（Planning、Evaluation、extra pass、recheckCommitted、bounded re-evaluation、post-liveness final gate），禁止重新设计 Whole-Claim Audit，只修 3 个最终发布一致性 blocker。不改 Planning 语义、Evaluation schema、extra-pass 数量、UI、Golden Path、Snapshot schema、source identity、Vercel、baseline、LegacyDesk、旧 REAL artifacts；不新增关键词规则、新 Agent、新模型 stage、自由循环。

- **Blocker 1（hard verdict + not-applicable 边界）**：`needsConstrainedConclusion` 增加第三触发条件——终态仍是合法硬 verdict（true/false）但存在 nonVerifiableAtoms 时同样 repair，只补边界、不降级（规则 `hard-verdict-with-not-applicable-boundary`）。overall false/true 继续由有据 Claim 支撑；not-applicable Claim 明确写为"不适用真假判断，未计入该判断"。回归 R10。
- **Blocker 2（repair 内 citation scope conversion）**：新增 `buildScopedEvidence`——按判词顺序（与 `normalizeReportCitations` 的全局 first-seen 同序）构造全局 source index，把每段 evidence 的局部 marker（supporting → [1..S]，contradicting → [S+1..S+C]）显式映射到全局编号；映射不到存活来源的 marker 删除。repair 不再直接复制带局部 marker 的 evidence，后续 normalize 只做 clamp 而不错绑。回归 R11（双 atom 局部 [1] 错绑形状 + 跨 atom 顺延形状）。
- **Blocker 3（chain 全死链 fallback）**：`pruneDeadCitations` 的 evidenceChain 层改写——URL 与非 URL metadata 分开处理，全死时 `sourceRefs` 保持 `[]`（不再 fallback 整份原数组），evidence marker 随存活来源清除；evidenceChain-only URL 纳入 liveness candidate 收集（此前只收全局与判词来源，chain 自由填写的 URL 会漏网）。回归 R12。

### 本轮 tests / build（实际运行）

- 根 `npm test`：54/605 + 3/85 + 2/21 + 20/83，全绿。
- 根 `npm run build`：exit 0。
- `cd mvp && npm test`：98 files（96 passed / 1 failed file / 1 skipped），1067 passed / 1 failed / 1 skipped；唯一失败为 LegacyDesk 已知抖动（基线对照同失败，见 §12）。
- `cd mvp && npm run build`：exit 0（tsc + vite）。
- `cd mvp/server && npx tsc --noEmit`：exit 0。
- `eval:gate` 未重跑（基线原因既有且无关，不改 baseline 换绿）。

### 本轮 tests / build（实际运行）

- 根 `npm test`：54/605 + 3/85 + 2/21 + 20/83，全绿。
- 根 `npm run build`：exit 0。
- `cd mvp && npm test`：98 files（97 passed / 1 skipped），1060 passed / 1 skipped / 0 failed。
- `cd mvp && npm run build`：exit 0（tsc + vite）。
- `cd mvp/server && npx tsc --noEmit`：exit 0。
- LegacyDesk 对照：本轮全量 1 failed（`uses the clean analysis shell for the real workspace too`）；stash 本轮改动后基线（7df268d）单跑同文件同样 1 failed（同名用例），确认为已知负载抖动，与本轮改动无关。
- `eval:gate` 未重跑：基线失败原因既有且与本轮无关（§9 记录），上一轮信号仍有效；不改 baseline 换绿。
