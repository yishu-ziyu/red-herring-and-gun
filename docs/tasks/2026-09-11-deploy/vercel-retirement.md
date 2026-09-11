# Vercel 退场记录（2026-09-11）

用户裁决：Vercel 这一路**收掉**，只留阿里云单源。理由是「坏的但不显眼」比「没有」更危险——它当时前端能开、接口 `508 Infinite loop`，比旧壳更误导。

## 退场前的事实

- 域名 `gun.yishuziyu.cn` **曾**绑在 Vercel 项目 `mvp`（`prj_b9tHYnCtJFyKWAxDLTccWk7zllpT`）上；2026-09-11 起 DNS 已改为 A → `121.89.90.68`（阿里云），不再指向 Vercel。
- 那个自环 rewrite：`/api/:path*` → `https://gun.yishuziyu.cn/api/:path*`，指向自身域名。实测 `HTTP 508 Infinite loop detected`。即便把域名指回 Vercel 也不会自己好。
- Vercel 侧最后一次成功部署停在 **Sep 3**，早于 #51 引入 `@rhg/core/investigation` 依赖；`mvp/vercel.json` 的 `buildCommand` 不构建 `@rhg/core`，所以照当时的方式重新部署现在会挂。
- 另一个项目 `red-herring-and-gun` 没有绑任何自定义域名（只有 `.vercel.app` 预览域），与生产无关。

## 删掉的文件（本仓库）

| 文件 | 原来干什么 | 为什么删 |
|---|---|---|
| `vercel.json`（仓库根） | 根目录部署配置：先 `npm run build -w @rhg/core` 再装并构建 `mvp`，输出 `mvp/dist`；含那个自环 `/api` rewrite 与 SPA 兜底 | 路径已退场，留着会误导下一个人 |
| `mvp/vercel.json` | 从 `mvp/` 目录部署的配置，`buildCommand` 只有 `npm run build` | 同上；且它不构建 `@rhg/core`，与当前代码不兼容 |
| `.vercelignore`（仓库根） | 2026-09-11 我为根目录部署新建的忽略清单 | 只服务于已退场的路径 |

本地 `.vercel/project.json`（仓库根的 CLI 链接文件，gitignored）一并移除，避免误跑 `vercel --prod`。
`mvp/.vercel/` 是此前留下的链接文件，未动。

`ops.sh` 与任何代码都不依赖以上文件：`ops.sh` 只是在打包时 `--exclude='.vercel'`。

## 恢复办法（如果以后还想用 Vercel）

不要只把域名指回去。至少要同时满足三条，否则会退回 508 自环或把所有人挡死：

1. **重写 `/api` 指向真实后端主机**（不能是自身域名）。可以用 `http://121.89.90.68/api/:path*`。
2. **让后端能拿到真实客户端 IP**。现在 `scripts/configure-aliyun-ip-api-nginx.sh` 里是
   `proxy_set_header X-Forwarded-For $remote_addr;`——它用直接对端的地址覆盖，Vercel 转发过来时
   对端是 Vercel 边缘节点，所有人会共享同一条 IP 键，而额度按 IP 记账。要改成信任转发并保留
   真实 IP（`$proxy_add_x_forwarded_for`，并配合只信自家网络段）。
3. **重新评估反滥用**。第 2 条等于放宽现在「只信最后一跳、不信客户端伪造」的防线
   （`checkQuota.ts` 的 `clientIp` 只取 XFF 最后一跳）。这是设计取舍，不要顺手改。

Vercel 面已删：域名解绑、重复项目删除。恢复需要在控制台重新操作。
