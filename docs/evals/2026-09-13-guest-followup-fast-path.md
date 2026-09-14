# 访客同一案追问快路径

契约依据：用户 2026-09-13 裁决——没登录的追问也要走与登录相同的同一案快路径，不能整轮重拆重搜。登录路径仍见 `docs/evals/2026-09-13-followup-fast-path.md`。本契约只补「访客没有服务端案件档案」这一段。

## Change

1. **胶囊仍是先填再发。** 访客点推荐追问，问题进输入框；确认（Enter / 发送）才发出。
2. **访客点确认后再问一句，体感与登录同一规则：**
   - 上一轮证据够答 → 不完整拆题、不对已核命题再联网搜；结论答这句追问；依据标明「依据来自刚才那一轮」。
   - 新冒出的可核查小问题才再搜；已核命题仍不重复搜。
   - 人物 / 日期 / 链接变了必须重查。
3. **访客没有 `serverCaseId`：** 追问请求不带 `caseId`，不强迫登录。把上一轮**对用户可见的材料**随请求带上：命题文本与判断、可点开的出处（url / 标题 / 摘录 / 支持或反驳）、结论原文。服务端按这份材料走与登录相同的快路径分类器。
4. **无上一轮可用材料**（没有可点开 http(s) URL 的已核命题，或请求里没带这份材料）：完整管道，不假装走了快路径。
5. **宪法：** 没证据不出结论（注入必须带真实 http(s) URL）；判定拍仍跑，绑不上不编结论。快路径给出的结论仍能点开来源。
6. 登录且带得上自己的案件档案：仍读服务端档案，不改。客户端材料只在没有服务端档案时顶上。

## Not this

- 不改思考区等待文案。
- 不改胶囊「先填再发」。
- 不为此强迫登录。
- 不把未展示的内部字段塞进客户端（拼接指令、finding / limitation、命题 id、provenance、知识库内部字段都不上行）。
- 不把知识库跨案串题再打开；本快路径不替代证据库，也不被它替代。
- 不要为了快而编没有出处的结论。
- 不擅自 commit / push。

## Evaluator

1. 客户端抽出的上一轮材料只有命题、判断、可点开出处、结论；不含内部拼接指令、finding、limitation、claim id、provenance。【命令】
2. 抽出结果喂给同一套分类器：被已核命题覆盖 → 无新命题、lookup 给出上一轮 URL；人物/日期/链接冲突 → 只把追问收成新命题；无可用 URL → 计划为 null。【命令】
3. 处理器：访客 `followUp:true` 无 `caseId`、带上一轮可见材料 → 管线收到 `followUpReuse`；无上一轮材料 → 不传 `followUpReuse`（完整管道）；不 400、不强迫登录。登录且带自己的 `caseId` 仍读服务端档案。访客带别人的 `caseId` 仍 400。【命令】
4. 前端：未登录完成态追问，第二次请求无 `caseId`、有 `followUp:true` 与上一轮材料；首轮不带这些字段。胶囊仍是先填再发。【命令】
5. `cd apps && npx vitest run` 覆盖上述新测与既有相关面全绿；`cd apps && npm run build` 零错误。【命令】
6. 真实走查默认不烧。人评：没登录再问一句，结论第一句是否直接答追问、标记是否像产品语气、来源能否点开。【人评】

## Gate

`cd apps && npx vitest run src/lib/priorRoundBrief.test.ts src/lib/agentExpansion.followUpLink.test.ts src/App.followUpLink.test.tsx src/goldenPath/followUpSection.test.tsx src/goldenPath/knowledgeMark.test.tsx server/src/lib/followUpReuse.test.ts server/src/lib/casePipeline/runCasePipeline.followUp.test.ts server/src/handlers.followupObservation.test.ts server/src/handlers.followupValidation.test.ts`

## Evidence

- 契约本文件。
- 单测输出。
- `docs/NOTES.md` 头部更新。
- 人评：没登录再问一句用户会看到什么。
