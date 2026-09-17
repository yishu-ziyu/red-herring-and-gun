# 审查看板首批修复：P0-P3

Date: 2026-09-12
契约：`docs/evals/2026-09-12-audit-fixes-p0-p3.md`；活看板：`docs/reports/2026-09-12-page-audit/review-board.html`

## 起因

整页美学审查（截图 + Notion 设计标尺）产出 P0–P5 六问题。用户在审查看板上批准本批四项：P0（折叠）、P1（断行）、P2（案卷堆叠）、P3 采纳推荐方案 A（域名行内引用）；P4/P5 留待裁决。

## 做了什么

- **P0**（ConclusionHero.tsx）：`sourcesExpanded` 初始值改为按视口判定——`(max-width: 768px)` 匹配时默认折叠；桌面与测试（matchMedia 缺省桌面语义）保持展开。
- **P1**（ConclusionHero.tsx + golden-path.css）：新增 `answerBreakSegments`（按中文标点与「」拆段，分隔符留前段）与 `isShortSegment`（去标点引号空白后 ≤12 实义字则锁行），断言渲染为段 span；CSS `.gp-hero-answer .is-nowrap { white-space: nowrap }`；移动端 `.gp-hero` 内边距 20px。长段（>12 字）不锁，防溢出兜底。
- **P2**（golden-path.css）：≤600px 下 `.gp-dossier-header` 改 column 堆叠，`.gp-dossier-toggle` 右置。
- **P3**（EvidenceItem.tsx + golden-path.css）：新增 `DomainCite` 组件（「— domain ↗」灰字引用行）；有摘录时域名移出 header、跟在摘录 blockquote 之后；无摘录时仍在标题后兜底；删除完成态把域名放大到 14px 的覆盖规则，全部回到 11.5px 灰字。

## 验证

- `answerBreakSegments.test.ts` 新增 6 断言（拆段/锁段/长段放行）；goldenPath 168 全绿。
- 全量门禁：apps 1307 过 / 1 跳过，root 83 全绿，双 build 零错误。
- Playwright 双端断言（scripts/qa/capture_audit_fixes.py）：移动端来源条折叠、断言 4 个锁行短段、案卷 header flexDirection=column、5 条引用行域名、header 内域名 0；桌面端来源条保持展开、引用行域名存在。截图存看板目录（fixed-*.png）。

## 人评待裁

P0 折叠触发器观感、P1 拆段后的换行位置、P3 引用行样式——用户在真实页面过目；P4/P5 未动。
