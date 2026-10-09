# 验收：修复副本归到主项目

Status: closed

## Change

将独立摆放的 `rhg-fix` 修复副本归入主项目 `.worktrees/rhg-fix/`，
保留 `fix/error-analysis-round2` 分支、所有未提交文件及测试入口。

## Not this

不删除副本，不合并或重置分支，不提交、不推送、不发布。
不覆盖主项目原有修改，不触碰其他 worktree。
本次只整理本机目录，不在 GitHub 创建 Issue 或更新远端看板。

## Evaluator

主代理在迁移前记录整个副本的 SHA256、Git HEAD/分支/改动清单、三个依赖链接。
使用 `git worktree move` 迁移后逐项核对，并从新位置检查依赖解析及已有测试入口。
只有三个依赖链接及 Git 自动维护的 `.git` 定位文件允许改变。
本机清单和结果放在 gitignored 的 `docs/evals/artifacts/2026-10-06-worktree-location/`。

## Checks

- [x] C1 旧目录不存在，新目录为真实目录，`git worktree list` 和修复副本 Git 根目录均指向新位置。
- [x] C2 所有普通文件、目录、其他链接不变；分支、HEAD、未提交改动清单不变。
- [x] C3 三个 node_modules 链接仍指向主项目原依赖目录，Node 从新位置能解析依赖，已有测试入口可运行。
- [x] C4 主项目 HEAD、原有源码改动和 `.gitignore` 不变；其他 worktree 注册位置不变；新副本被主仓忽略。

## 结果

2026-10-06 完成。Git 自动修正副本定位文件，迁移前后 2006 项清单核对通过。
分支仍为 `fix/error-analysis-round2`，HEAD 仍为 `f96a37f`，未提交工作清单完全相同。
主项目 HEAD 仍为 `110ac2e`，原有源码改动和其他 worktree 注册位置不变。

- Node 从新位置成功解析 TypeScript、Vite、Vitest、Express、tsx，均来自原共享依赖。
- `node --check .worktrees/rhg-fix/apps/e2e/e2e.mjs` 和 `drive-cases.mjs` 通过。
- `npm --prefix .worktrees/rhg-fix/apps test -- src/goldenPath/evidenceTitle.test.ts`：1 个文件、3 项测试通过。
- `git check-ignore .worktrees/rhg-fix` 命中新路径；`git diff --check` 通过。
- 迁移没有修改产品源码，没有提交、推送、发布或改变其他修复副本。

本机 `manifest.json` 和 `result.json` 位于上述 artifacts 目录，记录逐文件 SHA256、
原 Git 状态及迁移结果。网页及在线调查未运行：本次不改产品行为。
