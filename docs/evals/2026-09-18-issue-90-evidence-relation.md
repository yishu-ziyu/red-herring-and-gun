# Issue #90：证据关系必须在上屏前核验

## Change

央广网气泡水事故按「命题—具体材料段落」修，不按网页关键词翻桶。FactChecker 给出的支持/反驳 URL 在进入公开 InvestigationSnapshot 前，必须经过独立的 claim-source relation audit；未审到、审不清或只提供背景的来源只能显示为「仅相关/待核验」，不能先显示绿色支持再在终态纠正。

来源卡片保留真实网页标题，同时把与当前命题匹配的小节标题和上下文段落挂在 EvidenceLink 上。模型返回的 title/snippet 不能覆盖本轮检索得到的 canonical source metadata。同一 URL 被不同命题引用时，各自持有自己的 passage/section，不共享错误摘录。

拆题不得同时保留「所以可以中和酸」这种无主语跳跃残句和「气泡水可以中和酸」完整主张；完整主张能覆盖跳跃时优先保留完整主张。

## Not this

- 不见到「辟谣 / 流言 / 但是 / 杯水车薪」就确定性改成反驳；这些词只能作为语义核验的上下文。
- 不把合集的小节标题冒充网页真实 title，也不为不存在的 DOM anchor 编造链接。
- 不因为来源 URL 合法就认为它支持命题；URL 绑定、来源可靠性和语义方向是三件事。
- 不用最终报告纠错作为允许中途错误方向上屏的理由。
- 不夹带 T20、模型套餐或整站视觉重构。

## Evaluator

1. 单元：FactChecker 把某 URL 放 support，而 relation audit 判 `context-only` / `contradict` 时，公开前必须移出 support；audit 缺失时 fail-closed 为 related-only/unverified，不产生 support/contradict。
2. 单元：同 URL 对不同 claim 可有不同 relation；不能按 URL 全局翻桶。
3. 单元：CNR 合集 canonical title 保持《长期戴眼镜会变金鱼眼…》，EvidenceLink 的 sectionTitle 为「喝气泡水可以降尿酸」，passage 同时含前提与「杯水车薪/无法引起人体酸碱变化」限制；模型伪造的 source title/snippet 不进入快照。
4. 单元：原句已有「气泡水可以中和酸」时，不再插入「所以可以中和酸」重复残句；真正遗漏的「所以/因此」结论仍会补入。
5. 管线：第一份 `judging` 快照已经使用 relation audit 后的关系；后续补查新来源在没有刷新 audit 前最多是 context-only，刷新后才允许出现方向标签。
6. UI：SourceDrawer 优先显示 EvidenceLink passage，并把 sectionTitle 明确标为命中小节；网页 title 仍作为页面标题显示。
7. 回归：相关定向测试、`npm --prefix apps test`、`npm --prefix apps run build`、根 `npm test && npm run build`。真实模型复验固定同一输入与来源后逐条读原文，不以单测全绿替代内容验收。

## 实施结果（2026-09-18）

- 已实现独立 `claimAtom + URL` 关系审计：FactChecker 的候选方向保留在管线内部，公开 `InvestigationSnapshot` 只消费 SourceValidator 审计后的关系。缺审计、审不清或新增来源未及时复核时 fail-closed 为仅相关/未核验，不允许先出现支持/反驳徽章。
- 初轮改为 `FactChecker → SourceValidator`，SourceValidator 拿到 FactChecker 实际准备发布的 directional candidates；证据补查、质询重判与 whole-claim 补查出现新 URL 后都会刷新审计。最终报告优先使用审计后的 FactChecker 分条，不接受 ReportComposer 重新引入未经审计的方向。
- `atomSearch` 在合法 URL 命中后仍以检索层 title/snippet 为 canonical metadata；模型不能借同 URL 改写标题和摘录。上下文上限从 320/500 字提升至约 900 字，避免「虽然……但是……」后半句被裁掉。
- EvidenceLink 新增 `sectionTitle / passage / relationReason`。Source 仍保留真实网页标题；长文/合集按当前命题提取局部 passage，并在可识别时分离「流言 <小节> 真相」小节名。SourceDrawer 优先展示 link passage，并把网页标题、命中小节和关系理由分开呈现。
- 拆题补丁会在完整主张已经覆盖「所以/因此」结果时抑制无主语残句。本案「气泡水可以中和酸」存在时不再额外生成「所以可以中和酸」；真正缺失的跳跃结论仍会补入。

验证：

- P0 关系/来源/拆题定向回归通过；Case Pipeline 扩大回归 **155 passed / 1 skipped / 0 failed**；Source Drawer 与 Golden Path 定向回归 **123/123**。
- `apps` 前端与 API build 通过；schema/build 的 `apps/server` 与 `packages/core` 镜像一致；`git diff --check` 通过。
- 根工作区 `npm test`：core 638 + eval 90 + server 21 + web 83 = **832 passed / 0 failed**；根 `npm run build` 通过。
- 固定 CNR 片段直接调用真实 `MiniMax-M2.7-highspeed` SourceValidator 成功返回新 schema：对「气泡水可以中和酸」+ 该 CNR URL 判 `context-only`，理由明确区分「理论上有微弱机制」与「人体实际效果杯水车薪、不能支持有效中和」；同时把胃部不适/苏打水治疗问题列为缺失证据，没有跨题强判反驳。
- 真实 Chrome（固定 HTTP/SSE 快照、无模型调用）通过：抽屉同时显示真实网页标题《长期戴眼镜会变金鱼眼？未见得》、命中小节「喝气泡水可以降尿酸」、含「杯水车薪/无法引起人体酸碱变化」的 passage、关系理由，且不存在错误的「支持」徽章；无 page error / console error。

边界：完整真实管线同案复验尝试超过生产 420s 时限后终止。该次运行遇到 MiniMax FactChecker/ReportComposer 坏 JSON、StepFun thinking-only，以及其余备用 provider 当前不可用/余额不足/本地 Codex 路径缺失。它不构成 #90 完整 E2E 通过，也不能用来否定已通过的关系审计验证；需要在 provider 可用性恢复后再跑一条完整同案。

整套 `apps npm test` 最终为 **1673 passed / 4 failed / 1 skipped**。4 个失败均与本 P0 无关、且在本轮开始前已存在：`App.progressiveThread` 的「调整核查重点」入口，以及 3 个旧 ThinkingDisclosure 展示契约。#90 新增的 SourceDrawer 两个失败已按新 passage 语义修正并通过。未通过删除 P0 门禁或恢复旧错误行为换绿。
