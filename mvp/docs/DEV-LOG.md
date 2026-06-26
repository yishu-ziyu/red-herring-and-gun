# 开发日志

## 2026-06-27

### 严格审查修复（14 项 findings）

**Commit**: `c153b67` — 19 files changed, +1089/-409

修复上一轮严格审查遗留的 5 个 P2 + 9 个 P3 findings：

#### P2 级修复

| Finding | 文件 | 修复内容 |
|---|---|---|
| P2-1 | `server/src/handlers.ts` | search direction 硬编码 "support" → `classifySearchDirection` 按 contradictingEvidence URL 交叉匹配 + 文本启发式分类 |
| P2-2 | `server/src/handlers.ts` | fallback 评分路径绕过公式 → `buildDeterministicFinalReport` 改调 `computeFormulaScore` + `labelForScore` |
| P2-4/5 | `src/lib/agentRuntime/memoryStore.ts` + `memoryCandidateStore.ts` | memoryStore 竞态 → 改 append-only JSONL，readAll 按 id 取最新 |
| P2-8 | `src/lib/schemas.ts` + `server/src/lib/schemas.ts` + `src/lib/evidenceQuality.ts` | evidenceQuality publishedAt → CandidateMaterial 加 `publishedAt?: number`，`scoreFreshnessFromTimestamp(publishedAt)` |

#### P3 级修复

| Finding | 文件 | 修复内容 |
|---|---|---|
| P3-1/2 | `server/src/lib/anthropicParse.ts`（新建） | 公式覆盖块复制 + extractAnthropicText 四处副本 drift → 抽取共享模块，4 处副本改 import+export |
| P3-3 | `server/src/lib/aipingAuth.ts` | timingSafeEqual 等长空 Buffer |
| P3-4 | `src/lib/linkScraper.ts` | 移除 3 处 `window.` 前缀 |
| P3-5 | `src/lib/evidenceConsensus.ts` | criteria4 逻辑修正 |
| P3-6 | `src/components/v3/phases/mission/DetectiveClueNetwork.tsx` | useEffect 同步 claim |
| P3-7 | `src/components/v3/ConsensusProgressPanel.tsx` | useEffect 同步 expanded |
| P3-8 | `src/components/v3/EvidenceMatrix.tsx` | isExpired 占位 false + TODO |
| P3-9 | `src/components/v3/settings/ModelProviderSettingsPreview.tsx` | 标签"推荐接入"→"接入状态" |

#### 测试修复（pre-existing，非本轮回归）

- `src/test/setup.ts`：加 localStorage polyfill（jsdom 环境下 window.localStorage undefined）
- `server/src/lib/providerRouter.test.ts`：B3 加 `vi.stubEnv` 清空 `process.env.STEPFUN_API_KEY`

#### 验证结果

- 后端 tsc ✅
- 前端 tsc + vite build ✅（442 modules）
- npm test 全绿 66/66 passed

---

### 部署与配置优化

**Commit**: `ed7c38e` — 8 files changed

- `Dockerfile`：改多阶段构建，在容器内编译 server，不再依赖本地预编译 `server/dist`
- `deploy.sh`：删掉本地 `tsc` + sed 补丁，直接打包源码到服务器
- `docker-compose.yml`：healthcheck 路径从 `/` 改为 `/health`
- `setup-server.sh`：小调整
- `index.html`：标题/meta 更新
- `public/logo.png`：换新 logo（压缩至 207KB）
- `.env.local.example`：新增 MiniMax、StepFun 3.7、爱拼 OAuth、provider 顺序等环境变量
- `deploy-to-aliyun.sh`：阿里云部署脚本更新

---

### 爱拼 OAuth + MiniMax + StepFun 3.7 服务端适配

**Commit**: `120affc` — 7 files changed

- `server/src/index.ts`：新增爱拼 OAuth2 登录/回调/session 路由 + `/mcp` HTTP handler
- `server/src/lib/availableModels.ts`：接入 MiniMax（双 key 兼容），移除硬编码默认模型
- `server/src/lib/availableModels.test.ts`：MiniMax 相关测试
- `server/src/lib/sourceCondenser.ts`：加调用超时保护（withTimeout + getTimeoutMs）
- `server/src/lib/sherlockStyleSearch.ts`：小调整
- `server/tsconfig.json`：配置调整
- `src/lib/agentRuntime/agentProviders.ts`：StepFun 3.7 reasoning 模型不发 response_format/temperature/reasoning_effort（会触发 400）

---

### 前端确定性报告兜底、爱拼账户栏、样式与测试

**Commit**: `051a5ee` — 11 files changed

- `Dashboard.tsx`：新增爱拼登录状态/点数显示账户栏
- `MissionControlView.tsx`：新增确定性报告兜底展示、运行状态文案、耗时格式化
- `ReasoningWorkspaceV3.tsx`：修复 stream 未结束卸载导致的 isExpanding 卡住（P1-2）
- `AgentPanel.tsx`：依赖数组补 `sherlockSearchRuns`
- `styles.css`：新增 landing-account-bar、mission-run-status 等样式
- `AgentRuntime.ts`：error-boundary 路径标记为 failed（P2-7）
- `reportExporter.ts`：localStorage 写入加 try-catch 防崩溃（P2-9）
- `App.test.tsx`：新增确定性报告兜底 UI 测试
- `vite.config.ts`：接入 `buildStepFunRequestBody`，前端直连 StepFun 时兼容 3.7
- `vitest.config.ts`：setup 文件路径调整
- `tasks/todo.md`：任务清单更新

---

### 遗留事项

- `src/lib/claimDecomposer.ts:17`：预存在的 MVP demo 占位 TODO（"接入真实 LLM 进行智能分解"），不阻塞 demo
- 工作区 untracked 文件：`.ship/` 审查记录、`docs/`、截图、`findings.md` 等文档和过程产物，不在代码版本控制范围内
