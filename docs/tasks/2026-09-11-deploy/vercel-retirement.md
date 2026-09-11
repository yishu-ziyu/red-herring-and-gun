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

## 控制台操作记录（2026-09-11，用户裁决「甲」）

| 动作 | 对象 | 结果 |
|---|---|---|
| 解除域名绑定 | Vercel 项目 `mvp` 上的 `gun.yishuziyu.cn` | 已移除（HTTP 200）。该项目现只剩 `mvp-five-orpin.vercel.app` |
| 保留 | Vercel 项目 `red-herring-and-gun` | 保留作 Preview。核查过：**它的项目设置自带完整 Build/Output/Install override**，与根 `vercel.json` 内容重复，所以删 `vercel.json` 不影响它；上次构建失败的唯一原因是我写的 `.vercelignore` 排掉了 `mvp/server`，该文件已删 |
| 保留 | Vercel 项目 `mvp` 本身 | 保留但已无域名。核查过：**它没有连接任何 Git 仓库**（设置页是 Connect 按钮、无仓库链接），所以不会在推送时自动构建，是个不再作响的空壳 |

解除绑定后实测：`ops.sh public` 的 `System DNS` 仍是 `121.89.90.68`，https / health / models 三条仍 200；外部视角（浏览器经代理、远端解析 DNS）打开 `https://gun.yishuziyu.cn/` 仍渲染当前 Golden Path。**域名移除不影响服务**——DNS 记录在阿里云云解析，与 Vercel 无关。

恢复办法：在 Vercel `mvp` 项目 Domains 里重新 Add `gun.yishuziyu.cn`，并按本文开头那三个条件改造（不要只把 DNS 指回去）。
