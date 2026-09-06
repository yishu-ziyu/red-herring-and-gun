# 验收标准：视觉研究与交互原型任务（Reference → Product Mapping 与三种探索模式）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#53。PR：#60。

## Change

把外部世界真正优秀的设计语言映射进《红鲱鱼与枪》的具体产品语义，交付可真实运行比较的交互原型，并完成 kugiri 技术 Spike：

1. **Reference → Product Mapping 文档**（`docs/design/reference-pack/design-reference-mapping.md`）：
   - 系统化分析 CollectUI 分类（Cuberto, Nikoloz Zaalovich, UI Interaction, Animation, Blog Post, Tooltip, Empty States, Loading, Quote）与 Edoardo Lunardi / kugiri；
   - 每个参考严格回答三问：Borrow（借什么）、Reject（拒绝什么）、Map（映射到哪个具体产品瞬间）；
   - 补充交互机制、依赖引入需求与性能/A11y风险说明；
   - 确立 Quiet Editorial Evidence 准则：去语义彩虹底色（No Semantic Rainbow）、纸感第一（Paper-first）、自然文字叙事（无小卡片英文标题大写）；
   - 确立声称分级准则（明确标注 Actual Runtime Evidence / Prototype Simulation / Design Hypothesis）。
2. **独立 Design Exploration Playground**（`docs/design/prototypes/reference-exploration/`）：
   - 不修改生产 Golden Path 代码，独立运行；
   - 键盘 `1 / 2 / 3` 与轻量切换器无缝切换三种模式；
   - 三模式使用**完全相同**的生产形态设计夹具（`production-shaped design fixture`，包含 2 个 Claim、support、contradict、context-only、gap、conflict、directAnswer、Source Drawer）；
   - **Mode 1 — Editorial Calm**：精心编辑文稿感，大留白，原话作为 quote，Claim 作为章，Evidence 作为 citation row，Gap/Conflict 作为边注，极少 surface/shadow/radius，静态截图即成立；
   - **Mode 2 — Interactive Evidence**：真实 **Persistent DOM Identity**（`before === after`，同一个 HTMLElement 节点未销毁），通过 FLIP 平滑归位（`◌ 待核对` → `● 支持` / `● 反驳` / `○ 仅相关`），短/有空间因果/无眩晕/不抢阅读/无 layout jump，支持 prefers-reduced-motion；
   - **Mode 3 — Hybrid / Red Herring**：Editorial 骨架 + Cuberto 物理连续 + Edo 式克制文字动效；实现三大签名交互：Claim Trace（由真实 `originalQuote + claims[].originalSpan` 纯函数生成分段，缺失 span 不高亮）、Evidence Settling（真实同一 DOM 节点移动）、Conclusion Emergence（真实同一 DOM 节点展开）；
   - 三模式均支持 Source Drawer（桌面右侧 Drawer，移动 390px 下为 Bottom Sheet，Esc 关闭，focus 恢复，背景 `inert`，Tab 键焦点严格闭环）。
3. **Edo / kugiri 技术 Spike**：
   - 在隔离环境（`docs/design/reference-pack/kugiri-spike/`）真实安装并运行 `kugiri@0.4.0`；
   - 针对中文长句、标点、中英混排、inline `<a>`/`<strong>`、`text-wrap: balance`、1440px/768px/390px、动态 resize、字体加载、reduced-motion、screen reader 进行实测；明确将屏幕阅读器实测标注为 `Not tested（未跑实际 TTS 语音合成，根据 A11y 树结构评估）`；
   - 对比 kugiri vs 现代 CSS / Motion，产出坚决不引入生产依赖的技术裁决。
4. **无视觉禁区违规与 Quiet Editorial**：
   - 杜绝 Mission Control、Agent 节点、Card 套 Card、大面积玻璃拟态、无意义渐变、彩纸飞舞、红绿二元标签等；
   - 抽屉及全页面通过灰度审查（Grayscale Audit），去色后排版结构仍 100% 成立。
5. **真实截图与自动化走查**：
   - 生成 Desktop (1440px) 与 Mobile (390px) 下的 13 张走查及灰度审查截图。
6. **自动化回归套件**：
   - `scripts/verify_reference_exploration.py` 覆盖 10 项核心机制行为断言。

## Not this

- 不合并生产代码，不修改生产 Golden Path（`mvp/src/goldenPath/` 生产组件树保持原状）；
- 不开启正式生产视觉重构；
- 不引入未经评审确认的生产 npm 依赖；
- 不改动 `ops.sh`，不删除 `mvp/`；
- 不通过修改数据内容来让某个模式看起来更漂亮（三模式严格数据同构）；
- 不作未经实际验证的技术声明（Screen Reader 必须诚实标明 `Not tested`）。

## Evaluator

机器项（全绿才交付）：

- [x] M1: 映射文档 `docs/design/reference-pack/design-reference-mapping.md` 存在且包含 Cuberto、Nikoloz Zaalovich、CollectUI 关键类目及 kugiri 的完整 Borrow/Reject/Map 结构，包含 Quiet Editorial 准则与声称分级。
- [x] M2: kugiri isolated spike 分析文档 `docs/design/reference-pack/kugiri-spike-evaluation.md` 存在，包含 10 个测试维度的实测对比矩阵与引入结论，无障碍标注 `Not tested`。
- [x] M3: 独立原型目录 `docs/design/prototypes/reference-exploration/` 包含可运行的 Playground（`index.html` 及配套资源），无运行时语法报错。
- [x] M4: 键盘 `1 / 2 / 3` 在浏览器中可切换 Mode 1, Mode 2, Mode 3，且三者共享同一套生产形态设计夹具。
- [x] M5: 原型中完整覆盖 2 个 Claim、support、contradict、context-only、gap、conflict、directAnswer 及 Source Drawer / Sheet。
- [x] M6: 既有测试与构建全绿：根 `npm test`（core 578 / eval 85 / server 21 / web 83）、`npm run build`、`cd mvp && npm test`（908 绿 / 1 跳过）零报错。
- [x] M7: 自动化截图脚本/Playwright 验证通过，产出 13 张桌面端、移动端及灰度审查截图。
- [x] M8: TEST 01 PASS - Mode 1-3 键盘无缝切换（data-mode 响应 1/2/3 切换无报错）。
- [x] M9: TEST 02 PASS - Claim Trace 严格由 `originalSpan` 驱动（span 切分准确；无 span 不高亮）。
- [x] M10: TEST 03 PASS - Evidence Settling 真实 Persistent DOM Identity（`before === after` 同一 HTMLElement 节点未销毁）。
- [x] M11: TEST 04 PASS - Conclusion Emergence 真实 Persistent DOM Identity（同一节点平滑浮现）。
- [x] M12: TEST 05 PASS - kugiri 0.4.0 实际运行时行为（3 lines / 25 words 真实包装且可 revert）。
- [x] M13: TEST 06 PASS - Drawer 6 大核心字段完备性呈现。
- [x] M14: TEST 07 PASS - Drawer 打开时背景容器赋予 `inert` 属性。
- [x] M15: TEST 08 PASS - Drawer Tab 键焦点闭环锁定（ActiveElement 始终留在 Drawer 内）。
- [x] M16: TEST 09 PASS - Escape 键关闭抽屉并自动恢复原触发按钮焦点。
- [x] M17: TEST 10 PASS - prefers-reduced-motion 语义完整性（动画降为 0s，文字与符号无损）。

人评项（等人裁）：

- [ ] H1: 三模式视觉对比（Editorial 文稿感 vs 连续物理交互 vs 混合原生语言）。
- [ ] H2: Evidence Settling 过程肉眼检查：DOM 对象是否保持同一身份平滑归位，有无闪烁或重绘。
- [ ] H3: Claim Trace 联动：Hover Claim 01 时原句对应 phrase 是否准确高亮且不影响排版。
- [ ] H4: Conclusion Emergence：结论是否平滑让位长出，有无突兀跳跃或营销式喧闹。
- [ ] H5: 移动端 390px 下 Source Sheet 与整体阅读流是否自然成立。
- [ ] H6: Quiet Editorial Evidence 灰度审查：去色后排版结构是否依然庄重清晰，有无依赖彩虹色底块。
- [ ] H7: PR #60 逐条 Review 回复是否严谨务实，声明是否按 Actual / Simulation / Hypothesis 清晰拆分。
