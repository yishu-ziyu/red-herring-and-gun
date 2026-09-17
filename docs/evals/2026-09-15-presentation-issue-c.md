# 收束时限：判断已齐不得停在 judging 无总答

Date: 2026-09-15
来源：Issue C（P1）。诊断：核查回来就发 judging；complete 只在 `runReport` 全部走完才写；judging 快照没有 conclusion。`timeout_pending` 后流结束且没有 finalReport，会停在 judging + 「还在查」。停止信号未进 `runAgent`/检索。点停止且分条已齐时黄卡把总答藏掉。

## Change

1. **分条已齐、报告来不及：必须有总答。** judging 之后、`runReport` 之前（或一开始），若可核查命题都有 judgment，且剩余时间不够一次写报告（报告窗口约 90s，MiniMax 单次默认 180s），走现成 `runReportComposerWithFallback` / `buildDeterministicFinalReport`，再走现有 complete 收尾。不得停在 judging 且无总答。
2. **不得把 interrupted 总答改标成 complete。** 缺报告就诚实 interrupted（黄卡带总答）或走确定性报告后 complete。与 `docs/evals/2026-09-15-salt-followthrough.md` 第 17 行一致：不把中断伪装成报告写完。
3. **`timeout_pending` 后流结束且没有 finalReport：必须收口。** 用已有 `interruptedInvestigationSnapshot` 收口，不得保持 judging + 「还在查」。`App.tsx` timeoutPending 例外一并改契约。
4. **点停止且分条已齐：总答必须可见。** `InvestigationCanvas` 在 stop=stopped 时不得把已有总答藏掉。停止：管线 signal 未进 `runAgent`/检索——优先改注释+文案诚实，除非接线很小。
5. **刷新 GET 不扣额；不要改额度闸门语义。**

## Not this

- 不以增加 `ORCHESTRATE_TOTAL_TIMEOUT` 当唯一修复。
- 不伪造 complete（缺报告就诚实 interrupted 或确定性报告 complete）。
- 不隐藏异常、不放松门禁。
- 不做 B 的阅读顺序重排，不重排结论区。
- 不做 D。
- 不改首页/分享/视觉系统。
- 不改额度闸门语义。

## Evaluator

1. 分条已齐、报告来不及：不得停在 judging 无总答；终态是 complete（确定性报告）或 interrupted 黄卡带总答。【命令】
2. `timeout_pending` 后无 complete：不得保持 judging + 「还在查」。【命令】
3. 点停止且分条已齐：总答可见。【命令】
4. 相关现有测试仍绿：`handlers.investigation.test.ts`、`handlers.timeoutRace.test.ts`、`runCasePipeline.test.ts` 停止边界、`stopAndResume.test.tsx`（按新契约改「不重复说中断」但总答要在）。【命令】
5. `cd apps && npx vitest run` 跑本 Issue 动过的测试。【命令】

人评：停止/超时后画面是否还像「还在查」；分条已齐时总答是否一眼能看见。

## Evidence

- 分条已齐、报告来不及：`deadline` 只剩 20s 时不调 LLM `runReport`，走 `buildDeterministicFinalReport`，终态 `phase=complete` 且有 `conclusion.directAnswer`。
- `timeout_pending` 后流结束无 complete：前端用 `interruptedInvestigationSnapshot` 收口，不再保持 judging +「还在查」。分条已齐时黄卡带总答。
- 点停止且分条已齐：不重复说「中断」，`[data-gp-interrupted-answer]` 仍可见。
- 停止信号：未把 signal 接入 `runAgent`/检索（接线不小）；`runService` 注释改为阶段边界停，不说「立刻断」。刷新 GET 未动额度闸门。
- 未做 B 的阅读顺序重排，未做 D，未加总超时当唯一修复。
- `cd apps && npx vitest run src/App.test.tsx src/goldenPath/stopAndResume.test.tsx src/goldenPath/goldenPath.test.tsx server/src/lib/casePipeline/runCasePipeline.test.ts server/src/handlers.investigation.test.ts server/src/handlers.timeoutRace.test.ts` 6 文件 189 绿。
