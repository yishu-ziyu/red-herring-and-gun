# 红鲱鱼与枪 · 基于竞品差距的工程实施方案（v1 合成版）

> 整合 Plan 1 的工程纪律闸门、Plan 2 的可读报告语言、Plan 3 的行号级锚点。已在 `mvp/server/src/lib/agentConfigs.ts`、`mvp/server/src/lib/credibilityScore.ts`、`mvp/src/lib/factDeskWriter.ts`、`mvp/src/lib/reportComposer.ts`、`mvp/server/src/handlers.ts` 复核过真实行号。
> 冲突调和：(a) "来源历史信誉"是否接进公式——采纳 Plan 1 立场，**仅作展示信号**；(b) Grounding 硬约束同时吸收 Perplexity + Grok 双向；(c) 子命题树沿用 Plan 1 的"拖动后只重查受影响分支"边界。
>
> 配套竞品调研文档：`docs/competitive/01-international-factcheck.md`、`02-chinese-factcheck.md`、`03-ai-search-engines.md`、`04-argument-checking.md`、`05-academic-research-ai.md`。

## 1. 战略总结

1. **定位**：中文市场唯一同时具备 *命题拆解 + 公式化 0-100 可信度 + Agent 流式可视化 + can say / cannot say 边界* 的核查 Agent。
2. **护城河**：论证结构（Kialo）+ 论点抽取（IBM KPA）+ 证据溯源（Logically.app）+ 历史信誉（Logically.ai）四件套缝入端到端流水线，保持 `credibilityScore` 公式不变。
3. **输出形态**：人读"求证"报告，机器读 `schema.org/ClaimReview` JSON-LD；证据不足必须拒答，不可补写。

**7 大优势**（vs 全竞品）

| # | 优势 | 当前中文市场对标 |
|---|------|----------------|
| 1 | 命题类型自动拆解（事实/概念/比较/因果/预测/价值/策略） | 0 家 |
| 2 | 子命题独立支持/反驳树 | 0 家（字节 AI 求真仅整体判断）|
| 3 | `computeCredibilityScore` 五维信号 + log₂ 收敛 + 缺失门控 | 0 家公式化 |
| 4 | 证据四维评估 + 拟增第 5 维 *历史信誉* | 0 家结构化 |
| 5 | can say / cannot say 边界声明 | 仅央媒"求证"模糊等价 |
| 6 | Mission Control 实时可视化 Agent 流 | 0 家 |
| 7 | ClaimReview JSON-LD 兼容（利用 Google 2025-06 下线窗口） | 全球 8 家头部不服务中文 |

## 2. 优先级矩阵

### P0 · 第 1 波（1-2 周）

#### P0-1 Grounding + 同行评审硬约束
- **做什么**：FactChecker、SourceValidator 强制"批判信源 + 同行评审优先 + 证据不足时输出『暂无可靠证据』"。
- **为什么**：补齐 Perplexity（grounding 缺证据兜底）与 Grok Explain（同行评审优先）双重差距。
- **改动锚点**：
  - `mvp/server/src/lib/agentConfigs.ts:261-289` `fact_checker.systemPrompt` 末尾追加"必须列出至少 1 条反对意见/同行评审质疑，否则 `factCheckResult=unverified`"。
  - `mvp/server/src/lib/agentConfigs.ts:297-321` `source_validator.systemPrompt` 末尾追加"若无可靠来源，`sourceReliability=unverified` 且 `verificationNotes` 首句『暂无可靠证据支持这一说法』"。
  - `mvp/src/lib/reportComposer.ts:69 composeReport()` 新增衍生字段 `insufficientEvidence: boolean`（缺主证据且无反证时为 true），**不进** `computeCredibilityScore`。
- **验收**：
  - `mvp/server/src/lib/agentConfigs.test.ts` 新增 3 用例：prompt 正则匹配 `至少 1 条反对意见|同行评审|暂无可靠证据`。
  - `mvp/src/lib/reportComposer.test.ts` 新用例：主证据空 + 反证空 → `insufficientEvidence=true` 且 verdict=`unverified`。
  - demo：「某明星昨天因某事件被捕」（搜索空）→ Mission Control 完整跑完，结尾结论首句含"暂无可靠证据"，`credibilityScore ≤ 50`。
- **风险**：prompt 调整影响 `factCheckResult` 分布；用 `mvp/server/src/lib/credibilityScore.test.ts` 现有 9 个测试做回归。

#### P0-2 "求证：……"语言模板
- **做什么**：把 `claimSentence` 改为以「求证：网传『……』……」开头；新增 `canSaySentence` / `cannotSaySentence` 模板函数，沿用央媒求证栏目措辞。
- **为什么**：借鉴央媒求证栏目（`docs/competitive/02 §8`），中文媒体语境最熟悉的边界表达。
- **改动锚点**：
  - `mvp/src/lib/factDeskWriter.ts:46 FACT_DESK_WRITING_RULES` 追加"结论首句必须以『求证：』开头"。
  - `mvp/src/lib/factDeskWriter.ts:180 writeFactDeskConclusion()` 第 203 行 `claimSentence` 模板替换为 `求证：网传「…」，经核查……`。
  - `mvp/src/lib/factDeskWriter.ts` 新增导出 `canSaySentence(findings)` / `cannotSaySentence(cannotSay)` 两个纯函数。
- **验收**：
  - `mvp/src/lib/factDeskWriter.test.ts` 新增 4 用例：(a) 旧 demo case 文本首句包含「求证：」；(b) 三类 case 分别输出四段结构；(c) 0 字节 claim fallback 为 `先按可核查单元处理`；(d) `cannotSaySentence` 内容不得进入肯定句。
  - demo 截图：`mvp/src/components/v3/ConclusionDockV3.tsx` 渲染三层标题"求证： / 目前可以确认： / 目前不能确认："。
- **风险**：纯文案；底层 `allowedConclusion`/`canSay`/`cannotSay` 字段名不变，向后兼容。

#### P0-3 ClaimReview JSON-LD 输出
- **做什么**：从最终报告生成 `schema.org/ClaimReview` JSON-LD，提供复制/下载入口。
- **为什么**：Google 2025-06 下线 Rich ClaimReview 富文本展示但保留索引入口，Duke Reporters' Lab 仍消费。
- **改动锚点**：
  - 新增 `mvp/src/lib/claimReview.ts` 导出 `buildClaimReviewJsonLd(report: FinalReport): ClaimReviewJSONLD`，字段：`@context=schema.org` / `@type=ClaimReview` / `claimReviewed` / `reviewRating{ratingValue,bestRating=100,worstRating=0}` / `author` / `datePublished` / `url`（可选）。
  - `mvp/server/src/handlers.ts:1047` SSE `type:"complete"` payload **新增**字段 `claimReview: object`（不改既有结构），由 `applyFormulaScoreToReport` 后调用 `buildClaimReviewJsonLd`。
  - `mvp/src/components/v3/ConclusionDockV3.tsx` 增加"复制 JSON-LD"按钮 + `<script type="application/ld+json">` 注入（仅本页，single tag 校验）。
- **验收**：
  - 新增 `mvp/src/lib/claimReview.test.ts`：3 个固定 demoCase 必须通过 schema 必填字段 validator；`JSON.parse` 不抛错；claim 字符串含 `<script>` 必须 HTML 转义。
  - `mvp/server/src/handlers.reportFallback.test.ts` 保持 PASS（仅增字段不改结构）。
  - demo：Rich Results Test 截图，报告页 DOM 仅 1 个 `<script type="application/ld+json">`。
- **风险**：`url` 缺失时合法降级（不抛错、不含 `url` 字段）；评分必须直接取 `computeCredibilityScore` 结果，禁止二次反转。

#### P0-4 公式回归闸门（首日必做）
- **做什么**：把现有 `computeCredibilityScore` 行为固化为快照测试。
- **为什么**：所有 P0-P2 新维度只进入展示层，不得改公式权重或 `SCORE_LABELS`。
- **改动锚点**：`mvp/server/src/lib/credibilityScore.test.ts` 在现有 9 个 `describe` 之外新增 `snapshot` 块，对每个 fixture 输入输出 `{score, label, breakdown}` 完整快照。
- **验收**：`pnpm test mvp/server/src/lib/credibilityScore.test.ts` 必须 PASS；CI 增加 `--update=false` 强制。
- **风险**：低，纯测试增量。

### P1 · 第 2 波（2-4 周）

#### P1-1 IBM KPA：长文/截图先抽 Key Points
- **改动锚点**：`mvp/src/lib/claimDecomposer.ts` 新增 `extractKeyPoints(rawInput): Promise<KeyPoint[]>`（每项 `{text, stance:'support'|'oppose'|'context', spanRange}`）；`mvp/src/lib/pipeline.ts` 在 `decompose` 前新增 `kpa` 阶段并 emit SSE。
- **验收**：`claimDecomposer.test.ts` 新增金标「疫苗导致 autism」→ ≥1 support + ≥1 oppose；1500 字长文抽出 3-10 条且每条含原文 span。
- **风险**：抽取不是事实结论，`KeyPoint.id` 必须稳定可重放；长度/超时显式（1500 字上限）。

#### P1-2 Kialo 风格子命题树
- **改动锚点**：新增 `mvp/src/components/v3/SubclaimTree.tsx`（接收 `Subclaim[]` + `stance`），与 `MissionControlView.tsx` 同坐标系；`mvp/src/lib/schemas.ts:45 Subclaim` 新增可选 `parentId`/`stance`/`order`；`mvp/src/lib/streamingTypes.ts` 新增可选事件 `claim_tree_update`（不改既有事件）。
- **验收**：`SubclaimTree.test.tsx`（RTL）渲染 5 子命题树 → DOM 含 5 节点 + ≥4 edge；snapshot 含 `data-testid="subclaim-node"`；拖动后仅受影响节点重查。
- **风险**：拖动是用户编辑，不可伪装成模型结论；运行时锁定版本，避免旧 SSE 覆盖新树。

#### P1-3 句子级引用溯源（Logically.app）
- **改动锚点**：`mvp/src/lib/sourceLineage.ts` 新增 `CitationSpan = {url, selector, charOffsetStart, charOffsetEnd, snippet}`；`mvp/src/lib/evidenceSearchRouter.ts` 在抓取阶段保留 `charOffset`；`mvp/src/components/v3/EvidenceChain.tsx` 点击节点展开 `CitationSpan` 列表。
- **验收**：`sourceLineage.test.ts` 3 用例：HTML 段落、PDF 页码、截图 OCR 区域可跳转；quote 必须是原文子串（diff=0）；无法定位显示"定位不可用"，禁止编页码。
- **风险**：抓取正文版本哈希；页面更新后显示 stale。

#### P1-4 第 5 维：来源历史信誉
- **改动锚点**：新增 `mvp/src/lib/sourceReputationRegistry.ts`（导出 `recordOutcome`/`getReputationScore`，LRU + `~/.gun/sourceReputation.json`）；`mvp/src/lib/evidenceQuality.ts::assessCandidateEvidenceQuality` 接收 `sourceHistory: 'unrated'|'positive'|'mixed'|'negative'`；UI 展示依据与更新时间。
- **验收**：`credibilityScore.test.ts` 不变；新增 `sourceReputationRegistry.test.ts`：未知源=unrated（不得默认 45 冒充历史记录）；round-trip 持久化。
- **风险（已调和冲突）**：**不进入** `computeCredibilityScore` 公式，仅作展示信号。

#### P1-5 逻辑谬误诊断卡
- **改动锚点**：`mvp/server/src/lib/agentConfigs.ts` 新增 `FallacyDetectorOutput {fallacies: {type:'strawman'|'false_cause'|'hasty_gen'|'ad_hominem'|'appeal_to_authority', span, rationale}[]}`；`mvp/src/lib/pipeline.ts` 第 4 阶段插 `fallacy_detector`；新增 `mvp/src/components/v3/FallacyCard.tsx`。
- **验收**：`agentConfigs.test.ts` prompt 正则匹配枚举；`FallacyCard.test.tsx` 渲染三正例+一无谬误负例；每项含 `type + span + rationale + confidence`。
- **风险**：不得从缺证据自动推断谬误；`span` 必须可追溯到原文。

#### P1-6 盲点视图（Ground News 借鉴）
- **改动锚点**：新增 `mvp/src/lib/blindSpotAnalysis.ts`（按来源类型/立场聚合）；`mvp/src/components/v3/EvidenceChain.tsx` 接入。
- **验收**：demo 展示立场分布；同源转载折叠后再统计；<3 独立来源显示"样本不足"。
- **风险**：不通过域名推断政治立场；缺席 ≠ 反对。

### P2 · 第 3 波（1-2 月）

| # | 任务 | 改动锚点 | 验收 |
|---|------|---------|------|
| P2-1 | 学术通道 + Consensus | 新增 `academicSearch.ts` / `citationFormatter.ts`（APA/MLA）；`schemas.ts` 加 `academicConsensus` | DOI 去重后输出支持/反对论文数 + 共识度；零论文显示"暂无学术证据" |
| P2-2 | PDF 阅读 | 扩 intake + `orchestrateShared.ts`；隔离解析器，扫描件走 OCR | 文本/扫描/加密/伪扩展名 4 case；页码引用可回原页 |
| P2-3 | NATO Admiralty Code | 新增 `admiraltyRating.ts`（A-F 来源 + 1-6 信息） | 未知=F/6 或"无法评级"且展示理由；不替代主分数 |
| P2-4 | 时间衰减 | `sourceCredibility.ts::scoreFreshnessFromTimestamp` 增可配置策略 | 未来日期/无日期/历史事实 3 case；不默认写入主公式 |
| P2-5 | 编辑室/学术特化模式 | `pipeline.ts` 加 `mode` 参数；不改 grounding | 批量案件+人工批准 vs 学术检索协议+引用导出 |
| P2-6 | 多语言 | 先英→中规范化，保留原文+翻译 span | 同双语说法子命题对齐；翻译推断不得冒充原文证据 |

## 3. 实施顺序

1. **第 0 天**：合并 P0-4 公式闸门 → CI 红线。
2. **第 1 周**：P0-1（P0-2 同步 review 文案）→ demo 截图。
3. **第 2 周**：P0-3 → 部署到 `gun.yishuziyu.cn`，验证 Rich Results。
4. **第 3-4 周**：P1-1 + P1-2 + P1-3（并行，三独立模块）。
5. **第 5-6 周**：P1-4 + P1-5 + P1-6。
6. **第 7-10 周**：P2 全线，每两周一个，公式闸门不破。

## 4. 工程约束

- **冻结**：`computeCredibilityScore` 五类信号聚合 / `SCORE_LABELS` / Mission Control SSE 事件类型。
- **向后兼容**：所有 P0 新增字段均为 optional（`insufficientEvidence` / `claimReview` / `canSay`/`cannotSay` 模板）。
- **测试**：必须过 `pnpm test` 全部 vitest；新增闸门禁止 `expect.soft`；CI 强制 `pnpm typecheck`。
- **部署**：`deploy-to-aliyun.sh` 无需改；公网 `gun.yishuziyu.cn` 不能中断；schema 校验通过方可上线。

## 5. 评审清单

**每波完成时**：(a) `pnpm test` PASS；(b) `mvp/server/src/lib/credibilityScore.test.ts` snapshot 未变；(c) 三个固定 demo case（"明星被捕"空搜索 / "疫苗导致 autism" / "X 国暴动" 多源）端到端 SSE 录像 + 截图（Mission Control、ConclusionDock JSON-LD DOM）；(d) Rich Results validator 截图（P0-3 完成后必交）。

**用户需拍板**：

1. **报告 URL 持久化**：P0-3 `url` 字段是否做 `/r/:caseId` 永久路由？影响 SEO 与索引。
2. **学术模式计费/P2-1**：DOI 检索是否走付费 API（Crossref 免费 vs Semantic Scholar 限速）？
3. **历史信誉冷启动**：P1-4 持久化路径放用户本地 `~/.gun/` 还是服务端？涉及隐私边界。
4. **编辑室模式边界**：P2-5 是否限定为邀请制？批量审批人上限？
5. **多语言首期**：P2-6 是否同步上线 UI i18n，还是仅后端规范化？

---

## 附录 A · 关键文件改动总表

| 优先级 | 文件 | 行为 | 关键函数 / 行 |
|------|------|------|-------------|
| P0-1 | `mvp/server/src/lib/agentConfigs.ts` | 改 | `fact_checker.systemPrompt` L261-289 / `source_validator.systemPrompt` L297-321 |
| P0-1 | `mvp/src/lib/reportComposer.ts` | 改 | `composeReport()` L69 新增 `insufficientEvidence` |
| P0-2 | `mvp/src/lib/factDeskWriter.ts` | 改 | `FACT_DESK_WRITING_RULES` L46 / `writeFactDeskConclusion()` L180 / 新增 `canSaySentence` / `cannotSaySentence` |
| P0-3 | `mvp/src/lib/claimReview.ts`（新增） | 新增 | `buildClaimReviewJsonLd(report)` |
| P0-3 | `mvp/server/src/handlers.ts` | 改 | SSE `type:"complete"` payload L1047 新增 `claimReview` |
| P0-3 | `mvp/src/components/v3/ConclusionDockV3.tsx` | 改 | 新增「复制 JSON-LD」按钮 + `<script>` 注入 |
| P0-4 | `mvp/server/src/lib/credibilityScore.test.ts` | 改 | 新增 `snapshot` 块（公式回归闸门） |
| P1-1 | `mvp/src/lib/claimDecomposer.ts` | 改 | 新增 `extractKeyPoints()` |
| P1-1 | `mvp/src/lib/pipeline.ts` | 改 | 在 `decompose` 前新增 `kpa` 阶段 |
| P1-2 | `mvp/src/components/v3/SubclaimTree.tsx`（新增） | 新增 | 子命题树可视化 |
| P1-2 | `mvp/src/lib/schemas.ts` | 改 | `Subclaim` L45 新增可选 `parentId`/`stance`/`order` |
| P1-2 | `mvp/src/lib/streamingTypes.ts` | 改 | 新增可选事件 `claim_tree_update` |
| P1-3 | `mvp/src/lib/sourceLineage.ts` | 改 | 新增 `CitationSpan` 类型 |
| P1-3 | `mvp/src/lib/evidenceSearchRouter.ts` | 改 | 抓取阶段保留 `charOffset` |
| P1-3 | `mvp/src/components/v3/EvidenceChain.tsx` | 改 | 点击节点展开 `CitationSpan` 列表 |
| P1-4 | `mvp/src/lib/sourceReputationRegistry.ts`（新增） | 新增 | `recordOutcome` / `getReputationScore` |
| P1-4 | `mvp/src/lib/evidenceQuality.ts` | 改 | `assessCandidateEvidenceQuality` 接收 `sourceHistory` |
| P1-5 | `mvp/server/src/lib/agentConfigs.ts` | 改 | 新增 `FallacyDetectorOutput` 类型 |
| P1-5 | `mvp/src/lib/pipeline.ts` | 改 | 第 4 阶段插 `fallacy_detector` |
| P1-5 | `mvp/src/components/v3/FallacyCard.tsx`（新增） | 新增 | 谬误诊断卡片 |
| P1-6 | `mvp/src/lib/blindSpotAnalysis.ts`（新增） | 新增 | 按立场/来源类型聚合 |
| P1-6 | `mvp/src/components/v3/EvidenceChain.tsx` | 改 | 接入盲点视图 |
| P2-1 | `mvp/src/lib/academicSearch.ts`（新增） | 新增 | DOI 去重 + 共识度计算 |
| P2-1 | `mvp/src/lib/citationFormatter.ts`（新增） | 新增 | APA / MLA 引用导出 |
| P2-2 | intake + `orchestrateShared.ts` | 改 | 扩 PDF 解析通道 |
| P2-3 | `mvp/src/lib/admiraltyRating.ts`（新增） | 新增 | A-F + 1-6 双轴评级 |
| P2-4 | `mvp/src/lib/sourceCredibility.ts` | 改 | `scoreFreshnessFromTimestamp` 增可配置策略 |
| P2-5 | `mvp/src/lib/pipeline.ts` | 改 | 加 `mode` 参数 |
| P2-6 | 全栈 | 改 | 双语规范化 + UI i18n（按用户决策） |

## 附录 B · 三个固定 demo case 端到端验收清单

1. **空搜索 case**：`「某明星昨天因某事件被捕」`（搜索 0 命中）
   - 期望：Mission Control 全流程跑完 → 结尾首句含「求证：…暂无可靠证据」 → `credibilityScore ≤ 50` → `insufficientEvidence=true` → `claimReview` JSON-LD 通过 validator
2. **学术争议 case**：`「疫苗导致自闭症」`
   - 期望：KPA 抽出 ≥1 support + ≥1 oppose → 子命题树 ≥3 节点 → 至少 1 条同行评审反证 → `claimReview` 标注"已被多项同行评审研究反驳"
3. **多源对比 case**：`「X 国发生暴动」`（中英文媒体 3+ 信源）
   - 期望：盲点视图展示立场分布 → 句子级引用溯源可点开原文 → 历史信誉 ≥1 信源评级显示 → JSON-LD `url` 字段填 `/r/:caseId`

## 附录 C · 关键竞品对标映射

| 我们的动作 | 借鉴竞品 | 借的具体能力 |
|----------|---------|-------------|
| P0-1 grounding 硬约束 | Perplexity + Grok Explain | "无证据不答" + "同行评审优先" |
| P0-2 求证语言模板 | 新华社 / 央视求证栏目 | "求证：……」结构化措辞 |
| P0-3 ClaimReview JSON-LD | Duke Reporters' Lab + schema.org | 利用 2025-06 Google 下线窗口 |
| P1-1 IBM KPA | Project Debater + ACL 2020 论文 | Key Point Analysis 论点抽取 |
| P1-2 Kialo 风格树 | Kialo | 可视化结构 |
| P1-3 句子级引用 | Logically.app（原 Afforai） | PDF 页码级溯源 |
| P1-4 来源历史信誉 | Logically.ai | B2G 级信誉评分（仅展示，不入公式） |
| P1-5 逻辑谬误诊断 | Master Fallacy + logicalfallies.org | 50+ 谬误标签 |
| P1-6 盲点视图 | Ground News | 立场聚合 + 盲点提示 |
| P2-1 学术通道 | Consensus + Elicit | 论文支持/反对共识 |
| P2-2 PDF 阅读 | Logically.app | 学术 PDF 解析 |
| P2-3 NATO Admiralty | NATO Admiralty Code | 双轴评级 |
| P2-4 时间衰减 | （自创） | 可配置衰减 |
| P2-5 特化模式 | Full Fact 大选直播 + Consensus | 编辑室 vs 学术 |
| P2-6 多语言 | （自创 + 借鉴秘塔） | 双语对齐 |