# 验收：部署新版后访客不再停在旧壳

日期 2026-09-11。与 `docs/evals/2026-09-11-health-probe-quota.md` 同批，独立缺陷。

## 一句话任务

重新部署之后，回访的用户打开站点看到的是新版，而不是记忆里的旧壳。

## 缺陷（线上实测）

2026-09-11 部署新版后，浏览器加载的仍是 `#52` 之前的旧包：

```
服务端 /opt/red-herring/dist/index.html（mtime 05:43）引用  →  assets/index-Bs80gCnD.js   ← 新版
浏览器 document 实际加载                                    →  /assets/index-DlJ2SMPv.js ← Sep 2 的旧版
绕缓存 fetch("/?nocache=…") 取到的 HTML 引用                 →  assets/index-Bs80gCnD.js   ← 新版
```

响应头实测（同一 URL，两次请求）：

```
默认缓存：     Last-Modified: Wed, 02 Sep 2026 05:24:28 GMT   ETag "6a97b30c-4d6"
强制回源(cache:reload)：Last-Modified: Thu, 10 Sep 2026 21:43:15 GMT   ETag "6aa32473-4d6"
两次都：Cache-Control: （缺）
```

两层叠加：

1. **nginx 不给 HTML 任何 `Cache-Control`**（`scripts/configure-aliyun-static-nginx.sh` 的 `location /` 只有 `try_files`）。没有显式缓存指令时浏览器按 `Last-Modified` 做启发式缓存（约为文件年龄的一部分），于是把 9 天前的旧 HTML 当新鲜内容直接复用，不发条件请求。
2. **Service Worker 也没能兜住**（`mvp/public/sw.js`）。它对 `/` 的逻辑是「网络优先」，但 `fetch(event.request)` 默认仍走浏览器 HTTP 缓存，所以拿到的是同一份旧 HTML，并把它写回 SW 缓存。

后果：每次部署后，凡是之前访问过的用户都会被钉在旧壳上，而站点的 Service Worker 还会持续把这个旧壳喂给他。

## Change

- `scripts/configure-aliyun-static-nginx.sh`：给应用外壳与 SW 加显式缓存指令。
  - `location = /index.html`、`location = /sw.js`、`location = /manifest.webmanifest` → `Cache-Control: no-cache`（每次回源校验，命中 ETag 则 304）。
  - `location /assets/` → `Cache-Control: public, max-age=31536000, immutable`（文件名带内容 hash，可长期缓存）。
- `mvp/public/sw.js`：
  - 缓存版本 `rhg-shell-v2` → `rhg-shell-v3`，让旧缓存条目在 activate 时被清掉。
  - 页面入口的取数改为 `fetch(event.request, { cache: "reload" })`，显式绕过浏览器 HTTP 缓存，让已有的旧 SW 用户也能立刻拿到新壳。

## Not this

- **本次没有去碰 `/etc/hosts`（本机文件，不是仓库资产）**。它把 `gun.yishuziyu.cn` 钉到 `121.89.90.68`，排障时必须知道有这层。
- 不改 `public/` 下其它静态资源（`logo.png`、`agents/*.png`、`tool-icons/*.svg`）的缓存策略：它们不带 hash、但极少变，SW 的 cache-first 保留不变。
- 不改 `/api/`、`/health`、`/r/` 的代理行为。
- 不改 `ops.sh`、不删 `mvp/`（T20 红线）。
- 不给已缓存旧 HTML 的用户做强制失效（技术上做不到追溯）。SW 那条路修好后，带 SW 的浏览器下次导航即恢复；不带 SW 的浏览器等启发式窗口过期后恢复。

## Evaluator

机器项：

- **E1 HTML 不再被启发式缓存**：`curl -sI https://gun.yishuziyu.cn/` 的响应含 `Cache-Control: no-cache`。
- **E2 资源仍可长期缓存**：`curl -sI https://gun.yishuziyu.cn/assets/<index-*.js>` 含 `immutable`。
- **E3 SW 脚本不被卡住**：`curl -sI https://gun.yishuziyu.cn/sw.js` 含 `Cache-Control: no-cache`。
- **E4 SW 版本已升**：`rg 'rhg-shell-v3' mvp/public/sw.js` 有命中；`rg 'rhg-shell-v2'` 无命中。
- **E5 导航请求绕 HTTP 缓存**：`rg 'cache: "reload"' mvp/public/sw.js` 有命中。
- **E6 门禁全绿**：`cd mvp && npm test` 零失败、`cd mvp && npm run build` exit 0、根 `npm test`/`npm run build` exit 0。
- **E7 端到端**：部署后，浏览器在同一标签页**普通导航**（不带 `?nocache`）加载 `/`，`document` 实际加载的脚本名等于服务端 `dist/index.html` 引用的那一个。

人评项：

- **H1** 你本机开一个无痕窗口访问 `https://gun.yishuziyu.cn/`，确认看到的是新版 Golden Path 首屏。

## 执行记录（2026-09-11）

- **E1/E3/E5 通过**：服务器直探响应头实测 `/`、`/index.html`、`/sw.js`、`/manifest.webmanifest` 均为 `Cache-Control: no-cache`；`/assets/index-Bs80gCnD.js` 为 `public, max-age=31536000, immutable`；`/logo.png` 保持无指令（未在本次范围）。
- **E2 的判定说明**：在浏览器里用 `fetch(url, {cache:"reload"})` 读不到这两条的缓存头，拿到的是 `null`——因为 Service Worker 的 cache-first 分支用它自己缓存里的响应应答了。服务端真相以在服务器上直探 nginx 的结果为准（上一条），浏览器侧不作为该条的判定依据。
- **E4 通过**：`rg 'rhg-shell-v3' mvp/public/sw.js` 命中、`rhg-shell-v2` 无命中；`rg 'cache: "reload"' mvp/public/sw.js` 命中。
- **E6 门禁**：随 `ops.sh deploy --yes` 跑过，mvp 1168 过 / 1 跳过、build 通过；根四套全绿。
- **E7 通过**：部署后同一标签页做**不带 `?nocache` 的普通导航**，`document` 实际加载 `/assets/index-Bs80gCnD.js`，与 `/opt/red-herring/dist/index.html` 引用一致；首屏标题为「追溯来源，解释判断。」（Golden Path），不再是旧三栏壳。
- **修复前后对照**：改动前同一操作加载 `/assets/index-DlJ2SMPv.js`（Sep 2 的旧包）。
- **未做**：不给已经缓存了旧 HTML 的浏览器做强制失效（追溯不到）。带 SW 的浏览器在旧 SW 被替换后下次导航即恢复，本次实测即如此。
