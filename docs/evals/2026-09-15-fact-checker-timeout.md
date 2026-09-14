# 作判断超时：盐说法要能写出总判断

Date: 2026-09-15
来源：用户问「为什么写不出总判断」后，要求从全栈修好判断超时，再跑一轮盐说法。

## Change

1. **盐说法能等到分条判断，并写出对原句的第一句。** 同一条低钠盐混真假说法，从首页提交到终态：四条命题都有判断（站得住 / 站不住 / 有对有错 / 还查不清），画面上有总答，不是「还没有写成总判断」且四条「没查完」。
2. **作判断不再被 90 秒一刀切掉。** MiniMax 作判断的时限与这一步实际工作量对齐；超时后备用通道还能接到还能返回正文的供应商，不会只打失效密钥或只返回 thinking 的通道然后整次中断。

## Not this

- 不关掉全局超时来硬跑通。
- 不把 MiniMax 一次超时就从本进程踢掉 10 分钟，导致后面整轮只能打失效密钥。
- 不假装有总判断：没有分条判断仍不得编第一句。
- 不 commit。

## Evaluator

1. 作判断（fact_checker）单次尝试时限大于 90 秒，且有测试锁住。【命令】
2. MiniMax 一次超时不会让后续 agent 在本进程内只能走失效密钥；超时与「密钥无效 / 余额不足」不是同一类跳过。【命令】
3. `cd apps && npx vitest run` 相关 server 面（providerRouter、quota、pipeline 超时）绿。【命令】
4. 盐说法真跑：终态有 `conclusion.directAnswer`，四条命题都有 `judgment`，截图可见总答。黄卡若出现，只能是「收束时中途停了」加总答，不能是四条「没查完」且无第一句。【人评 + 命令】

## Evidence

过程记录与截图：`docs/evals/2026-09-15-salt-run3/`

- `timeoutForProviderModel({}, "minimax", "MiniMax-M2.7-highspeed", 90000) === 180000`
- MiniMax-M2.7 超时一次 `isProviderQuotaSkipped` 仍为 false；M3 一次为 true
- DeepSeek `Authentication Fails … api key is invalid` 算密钥失效
- `PIPELINE_TOTAL_TIMEOUT_MS_DEFAULT === 420000`
- `cd apps && npx vitest run server/src/lib/providerRouter.test.ts server/src/lib/minimaxM3.test.ts server/src/handlers.timeoutRace.test.ts` 47 绿
- 盐说法 `23799fa5`：fact_checker MiniMax `timeoutMs: 180000`，29s/38s/47s 完成。终态黄卡「收束时中途停了」，总答可见，四条有判断（三条核查结论 + 一条立场表达）。不是「还没有写成总判断」且四条没查完。
