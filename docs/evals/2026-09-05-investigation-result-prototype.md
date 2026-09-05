# 先看完成后的调查结果，再接生产

用户于 2026-09-05 要求用临时 HTML 呈现完成后的结果，满意后再继续生产实现；同时同步更新被新方向取代的文档。本轮只制作原型和同步文档。

## Change

- 沿用当前生产 AppShell 的历史栏、主线程、可展开卷宗与窄屏切换，复用真实 logo、字体和 ResearchMemo 判定句样式，不另起简化阅读页。Evaluator：按现有 AppShell / styles.css / ResearchMemo.module.css 核对并在浏览器打开卷宗；人评：是否保持原有设计。

- 一个可点击的本地 HTML，在同一份示例调查上比较「答案下集中质询」与「对应判断旁显示质询」。Evaluator：浏览器切换两个版本，确认答案、证据和调查日期不变；展开质询、查看来源、关闭后回到原阅读位置。
- 可查看已回应、未完成、没有质询、旧报告没有质询记录、历史重开、保存失败等状态；五条示例历史可打开，同句提供打开旧调查/重新核查选择。Evaluator：浏览器逐一操作；重查只展示明确标注的演示流程，不调用生产 API，不宣称完成真实核查。
- 桌面与 390px 窄屏能读到完整答案、争点、回应、出处和未完成原因。Evaluator：实际浏览器查看两种宽度，检查滚动、折叠、来源面板和历史入口。人评：哪种呈现更易懂，是否接受视觉与交互。
- 当前产品说明、运行地图、设计约束、NOTES 和原续做记录对方向及实施状态一致。Evaluator：逐段审查最终 diff，检索旧竞争优势断言、分歧自动扣分、禁止有界质询与过时的下一步，确认正文已修订或明确标为历史。

## Not this

- 原型数据是构造的呈现样例，不是实际调查，不证明质询收益或生产历史持久化。
- 不改生产代码、不跑真模型、不迁生产壳、不修订门禁、不提交或发布。
- 原型获认可后再继续生产接线；真实模型质询对照和五次调查留存验收仍须完成。

## Evaluator

- 机器项：静态脚本语法检查、HTML 本地访问、浏览器操作与渲染、所改文档链接、git diff --check。
- 这次不变更生产行为，不重复根/mvp 测试构建及 eval:gate；上一轮结果保持其原日期与限制。
- 人评：用户查看原型后决定呈现位置和是否进入生产实现。

## 当前状态

2026-09-05 用户看过界面总览后，明确认可 `packages/web/output/show-me-parts/index.html`（既有零件展示：要 / 不要）和 `packages/web/output/show-me-walk/index.html`（既有用户路径走查：桌面与手机）的设计。后续原型以这两份为具体视觉与交互基准：前者参考零件呈现，后者参考整体界面及桌面/手机路径。此次认可不等于逐项选中了零件页的所有候选，也不等于认可本轮新增质询的 A/B 位置；原稿内的旧开发状态不因此恢复为当前事实。

首版独立阅读页经用户反馈，与既有设计差别过大，已停止沿该版继续。修正版沿用现有生产界面：真实 logo、字体、AppShell 样式、主线程判定句及可展开右侧卷宗；A/B 只比较质询的呈现位置。用户尚未认可具体版本。

预览：`http://localhost:51909/index.html`；390px 窄屏：`http://localhost:51909/mobile.html`。
本地文件：`.context/compound-engineering/ce-prototype/2026-09-05-investigation-result/01-result/screens/index.html`；首版已于用户确认设计基准后的清理中删除，不再提供入口。

设计参考：当前生产 AppShell、ResearchMemo 及 mvp/DESIGN；Notion Will's S 中“弱化次要内容”和“渐进式揭示”；living/inline 与 living/type 仅阅读原则，未复制其页面。用户反馈后，以现有产品的视觉和布局为原型底稿。


## 本轮验证结果

- 修正版 JavaScript 语法检查与 git diff --check 通过；原型文件仅依赖本地 HTML/CSS/logo 和与现有页面相同的字体样式表，没有生产 API 调用。
- ChromeMain 实际操作：A/B 切换、已回应与未完成质询展开、出处详情及示例原文、五条示例历史打开、同句打开旧调查/主动重查、七种示例状态均已检查。修正版另走通桌面卷宗展开/收起、390px 框架内主线程/卷宗切换、历史打开、质询展开和出处关闭返回。
- 已查看修正版桌面与窄屏实际截图。没有以静态样例证明真实存储持久化或模型调用节省；新版完整生产路径和质询收益仍未验证。
- 生产测试、构建、真模型 eval 未运行：本轮未修改生产代码。用户尚未确认视觉与交互；首版偏离既有设计的反馈已落实为修正版约束。
- 本地预览服务可能闲置退出；HTML 和资源留在上述本地目录。恢复命令：`node /Users/mahaoxuan/.codex/plugins/cache/compound-engineering-plugin/compound-engineering/3.24.0/skills/ce-prototype/scripts/light-webserver.js start --root '<仓库绝对路径>/.context/compound-engineering/ce-prototype/2026-09-05-investigation-result/01-result'`，以启动输出的地址为准。
