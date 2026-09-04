# 当前状态

脊柱 T01–T19、T21–T24 已在 `main` / `dev` / `spine`。只剩 T20（上线切换）。生产仍走 `mvp/`，`ops.sh` 未改。

检索：AnySearch 预置。收费源走 `/settings`。首页已从案件三栏壳拆出（T17 骨架误用，不是原来 mvp 脸）。全量 eval 未跑。

本会话把 SCLN 协作层写进仓库：协议 `AGENTS.md`，验收标准 `docs/evals/`，记忆本页，转向 `docs/devlog/`，可迁走包 `docs/METHODOLOGY.md`。不叫「验收卡」：那是独立于实现的完成尺度，不是一张要填的表。`runtime/STATE.md` 不再当工作记忆，hook 不再覆盖它。

## 活动

- 脊柱：`runtime/tasks/20260903-casefile-spine.md`（gitignored 细节页）。门槛仍是 eval 门禁。AnySearch 活着之后，门禁在配额上可跑，但会烧 AnySearch + LLM。等人裁。
- 旧任务 `20260902-search-progress-ui` 已 complete。

## 已验证

- 本地 `main`=`dev`=`spine`=`5e3aa69`，已推 `origin`。
- 根 `npm test`：core 455 / eval 34 / server 19 / web 47。
- `mvp` 有一条 cross-exam 5s 超时，单跑 3.4s 过（合并未改 mvp）。
- 搜索活探测见 `docs/evals/2026-09-04-search-quota.md`。

## 本机坑

- `diff` 被包装，用 `cmp`。
- `git log --oneline` 藏 merge commit。
- `grep` 是 rg，括号要转义。
- eval/server 跑 `packages/*/dist`，core 改完先 `npm run build`。
- 不要并行两个真 key eval。
- vite `--fixture` 会被拒，fixture 走 `/cases/fx-*`。

## 下一步

人评：设置页好不好用。T20 仍等 eval 门禁。可用 AnySearch 单源跑全量 eval，会烧额度。
