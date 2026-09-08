# 2026-09-08 LegacyDesk 全量失败定位 + HEAD 收据导出

本轮复审：PR #79 `5137456034`（commit `c5517a8`）、PR #80 `5137458003`（commit `b55b03b`）。其后没有更新的人工 Review。

## Change

1. 从最新 `origin/main`（`861386d`）建立独立窄分支，定位 `LegacyDesk` 在 mvp 全量中的失败：`uses the clean analysis shell for the real workspace too` / missing `apodex-run`。用最小失败组合检查运行顺序、状态污染、mock/计时器清理、异步生命周期与当前契约。若根因可在不删断言、不 skip、不重试刷绿的前提下修复，则修复并在全量复验。
2. 把两个当前 HEAD review 目录的 DELIVERY、收据、结果、日志和脱敏证据 manifest 发布为可读取 artifact/附件。已提交旧候选（#80 `f3b9901`）收据不得冒称新 HEAD 执行。不为保存收据改动 #79/#80 产品候选 SHA。
3. 四次 LIVE 保持待批准、实际运行 0。给出可执行的总费用上限、调用上限、取消/停止机制，并证明将测的前后端版本。不把旧 Snapshot 回放当作 #79 真实调查。
4. 下一批真实结果的核对重点写明：关系标签、finding、摘录与原文支持范围；首屏答案与各 Claim 已知/未知边界。不只检查 URL 能否打开。历史样本矛盾保留为诊断材料。

## Not this

- 不继续扩大 Whole-Claim Audit 或 QA 平台。
- 不自行合并 #79/#80，不关闭 #53/#54。
- 不删断言、不 skip、不靠重试刷绿，不把全量失败自动豁免为负载抖动。
- 不修改旧样本来展示新版成功。
- 不把 Simulator 发现的矛盾算真人理解通过。
- 不把 `out/shannon-80-review-head` 的 RECORDED_REPLAY 写成 #79 新 producer 的真实调查。
- 不为了提交收据再改 #79/#80 产品代码。

## Evaluator

- **E1（机器）**：独立分支的 merge-base 为当前 `origin/main` `861386d`，且不含 #79 Audit 与 #80 QA 平台扩面。
- **E2（机器）**：最小失败组合有命令与日志：至少包括（a）只跑 `LegacyDesk.test.tsx`；（b）只跑失败用例；（c）mvp 全量；（d）改变文件顺序或 `fileParallelism`。结论必须对照 DOM/生命周期/mock，不得先写成抖动。
- **E3（机器）**：若修复，失败用例的原断言仍在；`cd mvp && npm test` 中该文件不得 skip；全量不再以 missing `apodex-run` 失败。根 `npm test`、`npm run build`、`mvp` build 通过。
- **E4（机器）**：GitHub 上可打开的附件/Release 含 #79 `c5517a8` 与 #80 `b55b03b` 的 DELIVERY、收据、结果、日志、脱敏 trace/截图与 manifest；manifest 绑定 candidate SHA 与 dirty/diff；`f3b9901` 单列旧候选。
- **E5（人评）**：LIVE 仍未执行；预算说明含金额上限如何强制、调用上限、取消/停止是否真能中止在途计费请求、前后端 SHA 如何证明。缺口必须写明 BLOCKED，不得用声明代替。
- **E6（人评）**：下一批真实结果核对清单是否覆盖关系标签/摘录范围/首屏与 Claim 边界，而不是只测链接 200。

## Evidence

本文件、独立 PR、mvp 测试日志、GitHub Release 附件、#79/#80 评论。测试绿不是 #79/#80 合并许可。

## 本轮结果

### 复审

#79 `5137456034`、#80 `5137458003` 之后没有新的人工 Review。

### LegacyDesk

先前全量失败 DOM（`out/shannon-80-final/mvp-tests/process.log`）不是空白页：侧栏已是「核查中」，中栏为 Suspense 回退「正在打开核查工作台…」，`apodex-run` 尚未挂上。`findBy` 默认 1 秒到时。同文件后续用例通过，因为模块级 `missionControlViewPromise` 已缓存。

本机从 `origin/main` `861386d` 复验：

| 组合 | 命令 | 结果 |
| --- | --- | --- |
| A 单文件 | `npx vitest run src/legacy/LegacyDesk.test.tsx` | 29 通过 / 6.31s |
| B 失败用例单独 | 同文件 `-t "uses the clean analysis shell..."` | 1 通过 / 28 skip |
| C 与相邻重文件并行 | LegacyDesk + goldenPath + livePath + App | 143 通过 |
| D 关闭 fileParallelism | 同上串行 | 134 通过 |
| E 暖缓存全量 | `cd mvp && npm test` | 1008 通过 / 1 skip / 22.41s |

因此它不是本轮 #79 独有失败，也不是断言写错。根因是 `React.lazy(MissionControlView)` 的异步生命周期：点击后还要等 300ms 切相，再等动态 import；全量 transform 争用时 import 超过 1 秒，首条启动用例失败。不预设「无害抖动」，不删断言、不 skip、不重试刷绿。

修复（本独立分支）：挂载即预取工作台模块；动态 import 失败时清空缓存以便重试；测试 `beforeAll` 先 `import` 同一模块，使本 worker 不再和全量抢首包。原 `apodex-run` 断言保留。

### 收据

https://github.com/yishu-ziyu/red-herring-and-gun/releases/tag/evidence-shannon-head-receipts-20260908

- #79 HEAD `c5517a8`：61 项管线收据，不是全量。
- #80 HEAD `b55b03b`：报告合同 + RECORDED_REPLAY。backend=`DISABLED_RECORDED_REPLAY`。
- 已提交 `f3b9901` 收据仍在 PR #80 仓库内，不得冒称新 HEAD。
- 分享 trace 为 `trace.redacted.zip`，与收据中原始 hash 不同。

### LIVE

仍待批准，实际 0 次。强制方式见 `docs/evals/2026-09-08-live-admission.md`。金额单价 unknown，在途 fetch 超时不 abort，故「停止计费」仍 BLOCKED。下一批真实核对见 `docs/evals/2026-09-08-next-real-result-checks.md`。

#53 / #54 未关闭。#79 / #80 未合并。
