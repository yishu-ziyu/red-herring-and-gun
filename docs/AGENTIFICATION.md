# 红鲱鱼与枪 · Agent 化完整方案（pi Agent SDK）

> 状态：已决策（2026-08-30）。执行引擎向 **pi Agent SDK** 迁移，判决层不动。
> 运行时地图：`docs/ARCHITECTURE.md`。产品真相：`docs/PRODUCT_SPEC.md`。

## 一、为什么选 pi Agent SDK

pi（badlogic/pi，OpenClaw 的运行时引擎）是 TypeScript 的极简嵌入式 Agent 栈：
`pi-ai`（统一多 provider LLM 层）→ `pi-agent-core`（事件驱动 Agent 循环 + 会话树）→ `pi-coding-agent`（会话持久化 / 工具 / 扩展）。

选它不是因为「流行」，而是四个特性刚好对得上这个产品的硬约束：

| pi 特性 | 对应我们的硬约束 |
|---|---|
| 完全可控上下文，不隐式注入 Prompt | 判决纪律：模型不能乱跳，Prompt 每 token 可审计（对照 ADR-006「判决层不动」） |
| Provider 无关：原生支持 MiniMax / Kimi / OpenRouter / Ollama / vLLM / OpenAI-compatible | 国产模型 10% + 现网 MiniMax-M3 主判、StepFun 二审、DeepSeek 链直接承接 |
| 事件驱动 `AgentEvent` + 会话树（branch / fork / rollback） | 过程 SSE → ApodexRunView；「查完再问一句留在同一条」天然落在会话树里 |
| 极简自托管，可嵌入（`createAgentSession()` 就是 SDK API） | 服务端 Express 进程内嵌，不引新的拓扑框架（沿用 ADR-002：不迁 LangGraph/DeepAgents） |

不用它写判决。它只当执行引擎；`finalizeLoopReport` 仍是唯一收束闸。

## 二、目标架构

```text
用户 → Dashboard（贴话/截图/视频/链接）
  → App → MissionControlView
    → POST /api/agent/orchestrate-stream（SSE）
      → Express handler（薄 adapter，编排已从 handlers 迁 lib）
        → pi 驱动核查会话（默认仍 casePipeline，pi 循环 flag 并列；达标后切默认）
            pi-agent-core 会话：LLM ↔ 工具循环，直到 submit_verdict
              工具（显式 schema，全部可审计）：
                web_search       → 现网检索矩阵（searchProviders.retrieveAtomSources）
                web_fetch        → 链接抓取 / 原图落点
                reverse_image    → 360 图搜适配器（配 KEY 即启用）
                vision_ocr       → StepFun Vision（截图/视频帧 OCR 与线索）
                memory_recall    → 记忆语义召回（同义词组+字符 Dice，零模型）
                todo_write       → 证据追索 hops / 任务板
                judge_atom       → 拆原子+自证+逐条判定（claimAtom 全家，工具化）
                submit_verdict   → finalizeLoopReport（自证/URL 闸/公式分/publicCopy/reportReviewer）
            AgentEvent observer → adaptOrchestrateStreamToShell → mapShellToApodexRun → ApodexRunView
```

关键点：**判决模块不是 pi 的「对话内容」，是 pi 的工具**。模型只能调用，不能绕过：
`judge_atom` / `submit_verdict` 是硬工具，收束必经 `finalizeLoopReport`。

## 三、现有代码的落点（可复用清单）

| 现有模块 | 在 pi 方案里的角色 |
|---|---|
| `claimAtom`（拆原子/自证） | `judge_atom` 工具的底层，保留 |
| `atomSearch` / `evidenceLoop` / `evidencePursuit`（ADR-004/005） | 检索策略 + 证据缺口判停，变成 pi 循环的**确定性护栏**（tool 结果校验 + 预算停止条件） |
| `searchProviders`（360/AnySearch/Metaso/Tavily/Exa） | `web_search` 工具实现，已有 |
| `reverseImage/search360ReverseImage` | `reverse_image` 工具（这轮已建） |
| `visionIntake`（StepFun Vision） | `vision_ocr` 工具（已有） |
| `memoryCandidateStore` + `semanticRecall` | `memory_recall` 工具 + 会话注入（已有） |
| `reportFallback` / `formulaScore` / `publicCopy` / `reportReviewer` | `submit_verdict` 闸门（已有） |
| `agentLoop`（ADR-006 自研 ReAct 内核） | **被 pi-agent-core 替代**，作为退役候选（其工具协议与 pi 对齐：todo/web_search/web_fetch/submit_verdict） |
| `llmGateway`（手写多 provider fallback） | 由 `pi-ai` 的模型目录 + fallback 接管，逐步退役 |

## 四、分阶段路线

### P0 · pi-ai 试点（不动行为，先换腿）

- server 引入 `@mariozechner/pi-ai`。
- 把 `llmGateway` / `providerRouter` 的 provider 调用换成 `getModel(provider, modelId)` + `completeSimple`，**保留**现有 `providerOrderForAgent` fallback 顺序与 `ProviderFallbackError` 语义。
- 验证：eval gate 全绿、1090+ 测试全绿、真实 case 冒烟一致。
- 说明：pi-ai 自带 cost tracking 与 thinking 统一，顺手拿去喂 eval 的成本断言。

### P1 · pi-agent-core 试点自治循环（flag 并列，默认关）

- `wantsAgentLoop`（现有 `execution:loop` / `AGENT_LOOP=1` / `?loop=1`）切到 pi 会话实现：
  ```
  createAgentSession({ modelRegistry, defaultModel, workspace })
    → 注入 7+1 工具（web_search/web_fetch/reverse_image/vision_ocr/memory_recall/
       todo_write/judge_atom/submit_verdict）→ session.subscribe(AgentEvent → SSE)
  ```
- observer：`AgentEvent`（message_update / toolCall / toolResult / thinking…）→ 现有 SSE 事件 → `ApodexRunView`。todo_write 直接驱动任务板。
- 会话树：每一次 /api/agent/orchestrate 是根；追问走同树 fork（「查完再问一句」）。
- eval：`agentLoop-vs-casePipeline 同案对比`（新增评测组：同一 golden 两引擎各跑一遍，比较 verdict/credibility/引用命中，gate 门槛 = 不低于现管线）。
- Quality 不够就留在 flag 后，不切默认。

### P2 · 切默认（另写 ADR）

- P1 达质量门后，默认执行引擎换 pi 循环；`casePipeline` 降级为备用轨（fallback），代码不删（双引擎可回退）。

### P3 · 产品专项优化

1. **追问与分支**：会话树 fork = 新问题；`session` 持久化 JSONL → 历史卷宗可续。
2. **证据追索可视化**：`todo_write` 的每个 todo 事件 = 现有 evidencePursuit hop；过程层回看不变。
3. **截图/视频**：`reverse_image` + `vision_ocr` 已建，挂进工具即接通以图搜图与原视频溯源。
4. **预算与成本**：pi 会话级 budget（max tool calls / cost cap）→ 替代现在 evidenceLoop 的轮数笼子；超预算的事件就是「查不清」的显式原因（SSE stop reason）。
5. **英文谣言**：pi 的会话内可注入语言策略（`web_search` 工具按 claim 语言选 provider/query 语言）。
6. **user feedback → golden**：已有 `/api/feedback`；P3 把 feedback 标注的错例半自动进 eval golden（人工复核后入库）。

## 五、判决纪律怎么保住（不变原则）

1. **判决是工具不是对话**：原子判定、拆题、写报告都只能通过 `judge_atom` / `submit_verdict` 工具发生，工具实现调现有确定性模块。
2. **收束唯一闸**：任何路径的最终结论必须过 `finalizeLoopReport`——自证丢未在原句的原子、URL 闸丢无出处的真假、publicCopy 剥工具名与四字章、公式分不让模型拍分数、reportReviewer 确定性复查。
3. **教练即工具**：pi 会话的系统提示只写「任务对象与工具使用规则」，不下真/假结论；判断的纪律全在工具层。
4. **可回放**：AgentEvent 每一条都进 JSONL / SSE；判决可审计到「哪一步、用了哪个工具、什么输入输出」。
5. **不把 pi 当拓扑**：不引入 LangGraph 式图编排（ADR-002 结论维持）；pi 只是可嵌入的 ReAct 引擎，动态加在证据维度（现有 evidenceLoop 语义），不加在拓扑维度。

## 六、风险与边界

- **pi 是青年框架**（OpenClaw 驱动）：工具协议、事件类型会演进。对策：在我们这边留薄适配层（`piBridge.ts`），pi API 变化只改这一处，不散落进域逻辑。
- **provider 兼容**：pi-ai 的 MiniMax/Kimi provider 与我们现网用的 base URL / 鉴权头可能不完全一致；P0 先验证，不一致则用 pi 的「OpenAI-compatible 自定义 provider」承接。
- **不切默认前的质量门**：P1 的对比评测是硬门槛，simulate 不够，跑真 golden。
- **域名外的工具不给**：只暴露核查域工具，不给 bash / 文件系统 / 沙箱（pi-coding-agent 的编码工具集不引入）。

## 七、验证

- P0：1090+ 测试全绿 + eval gate 通过 + 真实 case 三路冒烟（健康/社会/截图）。
- P1：新增 pi 循环评测组（同案对比），`eval:gate` 不劣于现管线才允许 `execution:loop` 切换审计结论。
- P2：切默认需另写 ADR，且保留 `casePipeline` 回退轨。
- 回归护栏：截图原图闸（imageOrigin）、权威库直查（atomSearchQuery）、反馈落盘（userFeedback）的测试全绿作为每次提交基线。

## 八、下一步（任务）

1. server 引入 `@mariozechner/pi-ai`，P0 试点（provider 层替换）。
2. 写 `server/src/lib/piBridge.ts`（pi 适配薄层：模型注册、事件→SSE 映射、预算器）。
3. P1 会话化 claimLoop（4+1 工具注入），保留 flag。
4. eval 新增双引擎同案对比组。
5. 达标后按第二～五节切默认（新 ADR）。