# 红鲱鱼与枪 — 项目接入指南

## 一句话描述
AI 驱动的谣言核查与事实追踪系统，采用多 Agent Handoff 架构（RumorDetector → FactChecker/SourceValidator → ReportComposer）。

---

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | React 19 + TypeScript + Vite |
| 状态管理 | React Context + useReducer（reasoningStore.tsx） |
| 画布可视化 | @xyflow/react |
| 后端 | Vite Dev Server Middleware（vite.config.ts） |
| 部署 | Vercel（前端）+ 阿里云 Docker + Nginx + SSL |
| 域名 | https://gun.yishuziyu.cn |

---

## 项目目录结构

```
mvp/
├── src/
│   ├── components/v3/           # 主界面组件
│   │   ├── Dashboard.tsx        # 首页（输入 + 案例选择）
│   │   ├── ReasoningWorkspaceV3.tsx  # 分析工作区
│   │   ├── ReasoningCanvasV3.tsx     # 画布可视化
│   │   └── panels/              # 侧边面板
│   ├── lib/
│   │   ├── agentConfigs.ts      # Agent 配置（systemPrompt + schema）
│   │   ├── agentExpansion.ts    # API 客户端（前端调用后端）
│   │   ├── confidenceEngine.ts  # FIRE 置信度评估引擎
│   │   ├── knowledgeBase.ts     # LocalStorage 知识库
│   │   ├── search360.ts         # 360 AI Search 客户端
│   │   └── schemas.ts           # TypeScript 类型定义
│   ├── store/reasoningStore.tsx # 全局状态管理
│   └── data/rumorCases/         # 6 类谣言案例数据
├── vite.config.ts               # 后端 API Handlers + LLM 调用
├── Dockerfile                   # Docker 部署
├── nginx.conf                   # Nginx 反向代理配置
└── .env.local                   # API Keys（不提交 git）
```

---

## 核心架构

### 多 Agent Handoff 流程

```
用户输入 claim
  → RumorDetector（串行）
    → 360 Search（并行）
      → FactChecker（并行）
      → SourceValidator（并行）
        → ReportComposer（串行）
          → 返回完整 trace + 最终报告
```

### Provider 回退链

每个 Agent 调用使用 `callAgentWithFallback`，按以下顺序尝试：

1. StepFun（国产模型优先）
2. 360 智脑
3. MiMo Token Plan（多集群回退：CN → SGP → AMS）
4. MiniMax
5. DeepSeek
6. Anthropic Proxy
7. Codex CLI（本地）

### API Endpoints（后端）

| 端点 | 功能 |
|---|---|
| `POST /api/agent/expand` | 单 Agent 扩展 |
| `POST /api/agent/recursive-search` | 递归搜索 |
| `POST /api/agent/sherlock-search` | Sherlock 搜索 |
| `POST /api/search/360` | 360 AI Search |
| `POST /api/agent/orchestrate` | 多 Agent 编排（非流式） |
| `POST /api/agent/orchestrate-stream` | 多 Agent 编排（SSE 流式） |

---

## 环境变量（.env.local）

```bash
# 360 AI Search
SEARCH360_API_KEY=xxx
SEARCH360_MODEL=360gpt-pro

# StepFun
STEPFUN_API_KEY=xxx
STEPFUN_MODEL=step-3.7-flash

# DeepSeek
DEEPSEEK_API_KEY=xxx
DEEPSEEK_MODEL=deepseek-chat

# MiMo
MIMO_API_KEY=xxx
MIMO_MODEL=mimo-v2.5-pro

# MiniMax
MINIMAX_API_KEY=xxx
MINIMAX_MODEL=MiniMax-M2.7

# Anthropic (Kimi Code)
ANTHROPIC_API_KEY=xxx
ANTHROPIC_BASE_URL=https://api.kimi.com/coding
```

---

## 关键开发规范

1. **API 调用**：前端使用 `API_BASE` 环境变量（`import.meta.env.VITE_API_BASE`），本地为空字符串（相对路径），生产环境指向云服务器
2. **Agent Prompt**：修改 `src/lib/agentConfigs.ts` 中的 `systemPrompt`
3. **Schema 约束**：Agent 输出必须匹配 JSON Schema（在 agentConfigs.ts 中定义）
4. **FIRE 评估**：5 维置信度（来源可靠性/证据完整度/逻辑一致性/信息时效性/权威匹配度）
5. **知识库**：LocalStorage 存储，自动提取证据和搜索策略

---

## 部署架构

```
用户
  → https://gun.yishuziyu.cn
    → Nginx (443) + Let's Encrypt SSL
      → /api/* → Docker localhost:3000（Vite preview + handlers）
      → /* → dist/ 静态文件（React SPA）
```

**服务器**：阿里云 121.89.90.68（Alibaba Cloud Linux 3）
**Docker**：自动重启，环境变量从 .env.local 注入
**SSL**：Let's Encrypt，自动续期

---

## 常用操作

```bash
# 本地开发
npm run dev

# 构建
npm run build

# 部署到 Vercel（前端）
npx vercel --prod

# 服务器部署（API）
scp .env.local root@121.89.90.68:/opt/red-herring/
ssh root@121.89.90.68 "cd /opt/red-herring && docker compose up -d --build"

# 查看服务器日志
ssh root@121.89.90.68 "docker logs -f red-herring-api"
```

---

## 当前已知问题

1. **DNS 劫持**：某些网络环境下 dig 返回 198.18.0.224（本地保留地址），实际全球 DNS 正确
2. **LLM 调用延迟**：多 Agent 串行调用约 15-30 秒，需优化为并行或流式
3. **KnowledgeBase**：当前用 LocalStorage，生产环境应迁移到数据库

---

## 下一步可开发方向

- 移动端适配
- 批量核查（多个 claim 并行）
- 报告导出（PDF/Markdown）
- 证据图谱交互（节点可点击/拖拽）
- API 限流和日志记录
- 知识库迁移到 MongoDB/PostgreSQL
