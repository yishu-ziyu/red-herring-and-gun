# 2026-09-08 PR #81 Review 5137757199

## Change

1. 投机预取失败被显式消费，不再变成 unhandled rejection；loader 仍在失败时清缓存并拒绝，实际渲染加载保持错误语义。同一 loader 的其它 fire-and-forget 调用点一并改为预取入口。
2. 保留原业务套件 beforeAll 预热。另有不经过预热的受控 loader/组件测试：挂载即预取、未完成时 fallback、完成后 apodex-run、首次失败后复位再加载、无 unhandled rejection。不靠 sleep、放宽超时、预先 import 被测模块。
3. 文档把 transform 争用标成候选解释；区分历史失败、当前未复现、定向防护、测试隔离。
4. LIVE 文档改为「强制方案已定义，尚未接线验证」。不在 #81 扩 provider/runner。LIVE 仍未执行。

## Not this

- 不把 loader 所有错误吞成成功。
- 不删、不 skip、不重试刷绿原 `apodex-run` 断言。
- 不扩大 #79/#80，不合并，不关 #53/#54，不启动付费 LIVE。

## Evaluator

- **E1（机器）**：隔离 loader 测试：`prefetch` 失败 0 次 unhandled rejection，缓存复位后第二次 load 成功；`loadMissionControlView` 失败仍 reject，不把错误吞成模块成功。
- **E2（机器）**：独立文件、无 beforeAll 预热：挂载后 importer 已被调用；未 resolve 时可见「正在打开核查工作台…」且没有 apodex-run；resolve 后原 apodex-run 断言成立。
- **E3（机器）**：预取第一次失败后进入工作台，第二次加载成功，过程无 unhandled rejection。
- **E4（机器）**：`npx vitest run src/legacy/LegacyDesk.test.tsx src/legacy/LegacyDesk.workbenchLoader.test.tsx`、`cd mvp && npm test`、mvp build、根 `npm test`、根 `npm run build` 通过。
- **E5（机器）**：文档不再写「调用上限可执行」或宣称 transform 争用为已证唯一根因。

## Evidence

定向测试日志、全量测试/build 日志、本文件、PR #81 回复。

## 本轮结果

Review `5137757199` 之后未再扩大 #79/#80。

- 投机预取走 `prefetchMissionControlView`，消费 rejection；`loadMissionControlView` 失败仍清缓存并 reject。挂载、开始核查、打开旧调查三处 fire-and-forget 均改为预取入口。React.lazy 仍走 loader。
- 定向：33 通过（原 29 + loader 2 + 冷加载 2）。冷加载文件无 beforeAll 预热、无顶层 import 工作台。
- mvp test：1012 通过 / 1 跳过。mvp build 0，工作台仍单独分包。
- 根 test：core 605 / eval 85 / server 21 / web 83。根 build 0。
- 原 `apodex-run` 断言仍在，无 skip。LIVE 0 次。#53/#54 未关。

收据：`docs/evals/artifacts/pr-81/receipt.json`。
