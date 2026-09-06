# 红鲱鱼与枪 · Edo / kugiri (0.4.0) 真实孤立运行时 Spike 评估报告

日期：2026-09-06  
评估对象：`kugiri` (v0.4.0, 由 Edoardo Lunardi 开发，安装于独立隔离目录 `docs/design/reference-pack/kugiri-spike/`)  
运行环境：Chromium (Playwright 无头环境) + 本地静态服务，未引入根工作区与 MVP 生产依赖  
测试台代码：[kugiri-spike-test.html](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/docs/design/reference-pack/kugiri-spike-test.html)  
最新截图证据：[kugiri-spike-comparison.png](file:///Users/mahaoxuan/Desktop/黑客松/红鲱鱼与枪/docs/design/reference-pack/screenshots/kugiri-spike-comparison.png)

---

## 1. 运行时加载与调用证明 (Actual Runtime Evidence)

本轮 Spike 在独立目录 `docs/design/reference-pack/kugiri-spike/package.json` 中独立安装 `kugiri@0.4.0`，并在浏览器运行时动态引入 `import { splitText } from './kugiri-spike/kugiri.js'`。

控制台与页面真实运行输出记录：
```text
RUNTIME STATUS: kugiri@0.4.0 运行时已成功加载并在内存就绪！
公开 API 调用: splitText(element, { type: ["lines", "words"] })
返回对象验证: { lines: HTMLElement[], words: HTMLElement[], chars: HTMLElement[], masks: HTMLElement[], revert: () => void }
```

---

## 2. 真实操作与 DOM 结构可观察记录

### 2.1 Case 1: 中文长句与标点分词
- **Input DOM**:
  ```html
  <div id="target-cjk-1">“维生素 C 能治感冒，而且每次感冒都应该输液。”——这是社交网络长期流传的典型复合谣言，包含因果与事实两个判断。</div>
  ```
- **kugiri 运行时操作**:
  `splitText(target, { type: ["lines", "words"] })`
- **Resulting DOM 真实输出（摘录）**:
  ```html
  <div data-line="0" style="display: block; position: relative; text-wrap: nowrap; background-color: rgba(0, 0, 0, 0); --line: 0;">
    <span data-word="0" style="display: inline-block; position: relative; width: 64px; margin-right: 0px; --word: 0;">“维生素</span>
    <span data-word="1" style="display: inline-block; position: relative; width: 14.5px; margin-right: 0px; --word: 1;">C</span>
    <span data-word="2" style="display: inline-block; position: relative; width: 16px; margin-right: 0px; --word: 2;">能</span>
    <span data-word="3" style="display: inline-block; position: relative; width: 16px; margin-right: 0px; --word: 3;">治</span>
    <span data-word="4" style="display: inline-block; position: relative; width: 80px; margin-right: 0px; --word: 4;">感冒，而且</span>
    ...
  </div>
  ```
- **Observable Result（真实可观察现象）**:
  1. **分词颗粒度与标点粘连**：`Intl.Segmenter` 将中文切为 25 个 word units。观察到部分全角标点与相邻文字合并在同一个 inline span 中（如 `“维生素`、`感冒，而且`、`液。”——这`），而破折号跨 span 时破坏了现代排版引擎的标点挤压规则；
  2. **强制 `text-wrap: nowrap`**：每一行被加上 `display: block; position: relative; text-wrap: nowrap`，字间距被硬编码为固定的 inline-block `width`；
- **Revert Result**:
  调用 `revert()` 后，DOM 完整还原为原始单一文本节点，字符串严格匹配。

### 2.2 Case 2: 嵌套内联元素 (`<a>` / `<strong>`)
- **Input DOM**:
  ```html
  根据 <a href="https://example.com" id="who-link">WHO 世界卫生组织</a> 与 <strong>FDA 官方标准</strong>，常规补充剂对普通 cold 没有临床治愈依据。
  ```
- **Observable Result**:
  当容器宽度较窄导致折行落在 `<a>` 内部时，kugiri 将原本单唯一的 `<a>` 标签按行进行了跨行克隆，生成两个相同属性的 `<a>` 片段。若业务组件在 `<a>` 上绑定了单例事件或持有 DOM 引用，会受到克隆影响。

### 2.3 Case 3: 视口 Resize 与 Repeated split/revert
- **Observable Result**:
  调整容器宽度（800px → 480px → 320px）后，由于旧的 `div[data-line]` 锁定了当时的折行宽度（`text-wrap: nowrap`），文字发生横向溢出。在实际业务中必须挂载 `ResizeObserver`，在宽度改变时调用 `revert()` 还原 DOM 并重新 `splitText()`。
- **连续 5 次 split/revert 测试**:
  连续执行 5 次 `splitText()` → `revert()`，每次还原后的 `innerHTML` 与初始 `innerHTML` 100% 幂等一致，证明 kugiri 的清理逻辑健全。

### 2.4 Case 5: 现代 CSS `text-wrap: balance` 交互
- **Input DOM**:
  容器设置 `style="text-wrap: balance; max-width: 320px;"`，内容为复合谣言原句。
- **Actual Runtime Evidence（真实运行执行与测量）**:
  1. 读取目标元素原生计算样式 `getComputedStyle(target).textWrap === "balance"`；
  2. 调用 `splitText()` 成功切出指定行数，并测量记录各行物理宽度（`[286px, 290px, ...]`）。
- **Structural Inference（DOM 结构与排版推论，非本 Case 运行时 resize 测量）**:
  1. 拆分后 kugiri 将各行硬封装为 `div[data-line]`（带有 `text-wrap: nowrap`），原生 `text-wrap: balance` 无法穿透作用于已切碎的行内 DOM；
  2. 浏览器原生 balance 算法在无硬封装时能根据容器宽度动态平衡折行；而 kugiri 锁定的各行失去跨元素自适应能力。若容器宽度改变必须依赖外层重新 split（注：本 Case 未在运行时触发宽度改变与 overflow 测量，属 DOM 结构与排版引擎特性推论）。

### 2.5 Case 6: 字体加载 `document.fonts.ready` 时序影响
- **Actual Runtime Evidence（真实运行执行与测量）**:
  1. 成功读取 `document.fonts.status` 初始状态（`loaded` 或 `loading`）；
  2. 成功执行 `await document.fonts.ready` 等待字体就绪解析；
  3. 在字体就绪后执行 `splitText()`，成功记录行数与各行几何高度。
- **Risk Analysis（时序风险推论，非本 Case 真实 font swap 实测）**:
  1. kugiri 的切行强依赖 `getBoundingClientRect()` 测量的物理像素坐标；
  2. 若在外部 WebFont（网络字体）加载就绪前执行 `splitText()`，断行点基于回退字体计算；
  3. 当 WebFont 加载完成触发字体替换（Font Swap）时，各字形 advance width 改变，已拆分行内的固定宽度 span 存在重叠或换行错位风险；
  4. 结论：kugiri 存在必须严格等待 `document.fonts.ready` 的时序依赖风险；现代原生 CSS 则天然支持 `font-display: swap` 流式重排（注：本测试未执行真实 font swap 前后几何对比与 overflow 捕获，属架构时序风险推论）。

---

## 3. 无障碍结构检查 (Accessibility Structure Inspection)

> **严格声明：当前运行环境未启动系统级 VoiceOver / NVDA 屏幕阅读器音频合成，以下结论属于 Accessibility Structure Inspection（无障碍树与 DOM 暴露检查），非 Screen Reader Runtime Audio Test，标记为 Not tested。kugiri 自身不带动画引擎，reduced-motion 属于主原型消费层的处理，非 kugiri 自身能力（标为 Not applicable）。**

1. **Accessibility Tree 文本连续性**：
   - 原生 DOM：整段中文作为一个连续的 `StaticText` 暴露给无障碍树；
   - kugiri DOM：文本被切分为数十个离散的 inline-block `span` 节点。在未手动设置 `aria-label` 与 `aria-hidden` 时，无障碍结构碎片化；
2. **Aria 自动注入情况**：
   - kugiri 默认在 units 上注入 `data-line`, `data-word`, `--line`, `--word`，**不会自动为目标容器注入 `aria-label` 或为切片子节点注入 `aria-hidden="true"`**；
   - 官方文档 caveats 明确指出需要开发者手动维护镜像 `aria-label`。

---

## 4. 业务场景映射与裁决 (Design Decision)

| 业务交互 | kugiri 方案 | 原生现代 CSS / 现有 Motion 方案 | 最终选型裁决 |
| :--- | :--- | :--- | :--- |
| **Claim Trace (命题回溯)** | kugiri 切词无法匹配业务 `originalSpan: [0, 10]`，切片粗细与 span 不对齐 | 原生按 `originalSpan` 切出语义 `<mark>`，由 CSS 变量控制微高亮与底线，无任何布局副作用 | **选原生方案**（零 JS 重排，精度 100%） |
| **Evidence Settling (证据归位)** | 不适用（kugiri 仅处理行内文本切分，不管列表布局） | FLIP / Framer Motion 保留 DOM 唯一身份平滑迁移 | **选现有方案** |
| **Conclusion Emergence (结论长出)** | kugiri 整行向上遮罩显现（视觉精致） | 正文通过 CSS height 让出空间 + `directAnswer` 微位移与淡入 | **选原生/现有 Motion**（像自然长出，无需拆碎 DOM） |

### 最终结论：**不引入 kugiri 作为生产依赖**。
- **依据**：
  1. 真实运行表明其对中文分词依赖 `Intl.Segmenter`，标点处理不够稳定（Case 1 实测）；
  2. 内联标签跨行克隆破坏单例引用（Case 2 实测）；
  3. 动态 Resize 必须依赖 JS ResizeObserver 反复销毁重建（Case 3 实测）；
  4. 文本硬封装与原生 `text-wrap: balance` 存在结构冲突（Case 5 结构推论）；
  5. 强依赖 DOM 像素测量，存在 `document.fonts.ready` 字体替换时序风险（Case 6 风险推论）；
  6. 业务所需的 Claim Trace 与 Conclusion Emergence 原生现代 CSS 即可实现，无需引入额外的外部库。

