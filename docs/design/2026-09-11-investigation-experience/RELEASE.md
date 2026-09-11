# 交付与回滚说明（PR-F）

- 日期：2026-09-11
- 契约：`docs/evals/2026-09-11-*.md`（每条改动一份）；完成情况：同目录 `ACCEPTANCE.md`、`ISSUES.md`
- 失败经验：同目录 `lessons.md`

## 一、改了哪些生产路径

| 路径 | 做了什么 |
| --- | --- |
| `apps/src/App.tsx` | 停止、刷新恢复、保存状态重试、分享入口接线 |
| `apps/src/goldenPath/ActivityFeed.tsx`（新） | 调查中的公共活动流 |
| `apps/src/goldenPath/ShareControl.tsx`（新） | 分享：预览 → 创建 → 撤销 |
| `apps/src/goldenPath/useInvestigationRun.ts` | 活动累计、runId、停止三态、resume |
| `apps/src/goldenPath/ClaimSection.tsx` | 争点两侧各自可点（完成态也渲染） |
| `apps/src/goldenPath/{InvestigationCanvas,copy,golden-path.css}` | 画布装配、文案、样式 |
| `apps/src/lib/investigationResume.ts`（新） | 重连与取消的客户端 |
| `apps/src/lib/agentExpansion.ts` | `run_started` / `run_state` / `investigation_activity` 事件与 `clientRequestId` |
| `apps/server/src/handlers.ts` | 运行身份、总线唯一出口、取消/读取/重连端点、帧守卫修正 |
| `apps/server/src/lib/runService.ts`（新） | 幂等、状态机、AbortSignal、订阅与重放 |
| `apps/server/src/lib/runStore.ts`（新） | runs / run_activities 持久化 |
| `apps/server/src/lib/sqliteStore.ts`（新） | SQLite 适配层与建表迁移 |
| `apps/server/src/lib/caseStore.ts` | 换 SQLite + 旧 `cases.json` 导入；不再按条数淘汰 |
| `apps/server/src/lib/shareHandlers.ts`（新） | 分享令牌、公开投影、公开页 |
| `apps/server/src/lib/investigationEmitter.ts`（新） | 快照先落、活动后发 |
| `packages/core/src/investigation/activity.ts`（新）+ `apps/server` 镜像 | `PublicActivity` 契约与投影 |

## 二、数据库与数据

- 库文件：`$DATA_DIR/rhg.sqlite`（默认 `apps/server/.data/rhg.sqlite`，生产是容器挂载卷）。
- 表：`schema_version`、`cases`、`runs`、`run_activities`、`shares`。
- **旧 `cases.json` 是自动导入的**：首次启动且 `cases` 表为空时导入，导入前备份成
  `cases.json.bak-<ISO 时间戳>`；同一份库再启动不会重复导入。
- **保留策略变了**：不再按 1000 条淘汰。交接包 §5.4 禁止静默丢掉用户记录。
  保留期限是产品决策，要加期限得先改 `caseStore.test.ts` 里那条断言。
- 旧记录缺 `createdAt` 的：`createdAt = 0` + `createdAtUnknown = true`，不拿当前时间冒充。

## 三、回滚

1. **代码**：`git revert` 对应的提交。按功能分提交，可单独回退：

   | 提交 | 内容 |
   | --- | --- |
   | `d16f34f` | `mvp/` → `apps/` 改名（含发布路径） |
   | `a8a2eea` | 争点两侧各自可点 |
   | `6796a68` | 公共活动层 |
   | `65c7cac` | 运行身份、取消、SQLite 与迁移 |
   | `24c9c6c` | 停止三态、刷新恢复、保存状态 |
   | `da2b960` | 显式分享与撤销 |

2. **存储**：删掉 `rhg.sqlite*` 即回到空库，旧记录从 `cases.json.bak-*` 恢复
   （把备份改回 `cases.json` 再启动即可重新导入）。
   代码层也留了降级：拿不到 `node:sqlite` 时 `caseStore` 退回进程内 Map（重启即丢）。
3. **前端**：`updateRunPointer` 写的 `localStorage["rhg:active-run"]` 只影响刷新恢复，
   清掉它不会影响任何已有数据。

## 四、没做的（PR-F 的剩余部分）

- **没有删除任何「已替代」的组件或路径**。旧壳 `LegacyDesk` 仍可通过 `?legacy=1` 进入，
  `packages/` 脊柱仍未接生产（T20 未执行）。这两件都要先证明没有消费者，没有用户裁决不做。
- 已删的只有一处，且有消费者证明：`snapshotUi.conflictSidesLabel` —— 它唯一的调用点
  在争点改动里被替换掉后，全仓库（含测试）不再有引用。
- **没有合并、没有部署、没有改域名、没有动付费额度策略**。
- 断网（非刷新）回连、`eval:gate`、`/examples/:slug` 公共案例回放：未做，见 `ACCEPTANCE.md`。

## 五、已知风险

- **一次无法复现的测试红**：2026-09-11 21:57 全量跑出 `1 failed | 1280 passed`，
  未捕获是哪条；随后连跑三次全绿。最可疑的是带真实计时器的 `runService.test.ts` D12。
  交付前三次全绿，但这条 flake 是已知风险，不当作没发生（详见 `lessons.md` F14）。
- **取消不能硬断在途模型调用**：只在 7 个阶段边界生效，所以「正在停止」可能持续较久。
  界面照实显示，不假装秒停。
- **原始 `agent_thought` 帧仍在流上**（真实一次调查 132 条）。Golden Path 不消费，未清理。

## 六、发布前还需要人做的判断

1. 视觉是否满意（`preview/` 全量截图 + 本地 `http://127.0.0.1:5211/`）。
2. 保留期限要不要定（现在是不删）。
3. 旧 `?legacy=1` 壳什么时候退场。
4. 公共案例层（`/examples/:slug`）做不做 —— 现在首页只有教学示例。
