# 红鲱鱼与枪 — 信息真相猎人

AI 驱动的谣言核查 Agent。用户提交一条疑似谣言或信息，系统经过多 Agent 协作核查后，输出可信度评分和证据链。

## 核查流程

```
用户输入 → RumorDetector → 360 Search → FactChecker ∥ SourceValidator → Debate → ReportComposer → 输出
```

**四个 Agent 各司其职：**

| Agent | 职责 | 输出 |
|-------|------|------|
| RumorDetector | 检测谣言特征（绝对化表述、匿名信源、情绪煽动等 8 类模式） | severity + rumorIndicators |
| FactChecker | 事实核查：核心事实是否成立 | factCheckResult + confidence |
| SourceValidator | 验证信源可靠性与可追溯性 | sourceReliability + verifiedSources |
| ReportComposer | 综合前三者 + 搜索结果，生成核查报告 | verdict + credibilityScore |

FactChecker 和 SourceValidator 并行执行。若两者输出存在冲突，系统自动进入 Debate 调解环节。

## 可信度评分机制

`credibilityScore`（0-100）由**确定性公式**计算，不依赖 LLM 估算。

### 公式结构

```
score = 5 个分量的加权聚合 → log₂ 收敛 → 归一化 → 惩罚修正 → 门控裁剪
```

**五个分量：**

| 分量 | 来源 | 作用 | 映射方式 |
|------|------|------|---------|
| A. 事实核查信号 | FactChecker | 核心判断 | true→+0.9, false→-0.9, partial→+0.2, unverified→0，再乘 confidence 系数 |
| B. 搜索证据信号 | 360 Search | 外部验证 | 每条来源：credibility × direction，取 mean 后用 tanh 压缩 |
| C. 信源可靠性 | SourceValidator | 信心调节 | high→+0.9, medium→+0.5, low→-0.4, unverified→0 |
| D. 谣言严重度惩罚 | RumorDetector | 降低可信度 | high→-0.7, medium→-0.4, low→-0.2，乘法惩罚 |
| E. 缺失来源惩罚 | SourceValidator | 证据缺口 | 每条 missingSource -0.05，封顶 -0.15，加法惩罚 |

**聚合规则（借鉴 MAFC 论文，Scientific Reports 2026）：**

- 同方向信号用 `log₂(N+1)` 收敛——增加共识者有一定效果，但不会线性膨胀
- 反向信号各自独立计算，互不抵消
- `unverified` 映射到 0（中性），与 `false` 的 -0.9 方向明确区分

**门控规则：**

- factCheckResult = "unverified" 且无 verifiedSources → 分数封顶 50 分

**分档标签：**

| 分数 | 标签 |
|------|------|
| 80-100 | 高度可信 |
| 60-79 | 基本可信 |
| 40-59 | 存疑 |
| 20-39 | 低可信 |
| 0-19 | 高度可疑 |

### 为什么不用 LLM 直接打分

| 维度 | 公式 | LLM 估算 |
|------|------|----------|
| 可复现 | 相同输入永远同输出 | 温度/提示微变结果即变 |
| 可解释 | 每个分量可追踪 | 黑盒 |
| 区分"查不到"和"查到矛盾" | 显式建模 | 不稳定 |
| 成本 | 零 API 费用 | 秒级 + 费用 |

LLM 仍负责证据理解、分类判断和自然语言解释；公式负责最终分数合成。

## 技术栈

- 前端：React + Vite + TypeScript
- 后端：Express + TypeScript（Vite 中间件代理）
- LLM：DeepSeek / MiMo / StepFun / 360 / Anthropic Proxy / Codex CLI（链式 fallback）
- 搜索：360 AI Search + AnySearch + Metaso + Tavily + Exa（并行聚合）

## 项目结构

```
mvp/
├── server/src/
│   ├── handlers.ts          # API 路由 + Agent 编排
│   ├── lib/
│   │   ├── agentConfigs.ts  # 4 个 Agent 的 system prompt + schema
│   │   ├── agentProviders.ts # 6 个 LLM provider 调用封装
│   │   ├── providerRouter.ts # 链式 fallback 调度器
│   │   ├── credibilityScore.ts # 可信度评分公式
│   │   └── sherlockStyleSearch.ts # 多平台搜索聚合
│   └── dist/                # 编译产物
└── src/
    └── components/v3/       # 前端组件（Canvas + Agent Trace + Dashboard）
```
