# 2026-09-13 · 修发版通道并上线

用户已裁 A：修发版通道并上线。本机免密 SSH。不 commit、不 push、不改 git config。

## Change

- `./ops.sh check` 退出码 0（或仅剩已记录、文档允许的非阻断项）。
- 随后 `ALIYUN_HOST=121.89.90.68 ALIYUN_USER=root ./ops.sh deploy --yes` 把当前 `apps/` 发到远端（默认 `/opt/red-herring/apps`）。
- 本机有内容的 `apps/.env.local` 会覆盖远端同名文件，按脚本惯例这是预期。
- 公网能打开产品页，不是报错页。探测域名以用户给出的 `gun.yishuziyu.online` 为准，同时核对证书实际绑的 `gun.yishuziyu.cn`。

## Not this

- 不为绿灯放水：假跑对真基线必然红就记数字，不改基线、不改考题。
- 不为 check 里的历史旧壳/legacy 借机重构；只做让 check 过、能发的最小修。
- 不 commit、不 push、不改 git config、不把密钥写进 git 或印出来。

## Evaluator

1. `./ops.sh check` 退出码 0。失败则区分本批引入 vs 历史既有。【命令】
2. 行为变更后跑 `npm run eval:gate -- --fake`：记录四门数字与是否红；假跑对真基线红不阻断发版。【命令】
3. 部署命令退出码 0；远端 `red-herring-api` 健康。【命令 / 环境】
4. 公网页能开：首页 HTTP 200 且 HTML 含产品标题，不是 5xx / 空白 / 报错页；`/health` 与 `/api/models/list` 可达。【命令】

## Gate

- `./ops.sh check`
- `npm run eval:gate -- --fake`（记数字，不因预期红停发）
- `ALIYUN_HOST=121.89.90.68 ALIYUN_USER=root ./ops.sh deploy --yes`

## Evidence

- 本文件
- 命令输出（check / eval:gate / deploy / 公网探测）
- `docs/NOTES.md` 头部：发了没有、公网是否可开
