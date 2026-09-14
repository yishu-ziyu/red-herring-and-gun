# 同一案追问快路径

契约依据：用户 2026-09-13 裁决——追问确认之后，能用这一案已有证据答的，直接基于现有材料给结论，并标明依据来自刚才那一轮；只有新冒出来的小问题才再搜。证据库管的是「另一条意思相近的新调查少搜」；本契约管的是「同一案子里的下一句」。

## Change

1. **追问仍是同一条核查的下一问**，不是新案子。推荐胶囊「先填再发」不变。
2. **登录且带得上一案档案**：
   - 不再对原句做完整拆题（不重跑拆题拍、不对该案已核命题再自证）。
   - 已核过且带可点开 URL 的命题：**不联网检索**；证据注入本轮，来源/证据标明「依据来自刚才那一轮」。
   - 若追问没有新的可核查小问题、或新问题能被现有材料覆盖：整轮不对已核命题联网搜；结论第一句仍直接回答这句追问。
   - 若追问冒出上一轮没有的可核查小问题（人物/日期/链接变了，或跟已核命题对不上）：**只搜新的**；已核命题仍不重复搜。
3. **拿不到上一案服务端档案**（无 `serverCaseId` / 未登录）：访客把上一轮对用户可见的材料随追问带上，走与登录相同的快路径分类；没有可用材料才走完整管道。细则见 `docs/evals/2026-09-13-guest-followup-fast-path.md`。
4. **宪法**：人物/日期/链接变了必须重查；没证据不出结论（注入必须带真实 http(s) URL，判定拍仍跑，绑不上不编结论）；记忆只加速不代替核查。快路径给出的结论仍能点开来源。
5. 证据库跨案语义命中仍在，职责不变：本快路径不替代它，也不被它替代。

## Not this

- 不改胶囊「先填再发」。
- 不绕过登录墙、不改拆题质量标准本身。
- 不把证据库「跨案语义命中」当成这一案快路径的替代。
- 不要为了快而编没有出处的结论。
- 不动 `packages/eval/`、不修 eval:gate 考题。
- 不擅自 commit / push。

## Evaluator

1. 分类器：追问被已核命题覆盖 → 计划里无新命题、lookup 给出上一轮 URL；人物/日期/链接冲突或语义对不上 → 只把追问收成新命题；上一轮无可用 URL → 计划为 null（不得假装快路径）。【命令】
2. 检索层：已核命题不进 `searchOne`；新问题只搜新的；注入来源 `provenance === "prior-round"`。【命令】
3. 管线：有档案且可覆盖 → 不调用 `rumor_detector`、已核命题 `searchOne` 次数为 0；有档案且有新问题 → `searchOne` 只收到新命题；不传档案 → 完整管道（拆题仍跑、逐命题检索）。结论带来源，来源可点开。【命令】
4. 处理器：登录且 `followUp:true` 带得上自己的案件 → 管线收到 `followUpReuse`；访客无 `caseId` 但带上一轮可见材料 → 同样收到 `followUpReuse`；不带 followUp / 无材料 → 不传 `followUpReuse`。【命令】
5. 前端：`provenance === "prior-round"` 的证据条目出「依据来自刚才那一轮」标记，胶囊仍可点开来源；知识库标记与普通检索条目不受影响。【命令】
6. `cd apps && npx vitest run` 覆盖上述新测与既有相关面全绿；`cd apps && npm run build` 零错误。改过的镜像（`packages/core` investigation）`npm run build` 零错误。【命令】
7. 真实走查（仅行为变更必须真走查时）：最多 1 次首轮 + 1 次可复用证据的追问 + 1 次必须新搜的追问。本批默认不烧真实调查。【人评】

## Gate

`cd apps && npx vitest run src/goldenPath/knowledgeMark.test.tsx src/goldenPath/activity.test.tsx src/lib/agentExpansion.followUpLink.test.ts server/src/lib/followUpReuse.test.ts server/src/lib/atomSearch.knowledge.test.ts server/src/lib/casePipeline/runCasePipeline.followUp.test.ts server/src/handlers.followupObservation.test.ts server/src/handlers.followupValidation.test.ts server/src/lib/investigation/provenance.test.ts`

## Evidence

- 契约本文件。
- 单测输出。
- `docs/NOTES.md` 头部更新。
- 人评：结论第一句是否直接答追问、标记措辞是否像产品语气、来源能否点开。
