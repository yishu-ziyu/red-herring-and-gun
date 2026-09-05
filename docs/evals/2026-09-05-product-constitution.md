# 产品宪法与 Golden Path 契约（#50）

背景：Issue #49 Product Reset、Issue #50 阻塞任务。2026-09-05 执行。本单元只改产品契约文档（`docs/PRODUCT_SPEC.md` 为主，README、CONTEXT 同步），不改前端、后端、交互实现。#51–#54 不在本轮，等人工验收。

## Change

- PRODUCT_SPEC 第一节第一屏写清产品是什么，定义可脱离 Agent / 模型 / 搜索品牌成立。Evaluator：只读第一节能回答「用户给什么、系统做什么、用户得到什么」，不出现必须读架构章节才懂的词；`grep -n "可检查的信息调查工具" docs/PRODUCT_SPEC.md` 命中第一节。
- 明文写出「白盒 ≠ 展示所有 Agent 行为」与「白盒是展示判断为什么成立」。Evaluator：`grep -n "白盒 ≠ 展示所有 Agent 行为" docs/PRODUCT_SPEC.md` 命中第二节。
- 明文写出命题透明 / 证据透明 / 判断透明三层及各自含义。Evaluator：`grep -n "命题透明\|证据透明\|判断透明" docs/PRODUCT_SPEC.md` 三个都在白盒三层小节；每层有「用户能检查什么」的一句话定义。
- 明文写出视觉体验属于产品门禁，不是发布后 polish。Evaluator：`grep -n "产品门禁" docs/PRODUCT_SPEC.md` 命中两条不可让步原则。
- Golden Path 只有一条默认主路径：输入 → 命题拆解 → 证据汇入 → 冲突/缺口 → 判断 → 来源下钻。Evaluator：`grep -n "命题拆解\|证据汇入\|来源下钻" docs/PRODUCT_SPEC.md README.md` 命中同一条路径；全文与 README 不再存在第二条并列主路径图（旧「材料进来 → 追出处 → … → 来源」图已删除）。
- Agent 名、provider、tool call、token、RRF、pipeline、内部 verdict enum、调试信息被定义为实现层、默认隐藏、不是产品核心概念。Evaluator：`grep -n "默认隐藏" docs/PRODUCT_SPEC.md` 命中含全部八类词的清单；CONTEXT 顶部声明下表为实现层词汇。
- README / CONTEXT 与 PRODUCT_SPEC 无互相矛盾的现行描述。Evaluator：`grep -n "能信还是不能信" README.md` 零命中；README 路径图为 Golden Path；`grep -n "实现层" CONTEXT.md` 命中头部声明；PRODUCT_SPEC 第四节引用锚点（「类型谁标」等）章节号未变，reviews 旧引用仍有效。
- PR 描述附「被废止的旧产品假设」，至少含：Mission Control 是产品脸、多 Agent 角色必须前台展示、可信度数字代表白盒。Evaluator：人读 PR 描述逐项核对。

## Not this

- 不改 `mvp/`、`packages/` 下任何代码与交互实现；`git diff --name-only main` 只含 README.md、CONTEXT.md、docs/PRODUCT_SPEC.md、docs/evals/、docs/devlog/、docs/NOTES.md。
- 不新增产品功能、不扩展产品方向、不另建与 PRODUCT_SPEC 竞争的产品真相文档。
- 不删除现行能力规则：质询、调查留存、证据追索、五词规则（`docs/ROADMAP.md`）都保留，只在宪法下重新定位。
- 不处理 #51–#54，不派发后续任务；PR 合并与 #50 关闭由人工验收决定。

## Evaluator

- 机器项：根 `npm test`、`npm run build` 全绿（纯文档变更，无行为变更，不跑 eval:gate）；`cd mvp && npm test` 全绿（生产壳仍在）。grep 验收逐条执行，输出贴 PR。
- 人评项（等人裁）：第一屏可读性——未读过仓库的人只读 PRODUCT_SPEC 第一节即能说出产品是什么；README 首屏与 PRODUCT_SPEC 第一节描述的是同一个产品；宪法表述本身是否还有听成别的意思的地方。
