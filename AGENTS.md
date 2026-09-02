# 红鲱鱼与枪

产品：`docs/PRODUCT_SPEC.md`。运行：`docs/ARCHITECTURE.md`。界面：`mvp/src/styles.css`、`mvp/DESIGN.md`。

用户看见的是对原句的直接回答和问题点，不是四字章或过程墙。细则见说明书第二节。

## 命令

```bash
cd mvp && npm test
```

行为变更再跑 `cd mvp && npm run eval:gate`。可见界面要真走到结果（原句回答 → 问题 → 出处）；测试绿不算验收。

## 长任务

只在跨会话、会压缩、或已写 Goal / Hard bar 时启用。短问答不建任务。

1. 规划前读 `runtime/STATE.md`。命中活动任务则读对应文件，不要靠聊天记忆恢复。新长任务复制 `runtime/tasks/TEMPLATE.md` 为 `runtime/tasks/YYYYMMDD-short-slug.md`，登记一行，不覆盖其他任务。
2. 里程碑、压缩、交接或结束前，更新任务文件和索引。只留目标、已验证事实、改动、失败路径、证据位置、下一步。
3. 证据留路径（测试名、eval caseId、截图、commit），不把日志贴进本文件或任务页。
4. 一次失败可以记在任务页。不准加厚本文件，不准新建 Skill。

有活动任务且本会话改了产品文件时，写回之前不要停。
