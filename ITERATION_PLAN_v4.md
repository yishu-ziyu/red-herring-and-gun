# v4 — UI / 动效重做

## 用户决策
- 动效风格: 叙事 / 电影感
- 设计调性: 杂志质感 (出版级排版)
- 范围: 全产品总升级
- 架构: 抽取 design tokens

## 已经完成 (在 main 上,已部署 gun.yishuziyu.cn)
- Design tokens 抽取: 8 档动效 / 6 条缓动 / 8 档排版 / 4 级深度 / 5 组渐变
- Cinema motion library: 8 个 keyframes + 工具类 + stagger
- 重做组件: Dashboard, ConclusionDockV3, LoginView, PrivacyPolicy, InferenceLicensePanel, ReasoningTracePanel, AgentStatusDot
- 自定义滚动条 + 字体平滑 + 数字衬线变体

## 本轮目标 (yishuship 流程)
- 补齐 pm_intake → design → e2e → review → qa → refactor → handoff 文档
- 不重复实现; 流程是文档化 + 验收
