# 验收标准：完成态结果页第一视觉稿（P0 + P1）

日期：2026-09-10。范围：Golden Path 完成态结果页，只做 P0（首屏判断层级）与 P1（命题↔证据摘录绑定）。

## Change

完成态调查读起来像一份可点击的调查备忘录，而不是分区报告。

1. **P0 首屏**：`ConclusionHero` 的 `directAnswer` 用文书层衬线、字重 700、约 `clamp(19px, 2.2vw, 24px)`、墨色正文；判断色只做细线/淡底，不对整句铺色。判断词、命题/来源条数、完成时间是答案下方的弱 metadata。原句气泡紧贴英雄区。边界说明保持次要。
2. **P1 证据行**：每条证据行左侧固定写出关系（支持 / 反驳 / 相关 / 待核对，文字+符号，不只靠颜色）。快照里已有 `excerpt` 时默认展示短摘录；没有就不编造、不留空摘录壳。整行仍是打开 `SourceDrawer` 的主命中目标。抽屉在有摘录时把摘录当作强调位。
3. 阅读顺序保持：直接回答 → 原句气泡 → 命题 → 证据关系 → 来源抽屉。

## Not this

- 不做 P2：争议双方并排对照卡。
- 不改首页、不换整套设计系统、不改 Snapshot schema、不部署生产。
- 不把 Card Stack / Bento / Dashboard / Mission Control / Agent 阶段 / 工具日志带回用户面。
- 不用「能信 / 不能信 / 还查不清」当结论第一句。
- 不发明摘录或出处。

## Evaluator

机器项（全绿才交付）：

- [x] M1 `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx` 全绿（含本期 P0/P1 新增断言）。101 项通过。
- [x] M2 完成态 fixture：`[data-gp-direct-answer]` 是结论区第一可见正文；`.gp-hero-answer` 的 CSS 含 `var(--gp-serif)` 与 `clamp(19px, 2.2vw, 24px)`；judgment 节点不是 `.gp-chip`。
- [x] M3 有 `excerpt` 的来源：证据行出现 `.gp-evidence-excerpt`，文本等于快照字段，不另写句子。无 `excerpt` 时不渲染摘录节点。
- [x] M4 每条 `.gp-evidence-item` 有左侧关系标签（文字属于 支持/反驳/相关/待核对，并带 glyph）；整行 `button` 仍打开 SourceDrawer。
- [x] M5 SourceDrawer 在有摘录时渲染 `[data-gp-source-section="excerpt"]`，且该块带强调样式类；无摘录时整节不出现。
- [x] M6 `mvp/src/goldenPath/` 用户面文案扫描仍无 Agent / provider / tool / pipeline 实现层词汇（沿用既有负向扫描）。
- [x] M7 行为未改后端：不改 `packages/core` Snapshot schema，不改 `ops.sh`，不删 `mvp/`。

人评项（单独列出，等人裁）：

- [ ] H1 完成态第一屏：眼睛先落到直接回答，而不是判断徽章或分区标题。
- [ ] H2 证据行读作「关系 + 标题 + 摘录 + 域名」，不像光秃链接清单。
- [ ] H3 390px 手机：证据行可点面积够大，没有 CJK 上标引用芯片。
- [ ] H4 P2 并排冲突卡明显未做。
