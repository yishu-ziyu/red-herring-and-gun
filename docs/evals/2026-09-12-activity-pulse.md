# 调查中语义脉冲：活动流行着色 + 思考链步骤微光

Date: 2026-09-12
来源：用户分享 Jeet（@jeetnirnejak）的「日志追踪」设计（流式日志 + 级别过滤 + 暂停 + 新行淡色背景一秒内淡出、按事件类型着色脉冲），要求思考如何用于产品。子 Agent 分析定位其契合产品宪法「调查逻辑默认可见并渐进呈现」（docs/PRODUCT_SPEC.md:49），用户裁决要加。预览方式：`http://127.0.0.1:5211/?fixture=first-beat` 自动播放全流程。

## Change

- **活动流语义脉冲**（`apps/src/goldenPath/ActivityFeed.tsx` + `golden-path.css`）：调查中活动新行到达时，整行带 14% 透明度的语义色背景脉冲，1 秒内淡出退回纸面色。着色规则：`conflict_detected`/`gap_identified` → 琥珀（--gp-semantic-conflict）；`source_checked` 按材料角色 support/contradict → 绿/红；`evidence_assessed`/`judgment_revised` → 绛红（--gp-accent）；其余（拆题/检索）→ 中性墨色。存量行（首次挂载）不脉冲，只有调查进行中到达的行闪。
- **思考链步骤微光**（`apps/src/goldenPath/ThinkingDisclosure.tsx` + `golden-path.css`）：思考步骤 01→02→03 解锁时，刚解锁的步骤编号格从品牌浅红淡回中性灰底，0.85s 一次不重复。
- reduced-motion 由 `golden-path.css` 既有全局块兜底（3100 行起，全部动画压平）。

## Not this

- 不做日志级别过滤 chips（All/Info/Warn/Error 是系统层概念，产品层已有角色徽标分层）。
- 不做点击行复制（单条检索记录脱离上下文易被误当证据结论，伤可审计性）。
- 不引入灰/琥珀/玫瑰字面配色（映射到 --gp-semantic-* 既有语义色）。
- 不做全行持续着色（违反「语义色绝不主导大面积卡片」）。

## Evaluator

1. `cd apps && npx vitest run src/goldenPath/` 162 全绿。【命令】
2. `cd apps && npm test` 1306 过 / 1 跳过；`npm run build` 零错误；根目录 `npm test` + `npm run build` 全绿。【命令】
3. `?fixture=first-beat` 走查：0.5s/1.2s 思考步骤微光各闪一次；4s/6.8s 活动新行按语义色脉冲并 1s 内退回纸面色；刷新重看可复现。【命令（浏览器走查）+ 人评】
4. 脉冲强度与着色映射（14% 透明度、作判断=绛红）由用户人评。【人评】
