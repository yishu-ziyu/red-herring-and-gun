# 2026-09-14 本机预览坏页（Failed to fetch / 连接中断）

## Change

1. 打开本机预览首页（工作区 `apps/` 的开发服务，约定地址 `http://127.0.0.1:5173/`），主区不再出现字面 `Failed to fetch`，也不再出现「与核查服务的连接中断了，这次没有查完。请重试。」首页可见中文品牌名「红鲱鱼与枪」，以及标语「你听到的说法，真的靠谱吗？」。输入框「要调查的说法」可聚焦。
2. 首页启动所需接口（额度/健康类，至少 `/api/models/health` 与 `/api/checks/quota`）返回本项目、可被页面读到。`curl` 对页面和这两个接口均成功（HTTP 2xx）。
3. 5173 / 3000（以及 `scripts/dev.mjs` 实际使用的端口）上只跑本仓库 `apps/` 这一套，不是 questspace 或其它项目。
4. 中文按真渲染故障修：用户自己截图也是乱码/方块，所以验收以浏览器里可见的正确汉字为准，不是「截图工具编码问题」。

## Not this

- 不替用户提交阿司匹林长句，不烧真模型/额度。
- 不恢复已删除的循环引擎。
- 不改 `AGENTS.md`。
- 不 stash / reset / 提交 / 切分支。
- 不新开空白预览标签堆页；复用已打开的预览标签，只留一个 `http://127.0.0.1:5173/`。
- 不把「测试绿」当成用户能看见首页。
- 不只改文案、不重启一次就口头报成功。

## Evaluator

机器：

```bash
# 页面是本项目首页，不是别的项目，且 charset 声明正确
curl -sS -D - http://127.0.0.1:5173/ -o /tmp/rhg-preview.html
# 期望：HTTP 200；Content-Type 含 charset=utf-8 或等价；正文含「红鲱鱼与枪」或当前首页标题/标语汉字；不含 questspace 特征。

# 接口是本项目
curl -sS -D - http://127.0.0.1:3000/api/models/health -o /tmp/rhg-health.json
curl -sS -D - http://127.0.0.1:3000/api/checks/quota -o /tmp/rhg-quota.json
# 经 5173 代理同样 2xx
curl -sS -D - http://127.0.0.1:5173/api/models/health -o /tmp/rhg-proxy-health.json
curl -sS -D - http://127.0.0.1:5173/api/checks/quota -o /tmp/rhg-proxy-quota.json
# 期望：HTTP 200；JSON 属于本项目（含 models / quota / ok 一类字段），不是 questspace。
```

相关测试（能跑就跑，不扩成全仓）：

```bash
cd apps && npx vitest run src/App.test.tsx src/goldenPath/stopAndResume.test.tsx --reporter=dot
```

人评（本任务必须做，内置浏览器）：

1. 列已有标签，关掉多余空白页和重复的 5173，只留一个标签。
2. 打开/刷新 `http://127.0.0.1:5173/`（position=side），截图/快照：品牌中文不是方块；主区没有「与核查服务的连接中断了」；标语是「你听到的说法，真的靠谱吗？」；输入框「要调查的说法」在。
3. 点一下输入框，确认可聚焦。不提交。
4. 若控制台仍有 Failed to fetch：记下 URL / CORS / 代理 / localhost vs 127.0.0.1 / 服务工 / 接口进程，修到没有这条阻断首页的错误。

通过标准：机器 curl 两项达标，人评 1–3 有截图/快照证据。第 4 条若仍有失败，记失败 URL 与根因，不算过。

## 结果

（本轮验收完成后填写）
