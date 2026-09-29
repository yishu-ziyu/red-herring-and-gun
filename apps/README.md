# apps/ — 生产 app

公网 `https://gun.yishuziyu.cn` 现在跑的就是这里。本地：

```bash
cd apps
npm install
npm --prefix server install
npm run dev
```

Vite 只代理 `/api`。Express 在 `server/`。发布走仓库根 `./ops.sh deploy --yes`，不要跑本目录的 `deploy.sh`。

## 脸在哪

| 路径 | 角色 |
|------|------|
| `src/goldenPath/` | 现行产品：首页、调查中、完成态、来源抽屉 |
| `src/App.tsx` | 路由与组合 |
| `src/components/v3/` | 账号、登录、模型设置与输入框（沿用旧目录名） |
| `src/lib/` | 领域再导出。判决不要在这里另写一份 |

## 判决在哪

`server/src/lib/casePipeline/` 编排一次调查。HTTP 入口 `server/src/handlers.ts` 应该保持薄。  
快照契约的源文件在 `packages/core/src/investigation`，这里的 `server/src/lib/investigation` 是镜像。

更完整的地图：`docs/REPO.md`。T20 是切到 `packages/`，不是删这个目录。

## 验证

仓库根目录的 `npm test` 和 `npm run build` 均运行本目录的生产代码，构建还包含 `server/`。`npm run eval:gate` 固定检查 12 个生产管线与最终判定的离线行为合同；它不调用模型，不代表真实模型质量。`npm run eval:live` 使用真实模型与搜索，对比 `server/eval/baseline.json`；缺基线或 API key 会在模型调用前失败。仅测量可在 `server/` 运行 `npx tsx eval/run.ts`，不会自动生成基线。
