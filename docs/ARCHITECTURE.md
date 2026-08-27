# 运行时地图

产品做什么：`docs/PRODUCT_SPEC.md`。  
领域词：`CONTEXT.md`。  
本文件只回答：**代码实际怎么跑、哪一层是真的、哪一层是残骸、下一步往哪收。**

公网 `https://gun.yishuziyu.cn`：Nginx 静态 + `/api` 反代 Express。  
本地 `npm run dev`：Express 管 API，Vite 只代理 `/api`（不再复制编排）。

## 仓库

```text
mvp/src/                  脸（React）
mvp/server/src/           生产 HTTP + 判决 + 编排
mvp/vite.config.ts        前端 dev server；`/api` 代理到 Express
docs/adr/                 运行时决策（尤其 ADR-003）
tmp-apodex-study/         对照用克隆，不进 git
mvp/apodex-replica/       外观草稿，不进 git
```

入口：`mvp/src/main.tsx` → `App.tsx`。  
生产进程：`mvp/server/src/index.ts` → `handlers.ts`。

## 现在真正的路径

```text
用户
  Dashboard（贴材料）
    → App 切到 MissionControlView
      → POST /api/agent/orchestrate-stream（SSE）
        → Express handlers（薄 adapter，现在仍过厚）
          → 默认 runCasePipeline（ADR-003）
            或 AGENT_LOOP=1 / execution=loop / ?loop=1
              → runClaimLoop（ADR-006）
                runAgentLoop：think ↔ todo_write / web_search / web_fetch / submit_verdict
                finalizeLoopReport：自证 / URL 闸 / publicCopy / 公式分
      → adaptOrchestrateStreamToShell
      → mapShellToApodexRun
      → ApodexRunView（thinking / Search / 任务板 / 核心结论）
```

用户看见的是判断。过程可回看。默认内核仍是**固定管线**。循环是并列执行引擎：开 flag 时过程是真工具事件；关着时过程仍是管线映射。

默认壳：`resolveShellMode` 开着。历史卷宗走 `ResultView`（右侧 dossier）。`/demo` 是证据矩阵演示，不是核查。

## 三层（该留的）

| 层 | 在哪 | 职责 |
|----|------|------|
| 脸 | `mvp/src/components/v3/` | 首页、核查过程、判断、账号 |
| 判决 | `mvp/server/src/lib/{claimAtom,atomSearch,evidenceLoop,evidencePursuit,reportAssembly,publicCopy,credibilityScore}` | 能信 / 不能信 的纪律 |
| 执行 | 默认 `casePipeline`。并列：`agentLoop`（`runAgentLoop` + 工具 + observer，ADR-006，flag 关闭） | 想、搜、打开网页、改任务板、收束 |

HTTP 只该是薄 adapter。`handlers.ts`（约 3700 行）不该再往里堆产品规则。  
`MissionControlView.tsx`（约 6300 行）仍同时养旧过程轨和新过程壳。

前端若要域规则，从 `mvp/src/lib/claimAtom` 再导出服务端 SSOT，不要复制一份。

## 两套不该并存的东西

1. **双运行时（遗物）**  
   生产默认：`mvp/server/src/lib/casePipeline`。  
   遗物：`mvp/src/lib/agentRuntime`（eval / 测试还在用，本地 HTTP 已不走它）。  
   ADR-003：只改 AgentRuntime 等于没进生产。  
   并列执行（ADR-006，默认关）：`mvp/server/src/lib/agentLoop`。这是要留下的执行引擎，不是第三套判决。

2. **双 HTTP（已收）**  
   生产与本地核查都走 Express：`mvp/server/src/index.ts` → `handlers.ts`。  
   Vite 只代理 `/api`、`/health`、`/mcp`、`/r`。不要再往 `vite.config.ts` 里写编排。

3. **过程壳两套代码还在**  
   默认只画 `ApodexRunView`。  
   `?shell=legacy` 和 `/shell-preview` 仍走 `MissionProcessShell`。同一文件里两套过程 UI，用户默认看不到旧的那套。

客户端 `mvp/src/lib` 与服务端 `mvp/server/src/lib` 还有约 10 个同名文件（部分是有意再导出，部分是历史拷贝）。不要在两边各写一套判决。

## 目标形状（执行引擎已并列，默认未切）

换执行引擎，不换产品：

```text
claim
  → runAgentLoop（ReAct：LLM ↔ 工具，直到 submit_verdict）
      工具：web_search / web_fetch / todo_write / submit_verdict
      observer → 现有 SSE 事件
      submit_verdict → finalizeLoopReport（闸门）
  → ApodexRunView
```

模块：`mvp/server/src/lib/agentLoop`。`claimAtom` / 证据循环是 loop 收束时的闸，不是删掉。不要 vendor FrontierAgent 的 Python 仓库，不要迁 LangGraph。

## 不是产品

| 路径 | 是什么 |
|------|--------|
| `tmp-apodex-study/` | 本地对照（FrontierAgent 克隆、截图）。不进 git |
| `mvp/apodex-replica/` | 外观 1:1 草稿。不进 git |
| `mvp/src/lib/pipeline.ts` + `data/rumorCases/` | 早期静态 demo，测试还在用 |
| `/demo`、EvidenceMatrixGSAP | 证据矩阵演示页 |
| `ConclusionDockV3` 一簇 | 旧判断页，现网不挂；测试和 git-diff 契约还指着 |
| `docs/reviews/agentic-patterns/` | 读书笔记，不是运行时 |
| `vendor/`、`Chinese_Rumor_Dataset/` | 本地资料，已 gitignore |

## 下一刀（按这个顺序）

1. ~~开发 HTTP 只代理 Express~~（已做）。AgentRuntime 已不在本地 HTTP 上，eval 迁完即可删。  
2. 过程只留 `ApodexRunView`，从 `MissionControlView` 拿掉 legacy 过程轨。  
3. ~~`runAgentLoop` feature-flag 与 `casePipeline` 并列~~（ADR-006，默认关）。直到判断质量不低于现管线之前，不切默认。  
4. 再拆 `MissionControlView` / `handlers.ts`。

不要从删判决模块开始。不要把研究克隆提交进仓库。
