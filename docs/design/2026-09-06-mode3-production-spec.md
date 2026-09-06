# 《红鲱鱼与枪》生产设计规范：Mode 3 / Hybrid (Quiet Editorial Evidence)

- **版本**：1.0.1（文档真相源与生产 CSS 对齐；未改生产代码）
- **生效日期**：2026-09-06
- **对应 Issue**：[#61 [Reset 4A] 生产视觉基础](https://github.com/yishu-ziyu/red-herring-and-gun/issues/61)
- **前置裁决**：PR #60 (已合并至 `main`，确立 Mode 3 / Hybrid 与 Quiet Editorial 准则)
- **核心哲学**：
  > **Paper-first. Semantics by structure, not by paint.**  
  > 复杂的调查，简单地被理解。

### 怎么读这份规范

文中出现的名称分两类，不要混读：

1. **Production CSS custom property**：写成 `--gp-…`，且必须能在 `mvp/src/goldenPath/golden-path.css` 的 `:root` 里找到。这是运行时变量。
2. **Design scale label / spec-only value**：字阶、行高、间距档位，以及 Topbar 的毛玻璃实现值。生产 CSS **按这些数值内联**，当前 **不是** `:root` custom property。本文用普通名称（如 `display`、`tight`、`space-4`），不给它们 `--gp-*` 名字。

---

## 概述与双层架构准则

在《红鲱鱼与枪》的视觉与交互体系中，坚决区分并隔离两大层级：

1. **Content Layer（内容层）**：
   - 包括：调查正文、原始说法（Original Claim）、命题（Claims）、证据行（Evidence Rows）、证据缺口（Evidence Gap）、争点（Conflict）、结论（Direct Answer / Conclusion）。
   - **设计法则**：绝对纸感优先（Paper-first）。信息关系必须依靠排版层级（Typography）、字阶与字重（Type scale & weights）、呼吸留白（Whitespace）、发丝细线（Hairline）以及小面积语义文字和微符号（Tiny glyphs）来传达。
   - **严禁**：大面积彩色背景块、卡片套卡片（Card-on-card）、彩色左粗边框。

2. **UI Layer（界面功能控制层）**：
   - 包括：顶栏导航（Topbar）、浮动菜单（Menu / Popover）、输入框功能外壳（Input functional surface）、侧滑抽屉与浮层（Drawer / Sheet）。
   - **设计法则**：视觉后退（Visually receding）。允许克制的圆角（Restrained radius）、轻微环境阴影（Restrained elevation）、轻微毛玻璃（Subtle blur & translucency）与清晰的高对比度焦点环（Focus ring）。
   - **严禁**：浮夸拟物、高饱和渐变、发光边缘（Glow / Spotlight）。

---

## 1. Type Scale（字阶规范）

采用模块化字阶（Modular Type Scale），针对中文（PingFang SC / 思源黑体）与英文（SF Pro / Inter）混排严格校准。

下表是 **Design scale labels / spec-only values**。当前生产 CSS 按这些像素值内联，`:root` **没有** `--gp-type-*` 变量。

| Scale label（spec-only） | 桌面端字号 | 移动端字号 | 对应生产应用场景 |
| :--- | :--- | :--- | :--- |
| display | 32px | 26px | 首页输入态主标题（Headline） |
| title | 24px | 20px | 调查直接回答（Direct Answer lede） |
| h1 | 18px | 17px | 命题章节标题（Claim Section Title, Section 01） |
| h2 | 16px | 15px | 证据分组标题、抽屉主标题 |
| body | 15px | 15px | 调查文稿正文、输入框正文、原始说法正文 |
| sub | 13.5px | 13px | 证据行引用文本、来源副标题、次要阐述 |
| caption | 12px | 12px | Kicker 顶眉标签、微元数据、时间戳、域名 |
| micro | 11px | 11px | 序号标记、快捷键提示（`<kbd>`）、状态微标 |

所有数字、计时、案号必须显式设置：
```css
font-variant-numeric: tabular-nums;
```

---

## 2. Weights（字重阶梯）

全系统严格限制为 4 档字重，杜绝滥用字重造成的粗细混沌：

- **400 (Regular)**：文稿正文、引用摘要、长篇叙事、次要说明、输入框默认文本；
- **500 (Medium)**：可交互按钮、Kicker 眉题、次级标签、输入框占位符、强调文本；
- **600 (SemiBold)**：命题小标题、证据分组头、输入态次级操作、菜单项选中态；
- **700 (Bold)**：Direct Answer 结论首句、产品 Logo 标识。

---

## 3. Line Height（行高节奏）

下表是 **Design scale labels / spec-only values**。当前生产 CSS 按这些倍数内联，`:root` **没有** `--gp-lh-*` 变量。

- tight `1.22` —— Display 与 Title 大标题，防止多行时版面散碎；
- snug `1.4` —— 命题标题、操作按钮、输入外壳头部；
- editorial `1.65` —— 文稿正文、原始说法、证据行引用文本；
- relaxed `1.75` —— 学术限制说明（Limitations）、边注解析。

---

## 4. Spacing Scale（间距尺度）

基于 4px 基准网格的等比尺度。下表是 **Design scale labels / spec-only values**。当前生产 CSS 按这些像素值内联，`:root` **没有** `--gp-space-*` 变量。

- space-1 `4px`（微对齐、图标文字间隙）
- space-2 `8px`（组件内紧凑间隙、标签间距）
- space-3 `12px`（控件内垂直堆叠、输入项间距）
- space-4 `16px`（移动端页边距、标准容器内衬）
- space-5 `20px`（桌面端标准段落间隙）
- space-6 `24px`（命题内章节间隙）
- space-8 `32px`（章节间主呼吸间隙）
- space-10 `40px`（输入态示例区与主输入框间隙）
- space-12 `48px`（调查正文大区块分割）
- space-16 `64px`（桌面端首屏垂直下沉量）

---

## 5. Content Width（正文宽度）

生产 CSS custom properties（存在于 `:root`）：

- `--gp-content-width: 780px;` —— Desktop 调查文稿中轴（Editorial Spine），居中对齐
- `--gp-shell-width: 1080px;` —— Shell / Topbar 最大宽度

Source Drawer 尺寸是 **spec-only 内联值**，当前不是 CSS 变量：

- 桌面端固定 `440px`（右侧滑出）
- 移动端宽度 `100%`，贴底 Bottom Sheet，最大高度 `85vh`

---

## 6. Canvas Surface（画布底色）

- `--gp-canvas`: `#fcfcfd`
- **定义**：全屏基底，极其轻微的冷灰白感，用于烘托纯白文稿纸感与半透明 UI Chrome。

---

## 7. Content Surface（文稿层表面）

生产 CSS custom properties：

- `--gp-surface-paper`: `#ffffff` —— 输入外壳等 UI 白底；正文内容层本身是透明叠在 `--gp-canvas` 上
- `--gp-surface-inset`: `#f7f7f5` —— **不是** Original Claim / Conflict / Gap 的默认背景

`--gp-surface-inset` 当前允许场景（UI / 系统状态，不是 Content Layer 卡片）：

- 功能控件 hover / active 浅底（品牌按钮、菜单项、历史项、示例标签）
- Interrupted 系统运行状态（功能性 surface）
- Source Drawer 里 exact excerpt / 不可达提示的可选中性 inset（功能层，不是调查正文语义卡片）

明确 **不以 inset card 表达**：Original Claim（`.gp-original` 当前是 `background: transparent` + 2px 中性左边线）、Conflict、Gap、Conclusion。

**规则**：调查正文不叠加阴影，不叠加彩色背景，不把每种语义装进浅底圆角盒。

---

## 8. Chrome Surface（功能控制层表面）

当前 **没有** `--gp-chrome-bg` / `--gp-chrome-blur` / `--gp-chrome-border` 这些 production CSS custom properties。不要把它们当成 token 名引用。

Topbar 当前实现值（内联，不是变量）：

- `background: rgba(255, 255, 255, 0.88)`
- `backdrop-filter: blur(12px)`（及 `-webkit-backdrop-filter`）
- `border-bottom: 1px solid var(--gp-hairline)` —— 这里的发丝线用的是真实变量 `--gp-hairline`

菜单 / Drawer 的白底与投影走真实变量 `--gp-surface`、`--gp-elevation-menu`、`--gp-elevation-drawer`。Chrome 视觉退到正文之后。本轮不抽新 token。

---

## 9. Primary / Secondary Ink（墨水色系）

对比度按用途分层，相对画布 `--gp-canvas: #fcfcfd`。**不**把整套墨色都说成 WCAG AAA。

生产 CSS custom properties：

- `--gp-ink-primary`: `#18181b` —— 正文与标题。对比足够高，按正文尺寸满足 WCAG AAA（≥ 7:1）。
- `--gp-ink-secondary`: `#52525b` —— 次要说明、出处域名。约 7.5:1，按正文尺寸满足 AAA。
- `--gp-ink-tertiary`: `#71717a` —— 时间戳、占位、辅助元数据。约 4.7:1，只用于非关键元信息；**不**声称 AAA。
- `--gp-ink-muted`: `#a1a1aa` —— 禁用态与不可用图标。对比更低，只用于非必要 / disabled，不承担可读正文。

---

## 10. Hairline（发丝分割线）

- `--gp-hairline`: `#e7e5e4`（实体边框、Topbar 底部边线、章节细线）
- `--gp-hairline-subtle`: `#f0eeec`（列表行间微分割线）
- **规则**：正文层严禁使用 >1px 的边框（除原始引语左侧 2px 中性边线外）。

---

## 11. Focus Ring（键盘无障碍焦点环）

- `--gp-focus-ring`: `0 0 0 2px #ffffff, 0 0 0 4px #2563eb;`
- **规则**：Golden Path 内键盘可聚焦元素使用 `.gp-shell :focus-visible` 呈现该双层焦点环，禁止 `outline: none` 而不提供替代。该规则不得写成全局 `:focus-visible`。鼠标点击态禁止焦点环闪烁。

---

## 12. Accent（唯一主强调色）

- `--gp-accent`: `#2563eb`（克制深钴蓝）
- `--gp-accent-subtle`: `rgba(37, 99, 235, 0.08)`
- **唯一允许场景**：
  1. 真实超链接点击反馈；
  2. 键盘 `:focus-visible` 焦点环；
  3. 输入态开始核查主按钮触发态；
  4. Claim Trace 激活态下的文字下划线与微染色。
- **严禁场景**：不可用于整屏背景、不可用于大号 Banner、不可用于正文装饰。

---

## 13. Semantic Micro-Accent（语义微墨水）

彻底废除大面积语义背景系统（`--gp-positive-bg` / `--gp-negative-bg` / `--gp-mixed-bg` 全部废止）。
语义仅通过**文字本体**与**极小点/符号**表达：

- 支持（Support）：`--gp-semantic-support: #15803d;`（墨绿）
- 反驳（Contradict）：`--gp-semantic-contradict: #b91c1c;`（深绯红）
- 仅相关（Context-only）：`--gp-semantic-context: #4b5563;`（中性岩灰）
- 待核对（Unassessed）：`--gp-semantic-pending: #71717a;`（冷灰）
- 证据缺口（Evidence Gap）：`--gp-semantic-gap: #92400e;`（暗琥珀棕）
- 争点冲突（Conflict）：`--gp-semantic-conflict: #9a3412;`（沉着砖红）

**强制规则**：禁止用上述颜色铺满卡片底色！必须通过 6px 点、符号（`●`、`○`、`◌`）以及自然中文词语（“支持”、“反驳”、“仅相关”、“尚缺”）呈现。

---

## 14. Radius 允许场景

严格控制圆角，杜绝无节制的圆角滥用：

- **正文内容层（Content Layer）**：`0px`（完全直角与发丝线，还原严肃文稿纸张切边）；
- **输入功能外壳（Input Stage Surface）**：`12px`；
- **微交互元素（Buttons / Tags / Examples）**：`8px`；
- **悬浮菜单与弹窗（Menu / Popover）**：`12px`；
- **胶囊（Only for Functional Chips, e.g. Lang Switcher）**：`999px`。

---

## 15. Elevation 允许场景

- **正文内容层（Content Layer）**：`box-shadow: none;`（零投影，零悬浮卡片感）；
- **输入外壳（Input Surface）**：
  `--gp-elevation-input: 0 1px 3px rgba(15, 23, 42, 0.04), 0 4px 12px rgba(15, 23, 42, 0.03);`
- **悬浮下拉菜单（Menu / Popover）**：
  `--gp-elevation-menu: 0 4px 16px rgba(15, 23, 42, 0.08), 0 1px 2px rgba(15, 23, 42, 0.04);`
- **侧滑抽屉（Drawer / Sheet）**：
  `--gp-elevation-drawer: -4px 0 24px rgba(15, 23, 42, 0.08);`（移动端贴底时为 `0 -4px 24px rgba(15, 23, 42, 0.08)`）。

---

## 16. Feedback Motion（即时反馈动效）

- **Spec-only 时长范围**：`120ms – 160ms`
- **生产 CSS custom property**：`--gp-motion-fast: 140ms`（落在上述范围内）
- **缓动**：`--gp-ease-out: cubic-bezier(0.16, 1, 0.3, 1)`（生产 CSS custom property）
- **适用场景**：按钮 Hover/Active、链接点击、示例标签点击、微符号状态切换。
- **准则**：瞬间响应，绝无任何滞后或阻碍用户点击。

---

## 17. UI Motion（界面启闭动效）

- **Spec-only 时长范围**：`220ms – 260ms`
- **生产 CSS custom property**：`--gp-motion-ui: 240ms`（落在上述范围内）
- **缓动**：`--gp-ease-out`
- **适用场景**：Drawer 侧滑展开/关闭、历史下拉菜单渐显、Bottom Sheet 弹出。
- **准则**：可随时被用户操作（如再次点击、按 Escape 键）立即中断。

---

## 18. Layout Motion（布局位移动效）

- **Spec-only 时长范围**：`260ms – 320ms`
- **生产 CSS custom property**：`--gp-motion-layout: 280ms`（落在上述范围内）
- **缓动**：`--gp-ease-out`
- **适用场景**（在后续 Issue #63/#64 实现，本 Issue 不实现）：Evidence Settling、Conclusion Emergence。
- **基础准备**：本 Issue 建立上述生产 motion 变量与结构类名，严禁使用 `transition: all`。

---

## 19. Reduced-Motion Strategy（减弱动画策略）

针对用户系统级设置 `prefers-reduced-motion: reduce` 的最高级保护：

```css
@media (prefers-reduced-motion: reduce) {
  .gp-shell *,
  .gp-shell *::before,
  .gp-shell *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

规则只作用于 `.gp-shell` 内。Golden Path 的 focus ring 同样只写 `.gp-shell :focus-visible`，不得用全局 `:focus-visible` 或全局 `*` 减弱动画去影响 auth modal、settings、legacy 与 portal。

- **语义完整性**：动效移除后，所有文字、状态标记、焦点位置必须 100% 完整呈现在正确位置，绝不依赖动画帧触发数据显示。

---

## 20. Desktop 1440 Layout（桌面布局结构）

- 视口：1440px × 900px；
- Topbar：贴顶固定（Sticky），高度 54px，内宽 1080px 居中；
- 输入态：垂直居中偏上（padding-top: clamp(64px, 12vh, 120px)），主输入框宽度 740px；
- 示例区域：紧凑排布在输入框正下方，以单行/双行克制标签呈现，字号 13px；
- 调查正文：780px 居中文稿，左侧为证据内容，右侧为抽屉留出充裕空间，无多栏仪表盘感。

---

## 21. Mobile 390 Layout（移动端 390px 布局结构）

- 视口：390px × 844px（iPhone 标准屏）；
- 容器：100% 宽度，左右各留 16px 安全外衬，严格禁止产生横向滚动溢出（`overflow-x: hidden`）；
- 输入框：单列占满，操作按钮触控高度保持 ≥44px，输入软键盘弹出时不遮挡提示；
- 示例标签：移动端水平流式排列或换行，支持手指轻点；
- 调查正文：单列沉浸式长文阅读，结论居首，命题线性展开，绝无“多张圆角卡片垂直死板堆叠（Card Stack）”。

---

## 22. Quiet Editorial Visual Smell Blacklist（视觉坏味道黑名单）

在开发与代码审查中，一旦发现以下视觉模式，必须无条件主动删除：

1. **Exact excerpt = 蓝色块**（严禁将原文摘录包裹在浅蓝底容器中。Original Claim 当前是 transparent + 2px 中性左边线；Drawer 摘录若需要区分，只用中性 inset，不用蓝色块）；
2. **Boundary / Gap = 黄色块 / 警告图标 ⚠️**（证据局限与缺口是学术诚实，必须用平实中性或深琥珀文字表达，严禁刷黄底加警告标）；
3. **Support = 绿色背景 / Contradict = 红色背景**（严禁整块证据行刷大红大绿）；
4. **Pastel cards everywhere**（严禁到处是五颜六色的马卡龙/莫兰迪浅色卡片）；
5. **彩色背景 + 同色左边框**（这是 generic AI SaaS 最典型的廉价设计套路，严禁使用）；
6. **Card-on-card（卡片套卡片）**（严禁在已有圆角卡片内部再嵌套带边框/阴影的圆角卡片）；
7. **Dashboard panels / Bento Grid**（严禁将调查切分成一堆仪表盘网格盒子）；
8. **大面积 Glassmorphism（玻璃拟态）**（正文内容层严禁使用 backdrop-blur；仅顶栏 UI 允许极轻微使用）；
9. **Glow / Spotlight / Border Trail**（严禁任何高亮发光、光斑跟随、流光边框等营销动效）；
10. **紫蓝渐变 / AI SaaS 视觉套件**（严禁在标题、按钮或背景使用紫蓝渐变色）；
11. **巨型 Status Badge**（严禁使用占地巨大的标签盖章）；
12. **每小节都有 Pill 药丸胶囊**（严禁给每个字段都包裹一个胶囊标签）；
13. **每个语义分配一个背景色（Semantic Rainbow）**（色彩不是分类语法，结构才是）；
14. **小标题带机械大写英文括号**（如 `(EXACT EXCERPT)`、`(RELEVANCE)`，全部替换为清晰的自然中文）；
15. **`transition: all`**（严禁使用全属性过渡，必须明确指定需要变化的属性，防止性能劣化与意外跳动）；
16. **Generic AI Composer / ChatGPT Clone**（输入框是低摩擦功能工具，不是巨型对话炫技舞台）。
