# #79 合取整体结论独立验收

## Change

必要命题 A 已有支持而 B 未查清时，最终整体结论不能发布 true/supported；直接答案须说清 B 的未知，保留 A 的已知与出处。A 有反证、B 未查清时可否定整体，但不能将 B 写成 false。partial 仅有反证 URL 不给聚合贡献支持方向。

## Not this

不实现自然语言逻辑分类器，不全部降级 unresolved，不修改 Audit、UI 或历史记录。测试使用合成模型/搜索输出与 alive 注入，执行真实 runCasePipeline→final Snapshot；不证明 LIVE 模型能力。独立 Validator 与 Implementer 为不同代理但共享账户和 worktree，隔离级别 logical-only。

## Evaluator

冻结公开测试：`mvp/server/src/lib/casePipeline/runCasePipeline.shannonConjunction.test.ts`。
命令：`cd mvp && npm test -- server/src/lib/casePipeline/runCasePipeline.shannonConjunction.test.ts`。

- 函数：A=true/support + B=unverified、缺失 verdict 或 related-only，不返回 true；重排仍成立。
- 管线：上述三类 B × clean/unavailable Audit，Composer=true，最终 verdict=unverified、Snapshot=unresolved；A=supported，B=unresolved；直接答案有未知边界与 A 的实际证据，引用 marker 解析到真实 A URL。
- 正向：单 A 或双 A/B 均有 support 时维持 true/supported、来源关联正确。
- 反向：A=false/contradict + B=unknown，整体 false/refuted；B=unresolved，直接答案不保留“两项均不成立”。
- 方向：false/contradict 与 partial/contradict-only 的聚合应 false，不混入真侧。

失败前日志、执行收据和冻结测试 SHA256 放 `docs/qa/artifacts/shannon-79/`；失败后使用同一测试 hash。最终 UI 主观阅读仍由人工复审；这里仅验收到生产数据出口。

## 旧验收纠正（独立 Validator 裁定）

`assembleFinalReport.test.ts` 原有“全 true 且至少一条有据→true”把 A 的证据代替无据 B，直接违反附件 §3“A=true 不能在 B 未知时证明该合取”。即使 B 的模型判词写 true，无支持方向来源也不满足“充分支持”；纠正为 null（函数没有 unverified 返回值，最终管线仍由冻结测试强制 unverified）。保留双命题各自有支持的 true 正向对照。不是为匹配实现改期望。旧 SHA 与修复后均使用这份纠正测试，Shannon 冻结测试不变。

## Audit 测量纠正（独立 Validator 裁定）

既有 Case 4 与 Review 5128449568 Blocker 2 同时输入未知必要命题和 Audit bridge gap，原测试把 `audit-unresolved-bridge-gap` 必须第一个触发当作要求。附件 §3 明确必要命题不能跳过，但没有规定两个合法收权检查先后。两处删除具体 rule 字符串断言，改为确切 missingJustifications 留在审计 artifact，以及最终 Snapshot.directAnswer 同时保留确切 bridge gap 和未知命题边界；原 unverified/unresolved 与 failed 状态断言仍在。不是允许任意 rule 换绿，若 gap 丢失或发布文本隐藏仍失败。旧/新候选使用完全同版纠正测试。

Case 4 同时给出 missingJustifications 和 nextQuestions；发布边界可通过确切未解问题表达，因此 directAnswer 断言“指南是否支持普遍餐后注射胰岛素？”，artifact 仍检查“A、B 真推不出 C，缺桥接依据”。该 fixture 原先对假域名发真实探活，与其“A/B 有据支持”的前提冲突；补 alive 注入保持其原定事实前提。首次更严格测量尝试旧/新都因未注入 alive 与错误要求逐字重复 missingJustifications 失败，原日志保留在 validator-measurement-attempt1-*。

## 独立最终复验

同版三套测量器：旧 HEAD `3cd4dfe` 为 11 失败/50 通过；修复后候选工作区为 61/61 通过。Shannon 17 项 frozen hash 保持 `a10642b7d2ba5f5d03fe56fdcffbcc3d0325e3ff255f04624116191ce9ea3403`，修复前 10 红、修复后全绿。最终 Snapshot/directAnswer、正向引用及未知边界已独立执行验证。收据绑定测试、日志、当前 diff 与 12 份合成管线结果。此证据是 synthetic 生产管线出口验证，非 LIVE 或实际浏览器用户路径证明。
