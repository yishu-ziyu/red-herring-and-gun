# 开发日志

## 2026-08-14

### 首轮真实用户评测（eval）与修复

**触发**：对本地 dev server 用 3 个真实用户画像 + 内置浏览器做了首轮真实使用评测（eval skill）。

#### 发现的问题

产品拆解与检索能力正常，但所有 case 卡在最后一步「整理结论」——因全部 5 个 LLM provider（MiniMax / StepFun / DeepSeek / 360 / MiMo / codex）余额或配额耗尽，用户等 3-5 分钟后只看到「核查中断」，**一无所得**。

3 个用户画像：
- 周桂芳（47，小超市主）：查「鸡蛋豆浆相克」→ 等了 5 分 25 秒 → 中断
- 林一鸣（29，核查编辑）：查「某公司取消年终奖」→ 卡在检索 90 秒 → 放弃
- 苏航（34，产品岗）：查「房屋养老金」→ 两轮各 3-4 分钟 → 中断

#### 已修复（2 处，+31 行）

1. `src/lib/agentConfigs.ts` — `report_composer` 加入 `CONTINUE_AFTER_FAILURE_AGENTS`，失败时降级而非整轮抛错
2. `src/lib/agentRuntime/AgentRuntime.ts` — `buildAgentFailureOutput` 增加 report_composer 分支：输出诚实降级报告（`verdictType: "unverified"` →「还查不清」、保留已检索来源）

**复验结果**：新人物罗建国（科普写作者）完整走完 DAG，最终页显示「还查不清 / 未能判断（30/100）」+ 8 条可点开来源，不再空手中断。

#### 待修复（需你处理）

**🏁 高优先级 — 模型 provider 恢复**
- MiniMax M3：无返回文本（疑似 key 异常或账户态）
- StepFun：`You exceeded your current quota`（超额度）
- DeepSeek：`Insufficient Balance`（余额不足）
- 360 智脑：`余额不足`
- MiMo：`Invalid API Key`
- codex gpt-5.5：超时 90s

这些在 `mvp/.env.local` 里配置。修复后重启 dev server。

#### 复验 Checklist（修复后找我）

1. 用「隔夜菜会致癌，等于吃毒药」提交一次完整核查，确认能拿到最终结论（能信/不能信/只能信一部分）+ 来源
2. 用「国家要收房屋养老金，每月从工资里扣」带链接提交，确认结论有来源可点开
3. 观察结果页：结论文案、来源编号、证据链、核查足迹各段是否正常
4. 观察过程页：双栏工作台（左过程/右结果）在核查中途是否正常

完整 eval 留痕：`~/.mirasim/eval/sessions/260814-1206-redherring/`（traces / evidence / feedback.md / 处置账）

#### 续修（F-01-timing / F-03 / F-04）

- 落地页 `GET /api/models/health`：轻量探测，人话提示模型服务不可用/不确定，不暴露 provider；探测失败不假装可用。
- 全挂时尽快收束：进程 skip map、同一次调用连续 hard fail 跳过 Codex 90s；`report_composer` 在前序已 error-boundary 时不再空转 LLM。
- 检索/对照超过约 1 分钟无新步骤时给白话说明；可恢复失败不再用「底层模型服务未能完成调用」盖过已有降级结论。
- 复验：5175 落地页可见 unknown 预警；5176 对「微波炉加热食物会致癌」orchestrate-stream 3.4s 落到「未能判断」并保留检索来源，不再空手中断。

---

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
