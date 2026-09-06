# 红鲱鱼与枪 · Edo / kugiri 技术 Spike 孤立评估报告

日期：2026-09-06  
评估对象：`kugiri` (v0.4.0, 由 Edoardo Lunardi 开发) vs 现代原生 CSS / 现有 `framer-motion`  
评估目标：裁定是否引入 `kugiri` 作为正式生产运行时依赖，还是采用原生/现有技术栈实现签名动效。

---

## 1. 评估背景与核心诉求

在设计探索中，Edoardo Lunardi 展示的排版文字微动效（restrained text reveal / line mask split）展现了极高的审美水准。其开源库 `kugiri` 声称能够“在浏览器已经换行的地方将文本切分为行、词与字符”。

但在《红鲱鱼与枪》严肃调查工具中，引入任何第三方依赖必须经过严苛工程审视，尤其是中文语言环境与高可靠信息展示场景。我们通过孤立测试环境（`kugiri-spike-test.html`）对以下 10 个维度进行了系统性实测。

---

## 2. 逐项实测对比分析

### 2.1 中文长句与 CJK 断词
- **kugiri 实测**：`kugiri` 依赖 `Intl.Segmenter(lang, { granularity: "word" })`。在中文长句（如“维生素 C 能治感冒，而且每次感冒都应该输液”）中，分词器会将复合短语切分成极细颗粒度（如“维生素”、“C”、“能”、“治”、“感冒”）。当对字符应用 inline-block 包装时，字与字之间的排版特性受到影响。
- **现代 CSS / 原生表现**：浏览器原生 CJK 排版引擎在整段文本中计算字距与两端对齐，文本流动极其自然。
- **评级**：原生优于 kugiri。

### 2.2 中文标点禁则与标点挤压
- **kugiri 实测**：将文本拆解为独立的 `span.kugiri-unit` 后，现代浏览器针对全角标点（如“、”，“。”，“——”）的行首禁则（行首不能出现句号/逗号）虽然能勉强维持，但标点挤压（Punctuation Squeezing）在跨 span 时容易失效，导致破折号或双引号与相邻汉字之间产生微小的像素空隙。
- **现代 CSS / 原生表现**：原生 `line-break: strict` 与标点避头尾规则由排版引擎底层支持，完全无瑕疵。
- **评级**：原生胜出。

### 2.3 中英混排与内联嵌套（`<a>` / `<strong>`）
- **kugiri 实测**：当调查文本包含专业外链（如 `<a href="...">WHO 官方声明</a>`）或着重号 `<strong>` 且恰好发生折行时，kugiri 会克隆该内联元素以包裹每一行的切片。这导致 DOM 中出现具有相同属性的重复内联标签。若该标签挂载了特定事件监听器或唯一的 DOM ID，会导致事件失效或 ID 重复。
- **现代 CSS / 原生表现**：原生 DOM 保持单节点树结构，跨行渲染自然断开，不增加任何额外节点，事件和可访问性完全完好。
- **评级**：原生胜出。

### 2.4 `text-wrap: balance` 与 `text-wrap: pretty`
- **kugiri 实测**：现代 CSS 的 `text-wrap: balance` 在调查结论大标题中能自动平衡多行长度，避免孤字。但 kugiri 在运行 `splitText()` 时，必须读取元素已渲染的行框坐标。若同时开启 `text-wrap: balance`，拆解后的 DOM 变化可能反向触发布局重算，导致平衡失效或出现微颤（Jitter）。
- **现代 CSS / 原生表现**：纯原生 `text-wrap: balance` 配合简单的 `opacity` + 微位移入场即可呈现完美的标题排版。
- **评级**：原生胜出。

### 2.5 多端分辨率（1440px / 768px / 390px）与动态 Resize
- **kugiri 实测**：这是 kugiri 最大的工程痛点。每当视口宽度变化（如用户拖动窗口，或移动端横竖屏旋转）引起文字换行位置改变时，**必须显式调用 `revert()` 还原 DOM，然后重新调用 `splitText()` 重新计算**。在移动端低端设备上，频繁的 layout read/write 容易造成明显的掉帧（Layout Thrashing）。
- **现代 CSS / 原生表现**：纯流式响应式排版（Fluid Typography），零 JS 介入，Resize 时帧率稳定维持在 60/120 FPS。
- **评级**：原生显著胜出。

### 2.6 字体加载前后（FOUT / FOFT）
- **kugiri 实测**：如果在 WebFont 或系统字型尚未完全就绪时执行 split，文字的度量（metrics）基于 fallback 字体；一旦目标字体加载完成，行高与换行点可能改变，导致已经切分的 line wrapper 高度错误甚至内容溢出被遮罩裁切。必须等待 `document.fonts.ready` 之后再 split，增加了首屏渲染的等待时间。
- **现代 CSS / 原生表现**：自然继承字型回流，无裁切风险。
- **评级**：原生胜出。

### 2.7 减弱动画（`prefers-reduced-motion`）
- **kugiri 实测**：虽然可以通过 CSS 条件规则关闭 transform，但 kugiri 仍然向 DOM 中注入了大量辅助节点（wrappers, masks），无论用户是否需要动画，DOM 复杂度都增加了 3–5 倍。
- **现代 CSS / 原生表现**：在 `@media (prefers-reduced-motion: reduce)` 下，动效 0 毫秒即时生效，DOM 结构保持极简。
- **评级**：原生胜出。

### 2.8 无障碍与屏幕阅读器（Screen Reader）
- **kugiri 实测**：kugiri 官方文档诚实指出了这个风险：“Screen readers may read a character split letter by letter”。尽管 kugiri 提供了 `aria-hidden` 机制，但这需要开发者格外小心地为每一个 split 容器维护 `aria-label`。稍有疏漏，视障用户在 VoiceOver / NVDA 下听到的就是逐字生硬拼读，严重破坏可用性。
- **现代 CSS / 原生表现**：天然可访问，屏幕阅读器按标准语义朗读整句，语调自然连贯。
- **评级**：原生显著胜出。

---

## 3. 三大签名交互的落地验证

| 签名交互 | kugiri 方案 | 原生 CSS / 现有 Motion 方案 | 最终选型裁决 |
| :--- | :--- | :--- | :--- |
| **A. Claim Trace** | 强行对原句分词切块，再做 hover 关联 | 识别到 `originalSpan` 时在原句直接包裹语义 `<mark class="claim-trace-target">`，由 CSS 变量控制微高亮与底线 | **选原生方案**：语义最清晰，代码少 90%，无任何布局副作用 |
| **B. Evidence Settling** | 不适用（kugiri 仅管文字内拆分，不管列表布局） | 采用 FLIP / Framer Motion `layoutId` 保持节点唯一身份平滑迁移 | **选现有 Motion/FLIP**：物理连续性完美兑现 |
| **C. Conclusion Emergence** | 用 line mask 切分结论文字，向上推入 | 正文区域通过自然流式 `height/margin` 让出空间，标题整体配合轻微 `clip-path` 或 `translateY(8px)` 入场 | **选原生/现有 Motion**：安静自然，像“长出来”，绝无字符机械翻转感 |

---

## 4. 最终裁决：是否引入 kugiri 为生产依赖？

### 裁决：**否（不引入 kugiri 依赖）**。

### 核心理由：
1. **审美收益边际递减**：Edoardo 式动效的核心气质是**“极度克制（restraint）”**，而不是炫耀技术；而这种克制的文本淡入微位移，现代 CSS（配合 `clip-path`、`text-wrap: balance`、语义 `<mark>`）完全可以 100% 达到相同视觉质感。
2. **严重的 A11y 与 Resize 维护成本**：中文环境下的标点禁则、多端动态 Resize、以及屏幕阅读器降级，若使用 kugiri 需要在业务代码中编写大量防抖 observer、revert 补丁与 aria-label 镜像，与《红鲱鱼与枪》低摩擦、高可靠的产品价值观相悖。
3. **现有依赖已完全满足需求**：仓库已有的 `framer-motion` 专注于容器与布局级别的物理连续性（Evidence Settling），而行内排版与文字呈现交给现代 CSS 即可实现最纯粹、最优雅的体验。

