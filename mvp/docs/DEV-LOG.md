# 开发日志

## 2026-08-19

### 输出语言：检索是工具，用户只看判断和出处

对照 [工具使用](https://adp.xindoo.xyz/chapters/Chapter%205_%20Tool%20Use/)：不把 function calling 给用户看。写报告只许能信/不能信/只能信一部分/还查不清，禁止工具名、Agent 名、先别转发。`publicCopy` 在 assemble 和 reviewer 出口再剥一遍。

### 21 章施工落地 + 合龙

规范：`docs/reviews/agentic-patterns/specs/`，验收：`specs/done/`。
生产上已改：类型闸强制可核查、问法三类、检索复用、失败不得写不能信、结果页写入知识库、无网址不得真/假、整句守门、按负荷选 6 条、eval 三类错。

合龙修了用户看得见的洞：结果页原先只读 `subclaimVerdicts`，第 7 条和立场条会丢；现在读 `claimItems`。`split`/`merge` 展示上限 6→12，检索仍 6。无出处整句不得写成能信。本地 Vite 的核查接口改挂 Case Pipeline，和 Express 生产同一条路。

说明书已追上：`docs/PRODUCT_SPEC.md` 第四节、第七节；`CONTEXT.md` type gate。

### 《Agentic Design Patterns》21 章对照（只审不改代码）

书仓：`vendor/agentic-design-patterns`（gitignored）。
21 个审查员各写一章：`docs/reviews/agentic-patterns/ch-01.md` … `ch-21.md`。
总表：`docs/reviews/agentic-patterns/INDEX.md`。

均分 4.2/5。14 章用我们的形状完成了该章目的。7 章 partial。没有一章要按书补自治 Agent。

建议动手顺序（存在条件）：eval 三类错 → 无网址不得真/假 → 类型闸复核 → 检索预算按负荷选 6 条。P2 / 问法复用 / 记忆确认按钮往后。

### 拆题类型闸：同一模型换工单，不是更强分类器（创始人不满，先记清）

**触发**：对照 *Agentic Design Patterns* 第 2 章「路由 / 意图识别」讲项目时，创始人连续问：价值句 / 事实句 / 因果句 / 预测句 / 查不清 **到底谁来判断**？是不是更强的模型？并纠正内部把「立场型」说成「灰」——压缩表达造成歧义。有这个困惑 = 对这一块不满意。先写进说明书和本日志，未拍板不改管线。

**事实（代码与本机配置）**

- 拆题、核查、写报告，开发默认都是 **MiniMax-M3**（`MINIMAX_MODEL=MiniMax-M3`，备用链首位 minimax）。不是 Mimic。
- 没有单独的更强分类模型。同一模型多次调用，每次一张工单：
  - RumorDetector：只许写 `type` + `verifiable`，不许写能信/不能信
  - 自证：只问原句有没有说过这条，不问类型
  - FactChecker：只许对着检索来源写 true/false/partial/unverified，不许重新分类
  - ReportComposer：只许根据前序 JSON 写能信/不能信
- 代码读 `verifiable === false` → 不检索。报告该条徽章「立场型」，说明「不适用真/假判断」。
- 「还查不清」是核查之后的状态，不是拆题标的。证据两边打架才换 StepFun `step-3.7-flash` 二审。

**不满点（开放）**

1. 类型闸在产品里不可见，连创始人都要猜是不是更强模型。
2. 证据冲突有第二意见，类型标签没有。MiniMax-M3 把能核对的流传说法标成立场，系统不去查。
3. 模型挂掉会 fail-open（整句当可核查继续搜）；模型自信标错反而跳过检索。两种失败不对称。
4. 对内说「灰」是 CSS，不是用户看见的话。以后对内对外都用「立场型 / 不适用真/假判断」。

**未决**

要不要给拆题标签做第二意见，或对「读起来像流传说法却被标立场」强制检索。未拍板。

落盘：`docs/PRODUCT_SPEC.md` 第四节「类型谁标」+ 第七节 2026-08-19 条；`CONTEXT.md` 补 type gate。

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
