# 2026-09-13 · 重新优化真实案例评分考试

契约依据：用户听懂「真实案例评分考试坏了」之后裁断——重新优化这一套考题，不是把及格线放水换绿灯。PRODUCT_SPEC 第八节此前把资格标签与基线修订标成待裁决单元；本契约是该裁决。

发版前有一套考试：用真实案例看调查结论准不准、出处有没有胡编、有没有胡乱引用。这套考试现在坏了（很多题目没标算不算分、对照成绩单格式过期、有时打分钥匙不通），灯一直红，说明不了产品变好还是变差。要把它修到能用。

## Change

1. **考试能跑完并给出有效对比**：`npm run eval:gate` 在钥匙可用时跑完全集，输出 `valid=true`（或诚实的 `invalidReason`）以及四门闸指标的新旧数字与 delta，而不是在对比前整场退出。
2. **每道算分的考题有明确资格**：`expectsEnterCheck` 或 `expectsEarlyStop` 二选一。以前 unlabeled 的：能根据「这题测什么」补真实标签就补；确实不该进总分的标清楚并排除。不要为了绿灯把含糊题标成合格。
3. **对照成绩单与现行 `metricSemver` 对齐**：资格集合或分母规则变了必须升版本，旧基线不得再比数字。新基线必须来自一次真实跑分（禁止手填及格线、禁止用 `--fake` 分冒充真分）。报告写出新旧数字。
4. **钥匙不通如实记录**：401 / 未配置密钥写进报告。能用仓库既有 `apps/.env.local` 跑的就跑。密钥不进 git。
5. **考题仍测得动现行产品**：结论类型、可信度区间、出处是否胡编（引用完整性）、报告契约。过时或无法给标准答案的题目退役，理由写在本文件。

## Not this

- 不把回归容差从 0.02 放宽，也不把任何「80 分及格」改成 50 来换绿。
- 不伪造黄金集资格标签，不伪造 baseline 分数。
- 不借这次改产品主路（P0/P1、证据库、追问快路径、`shareHandlers`、看不看得懂材料）。
- 不擅自 commit / push。
- 不把 `--fake` 跑分写成官方对照成绩单。

## 题目资格（本轮裁定，不是为绿灯服务）

算分、进入总分（`expectsEnterCheck: true`）的题目：有具体可核对说法、且黄金集已给出期望判词的案例。它们测的是「该查的要查完，结论/出处/报告契约对不对」。

| 题号 | 测什么 | 资格 |
| --- | --- | --- |
| RUMOR-001 … RUMOR-014 | 经典可核对传言：判词、可信度、出处、报告契约 | 进入核查 |
| TINY-001 … TINY-004、TINY-007 | 短谣：具体事件，能给标准答案 | 进入核查 |
| LOOP-001 … LOOP-003 | 口语与官方口径错位；`expectsEvidenceLoop` 只观测、不进四门闸 | 进入核查 |
| EVAL-UNVERIFIED-001 | 无公开出处时应判还查不清，不能写成能信/不能信 | 进入核查 |
| EVAL-TYPEGATE-001 | 「隔夜菜会致癌」须进入检索再下判，不能资格闸拦掉 | 进入核查 |

退役、不进总分：

| 题号 | 理由 |
| --- | --- |
| TINY-005 | 原句是「群里那张 P 图配的侮辱性文字说的是真的」：没有具体图片、没有具体文字，无法给出唯一标准答案。留着只会把「题目本身没答案」记成产品错。 |
| TINY-006 | 原句是「短视频里说的某某婚内出轨是真的」：占位「某某」，没有可核对对象。 |

本轮不新编 `expectsEarlyStop` 题。资格闸「不完整输入应停在检索前」仍由 `packages/core` 单测覆盖；考试集目前没有真人标定的停查样例，不拿捏造的停查题凑分母。缺口写进报告等人标。

`unlabeled` 在闸门与汇总里仍视为考试无效（安全网）：新题漏标资格不得混进对照。

## Evaluator

1. `packages/eval`：黄金集每一道在用题目恰好一个资格标签；TINY-005 / TINY-006 不在 `goldenDataset`。【命令】
2. `packages/eval` 闸门单测：`metricSemver` 为升版后的现行值；缺字段的旧成绩单被拒绝；指纹含 unlabeled 仍整闸拒绝（这是安全网，不是放水）。【命令】
3. `npm run eval:gate -- --fake`：跑完全集，输出 `valid=true`、`unlabeled=0`、四门闸数字。此跑只证明考试结构能用，分数不当对照成绩单。【命令】
4. `npm run eval:gate`（真实钥匙）：能跑完并打印四门对比行（`name old new delta`）。钥匙 401 / 未配置则如实记录，不编造成绩。【命令 / 环境】
5. 新 `packages/eval/baseline.json` 能被 `parseBaseline` 读入，含现行 `metricSemver`、现行 `caseIds`、不含 unlabeled 的指纹、四门闸都是有限数字。数字来自真实跑分，并在报告里对照旧数字。【命令 + 报告】
6. 相关 `packages/eval` 测试绿。不为此改无关产品代码。【命令】

## Gate

机器项必须吐可比数字，不是只有 pass/fail：

```bash
npm run eval:gate
```

期望在钥匙可用时，标准输出含四行（数字随当次跑分变化，但必须出现名称与三个数）：

```text
verdictAccuracy <old> <new> <delta>
credibilityAccuracy <old> <new> <delta>
citationIntegrityErrorRate <old> <new> <delta>
reportContractPassRate <old> <new> <delta>
```

结构自检（不当对照成绩单）：

```bash
npm run eval:gate -- --fake
```

期望 JSON 里 `valid === true` 且 `summary.unlabeled === 0`，并仍打印上述四门数字（相对基线的 delta 可以很大，因为假跑不是产品分）。

相关测试：

```bash
cd packages/eval && npx vitest run src/gate.test.ts src/score.test.ts src/golden.test.ts
```

## Evidence

- 本文件（锁定后不为让旧尝试及格而改 Evaluator）
- `docs/reports/2026-09-13-eval-exam-rebuild/`：`eval-gate-fake.txt`、真实闸门输出（或 401 记录）、`numbers.md`（新旧数字）
- `packages/eval/baseline.json`（真实跑分成绩单；假跑不得覆盖）
- `docs/NOTES.md` 头部插入本条

## 文件归属

本分身只动考试：`packages/eval/**`、`packages/eval/baseline.json`、`.gitignore` 里考试成绩单是否跟踪、本契约与报告、`docs/NOTES.md` 头部一条。不抢 `shareHandlers`、证据库、追问快路径、看不看得懂材料。
