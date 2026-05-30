# 真探 Agent 设计系统优化 — Codex 技术规范

> **来源**: 基于 Esther Design System + Aether Design System 研究，以及当前设计审计报告
> **目标**: 将 Esther 的"反AI美学"与暖色调设计融入真探 Agent，同时修复当前设计审计发现的技术债务
> **范围**: `src/styles.css` + 关键组件文件，不改动业务逻辑或交互行为

---

## 1. 执行摘要

### 1.1 核心策略
采用 **"增量适配"** 而非完全重写：保留 Variant B 的编辑式/严肃感骨架，将 Esther 的暖色调、衬线标题层级、3色约束和反AI美学注入其中。

### 1.2 关键变化
| 维度 | 当前状态 | 目标状态 |
|------|---------|---------|
| 背景色 | `#f5f5f7` 冷灰 | `#fefcf6` 暖奶油 |
| 主色调 | `#2563eb` 科技蓝 | `#2B7FD8` Esther蓝 |
| 强调色 | 无统一强调色 | `#F4D758`  Esther黄 |
| 警示色 | `#dc2626` | `#E84A5F` Esther红 |
| 正文字色 | `#1d1d1f` | `#1A1A2E` 暖墨 |
| 字体标题 | Noto Serif SC 700 | Noto Serif SC 700-900（衬线层级） |
| 字体正文 | Noto Sans SC 400-700 | Noto Sans SC 400-600（无衬线正文） |
| Shadow | 变量声明为none但组件硬编码 | 统一为声明式token，选择性使用 |
| 间距 | 硬编码，token未使用 | 使用 `--zt-space-*` token |
| border-radius | 8种不同值 | 标准化为5档 |

### 1.3 禁止事项（来自 Esther）
- 蓝紫渐变
- 玻璃拟态（glassmorphism）——当前 topbar 的 `backdrop-filter: blur()` 需移除
- 霓虹色、青色
- 纯黑 `#000000` 或纯白 `#FFFFFF` 背景
- Inter/Roboto 作为主字体
- 所有区域居中（hero 除外）
- 未经样式的默认 HTML 元素
- AI 模板感外观

---

## 2. 设计令牌规范

### 2.1 颜色系统

替换 `:root` 中现有的颜色变量（当前第1-65行）。保留变量名语义，但值按以下映射：

```css
:root {
  /* === 品牌3色系统（60/30/10）=== */
  --zt-primary: #2B7FD8;     /* 60% - 主要操作、已核实事实、链接 */
  --zt-accent: #F4D758;      /* 30% - 高亮、徽章、关键声明 */
  --zt-alert: #E84A5F;       /* 10% - 错误信息、警示、谣言标记 */

  /* === 中性/基础色 === */
  --zt-ink: #151821;         /* 最深暗色（极少使用） */
  --zt-text: #1A1A2E;        /* 主要文本色（原 --charcoal #1d1d1f） */
  --zt-text-secondary: #4A4A5A;  /* 次要文本（原 --steel） */
  --zt-text-muted: #888888;  /* 第三级文本/元数据（原 --silver） */
  --zt-bg: #fefcf6;          /* 页面背景 - 暖奶油（原 --cloud） */
  --zt-bg-deep: #faf6eb;     /* 深层奶油 - 卡片/区域背景 */
  --zt-bg-panel: #ffffff;    /* 面板/卡片背景（保持白色，不发冷） */
  --zt-bg-elevated: #f5f0e8; /* 微升高表面（输入框、悬停） */

  /* === 语义映射（兼容现有组件引用）=== */
  --bg-body: var(--zt-bg);
  --bg-panel: var(--zt-bg-panel);
  --bg-elevated: var(--zt-bg-elevated);
  --text-primary: var(--zt-text);
  --text-secondary: var(--zt-text-secondary);
  --text-tertiary: var(--zt-text-muted);

  /* === 边框 === */
  --border-subtle: #e8e4d9;    /* 暖灰边框（原 #e5e5e7） */
  --border-medium: #d4c9b5;    /* 较强边框（原 #d1d1d6） */

  /* === 功能色 === */
  --zt-success: #16a34a;       /* 保持现有绿色（可信度良好） */
  --zt-warning: #d97706;       /* 保持现有琥珀色（警告） */

  /* === Agent 专用色（去饱和）=== */
  --agent-rumor: #b45309;      /* Rumor Detector - 保持不变 */
  --agent-fact: var(--zt-primary);  /* Fact Checker - 改用品牌蓝 */
  --agent-source: #7c3aed;     /* Source Validator - 保持不变 */
  --agent-report: var(--zt-success); /* Report Composer - 保持绿色 */

  /* === 可信度色阶 === */
  --credibility-high: #15803d;     /* >= 80 */
  --credibility-good: #16a34a;     /* 60-79 */
  --credibility-medium: #d97706;   /* 40-59 */
  --credibility-low: #ea580c;      /* 20-39 */
  --credibility-critical: var(--zt-alert); /* < 20 - 改用 Esther 红 */
}
```

**重要**: `--accent-blue`、`--accent-green`、`--accent-amber`、`--accent-red`、`--accent-purple` 这些旧变量需要 **全局搜索替换**为新的语义变量名。

### 2.2 字体系统

当前 `index.html` 加载的字体：
```html
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700&family=Noto+Serif+SC:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

**修改要求**：
1. Noto Sans SC 添加 `900` 权重（AgentCard 等组件可能需要）
2. Noto Serif SC 添加 `900` 权重（Esther 的衬线标题使用 900）
3. 保持 JetBrains Mono 不变

```html
<!-- 新的字体加载 -->
<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;600;700;900&family=Noto+Serif+SC:wght@400;600;700;900&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
```

CSS 字体变量更新：
```css
--font-sans: 'Noto Sans SC', -apple-system, 'PingFang SC', 'Helvetica Neue', sans-serif;
--font-serif: 'Noto Serif SC', 'Huiwen Mincho', serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

**字体权重规范（严格限制已加载权重）**：
| 用途 | 权重 | 字体 |
|------|------|------|
| 正文 | 400 | Sans |
| 正文强调 | 500-600 | Sans |
| 按钮/标签 | 600 | Sans |
| 卡片标题 | 600-700 | Sans |
| 页面大标题 | 700-900 | Serif |
| 章节标题 | 600-700 | Serif |
| 分数/数字展示 | 700-900 | Serif |
| 元数据/时间戳 | 400-500 | Mono |

**禁止使用的权重**: `650`, `750`, `850` — 这些值在 Noto Sans SC / Noto Serif SC 中不存在，浏览器会 fallback 导致不一致渲染。

### 2.3 间距系统

替换当前未使用的 `--space-*` token，并强制使用：

```css
:root {
  /* 基础单位 */
  --zt-unit: 8px;

  /* 间距 token */
  --zt-space-xs: 8px;          /* 微间距：图标间隙、内联元素 */
  --zt-space-sm: 12px;         /* 小组件间隙 */
  --zt-space-md: 20px;         /* 标准组件间隙 */
  --zt-space-lg: 32px;         /* 区域间隙 */
  --zt-space-xl: 48px;         /* 大区域间隙 */
  --zt-space-section: clamp(40px, 6vh, 80px);  /* 区块间距 */

  /* 卡片内边距（流体） */
  --zt-card-padding: clamp(16px, 2vw, 28px);
}
```

**实施规则**：
- 所有硬编码的 `padding`、`margin`、`gap` 值必须映射到上述 token
- 例外：Canvas 网格相关像素值（如 `grid-template-columns: 242px minmax(760px, 1fr) 330px`）保持硬编码

### 2.4 圆角系统

标准化为 5 档：

```css
:root {
  --zt-radius-sm: 8px;     /* 小按钮、图标、标签框 */
  --zt-radius-md: 12px;    /* 按钮、标签、输入框 */
  --zt-radius-lg: 16px;    /* 卡片、面板 */
  --zt-radius-xl: 20px;    /* 大卡片、工作区面板 */
  --zt-radius-full: 999px; /* 药丸、徽章、进度条 */
}
```

**映射表（将当前值映射到新 token）**：
| 当前值 | 新 token | 用途 |
|--------|---------|------|
| `2px` | `--zt-radius-sm` | 标签框锐利角（特殊） |
| `8px` | `--zt-radius-sm` | 小按钮 |
| `10px` | `--zt-radius-md` | 按钮 |
| `12px` | `--zt-radius-md` | 卡片、输入框 |
| `14px` | `--zt-radius-lg` | 大卡片 |
| `16px` | `--zt-radius-lg` | 面板、模态框 |
| `18px` | `--zt-radius-xl` | 结果面板 |
| `20px` | `--zt-radius-xl` | 工作区面板 |
| `24px` | `--zt-radius-xl` | 仪表盘输入卡（特殊保留） |
| `999px` | `--zt-radius-full` | 药丸、徽章 |

### 2.5 阴影系统

**决策**：保持扁平设计哲学，但为卡片添加极微妙的暖色阴影以增加层次（而非 Esther 的完全无阴影）。

```css
:root {
  --zt-shadow-none: none;
  --zt-shadow-sm: 0 1px 2px rgba(26, 26, 46, 0.04);
  --zt-shadow-md: 0 4px 12px rgba(26, 26, 46, 0.06);
  --zt-shadow-lg: 0 8px 32px rgba(26, 26, 46, 0.08);
}
```

**规则**：
- 默认卡片使用 `--zt-shadow-sm` 或无阴影
- 浮动元素（如 topbar、模态框）使用 `--zt-shadow-md`
- Agent 卡片使用 `--zt-shadow-lg`（因其需要突出层级）
- 删除所有硬编码的 `box-shadow` 值，统一引用 token

### 2.6 选中文本样式

添加 Esther 风格的黄色选中文本：

```css
::selection {
  background: var(--zt-accent);
  color: var(--zt-text);
}
```

---

## 3. 文件变更清单

### 3.1 优先级 P0（必须完成）

| # | 文件 | 变更内容 | 验证方式 |
|---|------|---------|---------|
| 1 | `index.html` | 更新 Google Fonts 加载：添加 `900` 权重到 Sans/Serif | 检查 `<link>` 标签 |
| 2 | `src/styles.css` `:root` | 替换颜色/间距/圆角/阴影 token 定义（第1-65行左右） | 检查变量值 |
| 3 | `src/styles.css` 全局 | 搜索替换所有 `--accent-blue` → `--zt-primary`，`--accent-red` → `--zt-alert`，`--accent-*` → 对应新变量 | grep 确认无旧变量残留 |
| 4 | `src/styles.css` 全局 | 搜索替换所有 `font-weight: 650` / `750` / `850` → `600` / `700` / `700` | grep 确认无非法权重 |
| 5 | `src/styles.css` Handoff UI 区域 | 将 `#f8fafc`、`#e2e8f0`、`#1e293b`、`#64748b` 等硬编码色映射到 `--zt-*` 变量 | 检查 handoff 区域颜色 |
| 6 | `src/styles.css` Canvas 节点 | 将 `#3b82f6`、`#22c55e`、`#f59e0b`、`#a855f7` 硬编码色映射到语义变量 | 检查节点颜色 |
| 7 | `src/styles.css` 全局 | 将所有硬编码阴影值替换为 `--zt-shadow-*` | grep `box-shadow:` |
| 8 | `src/styles.css` 全局 | 添加 `::selection` 样式 | 检查选择文本效果 |

### 3.2 优先级 P1（推荐完成）

| # | 文件 | 变更内容 | 验证方式 |
|---|------|---------|---------|
| 9 | `src/styles.css` 全局 | 将常用间距值替换为 `--zt-space-*` token | 检查 padding/margin/gap |
| 10 | `src/styles.css` 全局 | 统一 border-radius 值为 `--zt-radius-*` token | grep `border-radius:` |
| 11 | `src/styles.css` topbar | 移除 `backdrop-filter: blur()`（禁止玻璃拟态），改用 `background: rgba(254,252,246,.9)` | 检查 topbar 样式 |
| 12 | `src/components/v3/panels/AgentCard.tsx` | 更新 Agent 颜色引用（如有硬编码） | 检查组件源码 |
| 13 | `src/components/v3/phases/result/ReportPanel.tsx` | 更新结论卡片、可信度徽章颜色引用 | 检查组件源码 |
| 14 | `src/styles.css` | 删除 Legacy Diagnosis Banner 注释代码（1715-1843行） | 检查是否删除 |
| 15 | `src/styles.css` | 合并重复的 `.floating-input-bar` 样式（2044-2159 和 2535-2640） | 检查重复定义 |

### 3.3 优先级 P2（加分项）

| # | 文件 | 变更内容 | 验证方式 |
|---|------|---------|---------|
| 16 | `src/styles.css` | 尝试按功能拆分为多个 CSS 模块文件（如 `dashboard.css`、`mission.css`、`result.css`） | 检查文件结构 |
| 17 | `src/styles.css` | 为 Canvas 节点添加 ARIA label 和 focus-visible 样式 | 检查可访问性 |
| 18 | 全局 | 为可信度徽章添加图标（非仅颜色）以改善可访问性 | 检查视觉呈现 |

---

## 4. 关键组件样式映射

### 4.1 仪表盘 Dashboard

```css
/* 当前 → 目标 */
.dashboard-page {
  /* 背景：--cloud #f5f5f7 → --zt-bg #fefcf6 */
  background: var(--zt-bg);
}

.dashboard-input-card {
  /* 保持白色但变暖 */
  background: var(--zt-bg-panel);
  /* 圆角：24px → 保持（特殊）或 20px */
  border-radius: 24px; /* 保持，作为 hero 元素可特殊 */
  /* 阴影：硬编码或无 → --zt-shadow-md */
  box-shadow: var(--zt-shadow-md);
}

.dashboard-brand-title {
  /* 字体：保持 Noto Serif SC */
  /* 颜色：保持 --text-primary → --zt-text */
  color: var(--zt-text);
}

.dashboard-submit-btn {
  /* 背景：--accent-blue → --zt-primary */
  background: var(--zt-primary);
  font-weight: 600; /* 650 → 600 */
}

.dashboard-submit-btn--deep {
  /* 脉冲动画：保持 */
  /* 边框色：--accent-blue → --zt-primary */
  border: 1px solid var(--zt-primary);
}
```

### 4.2 Agent 卡片 AgentCard

```css
.mission-agent-card {
  /* 背景：rgba(255,255,255,0.94) → --zt-bg-panel */
  background: var(--zt-bg-panel);
  /* 顶部边框：保持各 agent 颜色 */
  /* 阴影：硬编码 0 8px 32px → --zt-shadow-lg */
  box-shadow: var(--zt-shadow-lg);
  border-radius: var(--zt-radius-xl); /* 20px → token */
}

.mission-agent-card h2 {
  font-family: var(--font-serif);
  /* 保持 serif */
}

.mission-agent-meta {
  font-family: var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  /* 保持 */
}
```

### 4.3 Handoff UI（最大变化区域）

当前 Handoff UI 使用 `#f8fafc`（slate-50）、`#e2e8f0`（slate-200）、`#1e293b`（slate-800）等冷色 slate 系列。**必须全部映射到暖色调品牌系统**。

```css
/* Handoff 区域背景 */
.handoff-container,
.handoff-panel {
  /* #f8fafc → --zt-bg-deep #faf6eb */
  background: var(--zt-bg-deep);
}

/* Handoff 步骤卡片 */
.handoff-step-card {
  /* 白色背景 */
  background: var(--zt-bg-panel);
  /* 边框 */
  border: 1px solid var(--border-subtle);
  border-radius: var(--zt-radius-lg);
  /* 阴影 */
  box-shadow: var(--zt-shadow-sm);
}

/* Handoff 文本 */
.handoff-step-title {
  /* #1e293b → --zt-text */
  color: var(--zt-text);
}

.handoff-step-description {
  /* #64748b → --zt-text-secondary */
  color: var(--zt-text-secondary);
}

/* Handoff streaming 状态 */
.handoff-streaming-indicator {
  /* 保持动画，但颜色映射 */
  color: var(--zt-primary);
}
```

### 4.4 报告面板 ReportPanel

```css
/* 结论卡片 */
.conclusion-card {
  /* 背景：保持白色 */
  background: var(--zt-bg-panel);
  /* 左边框：保持可信度颜色 */
  /* 圆角 */
  border-radius: 0 var(--zt-radius-lg) var(--zt-radius-lg) 0;
}

.conclusion-score {
  font-family: var(--font-serif);
  /* 颜色由可信度决定 */
}

/* 可信度徽章 */
.credibility-badge {
  /* 使用 color-mix，但基准色改为 --zt-* 系列 */
  border: 1px solid color-mix(in srgb, var(--credibility-color) 24%, transparent);
  background: color-mix(in srgb, var(--credibility-color) 8%, var(--zt-bg-panel));
}

/* Truth Stamp */
.truth-stamp-text {
  font-family: var(--font-serif);
  /* 颜色：根据结论状态映射 */
}
```

### 4.5 Canvas 节点

```css
/* 节点状态颜色映射 */
.status-risk {
  /* #3b82f6 → --zt-primary */
  --node-color: var(--zt-primary);
}

.status-supported {
  /* #22c55e → --zt-success */
  --node-color: var(--zt-success);
}

.status-limited {
  /* #f59e0b → --zt-warning */
  --node-color: var(--zt-warning);
}

.status-blocked {
  /* 可能为红色 → --zt-alert */
  --node-color: var(--zt-alert);
}

.canvas-node {
  /* 阴影：硬编码 → --zt-shadow-sm */
  box-shadow: var(--zt-shadow-sm);
}
```

---

## 5. 验证清单（Codex 完成后必须逐项确认）

### 5.1 自动验证（通过 grep/script）

```bash
# 1. 旧颜色变量必须清零
grep -n "\-\-accent-blue\|\-\-accent-green\|\-\-accent-amber\|\-\-accent-red\|\-\-accent-purple" src/styles.css
# 期望：无任何匹配

# 2. 非法字体权重必须清零
grep -n "font-weight: 650\|font-weight: 750\|font-weight: 850" src/styles.css
# 期望：无任何匹配

# 3. 硬编码阴影必须清零（排除 token 定义本身）
grep -n "box-shadow:" src/styles.css | grep -v "var(--zt-shadow"
# 期望：无硬编码 shadow（特殊渐变/动画除外）

# 4. Slate 色板必须清零（Handoff UI）
grep -n "#f8fafc\|#e2e8f0\|#1e293b\|#64748b\|#94a3b8\|#cbd5e1" src/styles.css
# 期望：无任何匹配

# 5. 新 token 必须存在
grep -n "\-\-zt-primary\|\-\-zt-accent\|\-\-zt-alert\|\-\-zt-bg\|\-\-zt-text" src/styles.css
# 期望：有多处匹配

# 6. ::selection 样式存在
grep -n "::selection" src/styles.css
# 期望：有匹配
```

### 5.2 视觉验证（浏览器人工检查）

打开 `http://127.0.0.1:5176/` 并检查：

- [ ] **Dashboard 页面背景为暖奶油色**（`#fefcf6`），不是冷灰
- [ ] **品牌标题**使用 Noto Serif SC 衬线字体
- [ ] **输入卡片**有微妙的暖色阴影
- [ ] **提交按钮**为 `#2B7FD8` Esther蓝
- [ ] **深度核查按钮**边框为 Esther蓝
- [ ] **Mission 阶段**：Agent 卡片有正确颜色顶部边框和阴影
- [ ] **Handoff UI**：背景为暖色（`#faf6eb`），不是冷灰 slate
- [ ] **Handoff 步骤卡片**：白色背景，暖色边框
- [ ] **Result 阶段**：结论卡片左边框颜色与可信度匹配
- [ ] **可信度徽章**：使用 color-mix，底色变暖
- [ ] **Truth Stamp**：动画正常，颜色正确
- [ ] **选中文本**：高亮为黄色 `#F4D758`
- [ ] **topbar**：无模糊效果，使用半透明暖色背景
- [ ] **无玻璃拟态效果** anywhere
- [ ] **整体感觉温暖**、编辑式、非 AI 模板感

### 5.3 功能验证（确保样式改动未破坏功能）

- [ ] Dashboard → 输入 claim → Mission 阶段 正常流转
- [ ] Mission 阶段 → 所有 Agent 卡片正常显示状态
- [ ] Handoff UI → streaming 动画正常
- [ ] Result 阶段 → 报告面板完整显示
- [ ] Canvas → 节点可正常渲染和交互
- [ ] 响应式 → 移动端无布局错乱

---

## 6. 技术约束

1. **不修改业务逻辑**：只改 CSS 和极少量组件中的 className/inline style，不动 hooks、state、API 调用
2. **保持现有 className**：优先修改 CSS 选择器中的属性值，不动 HTML/JSX 结构
3. **保留动画**：所有 `animation`、`transition`、`@keyframes` 保持原样（只改颜色值）
4. **保留响应式**：所有 `@media` 查询保持原样
5. **TypeScript 编译**：改动后 `npx tsc --noEmit` 必须无错误
6. **Vite 编译**：改动后 `npm run build` 必须无错误（或至少无 CSS 相关错误）

---

## 7. 实施建议（供 Codex 参考）

### 推荐执行顺序

```
Step 1: index.html 字体更新（最小改动，先确认基础）
Step 2: src/styles.css :root token 重新定义（全局基础）
Step 3: 全局搜索替换旧变量名 → 新变量名（机械替换）
Step 4: 全局搜索替换非法 font-weight（机械替换）
Step 5: Handoff UI 硬编码色映射（最大视觉变化区域）
Step 6: Canvas 节点硬编码色映射
Step 7: Sherlock 搜索区域硬编码色映射
Step 8: 阴影统一化
Step 9: 添加 ::selection 样式
Step 10: 间距/圆角 token 化（P1）
Step 11: 删除 legacy/重复代码（P1）
Step 12: 浏览器验证
```

### 安全回退策略

如果任何步骤导致视觉明显崩坏：
1. 立即 git revert 该步骤
2. 记录具体问题
3. 跳过该问题继续其他步骤（在验证清单中标记）

---

*规范版本: v1.0*
*编写日期: 2026-05-30*
*基于: Esther Design System + Aether Design System + 真探 Agent 当前设计审计*
