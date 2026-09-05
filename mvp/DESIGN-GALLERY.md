# 红鲱鱼与枪 · 动效与零件索引

2026-09-05 用户看过界面总览后，明确认可 `packages/web/output/show-me-parts/index.html`（既有零件展示：要 / 不要）和 `packages/web/output/show-me-walk/index.html`（既有用户路径走查：桌面与手机）的设计。后续原型以这两份为具体视觉与交互基准：前者参考零件呈现，后者参考整体界面及桌面/手机路径。此次认可不等于逐项选中了零件页的所有候选，也不等于认可本轮新增质询的 A/B 位置；原稿内的旧开发状态不因此恢复为当前事实。

按**产品场景**选库，不是按画廊热度堆特效。视觉约束仍以 [DESIGN.md](./DESIGN.md) 和 `mvp/src/styles.css` 为准：暖纸、墨色、克制；第一屏是判断和问题点；过程可回看、不抢主秀。

改样式先改 CSS token（`--paper` / `--ink` / `--accent`、`--t-*` / `--motion-*`、已有 `cinema-shimmer`），再抄外部节奏。尊重 `prefers-reduced-motion`。不要发明用户人格，不要写成转发顾问、论证课或多 Agent 运维界面。

设计某一屏之前，仍可走 `mvp/.codex/skills/product-interface-brief`。本文件只回答：这个场景该打开哪些库。

---

## 建议先打开的 6 个

| # | 打开 | 对本产品有用在哪 |
|---|------|------------------|
| 1 | [loading-ui.com](https://loading-ui.com) | 和 Generative Loaders 同构的格子画廊。查证中要安静的 ring / spokes，打开就能比，不必从零发明 spinner。 |
| 2 | [elements.ai-sdk.dev](https://elements.ai-sdk.dev) | 推理 / 来源 / 输入整套零件。Shimmer、Reasoning、Sources、Prompt Input 能对上等待态、过程回看、贴材料；Conversation 不要当产品壳。 |
| 3 | [prompt-kit.com](https://www.prompt-kit.com) | 比 ChatGPT 式线程轻。输入框和消息流接近首页「丢进一句话 / 截图 / 链接」，不是聊天产品。 |
| 4 | [cult-ui.com](https://www.cult-ui.com) | 写明了 agent thought / streaming text。给过程回看抄流式与折起节奏，thought 本身不做第一屏。 |
| 5 | [magicui.design](https://magicui.design) | 只取 Shimmer / Text Animate 这类克制文字动效。Marquee、粒子、落地页块不进产品界面。 |
| 6 | [21st.dev](https://21st.dev) | 一次刷 Origin / Cult / Magic / Aceternity。找不到零件时来这检索，不要当设计方向。 |

改 **API Key / 设置行**时，这六个不够：直接开 [Origin UI](https://originui.com)（表单、输入组、设置行）。

---

## 场景 1 · 生成式等待 / 查证中

**这是什么：** 材料已提交，正在溯源。对应 `MissionControlView`、`MissionProcessShell`、`ThinkingReasoning`（`thinking`）、输入框 enhancing 态。用户要感到「这条说法正在被查」，不是在看模型思考秀。

**视觉约束：** 纸底上的安静反馈。优先已有 `cinema-shimmer` 和 `--motion-fade` / `--t-soft`。扫光用墨色/纸色，不要彩虹 conic 当品牌。不要假造「正在思考…」人格化文案；无句子时不要编一段 typing。

| 打开 | 抄什么 |
|------|--------|
| [Generative Loaders](https://generativeloaders.com) · [GitHub](https://github.com/kasturikhanke/generative-loaders) | Text / Inline 分类里最安静的几款；Image 12 仅当截图核查占位 |
| [Loading UI](https://loading-ui.com) | ring、spokes 一类 CSS/React spinner |
| [AI Elements · Shimmer](https://elements.ai-sdk.dev/components/shimmer) | 「查证中」扫光文字，最接近 Glyph/Spark |
| [CSS Loaders](https://css-loaders.com) | 纯 CSS、体积小的 spinner |
| [Uiverse](https://uiverse.io) | 打开 loader 分类，挑能单色化的 |
| [react-spinners](https://www.davidhu.io/react-spinners/) | 需要 npm 包时的保底，不要花式变体 |

**不要抄：** Aceternity / React Bits 粒子与 3D 环；全屏 loader 盖住「正在查哪句话」；Agent 网格呼吸灯；编造的 thought 打字机。

---

## 场景 2 · 判断结果与问题点

**这是什么：** 查完。第一眼是对原句的直接回答，以及问题在哪。对应 `ApodexRunView` 的核心结论、`ResultView`。半真半假要点名哪一截。不要盖「能信」四字章。

**视觉约束：** 能信 `#16a34a`、不能信 `#E84A5F`、还查不清 `#d97706`，但**不要用颜色单独表示判断**（须有文字）。一页一个主按钮。判断词是主秀，分数条、Agent 署名、模型名退后。

| 打开 | 抄什么 |
|------|--------|
| [Magic UI](https://magicui.design) | Text Animate：判断词入场一次即可 |
| [Motion Primitives](https://motion-primitives.com) | 文字揭示、短过渡；打开 Text / Transition 分类 |
| [Animate UI](https://animate-ui.com) | 给已有结论块加 Motion，不换皮肤 |
| [Cult UI](https://www.cult-ui.com) | streaming text 的收束感（结论出现，不是一直流） |
| [SyntaxUI](https://syntaxui.com) | 小而干净的结论/徽章块 |
| [Eldora UI](https://www.eldoraui.site) | 文字 pull-up / blur-in，只用一次、幅度小 |

**不要抄：** Tremor KPI 墙把分数做成仪表盘英雄；Tailark / Shadcnblocks 营销首屏；「先别转发」CTA；彩虹状态条；8bitcn / Neobrutalism 把界面做成主题皮肤。

---

## 场景 3 · 关键质询与过程回看（回应 / 来源 / 引用）

**这是什么：** 关键质询、回应和相关出处帮助用户理解判断，完整过程默认折起。对应 `ApodexRunView` 的结果正文、历史 `ResultView`、`InlineCitations`。2026-09-05 新质询记录尚未接线，先由临时 HTML 确认呈现方式。

**视觉约束：** 不和判断抢第一屏。质询完成、未完成、未发生和旧记录缺失必须如实区分；工具细节保持次要。引用是脚注节奏（`[n]` → 来源行），不是聊天气泡墙。

| 打开 | 抄什么 |
|------|--------|
| [AI Elements](https://elements.ai-sdk.dev) | Reasoning、Chain of Thought、Sources、Tool（打开对应组件页） |
| [prompt-kit](https://www.prompt-kit.com) | 消息流里的来源/折叠，不要整页对话 |
| [Cult UI](https://www.cult-ui.com) | agent thought / streaming text：流式、可折 |
| [assistant-ui](https://www.assistant-ui.com) | 流式与工具调用的信息架构，不要 ChatGPT 线程壳 |
| [SmoothUI](https://smoothui.dev) | 打开 AI / registry 相关分类，取折叠与流式块 |

**不要抄：** CopilotKit 把 Agent 直接生成的组件当主界面；Kibo 看板/甘特；过程时间线 + Agent 网格 + 日志墙三线并列；把多 Agent 做成运维台。

---

## 场景 4 · Prompt 输入

**这是什么：** 首页贴材料。对应 `Dashboard`、`promptInput/PromptInput`。动作是：贴说法 / 截图 / 链接 → 开始查。不是聊天。

**视觉约束：** 白纸输入框、细边、一个主按钮。附件是材料，不是 prompt 玩具。模型选择是次要信息，不要做成输入区英雄。

| 打开 | 抄什么 |
|------|--------|
| [AI Elements · Prompt Input](https://elements.ai-sdk.dev) | 打开 Prompt Input 组件：附件、发送、克制工具条 |
| [prompt-kit](https://www.prompt-kit.com) | 打开输入框分类 |
| [Origin UI](https://originui.com) | 输入组、附件行 |
| [shadcn](https://ui.shadcn.com) | Field、Input Group |
| [Hover.dev](https://www.hover.dev) | 发送按钮的微悬停，不要磁吸光标 |

**不要抄：** slash-command 调色盘当产品身份；对话 composer + 模型 ID 大徽章；Kokonut / Tailark 营销输入块；输入框彩虹光环当品牌。

---

## 场景 5 · API Key / 设置行

**这是什么：** 自带 key、选供应商、测连通。对应 `settings/ApiKeySettings`、`ProviderMark`。测通后的延迟是附属数字，不是仪表盘。

**视觉约束：** 表单行、标签、密文输入、次要按钮。纸色表面，不要「开发者控制台」暗色玻璃。供应商标记安静，不要变成模型秀。

| 打开 | 抄什么 |
|------|--------|
| [Origin UI](https://originui.com) | **优先。** 表单、输入组、设置行 |
| [shadcn](https://ui.shadcn.com) | Field、Input Group、Blocks 里的 settings 块 |
| [ReUI](https://reui.io) | 打开表单分类 |
| [SyntaxUI](https://syntaxui.com) | 干净的键值行 |
| [NumberFlow](https://number-flow.barvian.me) | 测通延迟 ms 的数字翻动（见场景 6） |

**不要抄：** 8bitcn 像素风、Neobrutalism 粗边、Aceternity 设置页光柱、把 API Key 做成霓虹密钥剧场。

---

## 场景 6 · 数字 / 进度

**这是什么：** 公式算出的 0–100 可信度（`ScoreRail` / `credibilityScore`）、推理用时（`ThinkingReasoning` 的 `elapsedMs`）、测 key 延迟、token 消耗（若展示）。数字说明核查进度或附属度量，**不是**判断本身。

**视觉约束：** 分数可以动，但不要老虎机暗示「模型正在摇出能信/不能信」。判断词仍用文字。token / 延迟放次要位置。

| 打开 | 抄什么 |
|------|--------|
| [NumberFlow](https://number-flow.barvian.me) | token、延迟、进度数字翻动 |
| [Magic UI](https://magicui.design) | 打开数字/计数相关分类，克制使用 |
| [Tremor](https://tremor.so) | 只看单条进度/数字的排版，不要整页 KPI |
| [Loading UI](https://loading-ui.com) | 不确定完成度时用不确定 spinner，不要假进度条 |

**不要抄：** 把可信度做成 slot machine；Tremor 仪表盘当结果页；token 计数器占第一屏。

---

## 明确不要当设计方向的库

这些可以出现在速查里，但默认**不要**往产品里搬：

- [Aceternity UI](https://ui.aceternity.com)、[React Bits](https://reactbits.dev) — 3D 卡、光柱、粒子、光标特效；落地页最满。
- [Kibo UI](https://www.kibo-ui.com) — 看板、甘特；我们不是多 Agent 运维界面。
- [CopilotKit](https://docs.copilotkit.ai) — Agent 直接出组件；界面必须简单。
- [Tailark](https://tailark.com)、[Shadcnblocks](https://www.shadcnblocks.com)、[Shadcnspace](https://shadcnspace.com) — 整页营销区块。
- [8bitcn](https://www.8bitcn.com)、[Neobrutalism](https://www.neobrutalism.dev) — 换皮，不是核查产品该有的样子。
- [Novel](https://novel.sh) — Notion 式编辑器；本产品不是写作台。
- [Skiper UI](https://skiper-ui.com) — 偏怪交互，除非有明确产品理由。

---

## 全库速查

用户目录原文里的链接都在。正文按场景用；这里防丢。

### 生成式等待 / Loader 画廊

| 库 | 打开 |
|---|------|
| Generative Loaders | [generativeloaders.com](https://generativeloaders.com) · [GitHub](https://github.com/kasturikhanke/generative-loaders) |
| Loading UI | [loading-ui.com](https://loading-ui.com) |
| Uiverse | [uiverse.io](https://uiverse.io) |
| CSS Loaders | [css-loaders.com](https://css-loaders.com) |
| react-spinners | [davidhu.io/react-spinners](https://www.davidhu.io/react-spinners/) |
| NumberFlow | [number-flow.barvian.me](https://number-flow.barvian.me) |
| AI Elements · Shimmer | [elements.ai-sdk.dev/components/shimmer](https://elements.ai-sdk.dev/components/shimmer) |

### AI 界面零件

| 库 | 打开 |
|---|------|
| AI Elements | [elements.ai-sdk.dev](https://elements.ai-sdk.dev) |
| prompt-kit | [prompt-kit.com](https://www.prompt-kit.com) |
| assistant-ui | [assistant-ui.com](https://www.assistant-ui.com) |
| Cult UI | [cult-ui.com](https://www.cult-ui.com) |
| Kibo UI | [kibo-ui.com](https://www.kibo-ui.com) |
| CopilotKit | [docs.copilotkit.ai](https://docs.copilotkit.ai) |

### 格子画廊、复制就走

| 库 | 打开 |
|---|------|
| Magic UI | [magicui.design](https://magicui.design) |
| Aceternity UI | [ui.aceternity.com](https://ui.aceternity.com) |
| React Bits | [reactbits.dev](https://reactbits.dev) |
| Animate UI | [animate-ui.com](https://animate-ui.com) |
| Motion Primitives | [motion-primitives.com](https://motion-primitives.com) |
| Origin UI | [originui.com](https://originui.com) |
| Hover.dev | [hover.dev](https://www.hover.dev) |
| Eldora UI | [eldoraui.site](https://www.eldoraui.site) |
| Kokonut UI | [kokonutui.com](https://kokonutui.com) |
| SmoothUI | [smoothui.dev](https://smoothui.dev) |
| SyntaxUI | [syntaxui.com](https://syntaxui.com) |
| Skiper UI | [skiper-ui.com](https://skiper-ui.com) |
| 8bitcn | [8bitcn.com](https://www.8bitcn.com) |
| Neobrutalism | [neobrutalism.dev](https://www.neobrutalism.dev) |

### 一次刷几十个库

| 站 | 打开 |
|---|------|
| 21st.dev | [21st.dev](https://21st.dev) |
| shadcn 官方 | [ui.shadcn.com](https://ui.shadcn.com) |
| Awesome React Components | [github.com/brillout/awesome-react-components](https://github.com/brillout/awesome-react-components) |
| ReUI | [reui.io](https://reui.io) |
| Shadcnblocks | [shadcnblocks.com](https://www.shadcnblocks.com) |
| Shadcnspace | [shadcnspace.com](https://shadcnspace.com) |
| Tailark | [tailark.com](https://tailark.com) |
| Tremor | [tremor.so](https://tremor.so) |
| Novel | [novel.sh](https://novel.sh) |
