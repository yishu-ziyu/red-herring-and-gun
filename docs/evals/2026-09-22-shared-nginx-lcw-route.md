# 共享 nginx 的 lcw 路由防回归

## Change

- `scripts/configure-aliyun-ip-api-nginx.sh` 生成裸 IP nginx 配置时，必须保留 `/lcw/` 路由。
- `/lcw/` 必须反代到 `http://127.0.0.1:8787/`，继续使用 600s 读写超时和 600m 上传上限。
- 现有 Red Herring 的 SSE、`/api/`、`/r/`、`/health` 与默认 8080 路由不得改变。

## Not this

- 不通过手工改线上 nginx 后就结束；再次运行 Red Herring 的 nginx writer 不能把 lcw 路由删掉。
- 不改 lcw 应用代码、Vercel 网关或 Docker 服务。
- 不顺手重构整套共享网关。

## Evaluator

1. 修改前：`apps/scripts/deploy-pipeline.test.ts` 新增的 lcw 断言失败，证明现有 writer 会删路由。
2. 修改后：同一测试通过，并验证输出包含 `location /lcw/`、8787 upstream、600s 超时和 600m body limit。
3. `npm --prefix apps test -- scripts/deploy-pipeline.test.ts` 通过。
4. 线上 Tracer Bullet：`127.0.0.1:8787/api/health` → nginx `/lcw/api/health` → `https://lcw.yishuziyu.cn/api/health` 均返回 200。
