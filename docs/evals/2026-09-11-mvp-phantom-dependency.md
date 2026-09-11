# 验收：拆掉 mvp 对 `@rhg/core` 的幻影依赖

日期 2026-09-11。

## 一句话任务

新克隆只装 `mvp/` 也能构建，不再依赖仓库根的 npm workspace 链接。

## 缺陷（实测复现，非推断）

`mvp/src` 有 13 处 import `@rhg/core/investigation`（含 3 个运行时值：`buildInvestigationSnapshot`、`rebuildInvestigationFromReport`、`validateInvestigationSnapshot`），但 `mvp/package.json` **没有声明** `@rhg/core`。

它现在能跑，只是因为 Node 从 `mvp/` 逐级上溯找到仓库根的 `node_modules/@rhg/core` 软链（该软链由仓库根 `npm install` 的 workspaces 机制创建）。

复现命令与结果（2026-09-11 实测）：

```bash
mv node_modules/@rhg /tmp/rhg-core-link-bak   # 移开根 workspace 链接
cd mvp && npx tsc --noEmit                    # exit 2
#   src/App.tsx(12,8): error TS2307: Cannot find module '@rhg/core/investigation' or its corresponding type declarations.
#   src/goldenPath/ClaimSection.tsx(12,8): 同上
#   src/goldenPath/devFixture.ts(6,44): 同上 …（共 4 处 TS2307）
cd mvp && npx vite build                      # exit 1
```

受影响的具体场景：按 `README.md`「本地运行」只做 `cd mvp && npm install` 的新克隆；任何把部署根目录设成 `mvp/` 的构建（Vercel 的 Root Directory 一旦设成 mvp 就没有 `packages/`）。

## Change

采用仓库内已有的先例（`mvp/src/lib/claimAtom/index.ts` 注释自述「Client re-export of claim-atom domain (SSOT on server)」）：

- 新增 `mvp/src/lib/investigation/index.ts`，整包再导出 `mvp/server/src/lib/investigation/index`。
- `mvp/src` 全部 13 处 `@rhg/core/investigation` 改为指这份本地再导出。
- `mvp/package.json` 增加 `typebox` 依赖：investigation 的 `schema.ts` 用 `typebox` / `typebox/value` 做校验，这份代码会进前端 bundle，属真实依赖，必须显式声明（当前只靠 `mvp/server/node_modules/typebox` 偶然命中）。

不改 `packages/`：`packages/core/src/investigation` 仍是契约 SSOT，`mvp/server/src/lib/investigation` 仍是它的字节级镜像，两侧 `mirror.test.ts` 双向守卫不变。本次只把前端**消费镜像**的路径从「根 workspace 链接」换成「仓库内相对路径」。

## Not this

- 不删 `packages/`、不改 `ops.sh`、不删 `mvp/`（T20 红线）。
- 不改 investigation 契约本身（schema、字段、不变量一律不动）。
- 不改 server 端任何行为。
- 不改根 `vercel.json` 的 buildCommand（它先 build `@rhg/core` 再 build mvp，仍然正确）。
- 不把 `mvp` 加进根 workspaces（那会牵动 T20 与部署，不是本缺陷该做的事）。

## Evaluator

机器项：

- **E1 幻影依赖消失**：移开根 workspace 链接后（`mv node_modules/@rhg /tmp/…`），`cd mvp && npx tsc --noEmit` exit 0、`cd mvp && npx vite build` exit 0。移回链接后同样全绿。
- **E2 前端不再引用 `@rhg/core`**：`rg -n '@rhg/core' mvp/src` 无命中（排除再导出模块自身的注释）。
- **E3 本地再导出与镜像同源**：`mvp/src/lib/investigation/index.ts` 只做 `export *`，不含任何手写实现；`diff` 证明 `mvp/server/src/lib/investigation` 与 `packages/core/src/investigation` 仍逐字节相同（既有 mirror 守卫测试）。
- **E4 typebox 已声明**：`mvp/package.json` 的 dependencies 含 `typebox`。
- **E5 门禁全绿**：`cd mvp && npm test` 零失败；`cd mvp && npm run build` exit 0；`cd mvp/server && npx tsc --noEmit` exit 0；根 `npm test`、`npm run build` exit 0；`npm run qa:contracts` 通过。
- **E6 镜像守卫仍生效**：`mvp/server/src/lib/investigation/mirror.test.ts` 与 `packages/core/src/investigation/mirror.test.ts` 均通过。

人评项：

- **H1** 是否认可「前端从 server lib 再导出」这一路径（与既有 `claimAtom` 一致）。
