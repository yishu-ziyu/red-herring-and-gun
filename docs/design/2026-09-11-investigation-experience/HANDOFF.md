# 交接：拆问题这一拍（Grok 停，Antigravity 接着）

仓库：`/Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪`
生产壳：`apps/`（原 `mvp/`）。发布：`./ops.sh`，走 `apps/`。
协作闭环：Decide → Design → Build → Run → Analyze → Communicate。现在停在 **Design**。不要擅自 Build 进生产，除非用户明说动手。

## 用户要的

调查中四人不是一开始铺开。拆问题这一拍要让人看见「谁在拆、拆成了什么」。

定下来的拍：

1. 原句还在。
2. 拆问题到场（小头像当消息头，不当四人进度条）。
3. 过程用 AICSS 那套分块：Thinking shimmer「拆分中」→ 灰字几截流出来 → 收成「拆开了 · Ns」可再点开。
4. 工具成果是白卡细线，列出「争夺咖啡 / 古代 / 非常多的战争」，原句对应词下划线。不要薄荷绿芯片、不要胶囊、不要成功绿。
5. 问题列表才是正文。
6. `decompose` / `search360` / 气泡独白不上主阅读列。过程若要给，只进可折的那一行。
7. 找出处的材料不进这一拍。后三人等 `investigating` 再出场。
8. 角色不表演思考。首页四人教学示意不动。

## 看哪份

临时 HTML（用户在看这个）：

`docs/design/2026-09-11-investigation-experience/take.html`

刚按用户骂绿色 AI 味改过：去掉绿芯片，白卡 + 原句下划线。用户还没点头说「可以做进生产」。

参考：`agent-ui-cases.html`（AICSS / AI Elements Reasoning / assistant-ui GroupedParts / Scrim 一行工具）。只拿分块和做完就折，不做成聊天，不上 token 控制台。

## 生产里已经有的（不要推倒）

- `apps/src/goldenPath/WorkRoles.tsx`：`received`/`decomposed` 只渲染拆问题；`investigating` 后三人才 `is-enter`。第一拍仍然不像「拆问题在做事」。
- 完成态剥 `S1` 来源序号（prompt + publicCopy + 快照 + 结果页）。
- 旧文档已删：`apps/docs/`、`docs/archive/`、`docs/reviews/agentic-patterns/` 等。入口：`docs/PRODUCT_SPEC.md`、`docs/ARCHITECTURE.md`、`docs/REPO.md`、`docs/NOTES.md`。

## 你接着做什么

1. 打开 `take.html`，对照用户最后那张截图（绿芯片已丑）。确认白卡+下划线这一版。
2. 用户若还要改视觉，继续改 HTML，不要先改 `apps/src`。
3. 用户说可以进生产时，才把这一拍接到 `InvestigationCanvas` / `WorkRoles`，验收写 `docs/evals/`，改完更新 `docs/NOTES.md` 头部。
4. 不要 `open -a "Google Chrome"`。这台机器的活档案是 ChromeMain，入口 `~/bin/chrome` 或 `chrome-cdp ensure`。乱开会被 `chrome-cdp` 当成外来进程，把用户标签页整窗 quit。
5. 不要杀 `/tmp/chrome-prof*` 的 headless Chrome，那是别的任务。
6. CMUx 预览不要开 Express `:3000`（`Cannot GET /` 白屏）。要 `cd apps && npm run dev` 的 Vite 端口。`:5210` 曾是 git mv 后的僵尸 Vite，404 空 body。

Grok 按用户要求停在这里。
