# 公网表面 — gun.yishuziyu.cn

规格与任务同文件。勾选完成时，在正文里写清当前线上行为，再 commit。

工作目录：`/Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪`  
公网：`https://gun.yishuziyu.cn`  
本机 CLI：`mdtask list --path docs/tasks` · `mdtask view GUN-001` · `mdtask done GUN-001`

## 入口与路由

- [ ] GUN-001 提供真实 robots.txt #seo #nginx !high @area:crawl
  当前：`/robots.txt` 返回首页 HTML。
  完成：响应 `Content-Type` 为 text/plain（或等价纯文本），正文含 Allow/Disallow；`curl -sI https://gun.yishuziyu.cn/robots.txt` 不是 text/html。

- [ ] GUN-002 提供真实 sitemap.xml #seo #nginx !high @area:crawl
  当前：`/sitemap.xml` 返回首页 HTML。
  完成：XML 列出已公开真实路径；每条 URL 打开后是对应页，不是软 404。

- [ ] GUN-003 未注册路径返回 HTTP 404 #seo #spa !high @area:routing
  当前：任意路径 200 + 首页。
  完成：`curl -sI https://gun.yishuziyu.cn/this-path-should-404` 状态码 404（或明确 404 页，状态码仍为 404）。

- [ ] GUN-004 固定公开路由表 #routing @area:routing
  当前 SPA 产品入口：`/`、`/settings/api-key`。`/demo` 已从前端路由删除；按现有未匹配路径机制访问时回到首页，不作为独立公开页。
  完成：在本文件或路由模块写死清单；sitemap 与实现一致。

- [ ] GUN-005 /settings/api-key noindex #seo !high @area:crawl
  完成：页面含 `noindex`；robots.txt Disallow 该路径。

- [ ] GUN-006 决定 /demo 是否公开收录 #seo #product !high @area:routing
  本轮决定：`/demo` 不作为独立公开页，前端演示路由已删除。SEO 层面的 noindex/robots 收尾仍归本任务的 SEO 条目，不在本次 SPA 清理内。
  完成：公开则进 sitemap 并有说明文案；内部则 noindex + robots Disallow。结论写进本任务正文。

## SEO 元信息

- [ ] GUN-010 Canonical 链接 #seo @area:meta
  完成：各公开页 head 有绝对 URL 的 `rel=canonical`。

- [ ] GUN-011 Open Graph #seo @area:meta
  完成：og:title、og:description、og:url、og:image、og:type；image 为 https 绝对路径。

- [ ] GUN-012 Twitter Card #seo @area:meta
  完成：twitter:card 等字段齐全，可与 OG 共用图。

- [ ] GUN-013 JSON-LD #seo @area:meta
  完成：至少 WebSite；可选 SoftwareApplication。原始 HTML 可见 script type=application/ld+json。

- [ ] GUN-014 首屏关键文案进原始 HTML #seo #csr !high @area:meta
  当前：CSR，body 主要是 #root，爬虫几乎看不到产品说明。
  完成：curl 首页源码中能读到定位/流程摘要（预渲染或 SSR 其一），不只依赖 JS 执行。

- [ ] GUN-015 hreflang #seo @area:meta @status:optional
  仅中文时可标 @status:wontfix 并说明；双语时再补。

## HTTP / HTTPS（请求到达本机 Nginx 时）

- [ ] GUN-020 HTTP 到 HTTPS 301 #nginx !high @area:tls
  完成：请求到达 80 且 Host=gun 时 301 到 https 同路径。
  备注：若请求在阿里云未备案层被拦，属 GUN-090，不在本项内假装已解决。

- [ ] GUN-021 对外链接统一 https #ops @area:tls
  完成：README、简历、分享文案只使用 https://gun.yishuziyu.cn。

- [ ] GUN-022 HSTS #nginx @area:tls @status:optional
  完成：HTTPS 响应带 Strict-Transport-Security；在 HTTP 入口稳定后再开。

## 生产与仓库

- [ ] GUN-030 生产 dist 与 main 产品叙事一致 #deploy !high @area:prod
  完成：线上 Hero、信任条（检索/模型分开）、Demo 与 main 一致；抽检 title/footer。

- [ ] GUN-031 可重复部署步骤 #deploy @area:prod
  完成：文档写明 build dist → 上传 → reload；或 ops.sh 路径可跑通。

- [ ] GUN-032 生产 env 加载约定 #deploy @area:prod
  完成：compose/env_file 明确；独立 server 也读 .env.local；文档一句说明。

- [ ] GUN-033 发布门禁 smoke #deploy @area:prod
  完成：发布后必测 /health、/api/models/list、POST /api/search/360 有真实 sources。

## 收录

- [ ] GUN-040 Search Console 提交 sitemap #seo @area:index
  依赖 GUN-001、GUN-002、GUN-003。
  完成：已验证资源 / 已提交 sitemap。

- [ ] GUN-041 清软 404 后再要收录 #seo @area:index
  完成：GUN-003 完成后 site: 复测并记录日期。

- [ ] GUN-042 公开页内链 #seo @area:index
  完成：首页链到 methodology/about（若存在）；那些页回链首页。

- [ ] GUN-043 固定 og:image 资源 #seo @area:meta
  完成：仓库与线上有可访问的分享图 HTTPS URL。

## 可选内容页

- [ ] GUN-050 /about #content @area:pages @status:optional
  完成：真路由 + 真 HTML 或预渲染 + 进 sitemap（若公开）。

- [ ] GUN-051 /methodology #content @area:pages @status:optional
  完成：多 Agent 证据流程说明；同上。

- [ ] GUN-052 /privacy #content @area:pages @status:optional
  若收集 key/日志则需要；否则标记 wontfix 并说明。

- [ ] GUN-053 案例静态页 #content @area:pages @status:optional
  例：隔夜菜类主张的说明页 + 试用入口。

## 工程

- [ ] GUN-060 生产构建门禁 #eng @area:eng
  完成：发布用的 build 命令稳定通过（tsc 全量若暂不可用，写清用 vite build 的边界）。

- [ ] GUN-061 工作区 WIP 不混进生产发布 #eng @area:eng
  当前未提交：providerRouter、sourceCondenser、MissionControl、AgentRuntime 等。
  完成：发布清单只含已审 diff；WIP 分 commit 或 stash 规则写进本任务。

- [ ] GUN-062 搜索 provider 失败可观测 #eng @area:eng
  完成：部分引擎失败时日志/响应可定位（如 Metaso 余额），主路径 fail-soft 仍返回 sources。

## 依赖 ICP 或机房策略（站外）

下列项完成依赖备案通过或源站迁出大陆。工程侧能做的前置写在正文，不把厂商拦截粉饰成已修。

- [ ] GUN-090 消除 HTTP 未备案拦截 #icp !high @blocked:icp @area:icp
  现象：http://gun.yishuziyu.cn 可能返回阿里云未备案页。
  完成：HTTP 到达自有 Nginx（或海外源），不再是厂商拦截页。
  路径：阿里云 ICP，或 DNS 改指非大陆节点。

- [ ] GUN-091 公网 HTTP→HTTPS 对外可靠 #icp @blocked:icp @area:icp
  依赖 GUN-090；否则 301 配置对外不可见。

- [ ] GUN-092 备案号展示（若走大陆正式站） #icp @blocked:icp @area:icp
  完成：页脚工信部备案号链接。

- [ ] GUN-093 主体与域名备案材料齐套 #icp @blocked:icp @area:icp
  完成：主体、负责人、域名实名、服务器、核验通过；记录备案号与通过日。
