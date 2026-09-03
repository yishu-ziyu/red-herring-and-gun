# CaseFile 脊柱 · 任务拆解与验收契约

架构决定：`docs/adr/ADR-007-casefile-spine.md`。本文是执行清单：每条子任务独立可验收，执行者拿到这一节 + ADR 就能做。
验收人是本文作者（规划 Agent）与用户；执行者的自述不算证据。

## 通用约定（每条任务都适用）

**分支**：集成分支 `spine`（自 `dev` 切出）。每条任务在 `spine-Txx-<slug>` 上做（git 不允许 `spine/…` 与分支 `spine` 并存），完成后由验收人合回 `spine`。并行任务在 `.worktrees/Txx/` 里做，不共用工作区。不碰 `dev` / `main`。不改 `mvp/` 下任何文件（它是参照，eval 打平后整体删除）。

**布局**：根 `package.json` 用 npm workspaces 管 `packages/*`；`mvp/` 不进 workspaces。

```text
packages/core/src/
  casefile/      事件、类型、reducer、不变量、序列化        （同构：不得 import node 内置模块）
  llm/           多厂商调用与 fallback（搬）
  search/        检索矩阵、过滤、RRF、查询组合（搬）+ toEvidence 规范化
  fetch/         web_fetch、HTML→文本、pivot 抽取、出处簇、SSRF 守卫
  text/          拆题/自证规则、公开文案、审稿规则、引用绑定、语义召回（搬）
  rules/         sourceTiers、judge、overall、score
  stages/        intake、decompose、retrieve、assess、investigate、crossExam、compose、finalize
  runner/        runTurn、路由、时间预算、失败开放
  util/          搬入的无域小工具（httpUtils、valueCoerce）
packages/server/src/
packages/web/src/
packages/eval/
```

**依赖白名单**：core：`typebox`、`node-html-parser`。server：`express`、`cors`、`dotenv`。web：`react`、`react-dom`、`vite`、`@vitejs/plugin-react`、`@xyflow/react`。eval：无新增。工具链（已在 T01 装好，不再算新增）：`typescript`、`vitest`、`tsx`（server dev 运行器；Node 22 无原生 TS 执行）、对应 `@types/*`。其它依赖必须先在任务契约里列出，否则不得加。

**代码约束**：TS strict、ESM、相对导入带 `.js` 后缀（node ESM 运行时需要）。域状态不得用 `Record<string, unknown>`；禁止下划线前缀字段当补丁。注释只写非显然的意图与约束，不叙述代码。

**搬迁规则**：标注「搬」的模块连同 `*.test.ts` 一起移动，只允许改 import 路径与文件位置。用复制（`cp`），不用 `git mv`——`mvp/` 保持原样。被搬模块若 import 了清单外的 `mvp/server/src/lib/*` 文件：小而无域的进 `util/`，其余按目录归类，一并原样复制并在报告里列「额外搬入」；不得内联或重写。TS 7 下 `Response.json()` 返回 `{}`，旧代码 `data?.error` 会报错：在该行加 `: any` 注解即可（与旧编译环境语义一致），不得用全局 `declare global` 的 `.d.ts` 打补丁。发现旧模块有 bug 记进任务页，不在搬迁时修。

**共享形状**（Wave 1 并行任务之间的类型约定；T02 在 `casefile/` 定义正式版本，T04 / T06 在本目录 `types.ts` 里只声明自己用到的结构类型，字段名与下面完全一致，合并后由验收人改成从 `casefile/` 引）：

```ts
type Tier = "A" | "B" | "C" | "unknown";
type Provenance =
  | { kind: "search"; query: string; provider?: string }
  | { kind: "pivot"; fromEvidenceId: string; pivotId: string }
  | { kind: "user" }
  | { kind: "memory"; recallId?: string }
  | { kind: "reverse-image"; imageUrl: string };
interface Evidence {
  id: string;             // "e1", "e2", …
  url: string;            // 原始 URL
  canonicalUrl: string;   // 规范化后，用于去重
  host: string;
  title?: string;
  excerpt: string;        // ≤ 320 字
  text?: string;          // 抓取后的正文
  publishedAt?: string;   // ISO 8601
  retrievedAt: string;    // ISO 8601
  tier: Tier;
  clusterId?: string;
  reachable?: boolean;    // 抓取失败置 false
  provenance: Provenance;
}
interface Pivot {
  id: string;
  kind: "link" | "doc_number" | "date" | "image" | "entity" | "query";
  value: string;          // URL / 文号 / 日期 / 机构名 / 查询串
  why: string;
  expectedValue: 1 | 2 | 3;
  fromEvidenceId?: string;
  depth: number;          // 距用户输入的跳数
}
```

时间戳一律 ISO 8601 字符串，事件对象必须可 `JSON.stringify` 往返。

**每条任务的通用验收**：根目录 `npm test` 全绿；`npm run build` 通过；`mvp/` 无 diff；新增文件在对应 `packages/*/src/` 下；任务分支只含本任务改动。

**证据格式**：测试文件名 + 用例名；命令与退出码；截图路径；eval run id。不贴日志全文。

**执行者**：默认 Grok 4.6 high；标 ★ 的用 xhigh。

---

## Wave 0 · 骨架与契约

### T01 · Monorepo 骨架

依赖：无。

Change：仓库根出现 `package.json`（workspaces `packages/*`）、`tsconfig.base.json`、四个包 `core / server / web / eval` 各有 `package.json`、`tsconfig.json`、`src/index.ts`、一个冒烟测试；根 `npm install && npm test && npm run build` 通过；`packages/web` 是 Vite React 空壳能 `npm run dev` 起来显示「红鲱鱼与枪」四个字；`packages/server` 起来响应 `GET /health` → `{ok:true}`。`.gitignore` 补 `packages/*/dist`、`packages/*/node_modules`、`packages/eval/baseline.json`、`packages/web/output/`。

Not this：不搬任何旧代码；不装白名单外的依赖；不改 `mvp/`；不引 turborepo / nx / lerna；不写 README 之外的文档。

Evaluator：验收人在干净 clone 上跑 `npm install && npm test && npm run build`；起 web 与 server 各看一眼。

Evidence：三条命令的退出码；`packages/*/src/index.ts` 路径；`curl /health` 输出。

### T02 · CaseFile 事件模型与 reducer

依赖：T01。

Change：`packages/core/src/casefile/` 导出：

- 类型：`Case`、`CaseInput`、`Claim`、`Evidence`、`Stance`、`ClaimVerdict`、`Pivot`、`Report`、`Message`、`CaseEvent`（封闭联合）。
- `createCase(input): { case, events }`、`reduce(case, event): Case`、`replay(events): Case`、`serialize / deserialize`。
- `assertInvariants(case)`：所有 `Evidence.url` 为 http(s)；`Stance.claimId / evidenceId` 可解析；`ClaimVerdict ∈ {true,false,partial}` 时 `basis` 非空且每条 basis 的证据 `reachable !== false`；`evidence.cites` 两端存在且无自环；`frontier` 中 pivot id 唯一；`Report.citations[n]` 全部可解析。
- 事件清单（至少）：`case.created`、`message.added`、`turn.started`、`turn.finished`、`stage.started`、`stage.finished`、`claims.added`、`claims.dropped`、`evidence.added`、`evidence.updated`、`evidence.cites`、`stance.added`、`verdict.updated`、`overall.updated`、`frontier.added`、`frontier.consumed`、`investigator.step`、`investigator.stopped`、`llm.called`、`report.finalized`、`error`。字段按 ADR-007 第 1、2、3 节；`Evidence.provenance` 必须能表达 `search(query) / pivot(fromEvidenceId, pivotId) / user / memory / reverse-image`。
- 该目录不得 import 任何 node 内置模块（前端要用）。用 `typebox` 定义 schema 并导出，供服务端校验入站事件与 LLM 输出。

Not this：不实现任何阶段逻辑；不做 LLM 调用；不写 HTTP。

Evaluator：`casefile.test.ts`：reduce 纯函数（同输入同输出、不改入参）；`replay(events)` 与逐步 reduce 结果深相等；随机生成 200 条合法事件序列后 `assertInvariants` 通过；每种非法情形（无 URL 证据、悬空 stance、true 判决无 basis、引用自环）各有一条失败用例；`serialize→deserialize` 往返相等；ESLint/tsc 层面确认目录无 `node:` 导入（用一条测试 grep 源码即可）。

Evidence：测试文件与用例名；`tsc --noEmit` 退出码。

---

## Wave 1 · 搬资产（可并行）

### T03 · LLM 多厂商层（搬）

依赖：T01。

Change：`mvp/server/src/lib/{providerRouter,agentProviders,anthropicParse,minimaxM3,availableModels,modelServiceHealth,visionIntake}.ts` 及其测试搬到 `packages/core/src/llm/`（`visionIntake` 只依赖 `agentProviders` / `anthropicParse`，归这里而不是 fetch/）；导出统一入口 `callJob({ job, systemPrompt, userContent, responseSchema, maxTokens, env, modelOverride, reasoningEffort })` → `{ output, model, latencyMs, reasoning? }`，内部走原 `callAgentWithFallback`。`env` 只从参数进来，不读 `process.env`。

Not this：不改 fallback 顺序与鉴权逻辑；不新增厂商；不改 prompt。

Evaluator：搬入的测试全绿；新增 `callJob.test.ts` 用假 fetch 证明 fallback 链行为与原 `callAgentWithFallback` 一致（至少：首选失败→次选成功；全失败→抛错并含各厂商错误摘要）。

Evidence：测试名；`git diff --stat` 显示搬迁文件只有 import 路径改动。

### T04 · 检索层（搬）+ 证据规范化

依赖：T01。

Change：`mvp/server/src/lib/{searchProviders,retrievalFilter,queryReuse,atomSearchQuery}.ts`、`mvp/server/src/lib/evidencePursuit/` 及测试（含 `searchProviders.progress.test.ts`、`atomSearchQuery.test.ts`、`queryReuse.test.ts`、`retrievalFilter.test.ts`、`evidencePursuit.test.ts`）搬到 `packages/core/src/search/`。它们依赖的 `httpUtils.ts`、`valueCoerce.ts` 原样复制到 `packages/core/src/util/`；`memoryCandidateTypes.ts` 原样复制到 `packages/core/src/text/`（T05 会用同一路径，内容必须逐字节相同，不得改）。新增 `toEvidence(raw, provenance): Evidence`：URL 规范化（去 utm / fragment / 尾斜杠、小写 host、`m.` 与 `www.` 折叠）、host 抽取、`retrievedAt`、`excerpt` 截断 320 字、`tier` 由 T06 的 `sourceTiers` 填（此处先留 `unknown`）。新增 `searchAll(env, query, onProgress): Evidence[]`（并行五源 → RRF → 过滤无 URL → 按 canonicalUrl 去重）。

`Evidence` / `Provenance` 类型按「共享形状」在 `search/types.ts` 里声明（T02 并行中，暂不从 `casefile/` 引）。

Not this：不改各厂商 API 调用；不做 fetch 页面；不做出处簇（T06）；不 import `casefile/`。

Evaluator：搬入测试全绿；`toEvidence.test.ts` 覆盖 8 种 URL 规范化用例；`searchAll.test.ts` 用假 provider 证明：一源失败不阻断、RRF 顺序、去重后无重复 canonicalUrl、progress 事件顺序。

Evidence：测试名；diff stat。

### T05 · 判决与文案模块（搬）

依赖：T01、T04（`reportReviewer` import `boundTinyRumorVerdict` 自 `search/atomSearchQuery.js`；`memoryCandidateTypes.ts` 已由 T04 放在 `text/`）。在 T04 合入 spine 后开始。

Change：搬到 `packages/core/src/text/`：`mvp/server/src/lib/claimAtom/`（拆题规则、自证、forceCheckable、merge、text）、`publicCopy.ts`、`reportReviewer.ts`、`reportSanitizer.ts`、`citationBinding.ts`、`semanticRecall.ts`、`memoryCandidate{Generator,Store}.ts`；搬到 `packages/core/src/rules/`：`credibilityScore.ts`、`formulaScore.ts`、`mvp/src/lib/sourceCredibility.ts`（客户端那份，含来源层级知识）。全部连测试。另：把 `mvp/server/src/lib/queryReuse.test.ts` 里 `searchAccepted → buildQueriesWithReuse` 这个 describe 复制回 `packages/core/src/search/queryReuse.test.ts`（T04 搬时因依赖 `memoryCandidateStore` 暂删），import 指向 `../text/memoryCandidateStore.js`。`packages/` 下任何文件不得 import `mvp/`。

Not this：不改任何规则常量；不合并两份 credibility 实现（后续 T09 决定用哪个）；不删「暂时没人用」的导出。

Evaluator：搬入测试全绿；`tsc --noEmit` 干净；验收人抽查三处随机 diff 只有 import 改动。

Evidence：测试名；diff stat。

### T06 · 抓取、抽取、出处簇、来源层级

依赖：T01。允许依赖：`node-html-parser`。

Change：`packages/core/src/fetch/`：

- `ssrfGuard.ts`（搬 `mvp/server/src/lib/ssrfGuard.ts` + `handlers.ts` 里的私网判定函数）。
- `webFetch(url, { timeoutMs, maxBytes, signal }): { finalUrl, status, contentType, html?, text, title?, publishedAt?, links[], images[], reachable }`：跟随 ≤3 跳重定向且每跳过 SSRF 守卫；`text` 为块级标签换行的纯文本；`publishedAt` 从 `<meta>`（article:published_time、pubdate、datePublished JSON-LD）与正文首个中文日期取。
- `extractPivots(evidence): Pivot[]`（确定性）：外链（同 host 剔除）、文号 `〔YYYY〕N号` / `(YYYY)N号`、日期、图片 URL、`据X（报道|消息|通报）`、`X（表示|称|回应）` 中的 X；每条带 `why` 与 `expectedValue`（外链到 gov/edu/官媒 = 3；被引机构 = 2；其余 = 1）。
- `originCluster(evidence[]): Map<evidenceId, clusterId>`：同 host 同簇；跨 host 正文 5-gram Jaccard ≥ 0.6 同簇；簇内保留最早 `publishedAt` 为根。
- `packages/core/src/rules/sourceTiers.ts`：host → `A | B | C`（A：`.gov.cn`、`.edu.cn`、官方辟谣平台、中央媒体名单；B：省级媒体、主流门户、维基；C：其余），名单是数据文件，可测。
- `imageOrigin/`、`reverseImage/` 搬入 `fetch/`；它们依赖的 `httpUtils.ts` 原样复制到 `packages/core/src/util/`（T04 会放同一路径，内容必须逐字节相同，不得改）。`visionIntake.ts` 归 T03。
- `extractPivots` / `originCluster` 的输入输出类型按「共享形状」在 `fetch/types.ts` 里声明（T02 并行中，暂不从 `casefile/` 引）。

Not this：不引 jsdom / readability / puppeteer；不用 LLM；不在此处决定追不追 pivot；不 import `casefile/`。

Evaluator：仓库内放 6 个真实页面 HTML 快照（gov 通知、央媒报道、自媒体转载 ×2、辟谣平台、微博页）作为 fixtures；`webFetch.test.ts` 用本地 http server 回放 fixtures，覆盖重定向、超时、超大响应截断、非 HTML、SSRF 拦截；`extractPivots.test.ts` 对每个 fixture 断言期望 pivot 集合（含文号与被引机构）；`originCluster.test.ts` 证明两篇转载同一通稿被并簇、无关文章不并；`sourceTiers.test.ts` 抽 10 个 host。

Evidence：fixtures 路径；测试名。

---

## Wave 2 · 阶段

**共用接缝（已在 spine 上，T07–T12 都用，不各自发明）**：

- `stages/context.ts`：`StageContext { current, emitted, emit, llm, now, signal }`，由 `createStageContext({ case, llm, now?, signal? })` 构造。`emit(event)` 填 `seq / at`、`validateEvent` 校验、`reduce` 折叠、返回新快照；`ctx.llm(params)` 每次调用自动发 `llm.called`（失败也记 `ok=false` 后原样抛）。阶段只通过 `ctx.emit` 写状态、只通过 `ctx.llm` 调模型，不直接 `reduce`、不直接 `callJob`。
- `llm/fakes.ts`：`createFakeLlm(script)`，按 job 名给应答（对象 / 函数 / Error / 数组按次序），`fake.calls` 记全部参数。测试只用它，不 `vi.mock` LLM 层。
- 阶段签名：`export async function runXxx(ctx: StageContext, input: XxxInput): Promise<XxxResult>`。工单 schema 用 typebox 放在阶段文件旁 `xxx.schema.ts`，模型输出用 `Value.Check` 校验，不通过按各契约走失败开放并发 `stage.finished(outcome: "failed-open")`。
- 实体 id：命题 `c1, c2…`、证据 `e1, e2…`、立场 `s1, s2…`、pivot 由 `extractPivots` 给；编号从 `ctx.current` 对应数组长度 + 1 取，跨阶段不重号。
- 不改 `stages/index.ts`、`rules/index.ts`、`packages/core/src/index.ts`（验收人合并时加导出，避免三方并行冲突）。

### T07 · Intake 与 Decompose 阶段

依赖：T02、T03、T05、T06。

Change：`stages/intake.ts`：文本原样；链接 → `webFetch` 后该页成为第 0 号证据（provenance `user`），命题从页面标题与首段抽；图片 → `visionIntake`，OCR 文本进命题源，图片进 frontier（`kind: image`）。`stages/decompose.ts`：一张工单（改写自 `mvp/server/src/lib/agentConfigs.ts` 的 rumor_detector，只许填 `claims[]{text,type,checkable,span}`，不许判真假）→ 自证工单（搬入的 `runClaimAtomSelfProof`）→ `forceCheckable` → 发 `claims.added` / `claims.dropped(self-proof)`。工单失败开放：整句作为一条 `fact` 命题继续。

Not this：不检索；不判决；不在 prompt 里写任何「能信/不能信」措辞。

Evaluator：用录制的 LLM 输出做 fixture（`llm/fakes.ts` 提供 `FakeLlm` 按 job 返回）；`decompose.test.ts`：复合句拆成 ≥2 条且顺序与原句一致；立场句 `checkable=false`；自证丢掉原句没说的命题并发 `claims.dropped`；「导致/致癌」类被 forceCheckable 拉回可核查；工单抛错 → 整句一条命题、`stage.finished.outcome = failed-open`。`intake.test.ts`：链接输入产生第 0 号证据且命题非空。

Evidence：测试名。

### T08 · Retrieve 阶段

依赖：T02、T04、T06。

Change：`stages/retrieve.ts`：对每条 `checkable` 命题，按负荷选 ≤6 条（因果 / 数字优先），用 `evidencePursuit.buildQueryPortfolio` 生成 2–3 条查询 → `searchAll` → `toEvidence` → `sourceTiers` → `originCluster` → 发 `evidence.added`（provenance `search(query)`）与 `evidence.updated(clusterId)`；同时按命题发 `stage.started/finished`。未入选命题不检索，保持无立场（后续 judge 得 unverified）。

Not this：不抓正文（首轮只用摘要，抓取归 Investigator）；不判读立场。

Evaluator：`retrieve.test.ts` 用假 provider：负荷选择顺序正确；每条证据带 query provenance；跨命题同一 URL 只出现一次 `evidence.added`（第二次为 `stance` 关联时复用）；一源全失败仍产出其余来源；空结果不抛错。

Evidence：测试名。

### T09 · Assess 阶段与 judge 规则 ★

依赖：T02、T03、T05、T06。

Change：

- `stages/assess.ts`：每条命题一张工单，输入命题 + 其证据（id、title、excerpt 或 text 前 1500 字），输出 `stances[]{evidenceId, stance: supports|refutes|partial|contextual, quote, confidence}`。代码校验 `quote` 为该证据 `text ?? excerpt` 的子串（忽略空白差异），不是则 `confidence` 置 0 并标 `quoteFidelity=false`。发 `stance.added`。
- `rules/judge.ts`（纯函数）：按 ADR-007 第 2 节。簇内取最高层级权重（A=3、B=2、C=1），同簇只计一次；`sup / ref / par` 为各簇权重和；规则常量集中在 `judgeConfig.ts`。输出 `ClaimVerdict` + `basis`（用到的 stance id）+ `rule`（触发的规则名）。`contested` 定义：`sup ≥ 3 且 ref ≥ 3`。
- `rules/overall.ts`：命题判决 → 整句 `verdictType`（`true | false | mixed_misleading | unverified`）+ `contested` 标记；`rules/score.ts`：0–100 公式（依据覆盖率、独立簇数、A 级占比、unverified 占比、contested 扣分），输出 `breakdown` 可读。用 T05 搬入的两份 credibility 中较可解释的一份作参考，不必保留其 API。

Not this：模型不输出命题判决；不在 judge 里读 URL 文本以外的任何模型字段；不做 tiny-rumor 一类启发式。

Evaluator：`judge.test.ts` 表驱动 ≥ 20 行：无立场→unverified；单 C 支持→unverified；一 A 反驳→false；两独立 B 支持→true；同簇三 C 支持→unverified（只算一次）；A 支持 + A 反驳→contested；partial 主导→partial；不可达证据不计。`assess.test.ts`：引文不在原文中 → confidence 0。`overall.test.ts`：真 + 假→mixed；`score.test.ts`：分解字段之和等于总分。

Evidence：测试名；`judgeConfig.ts` 路径。

### T10 · Investigator ★

依赖：T02、T03、T04、T06、T09。

Change：`stages/investigate.ts`，导出 `runInvestigator({ case, role, budget, deadline, tools, llm, emit }): { stopReason }`。

- 感知：`gaps = 命题 ∈ {unverified, contested} 或其 basis 全为 C 级`；候选动作 = 缺口查询（`evidencePursuit.assessEvidenceGap → queriesForGap`）∪ frontier 中未消费 pivot。
- 决策：一张工单，输入案件摘要（命题与判决、缺口、候选 ≤10 条含 expectedValue、剩余预算），输出一个动作 `{ kind: search|fetch|reverse_image|recall|stop, target, why }`。代码校验：target 在候选内、未消费、深度 ≤ 3、预算未尽；否则用确定性策略选 expectedValue 最高的候选。
- 行动：`search` → `searchAll`；`fetch` → `webFetch` 后 `extractPivots` + 一张「这页在引用谁、指向哪个原始来源」工单 → `frontier.added`、`evidence.cites`；`reverse_image` → 搬入的 reverseImage；`recall` → `semanticRecall`。新证据发 `evidence.added`（provenance `pivot` 或 `search`），受影响命题增量 `assess` → `judge` → `verdict.updated`。
- 增益：本步为某未解决命题带来新独立簇 = 1，否则 0。判停：预算尽 / 连续 3 步零增益 / 所有命题判决 ∈ {true,false,partial} 且 basis 含 A 级 / 到期 / 工具连续失败 3 次。发 `investigator.step`（n、goal、gap、action、why、result、gain）与 `investigator.stopped(reason)`。
- 默认预算：main 12 步；prosecutor / defender 各 4 步。

Not this：不让模型直接写证据或判决；不引 pi / LangGraph；不做无界递归；不在无缺口时启动（调用方保证，本函数也要 0 步返回 `resolved`）。

Evaluator：`investigate.test.ts` 用 `FakeLlm` + 假工具：
1. 两跳出处链：转载页 → 外链 pivot → gov 页；断言 `evidence.cites` 边存在、gov 证据 tier A、命题判决从 unverified 翻为 false、`stopReason=resolved`。
2. 模型提议非法 target → 代码回退选择，事件里 `why` 标明 `fallback`。
3. 连续零增益 3 步 → `no-gain`。
4. 预算 2 步 → `budget`。
5. deadline 已过 → 0 步 `time`。
6. 工具连续抛错 → `tool-failed`。
7. 无缺口 → 0 步 `resolved`。
另加 `probeInvestigator.ts`（真实 key，手动）：对「人社部发文说生育津贴直接打到个人卡里了」跑一次，附事件日志路径。

Evidence：测试名；probe 日志路径（不贴全文）。

### T11 · 交叉复核阶段

依赖：T09、T10。

Change：`stages/crossExam.ts`：对 `contested` 命题，顺序起 `runInvestigator(role=prosecutor, forceGaps)` 与 `runInvestigator(role=defender, forceGaps)`，任务书写进各自 investigate 工单的系统提示后缀（控方：只找反证与原始来源；辩方：只找佐证与原语境；assess 工单不带任务书，两方读证据用同一中立 prompt）；`forceGaps` 让两方都跑满自己的预算，不因命题已被对方翻案而 0 步退场；模型选择：`providers` 由运行器传入（阶段不读 env），≥2 时两方用不同厂商（`withModelOverride(ctx, choice)` 包装 `ctx.llm`），否则同源并发 `error` 事件注明；两方产出的 stance 标 `by`；结束后 `judge` 重判，仍 contested 则 `overall.contested=true`，score 扣分由 `score.ts` 处理。judge 补「压制」规则：`CONTESTED_DOMINANCE = 2`，一方权重达另一方两倍即不再 contested，落到 false / true 规则——否则交叉复核永远翻不了案。

Not this：不让两方互相对话；不做多轮辩论；不重写判词；无 contested 命题时不发任何事件。

Evaluator：`crossExam.test.ts`：非 contested 命题不触发；两方各自预算独立；stance 带 `by`；控方找到 A 级反证后判决翻为 false（3 vs 6）；两方均无新增 → 保持 contested 且 `overall.contested`；单厂商 key 时两方同源但仍运行并在事件里注明；`providers` 两个时两方工单的 `modelOverride` 各不同；任务书无判真假措辞。`judge.test.ts` 加 3 行：3/6→false、6/3→true、3/5→contested。`investigate.test.ts` 加 `forceGaps` 一行。

Evidence：测试名。

### T12 · Compose 与 finalize

依赖：T05、T09。

Change：`stages/compose.ts`：一张工单，输入原句、命题（判决 + basis 的引文与证据编号 `[n]`）、frontier 摘要，输出 `conclusion`（第一句直接回答原句）、`claimItems[]{claimId, line, citations[]}`。`stages/finalize.ts`：校验并修复：每个 `[n]` 可解析；含 `true/false/partial` 判决的 `claimItems.line` 至少一个引用；第一句不得是「能信 / 不能信 / 只能信一部分 / 还查不清」；`publicCopy` 剥工具名、厂商名、模型名；搬入的 `reportReviewer` 规则（模糊量词等）；不可修复 → 确定性兜底报告（用命题判决逐条生成句子）。发 `report.finalized`。

Not this：composer 不得收到 stance 以外的任何检索原文；不允许 composer 引入案外 URL。

Evaluator：`finalize.test.ts`：悬空 `[n]` 被修复或该句降级为 unverified 表述；模型写了「MiniMax」「web_search」被剥掉；首句为四字章 → 重写；composer 抛错 → 兜底报告结构完整、每条命题一行、无空字段；引用 `[n]` 与 `Report.citations` 一一对应。

Evidence：测试名。

---

## Wave 3 · 运行器、追问、服务端、eval

### T13 · 案件运行器

依赖：T07–T12。

Change：`runner/runTurn.ts`：`runTurn({ case, message, route, deps, budget: { totalMs, composeReserveMs } }): AsyncIterable<CaseEvent>`。顺序：decompose → retrieve → assess → judge → investigate（有缺口）→ crossExam（有 contested）→ compose → finalize。每阶段前检查 `signal` 与剩余时间；投资类阶段（investigate / crossExam）在剩余时间 < composeReserve 时跳过并发 `stage.finished(skipped)`；失败开放策略：decompose 失败 → 整句一条命题；assess 失败 → 该命题无 stance；compose 失败 → 兜底。默认 `totalMs=120000`、`composeReserveMs=30000`。

Not this：HTTP 不在这里；不读 `process.env`；不并发两轮同案。

Evaluator：`runTurn.test.ts` 全假依赖：事件顺序符合阶段顺序；`turn.finished.reason` 四种各一例；剩余时间不足时 investigate 被 skipped；abort 后 ≤1 个阶段内结束；每阶段的 `llm.called` 事件存在且 `model` 字段在公开序列化前被剥（配合 T15）。

Evidence：测试名。

验收清单（checker 在 `.worktrees/T13` 逐条执行，每条只答 PASS / FAIL + 一行证据；任何一条 FAIL 即打回）：

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | `npm test --workspace=@rhg/core` | 退出码 0；用例总数 ≥ 378 + 7 |
| 2 | `npm run build --workspace=@rhg/core` | 退出码 0 |
| 3 | `git status --short`；`git diff --stat spine...HEAD` | 干净；改动只在 `packages/core/src/runner/`，不含 `stages/index.ts`、`packages/core/src/index.ts`、`mvp/` |
| 4 | `rg "process\.env" packages/core/src/runner/` | 0 命中 |
| 5 | `rg "from \"../../mvp\|from \"mvp" packages/core/src/runner/` | 0 命中 |
| 6 | 读 `runTurn.ts`：找事件流的来源 | 事件来自 `createStageContext({ onEvent })`，没有自写的 emit 拦截或第二个 reducer |
| 7 | 读 `runTurn.ts`：new_claim 阶段顺序 | intake → decompose → retrieve → assess → judge → investigate → crossExam → compose → finalize，无缺无换位 |
| 8 | 读测试「事件顺序」用例的断言 | 断言 `stage.started.stage` 序列是第 7 条的子序列，且首事件 `turn.started`、末事件 `turn.finished`，`message.added` 恰两条（user 先 assistant 后） |
| 9 | 读四种 reason 用例的触发方式 | done：正常走完；timeout：靶向 `clock`，且断言有 `stage.finished(outcome: skipped)`；aborted：真的 `AbortController.abort()`，断言 abort 后到 `turn.finished(aborted)` 之间 `stage.started` ≤ 1 条，且没有 compose/finalize 事件；error：触发路径真实可达（如 `tools.fetch` 抛 TypeError 或 invariants 违反），不是在 runner 里为测试加的后门 |
| 10 | 读 timeout 用例 | investigate 被 skipped 时仍有 `report.finalized` |
| 11 | 读「llm.called 每阶段存在」用例 | 至少覆盖 decompose、assess、compose 三个 job |
| 12 | 读「同案并发」用例 | 第二轮只产生 `error`，不产生 `turn.started`；第一轮不受影响 |
| 13 | 读「消费者 break」用例 | for-await 里 break 后测试正常结束、无 unhandled rejection |
| 14 | 读「replay」用例 | `replay(全部事件)` deepEqual 运行器最终快照，且 `assertInvariants` 通过 |
| 15 | 读 `runTurn.ts` 非 new_claim 分支 | 发 `error` + `turn.finished(error)`，没有实现其他路由的半成品逻辑 |
| 16 | 读 `runTurn.ts` 的并发锁 | 模块级 `Set<caseId>`，finally 里释放，有 `ponytail:` 注释标明单进程 |
| 17 | `rg "能信\|不能信\|可信\|不可信" packages/core/src/runner/` | 0 命中（runner 不写用户文案） |

### T14 · 追问路由与多轮

依赖：T13。

Change：`runner/route.ts`：确定性优先（消息含 URL → `challenge`；携带 `pivotId` → `pursue_frontier`），否则一张工单归类 `new_claim | ask_case | off_topic`。`runner/turns.ts`：`pursue_frontier` → 以该 pivot 为种子跑 investigate → assess → judge → compose 增量；`challenge` → URL 抓取为证据（provenance `user`）→ assess → judge → compose 增量；`ask_case` → 一张工单只拿案件状态作答，代码校验回答中 URL ⊆ 案内 URL、且不含案外命题（简单校验：回答中的数字与专名需出现在案内证据文本中，否则改为「案内材料没有这一点，可以从这些方向再查」并附 frontier）；`off_topic` → 固定婉拒文案。

Not this：不做开放式聊天；不让 `ask_case` 触发检索。

Evaluator：`route.test.ts` 覆盖五类；`turns.test.ts`：`pursue_frontier` 消费 pivot 并产生 `frontier.consumed`；`challenge` 的证据 provenance 为 `user` 且参与 judge；`ask_case` 回答中出现案外 URL 被拦并替换。

Evidence：测试名。

设计定案（builder 照此实现，checker 照此核验）：

- `RunTurnInput.route` 改为可选；缺省时由 `routeMessage(case, message, llm)` 决定。`message` 增加 `pivotId?: string`。决定的 route 写进 `message.added(user).route`。
- 路由优先级（确定性在前）：① `pivotId` 存在 → `pursue_frontier`（pivot 不在案内 frontier 或已 consumed → 发 `error` + `turn.finished(error)`，不跑任何阶段）；② 案内 `claims.length === 0` → `new_claim`，不调 LLM（首轮永远是立案，带 URL 的首句由 intake 当附件抓，不是 challenge）；③ 消息文本含 URL → `challenge`；④ 否则一张工单 `route` 归类 `new_claim | ask_case | off_topic`，用 `parseJobOutput` 校验，LLM 失败或校验失败 → `new_claim`。（2026-09-03 修订：原稿 URL 在空案之前，会让首句带链接的案子进 challenge 面对 0 条命题。）
- 追问路径的 compose + finalize 必须复用 `runTurn` 里带 abort / 时间预算 / markError 的那段（抽成 runner 内部 helper 两处调用），不准在 `turns.ts` 再写一份。
- `pursue_frontier`：`InvestigatorInput` 增加 `seedPivotId?: string`，第一步不问 LLM、直接对该 pivot 执行动作（link → fetch；entity/query → search；image → reverse image），之后按原逻辑跑完预算。然后 assess（只补新证据）→ judge → compose → finalize。
- `challenge`：用 `deps.tools.fetch` 抓 URL（SSRF 在 webFetch 内）→ `evidence.added`，`provenance: "user"`，tier 用 `tierOf`；对每个可核查命题 `runAssess({ evidenceIds: [该证据] })` → judge → compose → finalize。抓不到（unreachable / 被拦 / 无正文）：不发 `evidence.added`，发 `message.added(assistant)` 固定文案 + `turn.finished(done)`。这不是系统错误。
- `ask_case`：恰一张工单 `ask_case`，输入 = 命题 + 判决 + 证据（标题 / host / 层级 / 摘要 / URL）+ 报告；输出 `{ answer: string }`。代码校验：(a) 回答中的 URL ⊆ 案内证据 URL；(b) 回答中每个数字串（`\d+(\.\d+)?`，去千分位）出现在案内证据文本 ∪ 命题文本 ∪ 报告文本中。任一不满足 → 用固定兜底文案 + 最多 3 个 frontier pivot 标签替换回答。专名不校验，标 `ponytail:` 注释。零检索、零抓取。
- `off_topic`：固定文案，路由之后零 LLM、零阶段。
- 固定文案（challenge 抓不到、ask_case 兜底、off_topic）全部放 `text/publicCopy.ts`，runner 只引用。
- 每个路由都产出 `turn.started` → `message.added(user)` → … → `message.added(assistant)` → `turn.finished`。

验收清单（checker 在 `.worktrees/T14` 逐条执行，每条只答 PASS / FAIL + 一行证据；任何一条 FAIL 即打回）：

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | `npm test --workspace=@rhg/core` | 退出码 0；用例总数 ≥ T13 合入时总数 + 14 |
| 2 | `npm run build --workspace=@rhg/core` | 退出码 0 |
| 3 | `git status --short`；`git diff --stat spine...HEAD` | 干净；改动仅在 `packages/core/src/runner/**`、`packages/core/src/stages/investigate.ts`、`packages/core/src/stages/investigate.test.ts`、`packages/core/src/text/publicCopy.ts`（及其测试）；不含 `mvp/`、`casefile/schema.ts`、`stages/index.ts`、`packages/core/src/index.ts` |
| 4 | `git diff spine...HEAD -- packages/core/src/stages/investigate.ts` | 只增加 `seedPivotId` 相关逻辑；现有五个停止条件、`decideAction`、`act` 的既有分支没有被改写 |
| 5 | `rg "process\.env\|mvp/" packages/core/src/runner/` | 0 命中 |
| 6 | 读 `route.ts` | 判断顺序与「设计定案」一致：pivotId → 空案 → URL → LLM；LLM 调用在三条确定性分支之后 |
| 7 | 读 `route.test.ts` | 五类各 ≥1 例；pivotId 与 URL 同时存在 → `pursue_frontier`；空案无 URL → `new_claim` 且 FakeLlm 调用数为 0；**空案含 URL → `new_claim`**；LLM 返回非法 JSON → `new_claim` |
| 7b | 读 `turns.ts` 与 `runTurn.ts` | compose + finalize 只有一处实现（同一个函数），new_claim 与 challenge / pursue_frontier 都调它；`rg -n "runCompose\|runFinalize" packages/core/src/runner/` 各只命中 1 处调用 |
| 7c | 读 challenge / pursue_frontier 路径 | `signal` 传进了 investigator / assess 用的 ctx；有一条用例：challenge 路径在 fetch 之后 abort，`turn.finished.reason === "aborted"` 且无 `report.finalized` |
| 8 | 读 `runTurn.ts` | `route` 缺省时调用 `routeMessage`；显式传入时不调；`message.added(user).route` 等于最终 route |
| 9 | 读 pursue_frontier 用例 | 事件流含 `frontier.consumed(pivotId)`；第一条 `investigator.step` 的 `action.target` 等于该 pivot 的 value / label；在该 step 之前没有 `job === "investigate"` 的 `llm.called` |
| 10 | 读 pursue_frontier 非法 pivot 用例 | pivotId 不在案内 → 只有 `turn.started`、`message.added(user)`、`error`、`turn.finished(error)`，没有 `stage.started` |
| 11 | 读 challenge 用例 | 有且仅一条新 `evidence.added`，其 `provenance === "user"`；之后有 `stance.added` 引用该 evidenceId；之后有 `verdict.updated`；有 `report.finalized` |
| 12 | 读 challenge 抓不到用例 | fake fetch 返回 `reachable:false`：无 `evidence.added`，有 `message.added(assistant)`，`turn.finished.reason === "done"`，无 `error` |
| 13 | 读 ask_case 正常用例 | `llm.called` 恰一条且 `job === "ask_case"`；fake search / fetch 调用次数为 0；无 `stage.started` |
| 14 | 读 ask_case 案外 URL 用例 | FakeLlm 回答含案外 URL → assistant 消息不含该 URL，含兜底文案，含 ≥1 个 frontier 标签 |
| 15 | 读 ask_case 案外数字用例 | FakeLlm 回答含案内不存在的数字 → 被替换；对照组：数字存在于证据文本 → 原样保留 |
| 16 | 读 off_topic 用例 | 路由之后 `llm.called` 为 0 条（或仅路由那 1 条）；无 `stage.started`；assistant 文案等于 `publicCopy` 中的常量 |
| 17 | 读四个非 new_claim 路由的用例 | 每个都断言 `replay(events)` toEqual 最终快照且 `assertInvariants` 不抛 |
| 18 | 读 `runTurn.ts` | 同案互斥锁在路由判定之前获取，五个路由共用 |
| 19 | `rg "能信\|不能信\|可信\|不可信\|靠谱\|转发" packages/core/src/runner/` | 0 命中（文案在 publicCopy） |
| 20 | 读 `publicCopy.ts` 新增文案 | 三段文案里没有「请勿」「不要相信」「谣言」「转发」字样；没有厂商 / 模型 / 工具名 |
| 21 | 读 ask_case 数字校验实现 | 有 `ponytail:` 注释说明只校验数字不校验专名 |

### T15 · 服务端

依赖：T13、T14。

Change：`packages/server`：`POST /api/cases`（新建，返回 caseId + 首轮 SSE）、`POST /api/cases/:id/turns`（SSE）、`GET /api/cases/:id`（事件日志 + 折叠状态）、`GET /api/cases`（列表）。SSE：15s 心跳、客户端断开即 abort、`X-Accel-Buffering: no`。公开事件经 `toPublicEvent`：剥 `llm.called.model`、任何字段中的厂商 / 模型名、堆栈；`error` 只留用户可读文案。案件存储：`.data/cases/<id>.jsonl` 追加事件（目录可配置）。配额：搬 `mvp/server/src/lib/checkQuota.ts`；账号相关（`accountStore`、`emailAuth`）本任务不搬，记入任务页。

Not this：不把任何域规则写进 handler；不复制 reducer（从 core 引）。

Evaluator：`server.test.ts` 用 supertest 风格（原生 fetch 到临时端口）：新建案件后 `GET` 返回的折叠状态等于 `replay(日志)`；SSE 事件序列化后用正则断言不含 `minimax|stepfun|deepseek|mimo|openai|anthropic|web_search|gpt|claude`；断开连接后服务端 abort（用假 deps 记录）；心跳帧出现。

Evidence：测试名；`curl` 一次真实 SSE 的前 5 行（不含密钥）。

设计定案（2026-09-03 验收人）：

- 修订：**不搬 `checkQuota`**。它缠着 accountStore / aipingAuth / emailSession / jsonSnapshot 和客户端 lib，搬它等于搬账号系统。改为进程内按 IP 的日配额：`Map<ip, { day, count }>`，环境变量 `DAILY_CHECKS_PER_IP`（默认 20，`0` 关闭），只拦两个 POST，超限 429 + `publicCopy` 文案。标 `ponytail:` 注明进程内存、重启清零、升级路径是账号。账号与登录配额记入任务页，T20 之后单独立项。
- 修订二（2026-09-03 19:20，替代原稿「断连即 abort」）：**轮次是服务端作业，SSE 只是视图。** 手机切后台、网络抖动会断 fetch 流，断了就废掉一次两分钟的调查是产品缺陷。所以：POST 只启动轮次并立刻返回 JSON；事件从 `GET /api/cases/:id/stream?since=<seq>` 订阅，断了重连补齐；显式 `POST /api/cases/:id/abort` 才中止；进程收 SIGTERM 时 abort 所有在跑轮次让日志收口。`src/turns.ts`：`TurnRunner`——每案一个 `AbortController` + 进程内 `EventEmitter` 总线（`Map<caseId, …>`），事件到达即 `store.append` 一条（不是轮次结束再批量写，崩了日志也是一致前缀）再广播。同案并发以 `TurnRunner` 为准返回 409（runner 自己的锁是第二道）。标 `ponytail:` 单进程总线，多实例升级路径是 Redis pub/sub。
- 文件：`src/app.ts`（express 5，路由挂载）、`src/deps.ts`（`buildDeps(env): RunTurnDeps`）、`src/store.ts`（`CaseStore` 接口 + `FileCaseStore(dir)`）、`src/turns.ts`（`TurnRunner`）、`src/sse.ts`（写帧、心跳、断连清理）、`src/publicEvent.ts`（`toPublicEvent`）、`src/quota.ts`。handler 里不出现任何域规则；`Case` 状态只用 core 的 `replay`。
- `buildDeps(env)`：`llm = (p) => callJob({ ...p, env })`；`searchProviders = defaultSearchProviders(env)`（core 已导出）；`tools.search = (q) => searchAll({}, q, { providers: searchProviders })`（同一组 providers，两处不再各造）；`tools.fetch = (url) => webFetch(url)`；`tools.reverseImage = makeSearch360ReverseImage(env)`（未配置则 undefined）；`tools.vision` 有 StepFun key 时包 `callStepFunVisionForIntake`，否则 undefined；`providers = listAvailableModels(env)` 映射成 `ModelChoice[]`。`process.env` 只在 `index.ts` 读一次传进来。
- 存储：`.data/cases/<caseId>.jsonl`，每行一个 `CaseEvent`，只追加；目录由 `CASES_DIR` 配置，默认 `.data/cases`。`CaseStore = { append(caseId, events), load(caseId): CaseEvent[] | null, list(): { caseId, text, createdAt, updatedAt, verdictType? }[] }`。不存快照；任何时候的状态 = `replay(load())`。`list()` 逐文件 replay，标 `ponytail:` O(n)、升级路径索引文件。
- 路由：
  - `POST /api/cases` body `{ text, attachments? }` → 202 `{ caseId, turnId }`。`createCase` 的事件先落日志，再启动首轮（detached）。
  - `POST /api/cases/:id/turns` body `{ text, pivotId?, attachments? }` → 202 `{ turnId }`；案件不存在 404；该案有轮次在跑 409 `{ error }`。
  - `POST /api/cases/:id/abort` → 204；没有在跑的轮次也 204。
  - `GET /api/cases/:id/stream?since=<seq>` → 200 SSE。先把日志里 `seq > since` 的事件按序发出（补齐），再接总线直播；`since` 缺省取请求头 `Last-Event-ID`（浏览器 `EventSource` 自动重连时带），再缺省为 0。每帧 `event: case.event`，`id: <seq>`，`data: <公开事件 JSON>`。流不主动结束（客户端看到 `turn.finished` 自己决定留或走）；客户端断开只是解除订阅，**不 abort 轮次**。补齐与直播衔接不得丢事件、不得重复（订阅总线在读日志之前，缓冲期间到达的事件按 seq 去重）。
  - `GET /api/cases/:id` → `{ case, events, running: boolean }`，`case` 与 `events` 都是公开形态，且 `case === replay(events)`。不存在 404。
  - `GET /api/cases` → `list()` 结果，按 `updatedAt` 降序。
  - 请求体非法 400；`text` 空或 > 4000 字 400。
- SSE：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`X-Accel-Buffering: no`；每 15s 一帧注释 `: ping`；`res` 的 `close` → 解除总线订阅、清心跳；关闭后 `write` 有守卫。
- 进程退出：`SIGTERM` / `SIGINT` → `TurnRunner.abortAll()`，等 `turn.finished` 落盘（上限 5s）再 `server.close()`。
- `toPublicEvent(e)`（定点脱敏，不做全文正则，证据正文里合法出现的公司名不能被删）：`llm.called` → `model: ""`、删 `error`；`error.message` → `scrubPublicText`；`evidence.added` 里 `provenance.kind === "search"` → 删 `provider`（`evidence.updated` 的 schema 没有 provenance 字段，原样）；其它事件原样。返回值必须仍通过 `validateEvent`。
- `index.ts`：读 `process.env` → `buildDeps` + `FileCaseStore` + `TurnRunner` → `createApp({ deps, store, turns, quota })` → listen + 信号处理。`createApp` 接受注入，测试全用假 deps / 临时目录。

验收清单（checker 在 `.worktrees/T15` 逐条执行，每条只答 PASS / FAIL + 一行证据；任何一条 FAIL 即打回）：

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | `npm run build --workspace=@rhg/core && npm test --workspace=@rhg/server` | 退出码 0；server 用例 ≥ 18 |
| 2 | `npm run build --workspace=@rhg/server` | 退出码 0 |
| 3 | `git status --short`；`git diff --stat spine...HEAD` | 干净；改动仅在 `packages/server/**`、`package-lock.json`、`.gitignore`；不含 `packages/core/`、`mvp/` |
| 4 | `rg "process\.env" packages/server/src` | 只在 `index.ts` 命中 |
| 5 | `rg "from \"[./]*mvp\|mvp/" packages/server/src` | 0 命中 |
| 6 | `rg "reduce\(\|switch \(event\.type\)\|verdict\|tier\|stance" packages/server/src --glob '!*.test.ts'` | handler / store / sse 里没有域规则：允许的命中只有 `replay(` 调用与 `publicEvent.ts` 里的字段删除 |
| 7 | 读 `deps.ts` | `tools.search` 用 `searchAll({}, q, { providers })` 且 `providers` 与 `searchProviders` 是同一个数组引用；`llm` 是 `callJob` 包一层传 `env` |
| 8 | 读 `store.ts` | 只有 append / load / list；没有写快照；`list` 用 `replay`；有 `ponytail:` 注释 |
| 9 | 读「GET 等于 replay」用例 | 断言 `body.case` toEqual `replay(body.events)` |
| 10 | 读「日志等于状态」用例 | 假 deps 跑完一轮后，直接读 `.jsonl` 文件逐行 `JSON.parse` → `replay` → toEqual 服务端 `GET` 返回的 `case`（公开形态差异只在 `llmCalls[].model` 与 provenance.provider，用例要么用无 llm/无 provider 的假 deps，要么先 `toPublicEvent` 再比） |
| 10b | 读「逐条落盘」实现 | `turns.ts` 里每收到一个事件就 `store.append` 再广播，不是轮次结束批量写；有用例：假 llm 在 assess 阶段抛错 / 挂起时，`.jsonl` 已含 `turn.started` 与之前的阶段事件 |
| 11 | 读 SSE 脱敏用例 | 假 deps 产生的事件里故意含 `model: "minimax-x"`、`error: "stepfun 500"`、`provenance.provider: "web_search"`；对整条 SSE 文本断言 `/minimax\|stepfun\|deepseek\|mimo\|openai\|anthropic\|web_search\|gpt\|claude/i` 不匹配 |
| 12 | 读 `publicEvent.ts` 用例 | `toPublicEvent` 输出再过 `validateEvent` 不抛；含 "OpenAI" 字样的证据 `text` 原样保留 |
| 13a | 读「断连不中止」用例 | 客户端在轮次中途关掉 stream 连接后，轮次继续跑完，日志末尾是 `turn.finished(done)`，不是 `aborted` |
| 13b | 读「显式 abort」用例 | `POST /api/cases/:id/abort` 后假 deps 观察到 `signal.aborted === true`，日志末尾 `turn.finished(aborted)`；再 abort 一次仍 204 |
| 13c | 读「重连补齐」用例 | 轮次跑到中途，新开 `stream?since=<已收到的最大 seq>`，收到的第一条事件 `seq === since + 1`，且到 `turn.finished` 为止 seq 连续无重复；另一例：不带 `since` 但带请求头 `Last-Event-ID: <n>`，效果同 `since=n` |
| 13d | 读「409」用例 | 同案第二个 `POST turns` 在第一轮跑完前返回 409；跑完后再 POST 返回 202 |
| 14 | 读心跳用例 | 假 clock / 缩短心跳间隔后，SSE 文本里出现 `: ping` |
| 15 | 读 SSE 帧格式用例 | 每帧 `event: case.event`、`id: <seq>`、`data:` 能 `JSON.parse` 并过 `validateEvent`；`since` 缺省时从 `case.created` 开始 |
| 15b | 读 `POST /api/cases` 用例 | 返回 202 且 body 有 `caseId`、`turnId`；随后 `GET /api/cases/:id` 的 `running === true`（首轮未完）或事件里已有 `turn.started` |
| 16 | 读 404 / 400 用例 | 未知 id 的 GET、stream、POST turns、abort 都 404；空 `text` 400；非 JSON body 400 |
| 16b | 读 `index.ts` | `SIGTERM` / `SIGINT` → `abortAll()` → 等待（上限 5s）→ `server.close()` |
| 17 | 读配额用例 | `DAILY_CHECKS_PER_IP=2` 时第 3 次 POST 429；`0` 时不拦；响应文案不含「请勿」「谣言」 |
| 18 | 读 `quota.ts` | `Map` 按日键；有 `ponytail:` 注释 |
| 19 | 读 `app.ts` | `createApp` 参数注入 deps / store / turns / quota；`express.json({ limit })` 有限制（≤ 2mb，附件 data URL 要过） |
| 20 | 读 `sse.ts` | 响应头三件齐（`text/event-stream`、`no-cache`、`X-Accel-Buffering: no`）；`res.on("close")` → 解除订阅 + 清心跳；关闭后 `write` 有守卫 |
| 20b | 读 `turns.ts` | 每案一个 `AbortController`；总线是进程内 `EventEmitter`（或等价）；有 `ponytail:` 注释写单进程与 Redis 升级路径；`abortAll()` 存在 |
| 21 | 真实运行：工作树根 `cp ../../mvp/.env.local .env.local`（不提交）后 `npm run dev --workspace=@rhg/server`，另一终端：`curl -s -X POST localhost:<port>/api/cases -H 'content-type: application/json' -d '{"text":"国家医保局宣布 2026 年起生育津贴直接发个人"}'` 拿 `caseId`，随即 `curl -N -s localhost:<port>/api/cases/<caseId>/stream \| head -20` | POST 返回 202 含 `caseId` / `turnId`；stream 前 20 行里有 `event: case.event`、`id:`，data 里能看到 `case.created`、`turn.started`、`stage.started`；`rg -i "minimax\|stepfun\|deepseek"` 对完整输出 0 命中。把 POST 响应与 stream 前 20 行（不含密钥）贴进报告 |
| 21b | 第 21 条 stream 断开（head 退出）后等 90s，`curl -s localhost:<port>/api/cases/<caseId>` | `running` 变为 `false`（轮次没因断连而中止），`events` 末尾 `turn.finished` 的 `reason` 是 `done` 或 `timeout`，不是 `aborted`；`case.report` 非空。把 `report.conclusion` 贴进报告 |
| 22 | 第 21b 条后 `ls .data/cases/` 与 `wc -l .data/cases/*.jsonl` | 有一个文件，行数 ≥ 10；`git status --short` 不含 `.data/`（已 gitignore） |
| 23 | `rg "console\.log" packages/server/src --glob '!index.ts'` | 0 命中 |
| 24 | `rg ": any\b" packages/server/src` | 0 命中 |

### T16 · Eval 包与门禁

依赖：T13。

Change：`packages/eval`：搬 `mvp/server/eval/golden.ts`（28 例）；重写 `score.ts` 以新 `Report/Case` 为输入，保留指标名 `routingAccuracy / verdictAccuracy / credibilityAccuracy / hallucinationRate / reportContractPassRate`，新增 `groundingRate`、`quoteFidelity`、`provenanceDepth`、`latencyP50 / P95`；`run.ts` 支持 `--ids / --domain / --repeats / --gate <baseline>`；`--gate` 同时接受旧格式 `mvp/server/eval/baseline.json` 做打平比较（只比共有四项）。根脚本 `npm run eval` / `npm run eval:gate`。

Not this：不改 golden 的期望值；不把新指标进门禁（先观测）。

Evaluator：`score.test.ts` 覆盖每个指标的正反例；用一份假 `Case` 走通 `run.ts --ids` 输出 JSON；验收人用真实 key 跑全量一次，记录 run id 与四项对旧基线的差值。

Evidence：测试名；eval run id；对比表（四项 + 新指标）。

设计定案：

- 输入统一为 `{ case: Case, events: CaseEvent[], report: Report | null, elapsedMs: number }`（一个案子跑完 `runTurn` 后的产物）。所有指标是 `(golden, result) => number | null` 的纯函数，`null` 表示该例不适用（不进分母）。
- 指标定义（每项一句话，checker 按这句核对实现与测试）：
  - `verdictAccuracy`：`overall.verdictType === golden.expectedVerdictType`；`overall.contested === true` 时不算命中。
  - `credibilityAccuracy`：`overall.score` 落在 `expectedCredibilityRange` 闭区间内。
  - `hallucinationRate`：报告 `conclusion` / `claimItems[].line` 中出现的 `[n]` 在 `report.citations` 找不到、或 `citations[].evidenceId` 不在 `case.evidence`、或文本中出现的 URL 不在案内证据 URL 集合 → 该例记 1；否则 0。
  - `reportContractPassRate`：同时满足 → 1：`conclusion` 非空；每个 `verifiable` 命题在 `claimItems` 里恰有一行；每行 `citations` 非空；`scrubPublicText(conclusion) === conclusion`（无术语泄漏）。
  - `routingAccuracy`：**重定义**为「取路正确」：`golden.expectsEvidenceLoop === true` 时要求事件流里有 ≥1 条 `investigator.step`；未声明的例返回 `null`。只观测不门禁。
  - `groundingRate`：`verifiable` 命题中，判决非 `unverified` 且 `tally.sup + tally.ref ≥ 1` 的比例。
  - `quoteFidelity`：所有带 `quote` 的 stance 里，归一化（去空白、小写）后 `quote` 是对应证据 `text` 或 `snippet` 子串的比例；无 quote 的例返回 `null`。
  - `provenanceDepth`：报告引用到的证据里 `tier === "A"` 的比例。
  - `latencyP50 / latencyP95`：跨例 `elapsedMs` 分位数（在汇总层算，不是逐例）。
- `--gate <baseline>`：接受旧格式 `mvp/server/eval/baseline.json` 与新格式；只比 `verdictAccuracy / credibilityAccuracy / hallucinationRate / reportContractPassRate` 四项；前三项与第四项方向分别为高好 / 高好 / 低好 / 高好；任何一项劣化超过 0.02 → 退出码 1，并打印四行 `name old new delta`。`routingAccuracy` 语义已变，不比。
- `run.ts`：`--ids a,b`、`--domain x`、`--repeats n`、`--gate path`、`--fake`（用 `FakeLlm` + 空搜索走通流程，不出网）。输出 JSON 到 stdout：`{ runId, startedAt, cases: [{ id, verdictType, score, metrics, elapsedMs, turnReason }], summary: { 各指标 } }`；同时写 `packages/eval/runs/<runId>.json`（gitignore）。
- golden：`packages/eval/src/golden.ts` 逐字搬 `mvp/server/eval/golden.ts`，唯一允许的改动是删掉 `expectedAgentSequence` 字段的类型与值（新架构无此概念）。其它字段与值一个字不改。

验收清单（checker 在 `.worktrees/T16` 逐条执行，每条只答 PASS / FAIL + 一行证据；任何一条 FAIL 即打回）：

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | `npm test --workspace=@rhg/eval` | 退出码 0；用例总数 ≥ 22 |
| 2 | `npx tsc --noEmit -p packages/eval` | 退出码 0 |
| 3 | `npm test --workspace=@rhg/core` | 退出码 0，用例数不少于 spine 上的数字（core 未被改动） |
| 4 | `git status --short`；`git diff --stat spine...HEAD` | 干净；改动仅在 `packages/eval/**`、根 `package.json`、`package-lock.json`、`.gitignore`；不含 `mvp/`、`packages/core/` |
| 5 | `STRIP='s/\s*expectedAgentSequence\??:\s*(\[[^\]]*\],?\|string\[\];)//g'; diff <(perl -0pe "$STRIP" mvp/server/eval/golden.ts) <(perl -0pe "$STRIP" packages/eval/src/golden.ts)` | 差异为空，或只剩注释行；`rg -c expectedAgentSequence packages/eval/src/golden.ts` 为 0；文件里没有 `@ts-nocheck` / `@ts-ignore` |
| 6 | `rg "from \"[./]*mvp\|require\(.*mvp" packages/eval/src` | 0 命中（`mvp/server/eval/baseline.json` 只能作为 CLI 参数字串出现在文档 / 脚本里） |
| 7 | `rg "process\.env" packages/eval/src` | 只出现在 `run.ts`（或单独 `env.ts`），`score.ts` 里 0 命中 |
| 8 | 读 `score.ts` 导出 | 恰好导出上表 10 个指标名 + 一个 `summarize`（名称可异），没有别的指标 |
| 9 | 读 `score.test.ts` | 10 个指标每个至少一个返回最好值、一个返回最坏值的用例；`routingAccuracy`、`quoteFidelity` 各有一个返回 `null` 的用例 |
| 10 | 读 `verdictAccuracy` 实现与测试 | `contested === true` 时返回 0 的用例存在 |
| 11 | 读 `hallucinationRate` 测试 | 三个触发条件（悬空 `[n]`、悬空 evidenceId、案外 URL）各一例 |
| 12 | 读 `reportContractPassRate` 实现 | 四个条件都在；调用了 core 的 `scrubPublicText`（不是自己重写清洗） |
| 13 | 读 `--gate` 实现与测试 | 只比四项；方向正确（hallucinationRate 升为劣化）；劣化 0.02 边界有测试：0.02 不退、0.021 退 |
| 14 | `npx tsx packages/eval/src/run.ts --ids RUMOR-001,RUMOR-003 --fake` | 退出码 0；stdout 是合法 JSON；`cases.length === 2`；`summary` 含 10 个指标键 |
| 15 | `npx tsx packages/eval/src/run.ts --ids RUMOR-001 --fake --gate mvp/server/eval/baseline.json` | 能读旧格式；输出四行 `name old new delta`；退出码 0 或 1 均可，但不是崩溃（无堆栈） |
| 16 | `ls packages/eval/runs/` 且 `git check-ignore packages/eval/runs/x.json` | 第 14 条产生了文件；路径被 gitignore |
| 17 | 读根 `package.json` | `scripts.eval` 与 `scripts.eval:gate` 存在并指向 `packages/eval`（`-w @rhg/eval`） |
| 18 | 读 `run.ts` | 用的是 core 导出的 `runTurn`；没有复制任何阶段逻辑；没有自己构造 `Case` 之外的运行路径 |
| 19 | 读 `run.ts` `--repeats` | 同一 id 跑 n 次产生 n 条 `cases` 记录，`summary` 按条算 |
| 20 | `rg "console\.log" packages/eval/src/score.ts` | 0 命中 |

合入后由验收人另派一个 Grok 实例用 `mvp/.env.local` 真 key 跑 `npm run eval -- --repeats 1` 全量一次，记录 runId 与四项对旧基线差值到任务页；该实例只报数字，不下结论。

---

## Wave 4 · 界面

### T17 · Web 基础：设计系统、壳、事件客户端

依赖：T02、T15。

Change：`packages/web`：设计 token（字体：中文衬线只给品牌与结论、正文 sans；判决色三值 + 中性色；间距与圆角尺度）写在一个 `tokens.css`；布局壳：左侧案件列表（可收起）、中间线程、右侧案件面板（≥1024px 三栏；<1024px 面板折叠为顶部摘要 + 抽屉；375px 单栏）；`useCaseStream(caseId)`：连 SSE，逐事件 `reduce`，暴露 `case` 与连接状态；断流重连并从 `GET /api/cases/:id` 补齐；`fixtures/`：至少 5 个静态事件日志（拆题中 / 检索中 / 有 contested / 完成 / 追问后），`npm run dev -- --fixture=<name>` 可离线渲染。

Not this：不引 UI 组件库（antd 一类）；不复制任何 `mvp/src` 组件；不渲染任何「Agent 名」「工具名」。

Evaluator：`useCaseStream.test.ts`：事件应用顺序与 reducer 一致；断流后补齐状态相等。验收人在浏览器打开 5 个 fixture，桌面 + 375px 各截图，检查三栏折叠行为与无横向滚动（`document.documentElement.scrollWidth === innerWidth`）。

Evidence：测试名；截图路径 `packages/web/output/acceptance/T17-*.png`。

设计定案（2026-09-03 验收人）：

- 视觉语言沿用 `mvp/DESIGN.md` 的原则（暖纸、墨、克制；衬线只给品牌与判定句；判决三色只做文字 / 细线 / 淡底，不做大色块；不用颜色单独表示判断），**实现从零写**，不复制 `mvp/src/styles.css` 任何一行（那份 17.8K 行是要删的）。
- 依赖：允许新增 devDependencies `jsdom`、`@testing-library/react`（只用于测试）。不引 UI 组件库、不引 Tailwind、不引路由库、不引状态库。
- `@rhg/core` 只能引 `@rhg/core/casefile` 与 `@rhg/core/publicCopy` 两个子路径（core 根会拖进 node 模块）。`vite.config.ts` 用 `resolve.alias` 把这两个子路径指到 `../core/src/...` 源码（dev / build / vitest 同用），`tsconfig` 加对应 `paths`；web 开发不再依赖先 build core。
- `src/styles/tokens.css`（≤ 120 行）是唯一写死颜色 / 字体栈 / 尺度的地方：
  - 色：`--paper #fefcf6`、`--paper-deep #f5f1e6`、`--ink #151821`、`--ink-muted #5b6070`、`--accent #b91c3c`、`--verdict-true #16a34a`、`--verdict-false #e84a5f`、`--verdict-unclear #d97706`；线与淡底一律 `color-mix(in srgb, var(--x) N%, transparent)` 派生，N ∈ {6, 12, 14, 20}。
  - 字：`--font-serif`（Noto Serif SC → Source Han Serif SC → Songti SC → serif）、`--font-sans`（Noto Sans SC → PingFang SC → Hiragino Sans GB → Microsoft YaHei → system-ui）、`--font-mono`。T17 不加载 web 字体（自托管字体是 T20 运维事）。
  - 尺度：间距 4 / 8 / 12 / 16 / 24 / 32 / 48；圆角 4 / 8 / 12；字号 12 / 14 / 17 / 20 / 24 + `--type-display: clamp(28px, 4vw, 40px)`；行高正文 1.6、标题 1.3；动效 `--dur 160ms`、`--ease cubic-bezier(.2,.7,.2,1)`，`prefers-reduced-motion: reduce` 下 `--dur: 0ms`。
  - `:focus-visible` 统一 `outline: 2px solid var(--accent); outline-offset: 2px`。
- 其它 CSS 文件里不准出现十六进制色、`rgb(`、`hsl(`、`font-family:`；只能 `var(--…)`。
- 布局壳 `AppShell`：语义元素 `<nav>`（案件列表）/ `<main>`（线程）/ `<aside>`（案件面板）。≥1024px：grid 三栏 `auto minmax(0,1fr) 360px`，nav 240px 可收起到 0（按钮 `aria-expanded`，状态存 localStorage）；768–1023px：两栏，aside 变右侧抽屉，顶部一条摘要栏（判决词 + 分数）带「打开面板」按钮；<768px：单栏，nav 与 aside 都是抽屉。抽屉 Escape 关闭、遮罩点击关闭。任何宽度不出现横向滚动。
- 路由：`useRoute()` 读 `location.pathname`，`navigate(path)` 用 `history.pushState` + `popstate`。只有 `/` 与 `/cases/:id`。T17 在两页放最小占位（首页：一个输入框 + 提交 → `POST /api/cases` → 跳 `/cases/:id`；案件页：线程里按 `case.messages` 顺序渲染纯文本气泡，面板里按 `case.claims` 顺序渲染「命题文本 + 判决词（`publicCopy` 的 face 词）」纯文本列表）。这是 T18 / T19 要替换的骨架，不做样式修饰，但必须真的能从首页一句话跑到看见判决词。
- `api.ts`：`createCase`、`postTurn`、`abortTurn`、`getCase`、`listCases`、`openStream(caseId, since): EventSource`。流用原生 `EventSource`（服务端每帧带 `id: <seq>`，浏览器断线自动重连并带 `Last-Event-ID`；服务端 T15 要接受该头作为 `since` 回退——已列入 T15 合入前修正）。`vite.config.ts` 里 `server.proxy['/api'] → http://127.0.0.1:3100`（端口从 `VITE_API_PORT` 读，缺省 3100 = server 的 `DEFAULT_PORT`）。
- `useCaseStream(caseId)`：挂载时 `getCase` → 状态 = 返回的 `case`，再 `openStream(caseId, case.seq)`；每帧 `JSON.parse` → 若 `seq <= current.seq` 丢弃（重复）；若 `seq > current.seq + 1` 关流、重新 `getCase`、重开流（补洞）；否则 `reduce`。暴露 `{ case, status: "loading" | "live" | "reconnecting" | "error", running, sendTurn(text, pivotId?), abort() }`。`sendTurn` 遇 409 设 `status: "error"` 与可读消息，不抛。不写手动重试循环（`EventSource` 自带）。
- fixture 模式：路径 `/cases/fx-<name>` 时 `api.ts` 换成 fixture 源：`getCase` 返回该 fixture 的前 `k` 个事件折叠态（`k` 由 fixture 元数据指定「运行中」截断点），`openStream` 返回一个每 150ms 吐一个剩余事件的假 EventSource，`sendTurn` 空操作。这样「运行中」的界面状态能离线看到并截图。
- `fixtures/`：5 份 `*.json`（`decomposing`、`retrieving`、`contested`、`done`、`followup`），每份 `{ name, cutAt: number, events: CaseEvent[] }`。由 `fixtures/build.ts`（node 脚本，用 `@rhg/core` 根导出的 `runTurn` + `createFakeLlm` + 假搜索 / 假抓取，注入固定 `now`）生成，两次运行字节相同。`followup` 含两轮（new_claim 后 pursue_frontier）。`contested` 的 verdict 有 `contested: true` 且事件里有 `investigator.step` 的 `role: "prosecutor"` 与 `"defender"`。
- 界面文本里不出现「Agent / 智能体 / 工具 / 模型 / 厂商名」；状态词只用「正在拆题 / 正在找证据 / 正在核对 / 已完成 / 已中止」这一类。

验收清单（checker 在 `.worktrees/T17` 逐条执行；第 14–20 条由带浏览器的 checker 做，截图存 `packages/web/output/acceptance/`；每条只答 PASS / FAIL + 一行证据；任何一条 FAIL 即打回）：

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | `npm test --workspace=@rhg/web` | 退出码 0；用例 ≥ 10 |
| 2 | `npm run build --workspace=@rhg/web` | 退出码 0（tsc + vite build） |
| 3 | `git status --short`；`git diff --stat spine...HEAD` | 干净；改动仅在 `packages/web/**`、`package-lock.json`；不含 `packages/core/`、`packages/server/`、`mvp/` |
| 4 | `rg "from \"@rhg/core\"" packages/web/src packages/web/fixtures --glob '!build.ts'` | 0 命中（只允许 `@rhg/core/casefile`、`@rhg/core/publicCopy`；`fixtures/build.ts` 是 node 脚本可引根） |
| 5 | `rg "mvp/" packages/web`；`rg "antd\|@mui\|chakra\|tailwind\|react-router\|zustand\|redux" packages/web/package.json` | 都 0 命中 |
| 6 | `wc -l packages/web/src/styles/tokens.css`；`rg -c "verdict-(true\|false\|unclear):" packages/web/src/styles/tokens.css` | ≤ 120 行；恰 3 个判决色定义 |
| 7 | `rg "#[0-9a-fA-F]{3,8}\b\|rgba\?(\|hsla\?(" packages/web/src --glob '!tokens.css' --glob '!*.test.*'` | 0 命中 |
| 8 | `rg "font-family" packages/web/src --glob '!tokens.css'` | 0 命中 |
| 9 | 读 `useCaseStream.test.ts` | 四个用例都在：顺序应用后状态 toEqual `replay(全部事件)`；收到 `seq` 跳号 → 重新 `getCase` 并重开流，最终状态 toEqual `replay`；重复 `seq` 被丢弃；`sendTurn` 遇 409 → `status === "error"` 且不抛 |
| 10 | 读 `useCaseStream.ts` | 用 `EventSource`；`since` 取 `case.seq`；没有手写重试 `setTimeout` 循环 |
| 11 | 读 fixture 测试 | 5 份 fixture 每个事件过 `validateEvent`；`replay(events)` 过 `assertInvariants`；`contested` 的某 verdict `contested === true` 且有 prosecutor 与 defender 的 `investigator.step`；`followup` 有两条 `turn.started` 且第二条消息 `route === "pursue_frontier"` |
| 12 | `npx tsx packages/web/fixtures/build.ts && git status --short packages/web/fixtures` | 重跑后无变更（确定性） |
| 13 | 读 `vite.config.ts` 与 `tsconfig.json` | alias / paths 把 `@rhg/core/casefile`、`@rhg/core/publicCopy` 指到 core 源码；`/api` 代理存在 |
| 14 | 浏览器：`npm run dev --workspace=@rhg/web`，开 `/cases/fx-done`，1280×800 | 截图 `T17-done-desktop.png`；`nav`、`main`、`aside` 三个元素的 `getBoundingClientRect().width` 都 > 0 且 x 坐标左 < 中 < 右；`document.documentElement.scrollWidth === window.innerWidth`；面板里能看到判决词文本；控制台无报错；Network 里没有对 `/api` 的请求 |
| 15 | 浏览器：同页 375×812 | 截图 `T17-done-mobile.png`；`scrollWidth === innerWidth`；`nav` 与 `aside` 不可见（`offsetParent === null` 或 `display: none` 或在视口外）；`main` 可见 |
| 16 | 浏览器：375 下点「打开面板」按钮 | `aside` 可见且 `aria-expanded="true"`；按 Escape 后不可见；截图 `T17-done-mobile-drawer.png` |
| 17 | 浏览器：`/cases/fx-decomposing`、`/cases/fx-retrieving`、`/cases/fx-contested`、`/cases/fx-followup` 各 1280 + 375 | 8 张截图；每张 `scrollWidth === innerWidth`；`fx-retrieving` 打开 3 秒后 `aside` 里命题数量文本或证据计数发生过变化（假流在吐事件） |
| 18 | 浏览器：1280 下点 nav 收起按钮 | `nav` 宽度变 0 或不可见，`aria-expanded="false"`；刷新页面后仍收起（localStorage） |
| 19 | 浏览器：任一页执行 `[...document.querySelectorAll("button")].filter(b => !b.textContent.trim() && !b.getAttribute("aria-label")).length` | 为 0 |
| 20 | 浏览器：真后端联调——起 `PORT=3100 npm run dev --workspace=@rhg/server`（工作树根有 `.env.local`），开 `/`，输入「国家医保局宣布 2026 年起生育津贴直接发个人」提交 | 跳到 `/cases/<id>`；面板里命题在 `claims.added` 后即出现（不等结束）；180 秒内 `turn.finished`（当前核心时延是 T21 的事，这里只验链路通），此时线程里有助手消息、面板里 ≥1 条命题带判决词（timeout 兜底的「没查到」类判决词也算）；截图 `T17-live-desktop.png`；把面板里的命题 + 判决词文本与 `turn.finished.reason` 贴进报告 |
| 21 | `rg "智能体\|Agent\|工具名\|模型名\|minimax\|stepfun\|deepseek" packages/web/src --glob '*.tsx'` | 0 命中 |
| 22 | `rg "prefers-reduced-motion" packages/web/src/styles/`；`rg ":focus-visible" packages/web/src/styles/` | 各 ≥ 1 命中 |
| 23 | `rg ": any\b\|console\.log\|\.only\|\.skip" packages/web/src` | 0 命中（`fixtures/build.ts` 不在 src 下，允许 console） |
| 24 | `wc -l packages/web/src/**/*.{ts,tsx,css}` | 报行数（仅报告） |

### T18 · 案件视图 ★

依赖：T17。允许依赖：`@xyflow/react`。

Change：中间线程：用户消息气泡；助手回答 = `Report.conclusion` 与 `claimItems`，`[n]` 渲染为可点内联引用，悬停显示证据标题 / host / 层级 / 引文；回答下方 frontier 芯片（「还可以往哪查」），点击即发起 `pursue_frontier`；底部输入框。右侧案件面板：整句判决卡（`faceVerdict`、分数与分解）；命题列表（原句序，立场型夹在中间标「立场型 / 不适用真/假判断」，可核查的带判决色芯片，判决更新时有过渡）；证据板（按出处簇分组，簇根在前，每条标层级与立场标记，可点开）；出处图（`evidence.cites` 为边，簇为分组，A 级高亮；无边时不显示该区）；追索时间线（折叠，默认收起；每步显示目标 / 动作 / 结果 / 增益，停止原因可读）。运行中：命题在 `claims.added` 后即出现，证据流入时计数跳动，判决芯片随 `verdict.updated` 翻转。

Not this：不出现 Agent 名 / 工具名 / 模型名；不做「运维台」式日志墙；过程不抢结论的视觉层级。

Evaluator：验收人用真实后端跑 3 个 golden 案例（含一个会触发 Investigator 的、一个含立场句的、一个截图输入的），全程录屏或分段截图：命题 ≤10s 出现、首批证据 ≤20s、结论带 ≥1 可点引用、点击引用打开正确 URL、frontier 点击后新一轮事件进入同一案件；375px 下所有区块可达且无横向滚动。组件测试：`ClaimList.test.tsx`（判决芯片文案与颜色映射、立场型文案）、`Citations.test.tsx`（`[n]` 解析）、`ProvenanceGraph.test.tsx`（有边才渲染）。

Evidence：测试名；截图 / 录屏路径 `packages/web/output/acceptance/T18-*`。

设计定案（2026-09-03 验收人；T17 骨架之上换皮，不重搭壳 / 路由 / 流）：

- 第一屏回答三件事，按此顺序占视觉层级：**原句站不站得住**（结论段）→ **问题在哪**（命题逐条）→ **出处在哪**（引用）。过程（追索步骤、阶段进度）是次要信息，永远不抢这三件事的层级。
- 线程（`<main>`）：
  - 用户消息：被检原句是「证物」——衬线 600、17px、左侧 3px 墨线、`--paper-deep` 底，层级低于结论；追问消息同样式但更小（14px）。不做聊天气泡的圆角对话框。
  - 助手回答 = 一张「报告卡」，只用 `case.report` 与 `case`：
    1. 结论段：`report.conclusion`，衬线、`clamp(17px, 1.8vw, 19px)`、行高 1.7；首句加判决色 62% 高亮下划线（`background: linear-gradient(transparent 62%, color-mix(判决色 20%) 62%)`），判决色取 `overall.verdictType`（true→true、false→false、mixed_misleading / unverified→unclear）。`[n]` 渲染为内联可点引用（mono、12px、判决无关的 `--ink-muted` 细边圆角），hover / focus 出 popover：证据标题、host、层级字母、引文（`stance.quote`），点击在新标签打开 `evidence.url`。
    2. 命题逐条：`report.claimItems` 顺序；每条 = 判决芯片（文字 + 判决色，芯片文案用 `publicCopy` 的 face 词表，不自造）+ `line` + 该条的 `[n]`。立场型命题（`claim.type` 不可核查者）芯片文案「立场型 · 不适用真/假判断」，中性色。
    3. 出处列表：`report.citations` 顺序，每条 `[n]` 标题 · host · 层级徽标（A/B/C，`--ink` 描边小方块，A 实心）· 立场标记（支持 ＋ / 反驳 － / 部分 ±，文字不只靠符号）。默认展开前 5 条，其余「展开全部 N 条」。
    4. frontier 芯片行：标题「还可以往哪查」，`case.frontier` 里未 consumed 的 pivot 按 `expectedValue` 降序取前 6，芯片文案 = pivot 标签（link → host + 路径截断、entity → 实体名、image → 「这张图的来源」）。点击 → `sendTurn("", pivotId)`，芯片进入「正在查」态并禁用。
  - 运行中（`running === true`）的助手块是同一张卡的「未完成态」，不是另一个组件：顶部一行状态词（只准这些：正在拆题 / 正在找证据 / 正在核对 / 正在追索 / 正在复核 / 正在写结论 / 已完成 / 已中止），从最近一条 `stage.started` 映射；命题在 `claims.added` 后即出现（芯片「核对中」，中性色）；证据计数「已找到 N 条材料」随 `evidence.added` 跳动（数字 mono，变化时 160ms 淡入）；判决芯片随 `verdict.updated` 翻转（颜色与文字同时过渡，160ms）。追索步骤流（`investigator.step`）以「仪器条」呈现：细线卡、点阵标记、每步一行 `目标 · 动作 · 结果`，最多显示最近 3 步，结束后整条折叠成一行「追索了 N 步 · 停止原因」可展开。
  - 输入框固定线程底部：textarea（自动增高到 6 行）+ 提交按钮；运行中提交按钮换成「中止」（`abort()`），输入框仍可编辑但不能提交；`Enter` 提交、`Shift+Enter` 换行；空串不能提交。
- 案件面板（`<aside>`），从上到下：
  1. 整句判决卡：face 词（衬线 24px）+ 分数（mono 32px）+ 分解条（`overall.breakdown` 每项一行：label + 细条 + 值，条长按 |value| 相对最大值，负值向左）。`overall.contested` 为真时卡下加一行「来源之间相互矛盾」。
  2. 命题列表：`case.claims` 原句序；每条 = 判决芯片 + 命题文本 + `tally`（`＋sup －ref ±par`，mono 12px，muted）；立场型夹在中间标灰。判决更新时芯片过渡。点击命题 → 线程滚到对应 claimItem 并高亮 1s。
  3. 证据板：按 `clusterId` 分组（无簇的单独成组），簇根（`evidence.cites` 中被引最多者，或无 cites 时 tier 最高者）在前；每条 = 层级徽标 + 标题 + host + 立场标记；点开显示 `excerpt` / `quote` 与「打开原文」。折叠时每簇只显示簇根 + 「还有 N 条同源」。
  4. 出处图：`@xyflow/react`；节点 = 被 `report.citations` 引用的证据 + 它们 `cites` 到的证据；边 = `case.cites`（from → to，箭头指向被引者）；A 级节点 `--ink` 实心；簇用同色淡底分组；高度 240px，`fitView`，不可拖拽节点（`nodesDraggable={false}`），可缩放。**无边时整个区块不渲染**（连标题都不出）。
  5. 追索时间线：默认折叠为一行「追索 N 步 · 复核 M 步」；展开后按 `investigator.step` 顺序，每步 `role` 徽标（主查 / 控方 / 辩方，不写 prosecutor/defender 英文）· 目标 · 动作 · 结果 · 增益（`gain` 字段有则显示「+N 条证据 / 判决变化」），`investigator.stopped.reason` 映射成可读词（预算用完 / 没有新收获 / 已经查清 / 时间到 / 工具故障）。
- 桌面 ≥1024：三栏；面板内五个区块纵向排，各自可折叠（标题行是按钮，`aria-expanded`）。768–1023：面板是抽屉，顶部摘要栏显示 face 词 + 分数 + 「打开面板」。<768：单栏，面板抽屉从底部升起（高度 85vh），顶部摘要栏同上。
- 文案硬约束：不出现 Agent / 智能体 / 工具名 / 模型名 / 厂商名；不出现「能信 / 不能信」四字章作为独立标题（face 词表里的词只在芯片与判决卡里用）；错误态一句话说清「哪一步没成」+ 「可以再试 / 换个说法」，不训人。
- 组件与文件：`src/case/ThreadView.tsx`、`ReportCard.tsx`、`Citation.tsx`（含 popover）、`FrontierChips.tsx`、`Composer.tsx`、`InstrumentStrip.tsx`；`src/panel/VerdictCard.tsx`、`ClaimList.tsx`、`EvidenceBoard.tsx`、`ProvenanceGraph.tsx`、`Timeline.tsx`；`src/lib/copy.ts`（状态词表、停止原因词表、role 词表；只引 `@rhg/core/publicCopy` 的 face 词）；`src/lib/select.ts`（从 `Case` 派生视图数据的纯函数：簇分组、簇根、frontier 排序、引用解析、最近 stage）。所有派生逻辑在 `select.ts` 里可单测，组件只渲染。
- 允许新增依赖：`@xyflow/react`（唯一）。

验收清单（checker 在 `.worktrees/T18` 逐条执行；14 条起由带浏览器的 checker 做，截图存 `packages/web/output/acceptance/`；每条只答 PASS / FAIL + 一行证据；任何一条 FAIL 即打回）：

| # | 动作 | 通过条件 |
|---|---|---|
| 1 | `npm test --workspace=@rhg/web` | 退出码 0；用例 ≥ T17 合入时 + 16 |
| 2 | `npm run build --workspace=@rhg/web` | 退出码 0 |
| 3 | `git status --short`；`git diff --stat spine...HEAD` | 干净；改动仅在 `packages/web/**`、`package-lock.json`；不含 core / server / mvp |
| 4 | `rg "\"dependencies\"" -A 8 packages/web/package.json` | 相比 spine 只多 `@xyflow/react` |
| 5 | `rg "#[0-9a-fA-F]{3,8}\b\|rgba\?(\|hsla\?(\|font-family" packages/web/src --glob '!tokens.css' --glob '!*.test.*'` | 0 命中 |
| 6 | 读 `select.test.ts` | 覆盖：簇分组与簇根选取（有 cites / 无 cites 两例）；frontier 过滤 consumed + 按 expectedValue 排序取前 6；`[n]` 解析（含 `[1][2]` 连写、`[99]` 悬空 → 原文保留不成链接）；最近 stage → 状态词映射（含 `turn.finished` 后为「已完成」/「已中止」） |
| 7 | 读 `ClaimList.test.tsx` | 四种判决 → 芯片文案来自 `publicCopy` face 词表 + 对应 CSS 类（true / false / unclear）；立场型命题文案含「立场型」且用中性类；`tally` 渲染 `＋n －n ±n` |
| 8 | 读 `Citations.test.tsx` | `[n]` 渲染为按钮 / 链接且 `href === evidence.url`、`target="_blank"`、`rel` 含 `noopener`；hover / focus 出 popover 含标题、host、层级字母、引文 |
| 9 | 读 `ProvenanceGraph.test.tsx` | `case.cites` 为空 → 组件返回 null（DOM 里没有该区块标题）；有边 → 渲染节点数 = 引用证据 ∪ 被引证据 数 |
| 10 | 读 `copy.ts` | 状态词只有设计定案列的 8 个；停止原因 5 个；role 3 个中文词；`rg "prosecutor\|defender\|investigator" packages/web/src --glob '*.tsx'` 只出现在字段访问，不出现在 JSX 文本 |
| 11 | `rg "能信\|不能信" packages/web/src --glob '*.tsx'` | 0 命中（face 词只从 publicCopy 来） |
| 12 | `rg "智能体\|Agent\|工具名\|模型名\|minimax\|stepfun\|deepseek\|openai\|claude" packages/web/src --glob '*.tsx'` | 0 命中 |
| 13 | 读 `ReportCard.tsx` / `ThreadView.tsx` | 运行中与完成态是同一组件的两个分支，不是两个组件；状态词来自 `copy.ts`；结论首句高亮用判决色 token 派生 |
| 14 | 浏览器 fixture：`/cases/fx-done` 1280×800 | 截图 `T18-done-desktop.png`；线程里有结论段、≥1 个 `[n]`、命题逐条、出处列表、frontier 芯片；面板里五个区块中出处图按 fixture 有无边决定；`scrollWidth === innerWidth` |
| 15 | 浏览器 fixture：`/cases/fx-done` 375×812 | 截图 `T18-done-mobile.png` + 打开面板抽屉后 `T18-done-mobile-panel.png`；抽屉内五个区块标题都能滚到；`scrollWidth === innerWidth` |
| 16 | 浏览器 fixture：`/cases/fx-retrieving` 1280 | 打开后 3 秒内「已找到 N 条材料」的 N 至少变化一次；命题芯片为「核对中」；截图 `T18-retrieving-desktop.png` |
| 17 | 浏览器 fixture：`/cases/fx-contested` 1280 | 判决卡下有「来源之间相互矛盾」；时间线展开后有「控方」与「辩方」徽标；出处图区块存在或不存在与 fixture 的 `cites` 是否为空一致；截图 `T18-contested-desktop.png` |
| 18 | 浏览器 fixture：`/cases/fx-followup` 1280 | 线程里有两条用户消息、两张报告卡；第二条用户消息样式更小；截图 `T18-followup-desktop.png` |
| 19 | 浏览器 fixture：`/cases/fx-done`，点第一个 `[n]` | 新标签 URL 等于该证据 `url`（用 `window.open` 拦截或读 `href`） |
| 20 | 浏览器 fixture：`/cases/fx-done`，hover 第一个 `[n]` | popover 出现，含 host 与层级字母；`Tab` 聚焦到它也出现；截图 `T18-citation-popover.png` |
| 21 | 浏览器 fixture：点面板里第二条命题 | 线程滚动，对应 claimItem 获得高亮类并在 ~1s 后移除 |
| 22 | 浏览器真后端 A（会触发追索）：起 server + web，首页输入「人社部发文说生育津贴直接打到个人卡里了，不用再走单位」 | 从提交起计时：命题出现 ≤ 10s、首条证据计数 ≥1 ≤ 20s、`turn.finished` ≤ 130s；完成态结论段有 ≥1 个 `[n]`；仪器条在运行中出现过 `investigator.step` 行（截图 `T18-live-A-running.png`）；完成截图 `T18-live-A-done.png`；把结论段文本与命题 + 芯片文案贴进报告 |
| 23 | 浏览器真后端 B（含立场句）：新案「转基因食品就是毒药，这届专家全被收买了」 | 命题列表里至少一条标「立场型」；可核查命题有判决芯片；截图 `T18-live-B-done.png`；贴命题 + 芯片文案 |
| 24 | 浏览器真后端 C（图片输入）：首页粘贴或拖入一张含文字的图（用 `packages/core/src/fetch/__fixtures__` 或任意本地 png），提交 | 案件建立、线程里用户消息显示图片缩略；60s 内有命题或有「这张图的来源」frontier 芯片；截图 `T18-live-C.png`。若 T19 尚未合入导致首页无图片入口，此条改为 `POST /api/cases` 带 `attachments:[{kind:"image", value:<dataURL>}]` 后打开案件页验证，并在报告注明 |
| 25 | 浏览器真后端 A 完成后点一个 frontier 芯片 | 同一 `/cases/<id>` 页面上出现新一条用户消息 + 新报告卡（未完成态），面板命题数不减少；芯片在点击后禁用；截图 `T18-live-A-followup.png` |
| 26 | 浏览器真后端 A 运行中点「中止」 | ≤ 3s 内状态词变「已中止」，`GET /api/cases/<id>` 末事件 `turn.finished.reason === "aborted"`；输入框恢复可提交 |
| 27 | 浏览器：任一完成页 `[...document.querySelectorAll("button,a")].filter(el => !el.textContent.trim() && !el.getAttribute("aria-label")).length` | 0 |
| 28 | 浏览器：任一完成页 375 宽，把面板抽屉内五个区块全部展开 | `scrollWidth === innerWidth` 仍成立；截图 `T18-mobile-all-open.png` |
| 29 | `rg ": any\b\|console\.log\|\.only\|\.skip" packages/web/src` | 0 命中 |
| 30 | `wc -l packages/web/src/case/*.tsx packages/web/src/panel/*.tsx packages/web/src/lib/*.ts` | 报行数（仅报告） |

### T19 · 首页与摄入

依赖：T17。

Change：首页：一句话定位 + 输入区（文本 / 粘贴链接自动识别 / 拖拽或粘贴图片，图片本地预览）、最近案件；提交后进入案件视图并立即显示「正在拆题」状态；空态与错误态文案由 `publicCopy` 风格约束（不训人、不写转不转）。

Not this：不做营销落地页；不展示「Powered by 厂商名」；不做账号（记任务页）。

Evaluator：验收人真实浏览器：文本 / 链接 / 图片三种输入各走一次到案件视图；375px 截图。

Evidence：截图路径。

---

## Wave 5 · 切换

### T20 · 上线切换与文档收口

依赖：T16 门禁通过、T18、T19。

Change：`ops.sh` 与部署脚本改指 `packages/server` 与 `packages/web` 构建产物；nginx 配置更新；生产 `/health` 与一次真实核查通过；删除 `mvp/`（含其 docs）与 `docs/AGENTIFICATION.md`；重写 `docs/ARCHITECTURE.md` 为一张目标形状图 + 包地图（≤80 行）；`docs/PRODUCT_SPEC.md` 第七节追加一条记录并把第二节的「查完可以再问一句」改为「案件即线程」；`AGENTS.md` 命令段改为根目录命令；ADR-007 状态改「已实施」。

Not this：不在门禁未过时切换；不保留双部署。

Evaluator：验收人在生产 URL 完成 T18 的三案例流程；`git ls-files mvp | wc -l` 为 0；`npm test` / `npm run eval:gate` 绿。

Evidence：生产截图；commit；eval run id。
