# 红鲱鱼与枪 — 设计系统

> **版本**: v1.0
> **日期**: 2026-05-30
> **来源**: 基于 Esther Design System 学习 + 品牌 Logo 视觉推导
> **适用**: gun.yishuziyu.cn 全站

---

## 1. 设计哲学

### 1.1 核心原则

**「限制即品质」** — 继承 Esther Design System 的核心信条。在 AI 生成内容泛滥的时代，视觉上的克制与秩序感本身就是可信度的保证。

**「品牌优先」** — 一切设计决策以「红鲱鱼与枪」品牌识别为最高准则。Logo 的红黑配色是视觉锚点，不可妥协。

### 1.2 从 Esther 学到的

| Esther 原则 | 我们的应用 |
|------------|-----------|
| 60/30/10 三色约束 | 品牌红 + 墨黑 + 暖奶油底 |
| 衬线标题 + 无衬线正文 | Noto Serif SC / Noto Sans SC |
| 暖色底、排斥冷灰 | `#fefcf6` 暖奶油背景 |
| 排斥玻璃拟态/霓虹/弹跳 | 无 backdrop-filter，无动画库过度使用 |
| 中文排版优先 | 字重、行高、字间距针对中文优化 |

### 1.3 禁止事项

- 蓝紫渐变（与品牌红冲突）
- 玻璃拟态（backdrop-filter）
- 霓虹色、青色、纯黑 `#000000` 背景
- 未经样式的默认 HTML 元素
- 所有区域居中（Hero 除外）

---

## 2. 色彩系统

### 2.1 品牌三色（源自 Logo）

| 名称 | Hex | 角色 | 使用场景 |
|------|-----|------|---------|
| **墨黑** | `#151821` | 60% 主色 | 标题、Logo 深色部分、关键文本 |
| **深红** | `#b91c3c` | 30% 强调色 | CTA 按钮、品牌名「与枪」、焦点状态、链接悬停 |
| **暖奶油** | `#fefcf6` | 10% 基底 | 页面背景、卡片背景 |

### 2.2 扩展色板

| Token | Hex | 用途 |
|-------|-----|------|
| `--zt-ink` | `#151821` | 最深暗色（极少） |
| `--zt-text` | `#1A1A2E` | 主要文本色（暖墨，非纯黑） |
| `--zt-text-secondary` | `#4A4A5A` | 次要文本、标签 |
| `--zt-text-muted` | `#888888` | 第三级文本、placeholder |
| `--zt-bg` | `#fefcf6` | 页面背景 — 暖奶油 |
| `--zt-bg-deep` | `#faf6eb` | 深层奶油 — 悬停状态 |
| `--zt-bg-panel` | `#ffffff` | 面板/卡片背景（不发冷） |
| `--zt-bg-elevated` | `#f5f0e8` | 微升高表面 |
| `--border-subtle` | `#e8e4d9` | 暖灰边框 |
| `--border-medium` | `#d4c9b5` | 较强边框 |

### 2.3 功能色（保留 Esther 映射）

| Token | Hex | 用途 |
|-------|-----|------|
| `--zt-primary` | `#2B7FD8` | 链接、已核实事实、信息提示 |
| `--zt-accent` | `#F4D758` | 文本选中高亮、徽章 |
| `--zt-alert` | `#E84A5F` | 错误、警示（与品牌红区分） |
| `--zt-success` | `#16a34a` | 可信度良好 |
| `--zt-warning` | `#d97706` | 警告、待复核 |

> **注意**: `--zt-primary` (蓝) 和 `--zt-alert` (红) 用于功能状态，品牌红 `#b91c3c` 用于品牌表达。两者不混用。

### 2.4 Agent 专用色

| Agent | Token | Hex |
|-------|-------|-----|
| RumorDetector | `--agent-rumor` | `#b45309` |
| FactChecker | `--agent-fact` | `#2B7FD8` |
| SourceValidator | `--agent-source` | `#7c3aed` |
| ReportComposer | `--agent-report` | `#16a34a` |

---

## 3. 字体系统

### 3.1 字体栈

| 角色 | 字体 | 字重 | 用途 |
|------|------|------|------|
| 中文标题 | `"Noto Serif SC", "Huiwen Mincho", "STSong", serif` | 700 | 品牌名、页面标题、章节标题 |
| 中文正文 | `"Noto Sans SC", ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif` | 400-600 | 正文、标签、按钮 |
| 英文装饰 | `"Georgia", "Noto Serif SC", serif` | 500 | Tagline、英文点缀 |
| 等宽 | `"JetBrains Mono", "Fira Code", monospace` | 400-500 | 代码、技术数据 |

### 3.2 字号规范

| Token | 值 | 用途 |
|-------|-----|------|
| `--text-hero` | `clamp(36px, 5vw, 52px)` | 品牌名（Landing Hero） |
| `--text-section` | `clamp(1.6rem, 4vw, 2.6rem)` | 区域标题 |
| `--text-card` | `1.15rem` ~ `1.4rem` | 卡片标题 |
| `--text-body` | `15px` | 正文 |
| `--text-label` | `13px` | 标签、元数据 |

### 3.3 排版规则

- **标题**: `letter-spacing: 0.04em`（中文标题略加宽）
- **Tagline**: `letter-spacing: 0.08em`（装饰性文本加宽）
- **正文行高**: `line-height: 1.6`
- **标题行高**: `line-height: 1.2`
- **文本选中**: `background: #F4D758; color: #1A1A2E`

---

## 4. 间距系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--zt-unit` | `8px` | 基础单位 |
| `--zt-space-xs` | `8px` | 紧凑间距 |
| `--zt-space-sm` | `12px` | 小间距 |
| `--zt-space-md` | `20px` | 标准间距 |
| `--zt-space-lg` | `32px` | 大间距 |
| `--zt-space-xl` | `48px` | 区域间距 |
| `--zt-space-section` | `clamp(40px, 6vh, 80px)` | 区块间距 |
| `--zt-card-padding` | `clamp(16px, 2vw, 28px)` | 卡片内边距 |

---

## 5. 圆角系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--zt-radius-sm` | `8px` | 小元素、标签 |
| `--zt-radius-md` | `12px` | 输入框、按钮 |
| `--zt-radius-lg` | `16px` | 卡片 |
| `--zt-radius-xl` | `20px` | 大卡片、模态框 |
| `--zt-radius-full` | `999px` |  pills、头像 |

---

## 6. 阴影系统

| Token | 值 | 用途 |
|-------|-----|------|
| `--zt-shadow-none` | `none` | 扁平元素 |
| `--zt-shadow-sm` | `0 1px 2px rgba(26, 26, 46, 0.04)` | 微投影 |
| `--zt-shadow-md` | `0 4px 12px rgba(26, 26, 46, 0.06)` | 卡片 |
| `--zt-shadow-lg` | `0 8px 32px rgba(26, 26, 46, 0.08)` | 浮层、模态框 |

> 阴影色统一使用 `rgba(26, 26, 46, x)` — 基于主文本色的低透明度，确保阴影不发蓝/不发灰。

---

## 7. 动画规范

| 名称 | 曲线 | 用途 |
|------|------|------|
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | 标准退出（悬停、展开） |
| `--ease-in-out` | `cubic-bezier(0.65, 0, 0.35, 1)` | 对称过渡（页面切换） |
| `--ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | 弹性（仅用于成功状态、徽章） |

> **限制**: 禁止弹跳/弹性动画用于大面积元素。动画时长控制在 `0.2s ~ 0.4s`。

---

## 8. 组件规范

### 8.1 主按钮（CTA）

```css
background: #b91c3c;
color: #ffffff;
border: none;
border-radius: var(--zt-radius-md);
padding: 12px 24px;
font-weight: 600;
font-size: 15px;
transition: background 0.2s ease, transform 0.2s var(--ease-out);
```

- **Hover**: `background: #9a1832`（加深 15%）
- **Disabled**: `opacity: 0.5; cursor: not-allowed`
- **Focus**: `outline: 2px solid #b91c3c; outline-offset: 2px`

### 8.2 输入框

```css
border: 1px solid var(--border-subtle);
border-radius: var(--zt-radius-md);
padding: 16px;
background: var(--zt-bg);
color: var(--zt-text);
```

- **Focus**: `border-color: #b91c3c`
- **Placeholder**: `color: var(--zt-text-muted); opacity: 0.7`

### 8.3 链接芯片（Detected Link）

```css
background: var(--zt-bg-elevated);
color: var(--zt-text-secondary);
border: 1px solid var(--border-subtle);
border-radius: var(--zt-radius-sm);
padding: 6px 12px;
font-size: 13px;
```

### 8.4 卡片

```css
background: var(--zt-bg-panel);
border: 1px solid var(--border-subtle);
border-radius: var(--zt-radius-xl);
padding: var(--zt-card-padding);
box-shadow: var(--zt-shadow-md);
```

---

## 9. 页面模板

### 9.1 Landing Page（首页）

```
┌─────────────────────────────────────┐
│  [Logo 120×120]                     │
│  红鲱鱼 与枪                        │ ← 衬线 700，墨黑 + 深红
│  信息真相猎人                        │ ← 衬线 500，次要色
├─────────────────────────────────────┤
│  ┌───────────────────────────────┐  │
│  │ 添加待核查材料                  │  │ ← 标签，13px，大写
│  │ ┌───────────────────────────┐ │  │
│  │ │ 输入文字、粘贴链接...      │ │  │ ← 输入框
│  │ └───────────────────────────┘ │  │
│  │ [添加图片] [example.com]      │  │ ← 材料工具区
│  │                               │  │
│  │ [🔎 启动真实核查]             │  │ ← CTA 按钮
│  └───────────────────────────────┘  │
│  1.立案 → 2.拆题 → 3.溯源 → ...   │ ← 流程示意
├─────────────────────────────────────┤
│  [Logo] 红鲱鱼与枪                  │
│  Powered by ...                     │ ← Footer
└─────────────────────────────────────┘
```

**配色**: 暖奶油底 `#fefcf6` + 白色卡片 `#ffffff` + 深红 CTA `#b91c3c`

### 9.2 Mission Control（分析中）

- 左侧: 案件卷宗（原始信息、材料来源、调查路径）
- 中间: Agent 执行画布 + 证据板
- 右侧: 结论审计 + 实时推理面板
- 背景: `#fefcf6`，卡片: `#ffffff`

---

## 10. 响应式断点

| 名称 | 宽度 | 行为 |
|------|------|------|
| Mobile | < 640px | 单列布局，Hero 缩小，卡片全宽 |
| Tablet | 640px ~ 1024px | 双列布局，侧边栏可折叠 |
| Desktop | > 1024px | 三列布局，固定侧边栏 |

---

## 11. 文件结构

```
src/
├── styles.css              # 设计令牌 + 全局样式 + 组件样式
├── components/v3/
│   ├── Dashboard.tsx       # Landing Page（品牌优先）
│   ├── StreamingReasoningPanel.tsx  # 实时推理面板
│   └── phases/
│       └── MissionControlView.tsx   # 分析工作台
├── lib/
│   ├── caseIntake.ts       # 案件输入类型
│   └── linkScraper.ts      # 链接抓取（r.jina.ai）
└── store/
    └── reasoningStore.tsx  # 推理状态管理
```

---

## 12. 演变记录

| 日期 | 变更 | 原因 |
|------|------|------|
| 2026-05-29 | 采用 Esther 暖色底 `#fefcf6` | 排斥 AI 冷灰感 |
| 2026-05-29 | 衬线标题 + 无衬线正文 | 中文排版经典法则 |
| 2026-05-30 | 品牌红从 `#E84A5F` 改为 `#b91c3c` | 匹配 Logo 深红 |
| 2026-05-30 | 新增链接抓取功能 | 用户输入链接自动识别 |

---

## 参考

- [Esther Design System](https://github.com/esthersjw/esther-design-system) — 反 AI 美学、三色约束
- [Aether Design System](https://github.com/...) — 扩展色阶参考
