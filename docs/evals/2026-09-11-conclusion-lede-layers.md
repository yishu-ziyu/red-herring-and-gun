# 结论区分成两层（短判断 + 解释）

日期：2026-09-11
方案：展示层 A 方案（用户 2026-09-11 选定）
契约路径：`docs/evals/2026-09-11-conclusion-lede-layers.md`

参照物：`docs/design/reference-pack/screenshots/desktop-mode3-hybrid.png`（用户 2026-09-06 已批准并录入 reference-pack）。当前线上实拍：`docs/design/2026-09-06-golden-path/desktop-9-real-complete.png`。

## Change

1. **数据层把结论拆成两层，`directAnswer` 语义不动。**
   - `directAnswer` 保持现状：`clip(report.conclusion, 400)`，不改语义、不改截断长度（`packages/core/src/investigation/build.ts:547`，镜像 `mvp/server/src/lib/investigation/build.ts:547`）。
   - 新增可选字段 `verdictLead`：结论里**第一句判断句**，含其结尾标点。
   - 启用已有但从未赋值的 `rationale`（`packages/core/src/investigation/schema.ts:166`，镜像 `mvp/server/src/lib/investigation/schema.ts:166`）：判断句之后的解释文本。
   - 两个字段都由 `build.ts` 里同一个确定性函数从 `report.conclusion` 切出来，不调用模型、不新增提示词。

2. **切分规则（确定性，输入 `report.conclusion` 原文 + `originalClaim`）。**
   - 用现有切句函数 `splitSentences`（`packages/core/src/text/publicCopy.ts:149`，按 `。！？` 切后过滤空段）。
   - **丢弃开头的原句复述句**（可连续多句）。判定为复述句，命中**任一**条件即算：
     ① **逐字复述**：去掉首尾引号与引导词后，剩余文本与 `originalClaim` **完全相同**。
     ② **带引导词 / 连接词的复述**：先剥离引导词（「流传说法是 / 原句 / 这句话 / 该说法」，可带首尾引号），**再剥离紧跟其后的连接词**（称 / 说 / 指出 / 表示 / 宣称 / 写道 / 提到 / 认为 等），然后剩余文本与 `originalClaim` **完全相同**。
   - **一律要求「完全相同」，不得使用任何重叠率 / 比例阈值。** 三轮实测证明比例判据必然误伤：只要原句之上追加了新信息（「隔夜水中含有亚硝酸盐，但没超标。」、「该说法称喝隔夜水会致癌，但没超标。」），比例判据就会把带新信息的判断句当成复述丢掉，而丢判断句和丢新信息都是内容损失。判据**宁严不宽**：判不出来就保留。
   - **修订记录（2026-09-11，共三次）**：初稿「以引导词开头即算」会把判断句「原句站不住。」丢掉（`docs/PRODUCT_SPEC.md:82` 明确它是合格第一句）；第二稿「无引导词 + 重叠率 ≥60%」会把「原句 + 新信息」的句子丢掉；第三稿改为分母为剥离后长度，仍会误伤带连接词且追加新信息的句子。**现稿为最终版：条件 ① 与 ② 都要求完全相同，模糊性归零。**
   - `verdictLead` = 剩余句序列的第 1 句。
   - `rationale` = 剩余句序列第 2 句起的拼接；为空则不输出该字段。
   - 被丢弃的复述句不进任何一层 —— 它已由既有的「你调查的说法」块展示，不得在首屏出现第二次。

3. **前端 `ConclusionHero` 渲染成两个独立节点。**
   - `mvp/src/goldenPath/ConclusionHero.tsx`：判断句用现有 display 字号（`.gp-hero-answer` 的 24px/700），解释文本另起一个节点、用正文样式（字号重量级降到正文档，与判断明确分层）。
   - 新增稳定的测试钩子：判断句节点保留 `data-gp-direct-answer`，解释节点加 `data-gp-rationale`。
   - **回退**：`verdictLead` 缺失或为空时，按今天的做法只渲染 `directAnswer`（保证旧快照、core 单句路径、fixture 都能正常渲染）；`rationale` 缺失时只不渲染解释层。

4. **顶层「边界」不再重复命题级边界。**
   - `build.ts` 组装顶层 `boundaries` 时不再并入各 `claim.boundary`，只承载整次调查级的边界（`report.causalBoundary`）。
   - 命题级 `boundary` 继续只在命题内部展示（`mvp/src/goldenPath/ClaimSection.tsx:173`），信息不丢失，只是不再同一屏出现两次。

## Not this

- **不做前端按句号切分的展示启发式。** 层次必须在数据层定；core 单句路径（`packages/core/src/stages/safeVerdictLine.ts:49`）本来就只有一个终止句号，前端切分在那边永远产不出第二层。
- **不改 `directAnswer` 的语义与 400 字截断。** 它被大量 `startsWith` / `slice` 断言钉死（如 `mvp/server/src/lib/casePipeline/runCasePipeline.wholeClaimAudit.test.ts:1200`），重定义会无谓放大波及面。
- **不改结论提示词，不改 verdictType 词表，不新增模型行为。** 生产提示词（`mvp/server/src/lib/agentConfigs.ts:604-610`）已经要求「第一句直接回答 + 一句一事 + 2–5 句」，本次只是把既有结构显式化。
- **不动 mode3 的黑名单。** 不加色块、卡片、发光、玻璃；解释层靠字号与留白分层。
- **不在本轮收排版 scale（18 档字号 / 7 档字重 / 缺衬线）。** 那是 B 方案，单独一轮、单独契约。
- **不补交互反馈（`:active`、浮层出场对称）。** 那是 C 方案。

## Evaluator

机器项（全绿才算做完）：

| # | 检查 | 命令 / 判据 |
|---|---|---|
| E1 | 切分函数行为正确 | 新增 `packages/core/src/investigation/build.lede.test.ts`，覆盖三个 fixture：① 首句即判断 → `verdictLead` = 首句、`rationale` = 其余；② 首句是原句复述 → `verdictLead` 取第二句、复述句**不出现**在任何一层；③ 单句结论 → `verdictLead` = 该句、`rationale` 缺省。命令：`cd packages/core && npx vitest run src/investigation/build.lede.test.ts` |
| E2 | 两层不重叠、不丢判断 | 同 E1 文件断言：`verdictLead` 只含一句（句内无 `。！？`），且 `rationale` 不包含 `verdictLead` 的文本 |
| E3 | 镜像未漂移 | `cd packages/core && npx vitest run src/investigation/mirror.test.ts`（`schema.ts` / `build.ts` 两侧字节一致） |
| E4 | 前端两层都渲染 | `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`，新增断言：完成态下 `[data-gp-direct-answer]` 文本只含一句判断且**不含原句复述**；`[data-gp-rationale]` 存在且非空；`rationale` 文本不出现在判断节点里 |
| E5 | 顶层边界不重复命题边界 | 同 E4 文件新增断言：完成态下 `[data-gp-boundaries]` 的文本不出现在任一命题的 boundary 节点中；`[data-gp-boundaries]` 仍满足既有第 7 条（非 alert/warning、无 ⚠️、含「不能推出」） |
| E6 | 回退路径不破 | 同 E4 文件：`verdictLead` / `rationale` 缺省的 fixture 仍渲染完成态，`[data-gp-direct-answer]` 有内容 |
| E7 | 无回归（服务端与快照） | `cd mvp && npx vitest run server/`（服务端子集）；`cd mvp && npx vitest run`；根 `npm test`。注：`cd mvp/server && npx vitest run` **不可用** —— `mvp/server` 没有自己的 vitest 配置，setup 按 cwd 解析会报 `Cannot find module .../mvp/server/src/test/setup.ts`，这是仓库既有配置缺口，不是回归。 |
| E8 | 类型与构建 | `cd mvp && npm run build`；`cd mvp/server && npm run build` |
| E9 | 复述判定不误伤「原句 + 新增信息」 | 同 E1 文件新增用例：`originalClaim="隔夜水中含有亚硝酸盐。"`，首句「隔夜水中含有亚硝酸盐，但没超标。」**必须保留**为 `verdictLead`，不得被判为复述句丢弃。命令：`cd packages/core && npx vitest run src/investigation/build.lede.test.ts` |
| E10 | 带引导词 / 连接词的真复述必须丢弃 | 同 E1 文件：`originalClaim="喝隔夜水会致癌。"` 时，「该说法称喝隔夜水会致癌。」「该说法指出喝隔夜水会致癌。」「这句话说喝隔夜水会致癌。」「原句说喝隔夜水会致癌。」四句作首句时**必须被丢**，`verdictLead` 取其后句子 |
| E11 | 带连接词且追加新信息必须保留 | 同 E1 文件：`originalClaim="喝隔夜水会致癌。"`，首句「该说法称喝隔夜水会致癌，但没超标。」**必须保留**为 `verdictLead`（条件 ② 已要求剥离后完全相同，此句剥离后为「喝隔夜水会致癌，但没超标。」≠ 原句，故必须保留） |

人评项（机器判不了，单独列出等人裁）：

- 首屏观感：把改动后完成态截图与 `docs/design/reference-pack/screenshots/desktop-mode3-hybrid.png` 并排看，判断是否回到「一句判断 + 一段解释」的层次。这一条**不得**用测试绿替代。

已知代价与风险（写下来，避免验收时才吵）：

1. **测试 fixture 可能需要补 `causalBoundary`。** `mvp/src/goldenPath/goldenPath.test.tsx:537-547` 依赖 `[data-gp-boundaries]` 存在。若其 fixture（`completeFromInvestigating()`）没有 `causalBoundary`，改完顶层边界只剩整调查级后该块会消失。届时**必须显式给 fixture 补 `causalBoundary`**，不得为了让测试过而把命题边界塞回顶层。
2. **`eval:gate` 在 main 上本来就是红的**（`baseline.json` 缺 `metricSemver` 字段，26 案资格标签全为 unlabeled）。本次改动不负责修它，也不得改 baseline 换绿灯；PR 里如实记录即可。
3. **`publicCopy.ts` 不是字节镜像**，core 版与 server 版词表不同。本次若要复用 `splitSentences`，注意它只存在于 `packages/core` 侧；`build.ts` 在两侧是镜像文件，两侧都要同步。
4. 不得手改真实调查数据、不得为了让截图好看而改后端判词。

---

## 增补（2026-09-11，用户裁决）：去掉结论区的「边界」小标题

用户看着完成态截图指出：「我觉得边界这个小标题就很没必要。」这与 `docs/PRODUCT_SPEC.md:82`「小节标题写成判断本身」一致 —— 「边界」是分类标签，不是判断。

### Change

- `mvp/src/goldenPath/ConclusionHero.tsx`：不再渲染 `<span className="gp-hero-boundary-title">`。「边界」这个小标题从结论区移除；边界正文（`ul.gp-hero-boundary-list`）继续渲染，内容一字不动。
- `mvp/src/goldenPath/golden-path.css`：删除随之失效的 `.gp-hero-boundary-title` 规则；`.gp-hero-boundary-list` 的 `margin-top` 由 `4px` 改为 `0`（那 4px 原本是给小标题留的间距）。
- `copy.ts` 的 `boundaryLabel` **保留不动** —— 命题级边界仍用行内加粗引导词渲染（`ClaimSection.tsx:175`，形如「**边界** 只覆盖声明发布时间前的公开记录」），那里它是句子的主语，去掉会让文本变成没有主语的片段。

### Not this

- 不动命题级边界的行内引导词。
- 不改边界正文的文案、语义色与背景（它仍然是认识论说明，不是 warning alert）。
- 不改 `[data-gp-boundaries]` 等测试钩子。
- 不借这一轮顺手动别的标题或排版（那是 B 方案）。

### Evaluator

| # | 检查 | 命令 / 判据 |
|---|---|---|
| E12 | 小标题已移除、边界正文仍在 | `cd mvp && npx vitest run src/goldenPath/goldenPath.test.tsx`：新增断言 —— 完成态下 `document.querySelectorAll(".gp-hero-boundary-title").length === 0`；`[data-gp-boundaries]` 仍存在且 `textContent` 含整调查级边界正文（`现有材料不能推出隔夜水本身有任何致癌性`）。E5 既有断言（非 alert/warning、无 ⚠️、含「不能推出」、命题边界不串入顶层）继续全绿 |
| E13 | 命题级行内引导词未被误删 | 同文件新增断言：`.gp-boundary` 节点仍存在且其 `textContent` 以「边界」开头 |
| E14 | 无回归 | `cd mvp && npx vitest run`；`cd mvp && npm run build` |

人评项：结论区观感 —— 小标题去掉后，那块浅色区域是否仍读得出「这是说明、不是结论」。单独列出等人裁，不得用测试绿替代。
