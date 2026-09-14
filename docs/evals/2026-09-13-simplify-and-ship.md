# 2026-09-13 简洁化今天产品改动并提交

## Change

今天未提交的产品改动被简洁化后保持原行为，然后提交并 push 到已跟踪分支。用户可见路径不变：调查体验诚实化、同一案追问快路径（含访客）、走查缺陷与展示收口。

## Not this

- 回退访客追问快路径（没登录也走同一案快路径）
- 重写 `packages/` 脊柱
- 为简洁而放宽测试断言
- 改 git config、Agent 署名、force push
- 提交 `.env`、密钥、大体积走查截图

## Evaluator

1. `cd apps && npx vitest run` 覆盖动过的面，全绿。失败就修，不放宽断言。机器。
2. `git log -1 --format='%H %s'` 有新 commit，message 写 why：调查体验诚实化、追问快路径、走查缺陷与展示收口。机器。
3. `git status -sb` 显示已 push（`ahead 0`）或与远程同步。机器。
4. `git log -1 --format='%B'` 不含 `Co-authored-by: Cursor`、`Made-with: Cursor`、任何 Agent 署名。机器。
5. 简洁报告写明删了什么重复。人评。

## Evidence

- 本文件
- vitest 输出
- commit hash
- `git status -sb` 在 push 后
