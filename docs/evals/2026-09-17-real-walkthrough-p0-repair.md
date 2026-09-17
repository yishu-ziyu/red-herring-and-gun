# 真实走查 P0 修复验收

## Change

1. `partial` / `exaggerated` 原子不得在用户可见结论里被写成整条「站得住」；应明确表达为部分成立 / 有事实基础但表述夸大。【命令：结论门单测】
2. 原句末尾的询问语、确认语（例如「真的假的」「是真的吗」「对吗」）不得被当成「这次没查」的事实命题，也不得生成新的检索追问。【命令：leftover + follow-up 单测】
3. 调查中命题一旦获得证据，原本折叠的命题卡自动展开，让新增证据无需等待终态即可看见；用户之后手动收起时不反复强开。【命令：ClaimSection / Golden Path 单测】
4. 1280px 完成态与调查态不得因来源胶囊、来源浮层或命题详情产生页面横向溢出；来源标题可换行，布局子项允许收缩。【命令：构建 + Playwright overflow evaluator】
5. 同一个「链接打不开，已按输入文字继续」通知在同一画面只出现一次。【命令：链接输入 / App 单测 + 真实走查】
6. 用 2026-09-17 走查同一条输入 `https://weibo.com/status/50891234 隔夜菜亚硝酸盐超标百倍直接致癌？真的假的？` 再跑一轮：不能出现「真的假的」命题/追问；最终大字结论不得与结构化 claim judgment / boundary 反向；SSE / 页面无运行时错误。【真实走查】
7. 「超标 / 超过 / 高于 / 低于 / 增加 / 减少 / 达到」这类带对象的量化事实，即使拆题模型误标为 `value + verifiable:false`，也必须被拉回可核查；本案「亚硝酸盐超标百倍」不得落成 `not-applicable`。【命令 + 真实走查】
8. 若所有可核查原子都已有方向一致来源并判 false、且没有不可核查原子，Whole-Claim Audit 不得要求证明更强的无关否定（例如“排除隔夜菜所有其它致癌因素”）再把整句降回 `unverified`；只证伪部分原子时原有桥接缺口门继续生效。【命令 + 真实走查】

## Not this

- 不通过删除 `partial` / `exaggerated` 语义来让测试变绿。
- 不隐藏所有证据或关闭追问来规避错误。
- 不把调查中的全部命题永久强制展开；用户手动操作仍应有效。
- 不改已有未相关的用户本地改动，不做全仓重构，不切 T20。
- 不把“有一条 false”当作整句 false 的充分条件；第 8 条只在所有可核查原子均有据证伪时放行。
- 不以「测试通过」替代真实走查的用户路径结果。

## Evaluator

1. `cd apps && npx vitest run server/src/lib/wholeClaimAudit/wholeClaimAudit.test.ts src/goldenPath/leftoverClaims.test.ts src/goldenPath/followUpSection.test.tsx src/goldenPath/claimSection.test.tsx src/goldenPath/inputStageLinkScrape.test.tsx`。【命令】
2. `cd apps && npm test`、`cd apps && npm run build`。【命令】
3. 启动独立 `5211/3001`，运行 `python scripts/qa/walkthrough_golden_path_real.py`，读取 `real-run.json` 的 milestones、overflow、pageErrors、sseErrors、最终命题与结论。【命令 + 人评】
4. 人评：最终第一句是否和逐条判断表达同一含义；追问是否仍围绕事实缺口而不是用户的语气词。【人评】
