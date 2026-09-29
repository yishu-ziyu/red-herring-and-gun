# 分支与界面状态收束

Issue：[#130](https://github.com/yishu-ziyu/red-herring-and-gun/issues/130)

## Change

用户要求核对各分支，收束已完成工作，确认5189是否漏掉新版界面。

## Not this

不清理未提交工作，不推送主线，不删除在用工作区，不将HTML原型冒充已实现页面。

## Evaluator

删除分支前用 git merge-base --is-ancestor 验证已在main；git worktree list 确认分支未被占用；核对原Claude会话及git历史中的界面修改。

## 结果

3个已合入、无占用的本地分支已删除：fix/error-analysis-round1、fix/live-run-defects、rewrite/behavior-preserving。恢复点已记录在Issue正文，提交全部保留于main。

剩余main、当前rewrite/evidence-first、rhg-fix使用中的fix/error-analysis-round2。rhg-fix的未提交E2E/netTape代码保留；main领先远端7个提交，未推送。5189基于main当前生产界面；原Claude会话中的新版是outputs/evidence-first-mock.html原型，最后提交仅更新PRODUCT_SPEC，未接到生产页面。
