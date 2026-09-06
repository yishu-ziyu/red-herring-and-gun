# 《红鲱鱼与枪》生产设计规范：Mode 3 / Hybrid (Quiet Editorial Evidence)

- **版本**：1.0.0 (Production Final)
- **生效日期**：2026-09-06
- **对应 Issue**：[#61 [Reset 4A] 生产视觉基础](https://github.com/yishu-ziyu/red-herring-and-gun/issues/61)
- **前置裁决**：PR #60 (已合并至 `main`，确立 Mode 3 / Hybrid 与 Quiet Editorial 准则)
- **核心哲学**：
  > **Paper-first. Semantics by structure, not by paint.**  
  > 复杂的调查，简单地被理解。

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

采用模块化字阶（Modular Type Scale），针对中文（PingFang SC / 思源黑体）与英文（SF Pro / Inter）混排严格校准：

| Token 名称 | 桌面端字号 | 移动端字号 | 对应生产应用场景 |
| :--- | :--- | :--- | :--- |
| `--gp-type-display` | 32px | 26px | 首页输入态主标题（Headline） |
| `--gp-type-title` | 24px | 20px | 调查直接回答（Direct Answer lede） |
| `--gp-type-h1` | 18px | 17px | 命题章节标题（Claim Section Title, Section 01） |
| `--gp-type-h2` | 16px | 15px | 证据分组标题、抽屉主标题 |
| `--gp-type-body` | 15px | 15px | 调查文稿正文、输入框正文、原始说法正文 |
| `--gp-type-sub` | 13.5px | 13px | 证据行引用文本、来源副标题、次要阐述 |
| `--gp-type-caption` | 12px | 12px | Kicker 顶眉标签、微元数据、时间戳、域名 |
| `--gp-type-micro` | 11px | 11px | 序号标记、快捷键提示（`<kbd>`）、状态微标 |

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

- `--gp-lh-tight`: `1.22` —— 用于 Display 与 Title 大标题，防止多行时版面散碎；
- `--gp-lh-snug`: `1.4` —— 用于命题标题、操作按钮、输入卡片头部；
- `--gp-lh-editorial`: `1.65` —— 用于文稿正文、原始说法、证据行引用文本，确保长文本阅读呼吸感；
- `--gp-lh-relaxed`: `1.75` —— 用于学术限制说明（Limitations）、边注解析。

---

## 4. Spacing Scale（间距尺度）

基于 4px 基准网格的等比尺度：

- `--gp-space-1`: `4px`（微对齐、图标文字间隙）
- `--gp-space-2`: `8px`（组件内紧凑间隙、标签间距）
- `--gp-space-3`: `12px`（卡片内垂直堆叠、输入项间距）
- `--gp-space-4`: `16px`（移动端页边距、标准容器内衬）
- `--gp-space-5`: `20px`（桌面端标准段落间隙）
- `--gp-space-6`: `24px`（命题内章节间隙）
- `--gp-space-8`: `32px`（章节间主呼吸间隙）
- `--gp-space-10`: `40px`（输入态示例区与主输入框间隙）
- `--gp-space-12`: `48px`（调查正文大区块分割）
- `--gp-space-16`: `64px`（桌面端首屏垂直下沉量）

---

## 5. Content Width（正文宽度）

- **Desktop 调查文稿中轴（Editorial Spine）**：
  `--gp-content-width: 780px;`（居中对齐，符合 65–75 中文字符每行的舒适阅读线宽）
- **Shell / Topbar 最大宽度**：
  `--gp-shell-width: 1080px;`
- **Source Drawer 宽度**：
  - 桌面端：固定 `440px`（右侧滑出，保持底层正文 60% 以上视野）
  - 移动端：宽度 `100%`（贴底 Bottom Sheet，最大高度 `85vh`）

---

## 6. Canvas Surface（画布底色）

- `--gp-canvas`: `#fcfcfd`
- **定义**：全屏基底，极其轻微的冷灰白感，用于烘托纯白文稿纸感与半透明 UI Chrome。

---

## 7. Content Surface（文稿层表面）

- `--gp-surface-paper`: `#ffffff`
- `--gp-surface-inset`: `#f7f7f5`（仅用于原始说法引用块、代码/引文微背景，温润纸浆感）
- **规则**：正文区域不叠加阴影，不叠加彩色背景。

---

## 8. Chrome Surface（功能控制层表面）

- `--gp-chrome-bg`: `rgba(255, 255, 255, 0.86)`
- `--gp-chrome-blur`: `blur(12px)`
- `--gp-chrome-border`: `1px solid var(--gp-hairline)`
- **定义**：用于 Topbar、下拉菜单、Modal 遮罩层。视觉完全退到正文之后。

---

## 9. Primary / Secondary Ink（墨水色系）

保证 WCAG AAA (≥ 7:1) 的极佳对比度与阅读舒适感：

- `--gp-ink-primary`: `#18181b`（深黑灰，主排版墨水）
- `--gp-ink-secondary`: `#52525b`（次要文字、说明、出处域名，对比度 5.5:1）
- `--gp-ink-tertiary`: `#71717a`（微元数据、时间戳、辅助占位）
- `--gp-ink-muted`: `#a1a1aa`（不可用状态、输入框禁用图标）

---

## 10. Hairline（发丝分割线）

- `--gp-hairline`: `#e7e5e4`（实体边框、Topbar 底部边线、章节细线）
- `--gp-hairline-subtle`: `#f0eeec`（列表行间微分割线）
- **规则**：正文层严禁使用 >1px 的边框（除原始引语左侧 2px 中性边线外）。

---

## 11. Focus Ring（键盘无障碍焦点环）

- `--gp-focus-ring`: `0 0 0 2px #ffffff, 0 0 0 4px #2563eb;`
- **规则**：所有键盘可聚焦元素（`:focus-visible`）必须呈现清晰双层焦点环，禁止使用 `outline: none` 而不提供替代。鼠标点击态禁止焦点环闪烁。

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

- **持续时长**：`120ms – 160ms`
- **缓动曲线**：`--gp-ease-out: cubic-bezier(0.16, 1, 0.3, 1)`
- **适用场景**：按钮 Hover/Active、链接点击、示例标签点击、微符号状态切换。
- **准则**：瞬间响应，绝无任何滞后或阻碍用户点击。

---

## 17. UI Motion（界面启闭动效）

- **持续时长**：`220ms – 260ms`
- **缓动曲线**：`cubic-bezier(0.16, 1, 0.3, 1)`
- **适用场景**：Drawer 侧滑展开/关闭、历史下拉菜单渐显、Bottom Sheet 弹出。
- **准则**：可随时被用户操作（如再次点击、按 Escape 键）立即中断。

---

## 18. Layout Motion（布局位移动效）

- **持续时长**：`260ms – 320ms`
- **缓动曲线**：`cubic-bezier(0.16, 1, 0.3, 1)`
- **适用场景**（在后续 Issue #63/#64 实现）：Evidence Settling（从待核对平滑位移至支持/反驳组）、Conclusion Emergence 顶部留白让渡。
- **基础准备**：本 Issue 建立标准 CSS 变量与结构类名，严禁使用 `transition: all`。

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

1. **Exact excerpt = 蓝色块**（严禁将原文摘录包裹在浅蓝底容器中；必须使用 1.5px 中性边线与温润纸白底）；
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
