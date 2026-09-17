# 当前产品基线提交

## Change

把当前 `fix/issue-87-judging-complete` 工作区整理成一个明确、可回退的产品基线 commit。基线包含当前真实产品代码、测试、产品/架构/验收文档、QA 脚本、必要设计 HTML 与被文档实际引用的终态浏览器截图。

未引用的中间态设计 PNG 不进入版本库，但保留在本机；通过本地 `.git/info/exclude` 排除，不删除用户文件。

基线提交必须如实记录当前机器验收状态：根工作区测试/构建通过，`apps` 全量仍有 4 个既有过程 UI 契约失败 + 1 skipped，因此该 commit 是“当前产品事实基线”，不是“可发布/可合并版本”。

## Not this

- 不 push、不 merge、不发布。
- 不为了把测试刷绿而修改当前产品行为或删除失败断言。
- 不删除本机中间设计截图。
- 不重写历史，不 squash 已有 3 个分支 commit。
- 不把 `.env*`、密钥、凭证或本地数据库加入版本库。
- 不把 DevSpace review snapshot 当作正式产品分支或版本。

## Evaluator

1. 敏感文件扫描：待提交列表不包含 `.env*`、`.pem`、`.key`、凭证明文；文本扫描无明显 API key/token。
2. 设计产物：`docs/design/scheme-a-real-render.png` 可被 `docs/NOTES.md` 引用并进入提交；其余当前未引用中间 PNG 不进入 Git index，且本机文件仍存在。
3. 提交前 `git diff --check` 通过；前端/API/根构建沿用本轮已验证结果，必要时复跑。
4. 提交后 `git status --short` 无普通源码/测试/文档脏改动；只允许被本地 exclude 的中间截图存在于文件系统但不出现在 status。
5. 新 commit 的 parent 是当前 `6e9699e`，不改写已有历史；提交信息明确这是当前产品基线，而不是发布版本。
6. 当前已知验收事实写入本文件并随 commit 固化：
   - Case Pipeline：155 passed / 1 skipped / 0 failed；
   - 根 workspace：832 passed / 0 failed；根 build 通过；
   - `apps`：1673 passed / 4 failed / 1 skipped；4 个失败为既有过程 UI 契约冲突（`App.progressiveThread` 的「调整核查重点」入口、3 个 ThinkingDisclosure 旧契约）；
   - `apps` 前端 build、API build、`git diff --check` 通过；
   - #90 固定 SourceValidator 真实 MiniMax 工单返回 `context-only`，固定快照 Chrome 抽屉验收通过；完整在线气泡水 E2E 因 provider 可用性/坏 JSON 超过总时限，未完成，不能写成通过。
