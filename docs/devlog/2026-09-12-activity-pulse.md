# 调查中语义脉冲：活动流行着色 + 思考链步骤微光

Date: 2026-09-12
契约：`docs/evals/2026-09-12-activity-pulse.md`

## 起因

用户分享 Jeet（@jeetnirnejak）的「日志追踪」设计截图：流式日志、级别过滤、暂停按钮、新行淡色背景一秒内淡出、按事件类型（信息=灰/警告=琥珀/错误=玫瑰）着色脉冲。派子 Agent 分析其与我们产品哲学的契合点，结论：主契合产品宪法「调查逻辑默认可见并渐进呈现」（docs/PRODUCT_SPEC.md:49），次契合「复杂调查，简单理解」（同文件 :26）；明确不是 Agent Observability（:24 白盒 ≠ 展示执行日志）。排除项：日志级别过滤、点击行复制、字面三色、持续着色。用户看过真实页面预览（`?fixture=first-beat`）后裁决：加。

## 做了什么

- `ActivityFeed.tsx`：`mountedRef` 区分首次挂载与进行中到达，只有新到达活动进 `freshIds`（1.1s 后移除）；行内联 `--gp-pulse` 由 `pulseColorFor(kind, payload.role)` 决定（conflict/gap=琥珀、source_checked 按 support/contradict=绿/红、assessed/revised=绛红、其余=中性墨）。
- `ThinkingDisclosure.tsx`：`prevStepRef` 检测步骤前进，`freshStep` 状态驱动刚解锁步骤编号的一次微光（0.9s 后清除）。
- `golden-path.css`：`gp-activity-pulse`（color-mix 14% 透明度 → 透明，1s forwards）与 `gp-step-glow`（accent-subtle → 灰底，0.85s forwards）；reduced-motion 由既有全局块（3100 行起）压平，未新增媒体查询。

## 验证

goldenPath 162 全绿；apps 1306 过 / 1 跳过；root 83 全绿；双 build 零错误。浏览器走查：活动流分歧行琥珀脉冲可见并按时退回；思考步骤微光在 0.5s/1.2s 各出现一次。
