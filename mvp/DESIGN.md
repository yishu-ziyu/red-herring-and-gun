# 红鲱鱼与枪 · 界面

暖纸、墨色、克制。这是核查桌，不是指挥台。

按场景找 loader / 动效 / AI 零件：[DESIGN-GALLERY.md](./DESIGN-GALLERY.md)。

**第一屏要回答：** 出处在哪？原句站不站得住？问题在哪？不要用「能信」四字章当第一句。查完输入框能发追问，留在这条里；再查一条才回首页。

过程、Agent 署名、模型名都是次要信息。不要把调查过程做成主秀。

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

判断色只认三个 token：`--verdict-true`（能信）/ `--verdict-false`（有问题）/ `--verdict-unclear`（查不清，mixed 与 unverified 都归它）。用法只做文字色、细线、淡底（color-mix 派生，标准浓度 6% 底 / 14% 高亮 / 20% 线），不做大面积色块；没有对应 token 的判断表达先加 token 再写样式，禁止裸写 rgba(22,163,74,x)。判定句规格：衬线 700、clamp(19px, 2.2vw, 24px)、墨色文字 + 判断色 62% 高亮下划线。被检原句（memo h1）是证物待遇：衬线 600、17-19px、左墨线 + 深纸底，层级永远低于判定句。

退役 token（历史引用走别名，新代码禁用）：`--zt-primary` → `--accent`（电光蓝已废）；`--agent-*` 角色四色 → 语义 token（rumor→unclear、fact→accent、source→ink-muted、report→true）；`--credibility-*` 五档 → 判断三色（high/good→true、medium→unclear、low/critical→false，五档三色相）。提示类文案（表单校验、额度、服务状态）用 `--verdict-unclear` 混墨的暗橙，破坏性错误才用 accent 红。排版 token `--type-*` 对齐桌面节奏 12 / 14 / 17 / 20 / 24，`--type-display` 只给品牌 hero。

过程左栏学 Nothing 的诚实几何，不学暗色 OS：说话是裸排正文，工具/思考是细线仪器卡加点阵标记。两层不要共一张皮。不做人设、不抄 Agent 集群。
