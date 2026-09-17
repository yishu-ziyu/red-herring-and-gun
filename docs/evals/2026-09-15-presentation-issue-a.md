# 完成态展示：不编经历、不补结论、来源带真命题、文案降级

Date: 2026-09-15

## Change

1. **完成态案卷不编调查经历。** `InvestigationDossier` 不再写固定秒数（0.0s / 1.4s / 2.1s / 15.2s / 23.4s）和编造里程碑（「国家疾控与专业科研机构数据归位」「5 拍慢动作切片已归档」「永久保留」等）。没有本次公共活动记录就不生成调查经历。默认展示材料、分歧、缺口；不展示「思考全链条」等执行层包装。
2. **展示层禁止补结论。** `ConclusionHero` 命中「这句话里有站住的部分，也有没站住的部分。」时，不得替换成「原句混淆了事实与推论：部分细节属实，但核心断言不能成立。」取消此替换。展示层只做不改变含义的排版/清洗。更具体的首句只能来自报告生成/公开文案契约，本 Issue 不改模型提示去「写得更顺口」。
3. **来源必须带着真实命题。** 不要用 `sourceId` 首次遇见 + `claims[0]?.id` 重建简化 link。命题来源入口保留原始 EvidenceLink 及真实 claimId。从顶部或命题卡打开第二条命题的专属来源，抽屉必须显示第二条命题与原始 finding/limitation。全局来源索引展示「关联哪些命题」，没有关联不伪造。
4. **文案降级。** `SourceDrawer` 外链默认「打开原文」；不要统一写「前往官方原文核验」。`ConclusionHero` 不要把 `sources.length` 写成「已查验」。案卷不要用「权威材料」。默认「打开原文」「收集到的来源」。只有数据条件满足才能用更强词。非官方/未评估不能计为已核验。
5. 换与健康无关的输入后，不得出现虚构疾控机构、固定调查耗时、未经证实的永久保存。

## Not this

- 不改 B 的阅读顺序重排、不改追问生成逻辑（F5/B）、不改分享机制、不改首页案例。
- 不新增工作台、不恢复旧三栏、不接更多模型、不辩论表演。
- 禁止仅在前端补写更顺口的判断。若必须改公开文案规则：同步 `packages/core` 与 `apps/server` 镜像（investigation 字节锁）并测两端。
- 不 relax 测试、不为绿灯改门禁。
- 不切 T20，不换模型/加 Agent，不重写 Snapshot schema。不另起视觉系统。

## Evaluator

1. 混合判断快照：页面/组件不得出现「核心断言不能成立」这类由前端补出的句子；原混合句若来自快照则原样或仅排版。【命令】
2. 第二条命题专属来源从顶部入口与命题卡打开，claim 文本与 finding/limitation 对上第二条，不对上第一条。【命令】
3. 案卷/完成态：fixture 或健康无关输入下，不得出现疾控、固定秒数 1.4s / 15.2s / 23.4s、永久保留。【命令】
4. 「已查验」「前往官方原文核验」「权威材料」不得作为无条件默认文案。【命令】
5. `cd apps && npx vitest run` 覆盖改动的 goldenPath 测试（至少 ConclusionHero / Dossier / SourceDrawer / 相关 canvas 测试）。【命令】
6. 真实浏览器渲染：本机 5173 可开就开 Cursor 浏览器走一条完成态；开不了就写未做浏览器。【人评】

## Evidence

- 混合判断：`ConclusionHero` 已删「核心断言不能成立」替换。`cd apps && npx vitest run src/goldenPath/conclusionHero.display.test.tsx src/goldenPath/investigationDossier.test.tsx src/goldenPath/presentationIssueA.test.tsx src/goldenPath/followUpClaimDisplay.test.tsx src/goldenPath/comprehension.test.tsx src/goldenPath/claimSection.test.tsx src/goldenPath/goldenPath.test.tsx` 7 文件 153 绿。
- 第二条命题专属来源：顶部入口与命题卡打开后，抽屉 claim 文本 / finding / limitation 对上第二条，不对上第一条。
- 案卷：fixture 与健康无关输入下无疾控、1.4s / 15.2s / 23.4s、永久保留；无活动不生成调查经历。
- 默认文案：外链「打开原文」；来源条「收集到的来源 N」；案卷「收集到的来源」。未改 `publicCopy` / `packages/core` 镜像。
- 人评：未做成 Cursor 浏览器走查（标签无法挂上）。本机随后可用 `http://127.0.0.1:5173/?fixture=mixed` 看完成态。
