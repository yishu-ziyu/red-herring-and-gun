# 2026-09-18 统一提交者身份：清理 Contributors 面板

背景：仓库 444 个提交散落 7 个作者身份（用户本人 4 种拼写 + `dev@local` 26 条 + DevSpace 2 条 + Cursor Agent 2 条，后三者也是真实工作，只是环境兜底身份）。用户裁决：用 git filter-repo + mailmap 统一署名，不压扁历史。

## Change

- 在**全新克隆**里执行 `git filter-repo --mailmap`，把 6 个非主身份全部映射为 `yishu-ziyu <yishuziyu@gmail.com>`（作者与提交者都改）。
- force push `main` 与全部 tag（含证据回执 tag `evidence-shannon-head-receipts-20260908`、`v1.0.0`，tag 内容随改写平移，语义不变）。
- 本地工作目录随后 `fetch + reset --soft` 对齐新远端；**未提交的工作区改动保持原样**。
- 改写前产出完整备份 bundle 存到仓库目录之外。

## Not this

- 不改任何文件内容、提交信息、作者/提交日期；不删任何提交；不压扁历史。
- 不处理 GitHub 账号邮箱挂载（用户自行确认 `yishuziyu@gmail.com` 在账号下）。
- 不清理 DevSpace/Cursor 环境配置（防复发建议另行交代）。
- 不动 Issue（GitHub 侧对象，force push 不影响）。

## Evaluator

机器项（改写后逐一核对）：
1. 新克隆 `git log --all --format='%an <%ae>' | sort -u` 恰好一行：`yishu-ziyu <yishuziyu@gmail.com>`。
2. **内容零变化**：改写后 `HEAD^{tree}` 与改写前 `main^{tree}` 树哈希完全相等；提交总数不变。
3. `git ls-remote origin` 的 main/tag 指向改写后提交。
4. 本地仓库 reset 后：`git status -s` 的改动文件集合与改写前一致；`git log --oneline | head` 内容（非 SHA）不变。

人评/延时项：
- GitHub Contributors 面板缓存最长约 24 小时，刷新后应只剩一个头像（等用户过目）。

## 风险与回滚

- 全部 commit SHA 改变，旧克隆需重新 clone。备份 bundle 含改写前全部引用，可完整回滚。
