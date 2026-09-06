# 红鲱鱼与枪 · Reference → Product Mapping 深度映射规范

日期：2026-09-06  
适用范围：#53 视觉与 Motion 系统设计探索、交互原型、技术选型  
对应宪法：Issue #50 产品宪法（白盒三层、执行过程隐藏、调查逻辑渐进呈现、视觉体验属发布门禁）

---

## 0. 映射方法论：Borrow, Map, Reject

外部优秀设计并非开箱即用的皮肤，若不经批判性审查直接移植，极易将产品带入“炫技但不可读”、“SaaS看板化”或“营销大秀”的歧途。

对所有外部参考，必须在统一的分析框架下回答三个核心问题：

1. **Borrow（借什么）**：这个设计真正解决了什么信息架构或人机交互问题？
2. **Map（映射到哪个产品瞬间）**：它对应《红鲱鱼与枪》白盒调查的哪个具体阶段与语义状态？
3. **Reject（不借什么）**：哪些视觉手法虽然精美，但与“严肃事实核查、低摩擦、无眩晕、快速获得直接答案”相冲突，必须坚决拒绝？

同时，每项映射必须精确定义**具体交互机制**（DOM/CSS/Animation 原理）、**依赖影响**及**性能与无障碍（A11y）风险**。

---

## 1. 核心设计参考映射矩阵

### 参考 1：Cuberto（UI Interaction & Physical Continuity）

- **外部参考源**：CollectUI / Cuberto Showcase (Micro-interactions, Fluid Transitions)
- **Borrow（借什么）**：
  - **对象身份连续性（Object Identity Continuity）**：物体不瞬变、不重绘，前一状态的物体在空间与几何上有因果地过渡到后一状态。
  - **微触觉物理反馈（Restrained Spring Physics）**：使用真实弹簧物理阻尼（stiffness 280–340, damping 26–32），提供有质感但不弹跳的位移与尺寸形变。
  - **即时 Hover Feedback**：鼠标悬停时元素背景与细线具有极短（120–160ms）的线性/缓出响应，赋予界面“可交互物”的确定感。
- **Reject（不借什么）**：
  - 坚决拒绝营销型全屏平滑滚动（Smooth-scroll hijack / Locomotive Scroll）。
  - 坚决拒绝鼠标跟随大圆圈光标（Custom Cursor blob）。
  - 坚决拒绝夸张的 3D 倾斜（tilt）、透视变换和阻断用户阅读的慢速转场。
- **Map（映射到哪个产品瞬间）**：
  - **Evidence Settling（证据归位）**：从 `investigating`（待核对 ◌）到 `complete`（支持 ● / 反驳 ● / 仅相关 ○）。
- **具体交互机制**：
  - **FLIP 原理 / Motion Layout Animation**：
    1. First：记录证据条在待核对组中的 `getBoundingClientRect()`；
    2. Last：DOM 数据更新，将该证据节点归入目标分组（如支持组），计算新的 DOM 盒坐标；
    3. Invert：对节点应用 `transform: translate(dx, dy)` 反向抵消位移；
    4. Play：移除 transform，由 `cubic-bezier(0.16, 1, 0.3, 1)`（约 260–320ms）顺滑回归真实流式排版位置。
  - **Glyph 状态演变**：中性空心圆 `◌` 平滑过渡为实心语义圆点 `●`，伴随微透明度与色相过渡，DOM 保持原唯一 `sourceId` 节点身份，不重建新元素。
- **是否需要新依赖**：
  - **否**。仓库现有的 `framer-motion ^12.40.0` 或原生 Web Animations API / CSS FLIP 即可完全胜任。
- **性能 / A11y 风险**：
  - 批量证据同时触发 FLIP 可能引起短时间 Layout Thrashing。必须采用 batch read / batch write 策略，或限制单次最大并发 settling 行数（≤6条）；
  - 必须提供 `prefers-reduced-motion: reduce`：在用户开启减弱动画时，完全跳过 translate 几何位移，仅保留即时的文字与符号状态切换（0ms）。

---

### 参考 2：Nikoloz Zaalovich（Editorial Minimalism & Typographic Hierarchy）

- **外部参考源**：Nikoloz Zaalovich 设计系统、CollectUI Minimalist Editorial & Newsfeed
- **Borrow（借什么）**：
  - **绝对排版层级（Absolute Typographic Hierarchy）**：不用卡片框定内容，而是通过字号比（Type Scale 12px / 14px / 16px / 20px / 28px）、字重（400 Regular / 500 Medium / 650 SemiBold）和行高韵律来划分层级。
  - **有效的大留白（Generous Whitespace）**：区块间使用 32px–56px 的垂直呼吸空间，让复杂调查信息具有从容沉着的研究文稿感。
  - **极简分割线（Hairline Rule）**：用 1px `rgba(0,0,0,0.06)` / `rgba(255,255,255,0.08)` 替代厚重的矩形容器与立体阴影。
- **Reject（不借什么）**：
  - 坚决拒绝纯艺术类海报排版中的低对比度灰字（必须保证 WCAG AAA 对比度 ≥ 7:1）。
  - 坚决拒绝非标准字型加载延迟导致的文字闪烁（FOIT）。
  - 坚决拒绝牺牲紧凑度而无限拉长垂直视口的极端留白。
- **Map（映射到哪个产品瞬间）**：
  - **Mode 1 全貌与 Mode 3 骨架**：
    - 调查结论区（Conclusion Hero）作为文稿 Lede（首段开门见山）；
    - 命题区（Claims）作为文稿的一、二级章节（Section 01 / Section 02）；
    - 证据区作为学术引用行（Citation Rows）；
    - 证据缺口（Evidence Gap）与争点（Conflict）作为边注/页边批注（Margin Notes）。
- **具体交互机制**：
  - 纯 CSS 流式排版：`max-width: 780px` 居中正文容器；
  - 零 `box-shadow`、正文区域零 `border-radius`；
  - 引用符号与罗马序号（`01`, `02`）使用 `font-variant-numeric: tabular-nums` 固定宽度，防止对齐错位。
- **是否需要新依赖**：
  - **否**。纯现代标准 CSS 原生特性。
- **性能 / A11y 风险**：
  - 纯排版方案性能最优（GPU 占用近乎为 0）；
  - A11y 需严格遵循语义 HTML 标签（`article`, `section`, `header`, `h1–h3`, `blockquote`, `dl`, `dt`, `dd`），保证屏幕阅读器能够线性无歧义朗读。

---

### 参考 3：Edoardo Lunardi / kugiri（Restrained Text Motion）

- **外部参考源**：X / Twitter Post (`edo_lunardi/status/2096176912288678308`) 与开源库 `kugiri` (0.4.0)
- **Borrow（借什么）**：
  - **浏览器原生断行感知（Line-Break Aware Split）**：不是机械地按空格切词，而是读取浏览器实际排版断行位置，实现“按整行揭示（line mask reveal）”或精确短语高亮。
  - **极度克制的进入动效**：文本从隐藏的裁切遮罩（clip mask）中向上微位移（8–12px）平滑显现，绝无跳跃感。
- **Reject（不借什么）**：
  - 坚决拒绝逐字乱飞、打字机光标（Typewriter cursor / Streaming token flashing）。
  - 坚决拒绝拆散中文词汇导致屏幕阅读器逐字逐音拼读。
  - 坚决拒绝在正文阅读时过度分散注意力的多重 stagger 动画。
- **Map（映射到哪个产品瞬间）**：
  - **Claim Trace（命题回溯）**：当用户 hover/focus 某个 Claim 时，原句中对应的真实 phrase 发生精确背景与微下划线响应。
  - **Conclusion Emergence（结论沉着浮现）**：调查完成瞬间，directAnswer 以整行遮罩或极轻缓出方式自然显现，不突兀。
- **具体交互机制**：
  - 方案 A（CSS + 原生 DOM Range / Span）：在解析原始说法时，若有明确 `originalSpan`，在 HTML 中包裹 `<mark class="claim-trace-target">`，以 `background-color` 与 `box-shadow: 0 1px 0` 驱动 180ms 柔和过渡。
  - 方案 B（kugiri 分割）：利用 `Intl.Segmenter` 将块级容器拆为行与词的 span 单元，通过 CSS 变量 `--line`, `--word` 配合 `transform: translateY` 与 `overflow: hidden` 遮罩揭示。
- **是否需要新依赖**：
  - **Spike 评估结论详见专门章节**。经中文长句与 A11y 深度实测，本产品生产环境**不需要引入 kugiri 依赖**，以语义 HTML `<mark data-span-id>` + 现代 CSS 原生实现体验更佳且零无障碍破坏。
- **性能 / A11y 风险**：
  - 若引入 kugiri 拆字，屏幕阅读器可能会将完整成语拆成单个字朗读；窗口 resize 时必须频繁 `revert()` 重新排版，开销显著；生产务必保持 DOM 文本结构完好并配置 `aria-hidden`。

---

### 参考 4：CollectUI — Blog Post / Newsfeed

- **外部参考源**：CollectUI #Blog Post, #Newsfeed (Medium, Substack, New Yorker 调查报道)
- **Borrow（借什么）**：
  - **调查文稿的叙事流（Narrative Spine）**：用户进入界面不是在看“仪表盘（Dashboard）”，而是在阅读一份正在实时撰写的“现场调查手记”。
  - **原话的典雅呈现**：原话作为带引号与微缩进的 Blockquote，奠定“有据可查、对着原话说”的严肃基调。
- **Reject（不借什么）**：
  - 坚决拒绝社交媒体式的作者大头像、点赞、转发、评论栏及花哨封面大图。
  - 坚决拒绝冗长的新闻网站 Header 导航与广告位。
- **Map（映射到哪个产品瞬间）**：
  - 页面整体骨架与**原话引用区域（Original Claim Block）**。
- **具体交互机制**：
  - 语义 `<blockquote>` 标签，左侧 2px 极细基准线，文字采用轻微深灰（#242426），字阶 17px/1.65 行高。
- **是否需要新依赖**：否。
- **性能 / A11y 风险**：零性能开销，A11y 标准原生支持。

---

### 参考 5：CollectUI — Tooltip / Source Drawer / Sheet

- **外部参考源**：CollectUI #Tooltip, #Drawer, #Modal (Linear Peek view, GitHub Pull Request drawer)
- **Borrow（借什么）**：
  - **非模态上下文保留（Context Retention）**：点击证据条后，不跳出当前页面，而是从屏幕侧边滑出轻量 Drawer，底层文稿保留但被浅遮罩锁定；
  - **移动端自适应为 Bottom Sheet**：屏幕宽度 < 768px 时，平滑降级为贴底抽屉，支持触控滑动关闭手势。
  - **完整的可访问性焦点环（Focus Management）**：打开时焦点转移至关闭按钮，按 `Escape` 键即刻关闭，关闭后焦点精确归位回原被触发的 Evidence 行。
- **Reject（不借什么）**：
  - 坚决拒绝阻断视野的巨大全屏居中 Modal 弹窗。
  - 坚决拒绝层层套叠的 Secondary drawer / Multiple popups。
- **Map（映射到哪个产品瞬间）**：
  - **Source Drawer（来源下钻）**：查看证据原文摘录、URL 真实域名、与命题的关系（支持/反驳/仅相关）、为什么相关、以及为何不能证明更强判断。
- **具体交互机制**：
  - 桌面端：`position: fixed; top: 0; right: 0; width: 440px; height: 100vh; transform: translateX(100%)`；通过 CSS `transform: translateX(0)` 与 240ms `cubic-bezier(0.16, 1, 0.3, 1)` 滑入；
  - 移动端（390px）：`position: fixed; bottom: 0; left: 0; width: 100%; max-height: 85vh; transform: translateY(100%)`；
  - 焦点 trap：`tabindex="-1"`，监听 `keydown (Escape)`，记录 `lastActiveElement` 并在 unmount 时恢复。
- **是否需要新依赖**：
  - 原型已完全用纯 TypeScript + React Hooks 原生实现完整的 Focus Trap 与 Escape 支持，无需引入沉重的组件库。生产若需统一基础组件，可评估 Base UI 或现有 Radix primitive。
- **性能 / A11y 风险**：
  - 背景遮罩需要锁定滚动（`overflow: hidden`），防止双重滚动条；需明确标注 `role="dialog"` 与 `aria-labelledby`。

---

### 参考 6：CollectUI — Empty States & Loading

- **外部参考源**：CollectUI #Empty States, #Loading (Raycast 搜索中继态、Notion 同步态)
- **Borrow（借什么）**：
  - **诚实的平静（Calm Honesty）**：等待时不使用引起焦虑的旋转大菊花或晃眼的进度条；证据缺口（Evidence Gap）以平实的调查笔记呈现。
  - **静止态即完备**：即使无动画，界面通过文字提示（“正在逐条追查出处”、“公开检索无直接证据”）已能传达全部关键事实。
- **Reject（不借什么）**：
  - 坚决拒绝将“未找到证据”展示为红色的“系统错误”或崩溃插画。
  - 坚决拒绝全屏骨架屏剧烈闪烁（Heavy Skeleton shimmer）。
  - 坚决拒绝 Agent 节点连线动画或小机器人工作动画。
- **Map（映射到哪个产品瞬间）**：
  - **Investigating 调查进行中** 及 **Evidence Gap（证据缺口）**。
- **具体交互机制**：
  - 证据条待核对状态使用轻量中性点 `◌`；
  - 证据缺口使用淡琥珀/中性灰左边框的 Margin Callout，标题写明“证据缺口：缺什么、为什么影响判断”。
- **是否需要新依赖**：否。
- **性能 / A11y 风险**：无。

---

### 参考 7：CollectUI — Quote

- **外部参考源**：CollectUI #Quote (Editorial Typography Quotes)
- **Borrow（借什么）**：
  - **语录的锚定价值（Anchor Point）**：整场调查的始作俑者是一句真实的公共流传说法。它应该拥有视觉上的神圣感与原始痕迹。
- **Reject（不借什么）**：
  - 坚决拒绝气泡对话框（Chat Bubble），红鲱鱼与枪不是聊天软件。
- **Map（映射到哪个产品瞬间）**：
  - **原始说法（Original Claim Block）**。
- **具体交互机制**：
  - 使用优雅的衬线引号装饰（或精密标点挂起），原句支持命题高亮切片（Span mapping）。
- **是否需要新依赖**：否。
- **性能 / A11y 风险**：无。

---

## 2. 映射落地执行表（速查）

| 外部参考源 | 借用机制 (Borrow) | 拒绝手法 (Reject) | 对应产品状态 (Map) | 新依赖 |
| :--- | :--- | :--- | :--- | :--- |
| **Cuberto** | DOM 连续性、FLIP 空间位移、微触觉反馈 | 炫技滚动、鼠标跟随球、3D 倾斜 | **Evidence Settling** | 无 (原生/现有Motion) |
| **Nikoloz Zaalovich** | 纯粹排版层级、极少阴影圆角、呼吸留白 | 灰度过低不可读、字体加载闪烁 | **Mode 1 骨架 / 整体层次** | 无 (原生 CSS) |
| **Edo / kugiri** | 浏览器断行感知、文本克制遮罩微位移 | 逐字打字机乱飞、A11y破坏、Stagger泛滥 | **Claim Trace / Emergence** | Spike 判定不引入生产 |
| **CollectUI Blog** | 调查手记叙事流、原话 Blockquote | 评论点赞、作者头像、长新闻大头图 | **主画布与正文流动** | 无 |
| **CollectUI Drawer** | 侧滑下钻保留上下文、移动端 Bottom Sheet | 全屏阻断 Modal、多层弹窗嵌套 | **Source Drawer / Sheet** | 无 |
| **CollectUI Empty** | 诚实平静、非错误插画、缺口一等呈现 | 恐慌红叉、骨架屏狂闪、Agent转圈 | **Evidence Gap 呈现** | 无 |
| **CollectUI Quote** | 语录权威锚定、可追溯原话 | 对话聊天气泡、社交分享卡 | **原始说法原句展示** | 无 |

