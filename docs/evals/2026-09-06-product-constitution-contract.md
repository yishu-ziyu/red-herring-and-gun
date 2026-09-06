# 产品宪法与 Golden Path 契约验收规范（#50 独立复核）

背景：GitHub Issue #49（Product Reset）及 Issue #50（[Reset 1] 写入产品宪法与 Golden Path 契约）。
日期：2026-09-06。
定位：本任务是整个 Product Reset 的阻塞前置门禁，目标是将已确定的产品原则写回仓库唯一真相源（`docs/PRODUCT_SPEC.md`）；`README.md` 与 `CONTEXT.md` 经检查后确认一致，因此零修改。严格禁止修改生产前端、后端或交互代码。

## Change

1. **产品一句话定义自立**：脱离 Agent / 模型 / 搜索品牌独立成立。第一屏即可读懂「用户给什么、系统做什么、用户得到什么」，无需阅读底层架构章节。
   - *Evaluator*: `grep -n "可检查的信息调查工具" docs/PRODUCT_SPEC.md` 命中第一节；第一节不出现必须读架构章节才懂的术语。
2. **不可让步原则 1（Evidence Auditability > Agent Observability）**：明确写出「白盒 ≠ 展示所有 Agent 行为」，白盒展示的是「判断为什么成立」（原话被拆成了什么，找到哪些证据，哪些支持/反驳/仅相关/尚缺，证据为什么冲突，判断如何形成）。
   - *Evaluator*: `grep -n "Evidence Auditability > Agent Observability" docs/PRODUCT_SPEC.md` 命中；`grep -n "白盒 ≠ 展示所有 Agent 行为" docs/PRODUCT_SPEC.md` 命中第二节。
3. **白盒三层模型**：
   - 命题透明：原话被拆成了什么，是否改变了原意。呈现拆分结果与原句对照，拆分过程不呈现（中间尝试、模型推理不上脸）。
   - 证据透明：支持 / 反驳 / 仅相关分别是什么，必须绑定可点开出处；尚缺是一等 Evidence Gap，写明缺什么、为什么阻止更强判断，无来源明确写无来源，不为凑链接把相关结果当支撑。
   - 判断透明：为什么得到这个结论，冲突在哪里，仍不能推出什么。
   - *Evaluator*: `grep -n "命题透明\|证据透明\|判断透明" docs/PRODUCT_SPEC.md` 命中白盒三层结构表。
4. **不可让步原则 2（复杂调查，简单理解 & 视觉门禁）**：明确视觉体验属于产品门禁，视觉验收与功能验收同等作为发布门禁，而不是发布后的美化项；不先解决信息架构留给 polish，也不先换皮。
   - *Evaluator*: `grep -n "视觉体验属于产品门禁" docs/PRODUCT_SPEC.md` 命中第二节。
5. **唯一 Golden Path**：
   `输入（一句话 / 截图 / 链接） → 命题拆解 → 证据汇入 → 冲突/缺口 → 判断 → 来源下钻`。调查逻辑默认可见并渐进呈现；执行过程默认隐藏。
   - *Evaluator*: `grep -n "唯一 Golden Path" docs/PRODUCT_SPEC.md` 命中；`grep -n "命题拆解\|证据汇入\|来源下钻" docs/PRODUCT_SPEC.md README.md` 命中；无第二条并列主路径。
6. **实现层默认隐藏**：Agent 名、provider、tool call、token、RRF、pipeline、内部 verdict enum（`verdictType` / `faceVerdict`）、调试信息定义为实现层概念，不是产品核心概念，默认隐藏。调查必需的证据语义（支持、反驳、仅相关、尚缺、争议）直接可见并向用户呈现。历史五词属于设计探索用语，不作为产品宪法或信息架构约束。
   - *Evaluator*: `grep -n "默认隐藏（实现层）" docs/PRODUCT_SPEC.md` 命中；`grep -n "实现层" CONTEXT.md` 命中。
7. **真相源一致性与工程事实明确**：`README.md` 与 `CONTEXT.md` 经检查后确认与宪法一致，因此零修改。`docs/PRODUCT_SPEC.md` 文件头明确为唯一真相源（devlog 仅供历史背景参考）；第八节基于 GitHub `main`、已合并 PR 及 Issue 真实状态，区分设计依赖关系与当前工程事实（如实记录 #51/#52 已合并入 `main`），不把已完成工程写成未来待执行序列。
   - *Evaluator*: `grep -n "能信还是不能信" README.md` 零命中；`grep -n "Product Reset（Issue #49）" docs/PRODUCT_SPEC.md` 命中第八节。

## Not this

1. **绝对禁止修改生产代码**：禁止修改 `mvp/` 和 `packages/` 下任何前端组件、后端 API、路由、样式或交互实现。`git diff --name-only origin/main` 绝不出现任何代码文件。
2. **不自行扩展产品方向**：不增加新的产品概念，不设计新的功能模块，不设立与 `PRODUCT_SPEC.md` 竞争的真相文档。
3. **不继续推进后续 Issue**：不在此分支处理 #51、#52、#53、#54，提交并开 PR 后停下等待人工审查。
4. **不删除既有工程与算法能力**：保留后端质询、留存、证据追索等实际能力，仅在前台和产品概念层将其界定为实现层。

## Evaluator

### 1. 机器项（自动化检查）

```bash
# 验证未修改任何代码文件（输出必须为空）
git diff --name-only origin/main -- mvp/ packages/

# 验证产品真相源关键条款命中
grep -n "可检查的信息调查工具" docs/PRODUCT_SPEC.md
grep -n "Evidence Auditability > Agent Observability" docs/PRODUCT_SPEC.md
grep -n "白盒 ≠ 展示所有 Agent 行为" docs/PRODUCT_SPEC.md
grep -n "命题透明" docs/PRODUCT_SPEC.md
grep -n "证据透明" docs/PRODUCT_SPEC.md
grep -n "判断透明" docs/PRODUCT_SPEC.md
grep -n "产品门禁" docs/PRODUCT_SPEC.md
grep -n "唯一 Golden Path" docs/PRODUCT_SPEC.md
grep -n "默认隐藏（实现层）" docs/PRODUCT_SPEC.md

# 验证无过时旧承诺
grep -n "告诉你能信还是不能信" README.md || echo "PASS: no obsolete promise in README"

# 运行代码库全量测试验证环境无回归
npm test
npm run build
cd mvp && npm test
```

### 2. 人评项（等待人工审查裁决）

- **第一屏可读性**：未读过架构的普通用户只看 `docs/PRODUCT_SPEC.md` 第一屏是否能准确说出产品是什么。
- **一致性体验感知**：`README.md` 与 `docs/PRODUCT_SPEC.md` 所表达的产品形态是否高度统一。
- **宪法完备性**：两条不可让步原则、白盒三层、Golden Path 是否存在任何可能引起研发歧义的表述。
