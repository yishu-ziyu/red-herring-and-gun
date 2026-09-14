# 运行时地图

产品做什么：`docs/PRODUCT_SPEC.md`。  
领域词：`CONTEXT.md`。  
本文件只回答：**代码实际怎么跑、哪一层是真的、哪一层是残骸、下一步往哪收。**

公网 `https://gun.yishuziyu.cn`：Nginx 静态 + `/api` 反代 Express。  
生产壳本地在 `apps/` 执行 `npm run dev`：Express 管 API，Vite 只代理 `/api`。根目录的 `dev:web` / `dev:server` 启动 `packages/` 脊柱，尚未执行 T20 上线切换。

## 当前接线状态（2026-09-11）

生产壳仍是 `apps/`：`./ops.sh deploy --yes` 在本机构建后打包上传，远端 Docker 重建 Express，
Nginx 从 `/opt/red-herring/dist` 发静态、把 `/api/` 与 `/health` 反代到 `127.0.0.1:3000`。
域名 `gun.yishuziyu.cn` 是 A → `121.89.90.68`（阿里云单源）。Vercel 那条路 2026-09-11 退场，
原因与恢复条件见 `docs/tasks/2026-09-11-deploy/vercel-retirement.md`。

前端默认路径是 Golden Path（`apps/src/goldenPath/`）：`ProductShell` + `InputStage` →
同一个 `InvestigationCanvas` 承载调查中与完成态 → `ConclusionHero` + `SourceDrawer`。
旧三栏壳（AppShell + MissionControl + ResultView）整建制退到 `/?legacy=1`（`legacy/LegacyDesk.tsx`），
不再承担生产信息架构。

白盒调查数据契约 `InvestigationSnapshotV1`：源文件 `packages/core/src/investigation`，
生产侧 `apps/server/src/lib/investigation` 是它的字节级镜像（两侧 `mirror.test.ts` 双向守卫），
**前端经 `apps/src/lib/investigation` 再导出消费**（同 `apps/src/lib/claimAtom` 的做法）。
服务端在 received → decomposed → investigating → judging → complete 八个语义里程碑发完整快照，
SSE 事件 `investigation_snapshot`；`GET /api/case/:id` 对旧历史做确定性重建。

默认执行引擎 `runCasePipeline` 含有界质询：真实证据 → 独立意见 → 可选补查 → 主调查回应 →
最新完整调查进入报告；最多两个争点各一轮，真实记录写入 `finalReport.crossExam`。分歧本身不扣分。

每日免费核查闸门：未登录访客 2 条/人/天，登录 3 条；来源 IP 另有天花板（20）只防「清 cookie 无限刷」，
不当单人额度。`/api/models/health` 是可用性探针，**不计额度**（计额度端点集合收在
`apps/server/src/lib/quotaPolicy.ts`）。测试期可用 `CHECK_QUOTA_GUEST_LIMIT` / `CHECK_QUOTA_IP_LIMIT` 放宽。

已知限制：`providerRouter` 的 `Promise.race` 超时（`providerRouter.ts:596`）不会取消在途模型请求，
不保证硬截止时间。停止检查发生在步骤边界。

T20（生产切到 `packages/` 脊柱）仍未执行。生产壳目录是 `apps/`。
完整当前状态见 `docs/NOTES.md` 头部。

## 仓库

完整地图（为什么在这里、改一处走哪几层）：`docs/REPO.md`。文档入口：`docs/README.md`。

```text
apps/                     生产 app。脸 goldenPath；HTTP + 编排在 server/
packages/                 脊柱 core / server / web / eval，尚未切生产
docs/                     产品、架构、验收、设计；不是运行时
ops.sh                    唯一发布入口。打包上传 `apps/`
tmp-apodex-study/         研究代码克隆，不进 git
```

入口：`apps/src/main.tsx` → `App.tsx`。  
生产进程：`apps/server/src/index.ts` → `handlers.ts`。

## 现在真正的路径

```text
用户
  InputStage（贴一句话 / 图 / 链接）
    → POST /api/agent/orchestrate-stream（SSE）
      → Express handlers（薄 adapter）
        → runCasePipeline
          → investigation_snapshot（received → decomposed → investigating → judging → complete）
    → InvestigationCanvas（同一画布：调查中与完成态）
      → ConclusionHero + 依据 + SourceDrawer
```

默认内核是含证据循环与有界质询的 `casePipeline`。产品状态只有最新一份 `InvestigationSnapshotV1`。  
旧三栏壳（AppShell / MissionControl / ResultView / ApodexRunView）只在 `/?legacy=1`。未匹配路径回到首页输入，不当独立产品页。

执行只有 `casePipeline`。`agentLoop` 已删，ADR-006 废止。

## 三层（该留的）

| 层 | 在哪 | 职责 |
|----|------|------|
| 脸 | `apps/src/goldenPath/` | 首页输入、调查中、完成态、来源抽屉；账号/登录仍用 `components/v3/auth` 与 settings |
| 判决 | `apps/server/src/lib/{casePipeline,publicCopy,investigation}` 与 `packages/core` | 对原句的回答、命题、出处、边界 |
| 执行 | `casePipeline` | 拆题、检索、核查、收束 |

HTTP 只该是薄 adapter。`handlers.ts` 不该再往里堆产品规则。  
前端若要域规则，从 `apps/src/lib/investigation` / `claimAtom` 再导出服务端 SSOT，不要复制一份。

## 两套不该并存的东西

1. **双运行时（已收）**  
   生产默认且唯一：`apps/server/src/lib/casePipeline`。  
   客户端 AgentRuntime 已删（2026-08-30）。`apps/server/src/lib/agentLoop` 已删（2026-09-14），不再作为并列执行引擎。

2. **双 HTTP（已收）**  
   生产与本地核查都走 Express：`apps/server/src/index.ts` → `handlers.ts`。  
   Vite 只代理 `/api`、`/health`、`/mcp`、`/r`。不要再往 `vite.config.ts` 里写编排。

3. **过程壳**  
   默认调查中不画旧过程壳。`/?legacy=1` 才是旧三栏。  
   `/demo`、`/shell-preview` 一类路径已经删除；访问未匹配路径回到首页输入。

客户端 `apps/src/lib` 与服务端 `apps/server/src/lib` 还有约 10 个同名文件（部分是有意再导出，部分是历史拷贝）。不要在两边各写一套判决。

## 不是产品

| 路径 | 是什么 |
|------|--------|
| `tmp-apodex-study/` | 本地研究代码克隆；旧界面截图已于 2026-09-05 清理。不进 git |
| 旧外观复刻及 HTML 探索 | 2026-09-05 按用户要求删除。现行界面在 `apps/src/goldenPath/`，token 在 `golden-path.css` |
| `apps/src/lib/pipeline.ts` + `data/rumorCases/` | 早期静态 demo（连同整条 demo 报告管线，2026-08-30 已删） |
| 已删除的演示/预览组件 | 不属于运行时；对应路径访问时落入首页 |
| 2026-08-30 删除的死功能 | 13 个死组件、~40 个死 lib、12 条前端不可达路由、`llmGateway`、非 pi 旧循环引擎、aiping config/apikeys 端点 |
| `vendor/`、`Chinese_Rumor_Dataset/` | 本地资料，已 gitignore |

## 历史收敛记录（已完成项，不是当前任务顺序）

1. ~~开发 HTTP 只代理 Express~~（已做）。AgentRuntime 已不在本地 HTTP 上，客户端 eval 已迁到 `apps/server/eval`，剩余类型抽取后即可删。
2. ~~旧三栏退到 `/?legacy=1`~~（已做）。默认脸是 Golden Path。  
3. ~~`runAgentLoop` feature-flag 与 `casePipeline` 并列~~（ADR-006，默认关）。直到判断质量不低于现管线之前，不切默认。  
4. ~~拆 `handlers.ts`~~（已做，2026-08-30）。3793 行 → 1272 行 HTTP adapter + 编排；六个单职责模块进 `apps/server/src/lib/`：`llmGateway`（Canvas 调度类 LLM 调用）、`searchProviders`（并行搜索矩阵 + retrieveAtomSources）、`visionIntake`（材料摄入 + StepFun 视觉）、`reportFallback`（确定性兜底报告）、`formulaScore`（公式评分）、`httpUtils`/`valueCoerce`/`ssrfGuard`（小工具）。同时删除两处与 `agentProviders` 重复的函数（`extractChatCompletionText`、`buildStepFunRequestBody`）和六个零调用 demo fallback 函数；eval 导入改指 lib 模块。`makeRunAgent` 与 orchestrate 接线仍在 handlers.ts，后续里程碑再评估拆分。截图原图闸已进 Case Pipeline（`imageOrigin`）；现网检索适配器还没有以图搜图，所以有图时会写「原图没查到」，不会把 OCR 二手帖当图源。真正能点到更早出处，要等接上以图搜图适配器。`AGENT_LOOP=1` 那条路还没接这道闸。

不要从删判决模块开始。不要把研究克隆提交进仓库。
