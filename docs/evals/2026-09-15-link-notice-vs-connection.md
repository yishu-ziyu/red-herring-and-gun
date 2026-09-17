# 登录墙提示不得被连接中断盖掉

Date: 2026-09-15
来源：`inputStageLinkScrape.test.tsx` P8。空 orchestrate mock 流立刻结束 → `connection=failed` 且无快照；`App.tsx` 把这当成「接不回去」，写连接中断全局提示并打回输入态。

## Change

用户刚提交、链接打不开、调查已开始：`.gp-global-notice` 仍是「链接打不开（可能需要登录），已按你输入的文字继续」。连接中断 / timeoutPending 不得无条件覆盖它，也不得把已开始的调查打回输入态。

## Not this

- 不为绿灯改 P8 断言。
- 不改门禁。
- 不取消「接不回去且没有任何材料 → 回首页」这条刷新恢复语义（无失败链接时仍回输入）。

## Evaluator

1. 贴微博登录墙链接：切到调查态后 `.gp-global-notice` 含登录墙提示，不是「这次没有查完」。【命令】`cd apps && npx vitest run src/goldenPath/inputStageLinkScrape.test.tsx`
2. 接不回去且没有任何材料：仍回首页输入。【已有】`stopAndResume`「接不回去且没有任何材料」。
