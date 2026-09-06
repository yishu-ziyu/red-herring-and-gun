# 红鲱鱼与枪 · Design Reference Pack（#53）

日期：2026-09-06  
适用：#53 视觉与 Motion 系统  
前置：#50 产品宪法、#51 InvestigationSnapshotV1、#52 Editorial / Document-based Golden Path 已完成。

## 0. 这一轮不是“继续美化”

目标不是做更多玻璃、渐变、卡片或动画，而是把已经正确的信息架构打磨成一个**安静、聪明、友善、低摩擦、可探索**的调查体验。

最终感受应接近：

> 一份正在形成的现代调查稿，顶部有非常轻的产品 Chrome；证据关系逐步变清楚；结论像从文稿中长出来，而不是弹出一张报告卡。

硬护栏：
- 不重新引入 Card Stack / Bento / Dashboard。
- 不重新引入 Mission Control / Agent stage / tool log。
- 不把“Apple 感”等价成 glassmorphism。
- 不因为“有趣”而增加无语义动画。
- 支持 / 反驳 / 相关 / 待核对 / 尚缺 / 争点必须靠文字、位置、符号共同表达，不能只靠颜色。

---

## 1. 产品参考：分别抄什么

### A. Elicit — 最重要的白盒参考

参考：
- https://elicit.com/blog/introducing-elicit-research-agent
- https://elicit.com/blog/introducing-elicit-reports
- https://elicit.com/solutions/reports

学：
- Transparency by default；过程可以追踪，但主角是研究对象和证据，不是 Agent 角色。
- 每个重要陈述都能下钻到 source quote / exact passage。
- 用户可理解“哪些材料被纳入、为什么形成这个结论”。
- source detail 是一次明确下钻行为，适合 drawer / sheet。

用于红鲱鱼与枪：
- Evidence row → Source Drawer：显示 title / excerpt / relation / domain / 查看原文。
- #53 应把“点击证据→看到原文片段”做成最精致的交互之一。

不抄：
- Elicit 的研究管理表格、筛选器、论文数据库密度；红鲱鱼与枪不是科研工作台。

### B. scite — 证据关系的语义参考

参考：
- https://scite.ai/features
- https://scite.ai/blog/citations-in-context-from-scite

学：
- Supporting / Contrasting / Mentioning 是“关系”，不是来源本身的全局标签。
- 先看到关系，再看 citation context；冲突本身是信息。

用于红鲱鱼与枪：
- `support / contradict / context-only / unassessed` 必须始终绑定到 Claim。
- 小圆点 + 关系标签 + citation row 比大面积色块更适合。

不抄：
- 大量统计数字、citation count 仪表盘。

### C. Full Fact — 编辑式事实核查参考

参考：
- https://fullfact.org/about/how-we-fact-check/
- https://fullfact.org/about/frequently-asked-questions/

学：
- Claim 和对应 conclusion 在文章顶部先总结。
- 正文带读者穿过证据，让读者自己复核判断。
- 灰区可以诚实存在，不强迫一切变成二元真假。

用于红鲱鱼与枪：
- 完成态 first viewport：directAnswer 第一层，原始说法第二层，命题与证据紧接其后。
- 文案应是“现有证据支持/不支持什么”，而不是“AI 判定”。

不抄：
- 传统新闻网站的长文章 Chrome、营销导航。

### D. Perplexity — 低摩擦 citation 参考

参考：
- https://www.perplexity.ai/help-center/en/articles/20260806-understanding-source-labels

学：
- citation 必须容易发现、容易点开；来源属性可以 hover / click 后再展开。
- source metadata 不应该压过 answer。

用于红鲱鱼与枪：
- domain / source type / reachable 是次级信息，默认轻量；真正需要时下钻。

不抄：
- “Answer + 一串 citation”就结束。红鲱鱼与枪必须继续展示 Claim / evidence relation / gap / conflict。

---

## 2. Apple：只借“层级与流动”，不借“玻璃皮肤”

必读：
- Apple HIG / Liquid Glass overview: https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- WWDC25 Meet Liquid Glass: https://developer.apple.com/videos/play/wwdc2025/219/
- WWDC26 Communicate your brand identity on iOS: https://developer.apple.com/videos/play/wwdc2026/251/
- HIG Materials: https://developer.apple.com/design/human-interface-guidelines/materials

关键原则：
1. Liquid Glass 主要属于**导航 / 控制层**，不是内容层。
2. 内容层应保持清楚、可读、品牌化；不要 glass on glass。
3. 色彩用来表达行动、状态、反馈与层级，而不是铺满页面。
4. UI layer 和 content layer 要分开：顶部轻 Chrome 可以有微弱 blur / transparency，调查正文保持实。
5. 直接反馈、空间连续性、可中断的 motion 比“炫”重要。

落到本产品：
- 顶栏可以尝试非常轻的 glass / blur；正文禁止整片玻璃。
- Source Drawer / account popover 可以是独立 floating surface。
- 调查正文以 typography + whitespace + divider 为主。

---

## 3. Google Material 3 Expressive：学“表达=可用性”

必读：
- https://design.google/library/expressive-material-design-google-research
- https://design.google/library/material-design-eras
- https://design.google/library/design-notes-material-3-expressive-liam-spradlin

关键原则：
- Expressive 不等于 loud；可以很安静。
- 用 size / space / motion / typography 把注意力导向真正重要的信息。
- motion 与 responsive feedback 是帮助理解状态变化的工具。
- 大小与层级能让关键元素更快被发现；不要靠更多 containers。

落到本产品：
- directAnswer 的字号和留白要真正承担“完成态焦点”。
- `support / contradict / gap / conflict` 的差异主要靠信息架构 + label + glyph；色彩只作强化。
- waiting / searching 状态可以有细微但有生命感的 motion，不允许 loading spectacle。

---

## 4. 设计 Skill：Zcode 开始 #53 前应该读什么

推荐安装：

```bash
npx skills@latest add emilkowalski/skills
```

仓库：https://github.com/emilkowalski/skills

优先使用：

1. `apple-design`
   - Apple 的响应、空间连续性、spring、translucent material、typography、reduced-motion。
2. `animate`
   - 每个动画先判断“该不该动”，再决定工具、属性、curve、duration、interruptibility。
3. `review-animations`
   - PR 完成前做严格 motion review；默认不通过，直到赢得通过。
4. `find-animation-opportunities`
   - 找真正需要 Motion 的断裂点，不为了“丰富”到处加动画。
5. `pick-ui-library`
   - 禁止 Coding Agent 手搓已有成熟 primitive。
6. `prototype`
   - 对高价值单个交互（例如 Claim 展开 / Source Drawer / evidence reclassification）可以做 3 个真正不同的方案再选。

补充阅读：
- https://emilkowal.ski/ui/agents-with-taste
- https://emilkowal.ski/ui/great-animations
- https://emilkowal.ski/ui/good-vs-great-animations

原则：Agent 不应该自己“凭感觉”发明 easing / spring；先读 skill，再写。

---

## 5. Motion 技术栈：当前仓库已经够用，不要乱加依赖

当前 `mvp/package.json` 已有 `framer-motion ^12.40.0`。#53 优先继续使用现有依赖。

官方文档：
- https://motion.dev/docs/react-layout-animations
- https://motion.dev/docs/react

推荐用法：

### A. Evidence 从 `unassessed` → `support / contradict / context-only`

使用 `layout` / `layoutId` 保持同一 Evidence Row 的身份，让它自然移动到新的关系组，而不是旧行消失、新行凭空出现。

目的：解释“这条材料经过核对后被归到了哪里”。

### B. Claim 展开 / 收起

优先 layout animation + opacity；保持可中断。
不要 `scale(0)`，不要大幅位移。

### C. Gap / Conflict 首次出现

短距离 + opacity；只在首次出现时强调。
不要黄色警告卡跳出来，不要持续 pulse。

### D. complete：directAnswer 形成

让文稿整体通过 layout 让出空间，然后 directAnswer 轻微进入；下面已有 Claim/Evidence 保持空间连续性。

目的：用户感到“结论形成了”，而不是“系统跳到了结果页”。

### E. Drawer

Source row → Drawer 是有空间来源的动作：Drawer 从触发侧进入；ESC / overlay / focus management / reduced motion 必须正确。

---

## 6. 可复用组件 / Primitive

### Motion Primitives

- https://motion-primitives.com/docs

适合“读源码 / 抄交互”，不建议为了它给当前项目引入 Tailwind。
重点看：
- Disclosure
- Animated Group
- In View
- Transition Panel / Morphing Popover（只作参考，不要滥用 morph）

### Base UI

- https://base-ui.com/

如果 #53 要重做 Drawer / Popover / Menu 的行为层，优先考虑 Base UI：unstyled、accessible、可与 Motion / plain CSS 配合。

### Radix Primitives

- https://www.radix-ui.com/primitives

如果现有组件已经更接近 Radix API，可选其 Dialog / Popover / Accordion / Tooltip。重点价值是 focus management、keyboard navigation、ARIA，而不是默认视觉。

原则：只引入一个 primitive 基础，不要 Base UI + Radix 同时上。

---

## 7. #53 的签名视觉动作（Signature Motifs）

这一轮最多只保留 3 个真正有记忆点的设计动作：

### 1. Claim Trace
原始说法里有 `originalSpan` 时，对应文本可做非常轻的 underline / highlight；命题 01/02 出现时让用户看得出“这一条来自原句哪里”。无 span 时绝不伪造。

### 2. Evidence Settling
新来源先作为 `◌ 待核对` 进入；核对后同一行平滑归入 `● 支持` / `● 反驳` / `○ 相关材料`。

这是本产品最值得做好的 Motion。

### 3. Conclusion Emergence
完成时 directAnswer 在文稿顶部形成，已有正文顺滑让位；不是弹卡、不是彩纸、不是大勾动画。

其余 motion 都应服务这些主动作，而不是竞争注意力。

---

## 8. 视觉系统建议（作为设计起点，不是死值）

### Container
- 正文宽度：保持约 760–840px 的编辑式阅读宽度。
- 内容层 true/near white；不要奶油色“高级感”。
- 顶部 Chrome 可轻微 translucent；正文实色。

### Typography
- 中文优先系统栈：PingFang SC / system UI。
- directAnswer：像报道 lede，而不是营销 hero。
- Claim title：明显高于 evidence row，但不要每条都像 H1。
- Source metadata：真正退后，不和结论抢。

### Color
- Accent：蓝色继续可用，但降低大面积使用。
- Support / Contradict / Related / Gap：语义色只用于 glyph、文字、细线、focus ring；避免大面积 tint block。
- 可访问性：永远附文字/符号，不靠红绿。

### Border / Radius / Shadow
- 正文 section 默认无 radius / shadow。
- Drawer / popover / input 是可以使用 surface 的地方。
- Hairline divider 比 box 更优先。

---

## 9. #53 明确禁止的效果

- 玻璃正文卡片；glass on glass。
- 证据节点连线 / Agent DAG。
- 颜色铺满 support / contradict 大区块。
- 每次 SSE event 都触发动画。
- 持续 shimmer / glow / particle。
- `scale(0)` 弹出。
- `transition: all`。
- `ease-in` entrance。
- 动画期间阻塞点击。
- 因为追求 motion 而让用户更晚看到 evidence / conclusion。

---

## 10. #53 视觉验收方式

必须同时看实际运行与静态截图，功能测试不能代替视觉验收。

至少提供：
1. Desktop input
2. Desktop real investigating
3. Desktop real complete
4. Conflict + gap
5. Source Drawer open
6. Mobile investigating
7. Mobile complete
8. Reduced-motion 对照

必须额外提交 Motion 取证：GIF / 视频 / 连续帧均可，至少覆盖：
- Evidence Settling
- Claim expand/collapse
- Conclusion Emergence
- Source Drawer

最后做两个 review：
- `review-animations`
- 人工设计 review

#53 通过前不要进入 #54。
