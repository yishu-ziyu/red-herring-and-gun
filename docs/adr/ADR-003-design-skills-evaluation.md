# ADR-003: Frontend Design Skills Evaluation

## 日期

2026-07-10

## 状态

已评估 — 建议采用动画决策框架

## 背景

红鲱鱼与枪前端使用 GSAP + 自定义 CSS，有 DESIGN.md 设计系统。评估两个设计 skill 仓库的可集成性。

## 调研

### Taste-Skill (Leonxlnx)

**仓库**: https://github.com/Leonxlnx/taste-skill

**核心机制**: 三旋钮 — DESIGN_VARIANCE (1-10), MOTION_INTENSITY (1-10), VISUAL_DENSITY (1-10)
- 根据页面类型和 vibe 词自动推断旋钮值
- 每个 skill (taste-skill, minimalist, soft-skill, brutalist-skill, brandkit) 是基于旋钮值的规则集
- 有 anti-default discipline：禁止 AI-purple gradients、Inter + slate-900、three equal feature cards 等

**对我们前端的适用性**:
- 三旋钮机制可以映射到我们的 DESIGN.md 设计令牌
- anti-default discipline 和我们的 editorial/serif 审美一致
- 具体 skill（minimalist-skill、soft-skill）对 Mission Control 面板有用
- brandkit skill 对 logo 和品牌色管理有用

**不适用部分**:
- 大部分 skill 针对 landing page / portfolio，不是 dashboard
- image-to-code-skill 和 imagegen 系列对我们无价值

### Emil Kowalski Skills

**仓库**: https://github.com/emilkowalski/skills

**核心机制**:
- emil-design-eng: 动画决策框架（frequency-based）、组件设计规则、before/after review table 格式
- apple-design: Apple WWDC 设计原则蒸馏
- review-animations: 严格动画审查
- animation-vocabulary: 动画术语词典

**对我们前端的适用性**:
- 动画决策框架直接适用：100+/day → no animation, tens/day → minimal, occasional → standard, rare → delight
- Mission Control 的加载/错误/成功状态属于 occasional，可以用 standard animation
- GSAP transition 规则：ease-out for enter, ease-in for exit, 不用 `transition: all`
- before/after review table 格式可以直接用于代码审查
- Apple design 原则（depth, blur, motion）和我们的 cinema motion 方向一致

## 评估结论

| 维度 | 评估结果 | 说明 |
|------|---------|------|
| Taste-Skill 三旋钮 | GO | 映射到 DESIGN.md 设计令牌 |
| Anti-slop 规则 | GO | 和 editorial/serif 审美一致 |
| Emil 动画框架 | GO | 直接改善 GSAP 动画质量 |
| Emil review 格式 | GO | 可用于代码审查标准 |
| Apple 设计原则 | PARTIAL | 和我们的 cinema motion 方向一致，但需要适配 dashboard 场景 |
| 集成成本 | LOW | 主要是规则学习和应用，无代码改动 |

## 决策

**采用**：
- 把 emil-design-eng 的动画决策框架写入我们的 code review checklist
- 把 taste-skill 的 anti-default discipline 规则写入 DESIGN.md
- Mission Control 动画按 emil 框架重新评估（frequency-based）

**不采用**：
- 不采用完整的 taste-skill 三旋钮系统（太针对 landing page）
- 不采用 image-to-code 和 imagegen skills（对我们无价值）

## 面试叙事

"我们评估了两个前端设计 skill 仓库。Taste-Skill 的三旋钮系统和 anti-slop 规则与我们的 editorial 审美一致，但主要针对 landing page。Emil Kowalski 的动画决策框架直接适用：他的 frequency-based 规则（100+/day → no animation, occasional → standard）让我们重新审视 Mission Control 的动画策略。我们决定把他的规则写入 code review checklist，把 anti-slop 规则写入设计系统。"
