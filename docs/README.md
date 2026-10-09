# 文档入口

陌生人先读这一页，再打开表里那一份。不要按文件夹字母顺序把 `evals/` 读一遍。

**现行规则只有：** [PRODUCT_SPEC.md](PRODUCT_SPEC.md)（产品）、[ARCHITECTURE.md](ARCHITECTURE.md)（怎么跑）、[REPO.md](REPO.md)（文件在哪）、[NOTES.md](NOTES.md)（三行现状与已否定的判断）。实现层词在仓库根 [CONTEXT.md](../CONTEXT.md)。本地跑 `cd apps && npm run dev`，发布 `./ops.sh`。

| 你要做的事 | 打开 |
|------------|------|
| 产品是什么、允许什么、禁止什么 | [PRODUCT_SPEC.md](PRODUCT_SPEC.md) |
| 正在做什么 | GitHub Project「红鲱鱼与枪」：https://github.com/users/yishu-ziyu/projects/1 |
| 带来了什么 | [metrics/index.html](metrics/index.html)（数字曲线）＋ 各 Issue 的「结果」 |
| 代码实际怎么跑、哪层是真的 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 文件为什么在这里、改一处走哪几层 | [REPO.md](REPO.md) |
| 哪些判断已经否定 | [NOTES.md](NOTES.md) |
| 这一次算不算做完 | 动手前写 [evals/](evals/) 里一份新契约；做完在契约末尾补「结果」并链接 Issue |
| 为什么选这条实现 | [adr/](adr/)（ADR-006 已废止） |
| 方向为什么变了 | [devlog/](devlog/) |
| 安全审计现状与缺口 | [security-checklist.md](security-checklist.md)（#127 保持开放） |
| 怎么发布、门禁 | [PRODUCT_RELEASE_GATE.md](PRODUCT_RELEASE_GATE.md) |

`evals/` 是某次任务的完成尺度，不是百科。做完以代码和 NOTES 为准；里面写着「未做 / 未 commit / mvp/」而 NOTES 已经改口的，当废纸。走查截图、实验室 HTML 不进现行规则。

实现细节以代码为准。不要从仓库里搜旧 DEV-LOG、旧 Agent 读书笔记当现行规则。
