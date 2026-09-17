# 输入菜单与实际能力一致

## Change

用户已授权移除未接通的技能入口；默认继续走方案二自动调查。加号只添加图片或视频，视频按画面抽帧核查，不承诺读取 PDF、Word 或视频音轨。技能菜单、斜杠选择器、技能标签及专用事件/样式全部删除，不能只隐藏。图片、视频、已有材料的删除和原文输入保持可用。

## Not this

不删除服务端 agentSkills、拆题、检索、核验、判断及补查。不实现新的模式或滑条，不改套餐，不处理历史原文中的用户手打斜杠，不改正在进行的其他视觉工作。#90 在本轮仅独立审阅和拟修复方案，不直接按未经验证的关键词规则改判词。

## Evaluator

- 组件测试：加号菜单只有准确的材料入口；没有技能菜单/斜杠选择器；`/` 和带斜杠 URL 原样提交；中文输入法确认不误发送，Enter 发送、Shift+Enter 换行；忙碌/禁用不提交。
- 输入接线测试：图片添加/移除、视频抽帧保持；PDF/Word 和混合不支持文件明确拒绝，不把文件名当作正文；主入口和旧 Dashboard 均使用同一能力范围。
- 静态检查：PromptInput 不残留 SKILLS、skillPill、slashMenu 和技能专用键盘监听；后台 agentSkills 与运行链未修改。
- `npm --prefix apps test`、前端/API 构建、根工作区测试与构建；如不涉及判断或检索策略，无需用收费 live eval 证明纯输入交互。
- 真实 Chrome 验证默认/legacy 入口的菜单、斜杠原文、添加/删除图片，记录桌面与 390px 截图、无应用脚本/控制台错误。以受控 HTTP/SSE 夹具阻止费用，明确标注，不冒充真实模型质量验收。

## 状态

输入菜单清理已经在本地，定向与浏览器验收通过；整仓门禁未通过，不能据此合并或发布。恢复本轮时相关代码、测试和初版 #90 审阅方案已经存在；本轮保留这些改动，强化了精确换行及移动端网络/控制台验收，并复核 #90 的实际数据库与源网页。

## 本次实测

- 输入相关 4 文件、24 项测试通过：`PromptInput.test.tsx`、`inputMedia.test.tsx`、`inputStageLinkScrape.test.tsx`、`materialAndAccount.test.tsx`。视频抽帧在组件测试中使用受控返回值，不冒充真实视频解码验收。
- `apps` 前端与 API 构建通过；根工作区 832 项测试与构建通过；离线 `qa:gate` 通过，`git diff --check` 通过。前端保留既有大于 500 kB 的构建体积警告。
- 真实 Chrome + 本地 HTTP/SSE 夹具：默认首页与 `/?legacy=1` 均只有「添加图片或视频」；斜杠/网址原文、精确的两行文本、图片添加/移除、PDF 拒绝、实际发送请求原文均通过。两次明确发送产生两次调查 POST；没有调用真实模型。1280×900 和 390×844 留图，窄屏文档宽=视口宽=390，pageErrors=[]、consoleErrors=[]。工具未提供 Browser 插件，使用本机已有 Playwright/Chrome。
- 最新浏览器复验再次通过：`/tmp/rhg-menu-final-browser/report.json` 及同目录默认/legacy 桌面菜单、390px 窄屏截图。该次使用 `127.0.0.1:50581` 的临时夹具服务，脚本结束即关闭。此前精确换行及普通复验分别在 `/tmp/rhg-menu-exact-newline-before/` 和 `/tmp/rhg-menu-continue-browser/`。
- 菜单主文件、专用 CSS、语言文案与 InputStage 的哈希在本轮前后相同，验收对应同一份输入清理实现；未改服务端 agentSkills 或事实判断规则。

## 整仓阻塞，不能用定向通过掩盖

`apps` 全量为 **1664 通过 / 4 失败 / 1 skipped**。四项单独复测依然失败（该子集 16 通过 / 4 失败），不是并行负荷导致的偶发超时。

1. `App.progressiveThread.test.tsx`：进行中找不到「调整核查重点」。当前 `InvestigationCanvas` 仅在 complete/interrupted 渲染 `InvestigationScope`，该入口随之从进行态消失。
2. `investigationReadingOrder.test.tsx`、`thinkingHonesty.test.tsx`、`thinkingWaitStatus.test.tsx`：当前 `ThinkingDisclosure` 在非 live 或命题已出现时返回 null，三项现有契约仍要求可折叠思考区。

这些过程页改动与菜单清理在当前工作区并存；本轮不擅自恢复另一项视觉工作的旧 UI，也不删除断言凑绿。继续集成前须恢复方案二要求的调整重点入口，并对思考区去留与验收契约进行一致性处理。相关日志：`/tmp/rhg-menu-final-apps.log`、`/tmp/rhg-menu-unrelated-ui-retest.log`。

用户原有未提交改动均保留；没有 commit、push 或部署，夹具 HTTP 服务已随脚本结束关闭。#90 仍为仅审阅/方案，不能把菜单验收当成 P0 修复完成。
