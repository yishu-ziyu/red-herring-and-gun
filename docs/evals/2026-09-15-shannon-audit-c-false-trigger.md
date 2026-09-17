# 整句审计/连词规则不得被 Issue C 时间门在测试里跳过

Date: 2026-09-15
来源：`cd apps && npm test` 8 红。怀疑 Issue C「分条已齐且剩余时间不够就走确定性报告」在测试里误触发，跳过整句审计和 Shannon 连词收权。

## Change

1. **连词收权仍跑。** A supported、B unverified/missing/related-only，audit clean 或 unavailable，整句直答应以 `directAnswer("unverified")` 开头，不得因确定性报告把 composer 的 true 原样交出。
2. **整句审计仍跑。** 核查句含「所以」跳跃时，C 的 verdict 必须是 unverified（或等价收权），直答应含「所以」原连接词，不得只剩后半句。
3. **时间门不得在测试默认 deadline 下误触发。** 分条已齐但剩余时间仍够写报告时，必须走审计/连词规则，不得只因测试时钟已过或剩余时间被算成不够就跳到确定性报告。

## Not this

- 不改这 8 条断言去迁就错误总答。
- 不以放松门禁换绿灯。
- 不把「所以」从期望句删掉来迁就拼法。
- 不以增加总超时当唯一修复。

## Evaluator

1. `cd apps && npx vitest run server/src/lib/casePipeline/runCasePipeline.shannonConjunction.test.ts` 全绿。【命令】
2. `cd apps && npx vitest run server/src/lib/casePipeline/runCasePipeline.wholeClaimAudit.test.ts` 全绿。【命令】
3. 8 条原断言一字不改：`startsWith(directAnswer("unverified"))`、C verdict=`unverified`、直含「「所以高血压可以不药而愈」尚未查清」。【命令】

人评：无。
