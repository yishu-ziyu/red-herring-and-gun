# 验收标准：视觉研究与交互原型任务（Reference → Product Mapping 与三种探索模式）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#53。

## Change

把外部世界真正优秀的设计语言映射进《红鲱鱼与枪》的具体产品语义，交付可真实运行比较的交互原型，并完成 kugiri 技术 Spike：

1. **Reference → Product Mapping 文档**（`docs/design/reference-pack/design-reference-mapping.md`）：
   - 系统化分析 CollectUI 分类（Cuberto, Nikoloz Zaalovich, UI Interaction, Animation, Blog Post, Tooltip, Empty States, Loading, Quote）与 Edoardo Lunardi / kugiri；
   - 每个参考严格回答三问：Borrow（借什么）、Reject（拒绝什么）、Map（映射到哪个具体产品瞬间）；
   - 补充交互机制、依赖引入需求与性能/A11y风险说明。
2. **独立 Design Exploration Playground**（`docs/design/prototypes/reference-exploration/`）：
   - 不修改生产 Golden Path 代码，独立运行；
   - 键盘 `1 / 2 / 3` 与轻量切换器无缝切换三种模式；
   - 三模式使用**完全相同**的真实调查数据（“维生素 C 能治感冒，而且每次感冒都应该输液。” 包含 2 个 Claim、support、contradict、context-only、gap、conflict、directAnswer、Source Drawer）；
   - **Mode 1 — Editorial Calm**：精心编辑文稿感，大留白，原话作为 quote，Claim 作为章，Evidence 作为 citation row，Gap/Conflict 作为 margin note / rule，极少 surface/shadow/radius，静态截图即成立；
   - **Mode 2 — Interactive Evidence**：Cuberto 式连续性，保留 DOM identity 的 Evidence Settling（`◌ 待核对` → `● 支持` / `● 反驳` / `○ 仅相关`），短/有空间因果/无眩晕/不抢阅读/无 layout jump，支持 prefers-reduced-motion；
   - **Mode 3 — Hybrid / Red Herring**：Editorial 骨架 + Cuberto 物理连续 + Edo 式克制文字动效；实现三大签名交互：Claim Trace、Evidence Settling、Conclusion Emergence；
   - 三模式均支持 Source Drawer（桌面右侧 Drawer，移动 390px 下为 Bottom Sheet，Esc 关闭，focus 恢复）。
3. **Edo / kugiri 技术 Spike**：
   - 针对中文长句、标点、中英混排、inline `<a>`/`<strong>`、`text-wrap: balance`、1440px/768px/390px、动态 resize、字体加载、reduced-motion、screen reader 进行孤立实测与系统性分析；
   - 对比 kugiri vs 现代 CSS / Motion，产出是否引入生产依赖的决定性技术评估。
4. **无视觉禁区违规**：
   - 杜绝 Mission Control、Agent 节点、Card 套 Card、大面积玻璃拟态、无意义渐变、彩纸飞舞、红绿二元标签等。
5. **真实截图与自动化走查**：
   - 生成 Desktop (1440px) 与 Mobile (390px) 下的多状态截图与走查。

## Not this

- 不合并生产代码，不修改生产 Golden Path（`mvp/src/goldenPath/` 生产组件树保持原状）；
- 不开启正式生产视觉重构；
- 不引入未经评审确认的生产 npm 依赖；
- 不改动 `ops.sh`，不删除 `mvp/`；
- 不通过修改数据内容来让某个模式看起来更漂亮（三模式严格数据同构）。

## Evaluator

机器项（全绿才交付）：

- [ ] M1: 映射文档 `docs/design/reference-pack/design-reference-mapping.md` 存在且包含 Cuberto、Nikoloz Zaalovich、CollectUI 关键类目及 kugiri 的完整 Borrow/Reject/Map 结构。
- [ ] M2: kugiri isolated spike 分析文档 `docs/design/reference-pack/kugiri-spike-evaluation.md` 存在，包含 10 个测试维度的实测对比矩阵与引入结论。
- [ ] M3: 独立原型目录 `docs/design/prototypes/reference-exploration/` 包含可运行的 Playground（`index.html` 及配套资源），无运行时语法报错。
- [ ] M4: 键盘 `1 / 2 / 3` 在浏览器中可切换 Mode 1, Mode 2, Mode 3，且三者共享同一套真实案例数据。
- [ ] M5: 原型中完整覆盖 2 个 Claim、support、contradict、context-only、gap、conflict、directAnswer 及 Source Drawer / Sheet。
- [ ] M6: 既有测试与构建全绿：根 `npm test`、`npm run build`、`cd mvp && npm test` 零报错。
- [ ] M7: 自动化截图脚本/Playwright 验证通过，产出桌面端（1440px）与移动端（390px）的多模式截图。

人评项（等人裁）：

- [ ] H1: 三模式视觉对比（Editorial 文稿感 vs 连续物理交互 vs 混合原生语言）。
- [ ] H2: Evidence Settling 过程肉眼检查：DOM 对象是否保持同一身份平滑归位，有无闪烁或重绘。
- [ ] H3: Claim Trace 联动：Hover Claim 01 时原句对应 phrase 是否准确高亮且不影响排版。
- [ ] H4: Conclusion Emergence：结论是否平滑让位长出，有无突兀跳跃或营销式喧闹。
- [ ] H5: 移动端 390px 下 Source Sheet 与整体阅读流是否自然成立。
- [ ] H6: 交付报告中对 12 个关键问题回答完整，推荐方向论据充分。
