# 验收标准：[Reset 3] Golden Path 视觉语言：Card → Editorial / Document 调查重构（PR #57 复审）

日期：2026-09-06。Issue：yishu-ziyu/red-herring-and-gun#52（PR #57 阻塞项修复）。

## Change

将 Golden Path 调查页面的视觉组织从「Card 套 Card 的 SaaS Dashboard」彻底重构为「Editorial / Document-based 交互调查文稿」：

1. **减少 Surface 容器数量**：去除主内容区层层嵌套的独立白底卡片、厚圆角、阴影（box-shadow）与边框盒子；层级优先依靠 typography（字号/字重）、whitespace（垂直韵律）与细分割线（divider rule）；
2. **Conclusion（调查结论）**：不再是 floating hero card，改为正文顶部 typographic lede / 结论大标题，小标「调查结论」+ 大字号 directAnswer + 事实性元信息与边界，像深度调查报道的首段定调；
3. **Original Claim（原始说法）**：不再是独立白卡，转为调查文稿中的「原始材料引用」（quote/blockquote 语义），用左侧细边线、双引号与轻量排版呈现；
4. **Claim（命题章节）**：去除大白卡容器与卡片阴影，转为文章章节（document section）结构：双位序号（01/02）+ 命题标题 + 细分隔线；保留展开/收起能力但 header 呈文档段落态；
5. **Evidence（证据行 / Citation Rows）**：彻底消除「Claim卡 → 四色大盒 → 白色小卡」的三层嵌套；证据改为连续的行式引用列表（citation row），用小圆点（dot）、短 label、来源标题、摘要 excerpt、域名与细分隔线组织，支持整行下钻 Source Drawer；
6. **Support / Contradict / Context 语义降噪**：废除大面积绿/红/紫/灰底色块，语义区分转由轻量语义标记承担（支持 ● 绿 dot/label、反驳 ● 红 dot/label、相关材料 ○ 紫/中性、待核对 ◌ 灰），颜色仅作为语义信号而不切割页面；
7. **Evidence Gap（尚缺）与 Conflict（争点）**：
   - Gap：从独立卡片转为调查笔记式的旁注 / 批注（margin note / callout），中性/淡黄色左竖线 + 小字号说明；
   - Conflict：从 Warning 警告卡改为冷静的「争点」小节，清晰对比分歧双方与产生分歧的原因（如实区分 known / unknown）；
8. **严格控制圆角与阴影**：主内容区调查正文绝大多数元素无 shadow；同一屏不出现堆叠圆角；radius 仅保留于真正独立的交互浮层（输入框、Source Drawer、Menu、按钮）；
9. **同一画布生长体验**：保持原句在场 → 命题与证据行汇入 → 缺口/争点 → 完成态结论自然长出的一致性；
10. **移动端（390px）**：完全消除卡片堆叠（Card Stack），呈现为单列流畅交互文稿，点击证据行平滑唤出全宽下钻 Sheet；
11. **数据契约与测试完全兼容**：保留所有 `InvestigationSnapshotV1` 契约、状态机映射与测试 selector（`data-gp-*` 属性与可访问性标签完全保留）。

## Not this

- 不重写或破坏 `InvestigationSnapshotV1` 核心数据结构与 reducer 逻辑；
- 不进入 #53（最终品牌插画、完整 Motion 系统、字重字号设计 token 体系全面打磨）；
- 不做 #54 用户理解实验；
- 不改动 server 端契约与 `ops.sh`。

## Evaluator

机器项（全绿才交付）：

- [ ] M1 测试全绿：`cd mvp && npm test`（含 `goldenPath.test.tsx` 17 项全过，包含 refuted / supported / mixed / unresolved / conflict-known / conflict-unknown / investigating / interrupted / >180字 / unreachable / imageOrigin 等）；
- [ ] M2 根工作区测试与构建全绿：根 `npm test`（core 578 / eval 85 / server 21 / web 83）与 `npm run build`；`cd mvp && npm run build`；`cd mvp/server && npm run build`；
- [ ] M3 负向检查：主调查区（`.gp-canvas-inner` 内的 `.gp-original`, `.gp-hero`, `.gp-claim`, `.gp-evidence-item`, `.gp-gaps`, `.gp-conflict`）无 `box-shadow`；`.gp-evidence-space` 消除大色块背景网格；
- [ ] M4 语义标记完整性：支持（support）、反驳（contradict）、待核对（unassessed）、相关（context-only）、尚缺（gap）、争议（conflict）在 DOM 与视觉上有明确的小标/圆点/色相指示，不退化为无区分纯文本；
- [ ] M5 Selector 兼容：所有 `data-gp-phase`、`data-gp-claim-id`、`data-gp-role`、`data-gp-conflict-id`、`data-gp-interrupted`、`data-gp-judgment` 及 aria 属性完全保持，保证原有与新增断言均可通过。

人评项（等人裁，附真实端到端/fixture 运行截图）：

- [ ] H1 Box Test：数出主调查正文的圆角矩形盒子数量；不再呈现卡片套卡片套卡片的 Dashboard 观感；
- [ ] H2 Grayscale Test：页面在黑白模式下仍能单凭字阶、字重、编号、缩进与细分割线清晰辨识层次（结论 → 原始说法 → 命题章节 → 证据行 → 批注）；
- [ ] H3 Article Test：去除非核心 Chrome 后，整体呈现为一篇现代深度调查稿，而非 SaaS 管理看板；
- [ ] H4 必须提供的最新截图（存入 `docs/design/2026-09-06-golden-path/`）：
  - 1. Desktop investigating（调查态：命题出现，证据行汇入待核对）
  - 2. Desktop real complete（真实端到端完成态：directAnswer 大标题 + 证据行）
  - 3. Desktop conflict + gap（争点与尚缺批注）
  - 4. Mobile complete（390px 移动端完整文稿流）
  - 5. Source Drawer（若视觉有优化同步附图）
- [ ] H5 PR #57 描述追加 `### Card → Editorial revision` 详细改动说明与对比。
