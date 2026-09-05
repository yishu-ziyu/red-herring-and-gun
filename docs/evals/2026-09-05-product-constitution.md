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

## 2026-09-05 PR #55 人工验收 blocker 修订

人工结论：方向通过，暂不合并；三个 blocker 只修契约文档。

### Blocker 1：ROADMAP 与宪法只剩一套现行规则

- Change：ROADMAP 五词规则降为顶层产品语言与导航骨架，明写不是封闭词表，证据语义（支持 / 反驳 / 仅相关 / 尚缺 / 争议）必须能直出用户面前；「内部词」限定为实现层清单；写明与 PRODUCT_SPEC 冲突时改 ROADMAP。「拆分过程不呈现」精确定义为：不展示模型推理、中间尝试和内部拆题日志，必须展示最终拆分结果并可对照原句查是否改题。Evaluator：`grep -n "不是封闭词表" docs/ROADMAP.md`、`grep -n "必须展示最终拆分结果" docs/ROADMAP.md`、`grep -n "改本文件" docs/ROADMAP.md` 全命中；PRODUCT_SPEC 第二节「默认隐藏」小节同步为新规则，不再写「落到用户面前时用五词表达」。
- Not this：不删五词、不改 ROADMAP 的待议顺序结构、不把裁决推迟到 #52。

### Blocker 2：「过程默认收着」废止，两个对象分开

- Change：PRODUCT_SPEC 全文不再出现「过程默认收着」；Golden Path 下与主路径行为改为「执行过程（Agent、tool call、provider、token、模型推理、内部日志）默认隐藏；调查逻辑（原句 → 命题 → 证据关系 → 缺口/冲突 → 判断）默认可见并渐进呈现」。devlog 同步。Evaluator：`grep -rn "过程默认收着" docs/PRODUCT_SPEC.md docs/devlog/2026-09-05-product-constitution.md` 零命中（历史记录节引用旧说法的除外）；`grep -n "默认可见并渐进呈现" docs/PRODUCT_SPEC.md` 命中。
- Not this：不改历史记录节按当时状态的引文；不改 `docs/reviews/` 旧文档。

### Blocker 3：「尚缺」不绑出处

- Change：白盒三层「证据透明」改为支持 / 反驳 / 仅相关必须绑定可点开出处；尚缺是一等 Evidence Gap，写明缺什么、为什么这个缺口阻止更强判断，无来源就明确写无来源，不许为凑链接把相关结果当支撑。Evaluator：`grep -n "一等 Evidence Gap" docs/PRODUCT_SPEC.md` 命中证据透明行；该行不再有「各自绑定」覆盖四类的说法。
- Not this：不新增 schema 或数据结构（那是 #51）；不改管线代码。

### 机器验证记录（blocker 轮）

纯文档变更，无代码路径改动；根 `npm test` / `npm run build`、mvp `npm test` 在前一 commit 全绿（core 550 / eval 85 / server 21 / web 83；mvp 870 过 / 1 跳过），本轮增量不触及任何代码文件。
