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

### T14 · 追问路由与多轮

依赖：T13。

Change：`runner/route.ts`：确定性优先（消息含 URL → `challenge`；携带 `pivotId` → `pursue_frontier`），否则一张工单归类 `new_claim | ask_case | off_topic`。`runner/turns.ts`：`pursue_frontier` → 以该 pivot 为种子跑 investigate → assess → judge → compose 增量；`challenge` → URL 抓取为证据（provenance `user`）→ assess → judge → compose 增量；`ask_case` → 一张工单只拿案件状态作答，代码校验回答中 URL ⊆ 案内 URL、且不含案外命题（简单校验：回答中的数字与专名需出现在案内证据文本中，否则改为「案内材料没有这一点，可以从这些方向再查」并附 frontier）；`off_topic` → 固定婉拒文案。

Not this：不做开放式聊天；不让 `ask_case` 触发检索。

Evaluator：`route.test.ts` 覆盖五类；`turns.test.ts`：`pursue_frontier` 消费 pivot 并产生 `frontier.consumed`；`challenge` 的证据 provenance 为 `user` 且参与 judge；`ask_case` 回答中出现案外 URL 被拦并替换。

Evidence：测试名。

### T15 · 服务端

依赖：T13、T14。

Change：`packages/server`：`POST /api/cases`（新建，返回 caseId + 首轮 SSE）、`POST /api/cases/:id/turns`（SSE）、`GET /api/cases/:id`（事件日志 + 折叠状态）、`GET /api/cases`（列表）。SSE：15s 心跳、客户端断开即 abort、`X-Accel-Buffering: no`。公开事件经 `toPublicEvent`：剥 `llm.called.model`、任何字段中的厂商 / 模型名、堆栈；`error` 只留用户可读文案。案件存储：`.data/cases/<id>.jsonl` 追加事件（目录可配置）。配额：搬 `mvp/server/src/lib/checkQuota.ts`；账号相关（`accountStore`、`emailAuth`）本任务不搬，记入任务页。

Not this：不把任何域规则写进 handler；不复制 reducer（从 core 引）。

Evaluator：`server.test.ts` 用 supertest 风格（原生 fetch 到临时端口）：新建案件后 `GET` 返回的折叠状态等于 `replay(日志)`；SSE 事件序列化后用正则断言不含 `minimax|stepfun|deepseek|mimo|openai|anthropic|web_search|gpt|claude`；断开连接后服务端 abort（用假 deps 记录）；心跳帧出现。

Evidence：测试名；`curl` 一次真实 SSE 的前 5 行（不含密钥）。

### T16 · Eval 包与门禁

依赖：T13。

Change：`packages/eval`：搬 `mvp/server/eval/golden.ts`（28 例）；重写 `score.ts` 以新 `Report/Case` 为输入，保留指标名 `routingAccuracy / verdictAccuracy / credibilityAccuracy / hallucinationRate / reportContractPassRate`，新增 `groundingRate`、`quoteFidelity`、`provenanceDepth`、`latencyP50 / P95`；`run.ts` 支持 `--ids / --domain / --repeats / --gate <baseline>`；`--gate` 同时接受旧格式 `mvp/server/eval/baseline.json` 做打平比较（只比共有四项）。根脚本 `npm run eval` / `npm run eval:gate`。

Not this：不改 golden 的期望值；不把新指标进门禁（先观测）。

Evaluator：`score.test.ts` 覆盖每个指标的正反例；用一份假 `Case` 走通 `run.ts --ids` 输出 JSON；验收人用真实 key 跑全量一次，记录 run id 与四项对旧基线的差值。

Evidence：测试名；eval run id；对比表（四项 + 新指标）。

---

## Wave 4 · 界面

### T17 · Web 基础：设计系统、壳、事件客户端

依赖：T02、T15。

Change：`packages/web`：设计 token（字体：中文衬线只给品牌与结论、正文 sans；判决色三值 + 中性色；间距与圆角尺度）写在一个 `tokens.css`；布局壳：左侧案件列表（可收起）、中间线程、右侧案件面板（≥1024px 三栏；<1024px 面板折叠为顶部摘要 + 抽屉；375px 单栏）；`useCaseStream(caseId)`：连 SSE，逐事件 `reduce`，暴露 `case` 与连接状态；断流重连并从 `GET /api/cases/:id` 补齐；`fixtures/`：至少 5 个静态事件日志（拆题中 / 检索中 / 有 contested / 完成 / 追问后），`npm run dev -- --fixture=<name>` 可离线渲染。

Not this：不引 UI 组件库（antd 一类）；不复制任何 `mvp/src` 组件；不渲染任何「Agent 名」「工具名」。

Evaluator：`useCaseStream.test.ts`：事件应用顺序与 reducer 一致；断流后补齐状态相等。验收人在浏览器打开 5 个 fixture，桌面 + 375px 各截图，检查三栏折叠行为与无横向滚动（`document.documentElement.scrollWidth === innerWidth`）。

Evidence：测试名；截图路径 `packages/web/output/acceptance/T17-*.png`。

### T18 · 案件视图 ★

依赖：T17。允许依赖：`@xyflow/react`。

Change：中间线程：用户消息气泡；助手回答 = `Report.conclusion` 与 `claimItems`，`[n]` 渲染为可点内联引用，悬停显示证据标题 / host / 层级 / 引文；回答下方 frontier 芯片（「还可以往哪查」），点击即发起 `pursue_frontier`；底部输入框。右侧案件面板：整句判决卡（`faceVerdict`、分数与分解）；命题列表（原句序，立场型夹在中间标「立场型 / 不适用真/假判断」，可核查的带判决色芯片，判决更新时有过渡）；证据板（按出处簇分组，簇根在前，每条标层级与立场标记，可点开）；出处图（`evidence.cites` 为边，簇为分组，A 级高亮；无边时不显示该区）；追索时间线（折叠，默认收起；每步显示目标 / 动作 / 结果 / 增益，停止原因可读）。运行中：命题在 `claims.added` 后即出现，证据流入时计数跳动，判决芯片随 `verdict.updated` 翻转。

Not this：不出现 Agent 名 / 工具名 / 模型名；不做「运维台」式日志墙；过程不抢结论的视觉层级。

Evaluator：验收人用真实后端跑 3 个 golden 案例（含一个会触发 Investigator 的、一个含立场句的、一个截图输入的），全程录屏或分段截图：命题 ≤10s 出现、首批证据 ≤20s、结论带 ≥1 可点引用、点击引用打开正确 URL、frontier 点击后新一轮事件进入同一案件；375px 下所有区块可达且无横向滚动。组件测试：`ClaimList.test.tsx`（判决芯片文案与颜色映射、立场型文案）、`Citations.test.tsx`（`[n]` 解析）、`ProvenanceGraph.test.tsx`（有边才渲染）。

Evidence：测试名；截图 / 录屏路径 `packages/web/output/acceptance/T18-*`。

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
