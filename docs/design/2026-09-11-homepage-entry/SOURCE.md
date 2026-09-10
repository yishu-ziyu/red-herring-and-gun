# 首页进门改版 · 视觉取证

- 日期：2026-09-11
- 任务书：`docs/tasks/2026-09-11-homepage-entry/TASK.md`
- 验收标准：`docs/evals/2026-09-11-homepage-entry.md`
- 预览地址（本地 vite 5199）：`http://127.0.0.1:5199/`（Golden Path 生产壳）、`http://127.0.0.1:5199/?legacy=1`（旧三栏壳）

## 先说清楚改的是哪一层

任务书附的 `before.png` / `after-mock.png` 画的是**左栏三栏壳**，但仓库现状里它已经不是默认首页：

- 线上 `gun.yishuziyu.cn` 仍在跑旧部署（浏览器实测 DOM 有「历史卷宗 / 新查一条 / 模型设置」，
  只加载单包 `assets/index-DlJ2SMPv.js`）。
- 当前代码 `npm run dev` 的默认 `/` 是 Golden Path（`ProductShell` + `InputStage`），
  构建出 `index-*.js` + 独立 `LegacyDesk-*.js` 分包 —— 与线上不是同一份产物，即线上是 #52 之前的旧部署。
- 旧三栏壳在当前代码里挂在 `/?legacy=1`（`LegacyDesk`）。

所以两处都按同一语义改了，截图也两处都给。

## 截图清单

| 文件 | 状态 | 性质 |
|------|------|------|
| `desktop-home-goldenpath.png` | 未登录空白输入态（生产壳 `/`） | 真实渲染，本地 dev |
| `desktop-home-goldenpath-preview.png` | 同一页下滚到「查完大概长这样」 | 真实渲染，本地 dev |
| `desktop-home-legacyshell-rail.png` | 未登录空白输入态（旧壳 `/?legacy=1`，对照 after-mock.png） | 真实渲染；左栏「最近核查」里那条是浏览器 localStorage 的真实历史 |
| `desktop-home-legacyshell-preview.png` | 同上，下滚到示意块 | 真实渲染 |
| `desktop-result-goldenpath-newcheck.png` | 完成态（生产壳），顶栏出现「新调查」 | **FIXTURE**：`/?fixture=complete`（devFixture 脚本化快照，非真实调查） |
| `desktop-result-legacyshell-newcheck.png` | 旧结果态（旧壳），左栏出现「新查一条」 | 真实渲染：点左栏 localStorage 里的旧记录打开 |

## 改了什么（对照任务书 A/B/C）

1. **A 去掉进门重复的「新查一条」**
   - 生产壳：进门态品牌渲染为静态 `div`（`gp-brand--static`，不可点）；只有看调查/旧结果时才在顶栏出现「新调查」。
   - 旧壳：左栏 `app-shell-new` 只在 `renderedPhase === "executing"` 时渲染；窄屏同条件。
2. **B 未登录首页拿掉「模型设置」**
   - 生产壳：删掉未登录时的 `<a href="/settings/api-key">模型设置</a>`；登录后账号菜单里的入口保留。
   - 旧壳：删掉左栏 foot 的 `app-shell-rail-meta`；登录后账号菜单入口保留。
3. **C 输入区下方加「查完大概长这样（示意，不是真结果）」**
   - 两壳都在输入框与例子下方加了静态示意块：一句直接回答 + 有对有错 + 命题/来源计数 + 「支持 / 反驳」两行材料 + 每行一句片段。
   - 片段口径沿用 PR #85 的诚实写法「检索片段（非逐字原文）」，不用引号装逐字原文。
   - 关系词用既有词表「支持 / 反驳」，没有沿用 mock 临时稿里的口语「帮 / 拆」。

## 已知与 mock 的差异（不是缺陷）

- mock 是左栏形态，本地默认首页是顶栏形态（见上）。截图两套都给，语义一致。
- mock 左栏写「最近查过的 / 还没有查过」，真实旧壳文案是「最近核查 / 还没有查过」（`uiLang.ts`）；本批没有改这些既有文案。
- mock 用「帮 / 拆」，真页面用「支持 / 反驳」（既有产品词表）。
