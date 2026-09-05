# 红鲱鱼与枪 · 界面

暖纸、墨色、克制。这是核查产品，不要做成多 Agent 运维界面。

2026-09-05 用户看过界面总览后，明确认可 `packages/web/output/show-me-parts/index.html`（既有零件展示：要 / 不要）和 `packages/web/output/show-me-walk/index.html`（既有用户路径走查：桌面与手机）的设计。后续原型以这两份为具体视觉与交互基准：前者参考零件呈现，后者参考整体界面及桌面/手机路径。此次认可不等于逐项选中了零件页的所有候选，也不等于认可本轮新增质询的 A/B 位置；原稿内的旧开发状态不因此恢复为当前事实。

按场景找 loader / 动效 / AI 零件：[DESIGN-GALLERY.md](./DESIGN-GALLERY.md)。

**第一屏要回答：** 出处在哪？原句站不站得住？问题在哪？不要用「能信」四字章当第一句。查完输入框能发追问，留在这条里；再查一条才回首页。

对原句的回答在第一层；改变判断的关键质询、对应回应、出处和未完成原因可以就近展开。工具日志、角色署名和模型名保持次要。没有实际质询记录时不补造对话，旧报告缺记录与本次未提出质询分开表达。

2026-09-05 当前通过临时 HTML 评审质询的呈现位置，尚未接入生产结果页。原型必须沿用现有 AppShell、品牌、ResearchMemo 排版和可展开卷宗，仅比较新增能力的呈现；不另起一套简化阅读页。用户认可后再接线，原型不能充当真实调查与历史留存验收。

活 token 在 `mvp/src/styles.css` 的 `:root`。改样式先改 CSS，再改本文件。

| 角色 | 大约 |
|------|------|
| 纸底 | `#fefcf6` |
| 墨 | `#151821` |
| 强调 | `#b91c3c` |
| 能信 | `#16a34a` |
| 不能信 / 有问题 | `#E84A5F` |
| 还查不清 | `#d97706` |

间距走 4 / 8 / 12 / 16 / 24 / 32。一页一个主按钮。不要用颜色单独表示判断。

字体一条规则：衬线只给品牌与文书层（主标题、tagline、侧栏字标、卷宗头、判断正文），sans 给所有 UI（按钮、chips、表单、标签、meta），mono 给数字与链接。sans 一律 `var(--font-sans)`（Noto Sans SC 打头，与 Noto Serif SC 配对），不要裸写系统字体栈。

判断色只认三个 token：`--verdict-true`（能信）/ `--verdict-false`（有问题）/ `--verdict-unclear`（查不清，mixed 与 unverified 都归它）。用法只做文字色、细线、淡底（color-mix 派生，标准浓度 6% 底 / 14% 高亮 / 20% 线），不做大面积色块；没有对应 token 的判断表达先加 token 再写样式，禁止裸写 rgba(22,163,74,x)。判定句规格：衬线 700、clamp(19px, 2.2vw, 24px)、墨色文字 + 判断色 62% 高亮下划线。原句沿用主线程的输入气泡；ResearchMemo 的 h1 是中性章节头，16px，不再添加原句证物框。判定句沿用当前 ResearchMemo 的 21–26px 衬线高亮样式。

退役 token（历史引用走别名，新代码禁用）：`--zt-primary` → `--accent`（电光蓝已废）；`--agent-*` 角色四色 → 语义 token（rumor→unclear、fact→accent、source→ink-muted、report→true）；`--credibility-*` 五档 → 判断三色（high/good→true、medium→unclear、low/critical→false，五档三色相）。提示类文案（表单校验、额度、服务状态）用 `--verdict-unclear` 混墨的暗橙，破坏性错误才用 accent 红。排版 token `--type-*` 对齐桌面节奏 12 / 14 / 17 / 20 / 24，`--type-display` 只给品牌 hero。

过程左栏学 Nothing 的诚实几何，不学暗色 OS：说话是裸排正文，工具/思考是细线仪器卡加点阵标记。两层不要共一张皮。不做人设、不抄 Agent 集群。
