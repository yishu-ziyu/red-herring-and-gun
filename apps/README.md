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
| `src/components/v3/` | 旧三栏壳，只在 `/?legacy=1` |
| `src/lib/` | 领域再导出。判决不要在这里另写一份 |

## 判决在哪

`server/src/lib/casePipeline/` 编排一次调查。HTTP 入口 `server/src/handlers.ts` 应该保持薄。  
快照契约的源文件在 `packages/core/src/investigation`，这里的 `server/src/lib/investigation` 是镜像。

更完整的地图：`docs/REPO.md`。T20 是切到 `packages/`，不是删这个目录。
