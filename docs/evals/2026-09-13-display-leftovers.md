# 2026-09-13 · 走查展示三条（来源墙 / 解释泄漏 / 比喻材料）

依据：`docs/reports/2026-09-13-pressure-walkthrough/notes.md` 与同目录截图（`step-a-04-conclusion.png`、`step-b-03-conclusion.png`、`step-d-04-conclusion.png`、`step-b-02-sources.png`）。只改走查见过、上一轮没动的三条。不重做追问知识库串题、长文 4 条上限、链接提示。

## Change

1. **来源条不要压结论。** 完成态结论第一句必须先于来源胶囊，或至少不被来源胶囊墙挡住。桌面完成态不得再默认展开成墙。允许：默认折叠、收到结论下方、或条上只保留已引用的来源。不要为了好看把直答挤下去。
2. **解释里不准漏内部词。** 用户可见结论/解释不得出现英文 `claim`、半截模型残字（如 `IA「「微波炉`）、内部拼接（如 `claim中「…」`）。展示层收口，复用已有 `displayFollowUpClaim` / `scrubFaceText` / 结论拆段。
3. **文不对题的比喻材料。** 检索/引用「钢铁长城」这种比喻义、和用户在查的长城工程不是同一主张时，不得当作该命题的依据展示（相关材料也要能辨认或拿掉）。最小修：材料绑定按命题文本，过滤明显跑题标题/摘要。不重写整个搜索栈。

## Not this

- 不重做追问知识库串题、长文 4 条上限、链接提示。
- 不 commit、不部署。
- 不碰评分考试、不改 `packages/eval/`。
- 不为动效再拉长等待。
- 不把同一案快路径拆掉。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| S1 | 完成态结论第一句在来源胶囊列表之前；默认不展开胶囊墙 | ConclusionHero / goldenPath 测 | 命令 |
| S2 | 点「已查验 N 个信息来源」仍能展开看到来源 | 同上 | 命令 |
| L1 | `claim中「这句话曾被写…」` 进解释 → 用户可见正文无 `claim` | scrubFace / publicCopy / 结论卡测 | 命令 |
| L2 | `IA「「微波炉加热食物会致癌」…` 进解释 → 无半截 `IA`、无 `「「` | 同上 | 命令 |
| T1 | 命题为长城工程/长度，标题「解放军是保卫祖国的钢铁长城」→ 不进该原子来源 | atomSearchQuery 测 | 命令 |
| T2 | 同命题，标题含文物局长度/太空可见 → 仍保留 | 同上 | 命令 |
| G | 相关 vitest 全绿 | 见 Gate | 命令 |

人评：本机若可开，完成态一眼能看到直答；解释无内部词；长城案材料里没有钢铁长城比喻当依据。

## Gate

```bash
cd apps && npx vitest run \
  src/goldenPath/answerBreakSegments.test.ts \
  src/goldenPath/conclusionHero.display.test.tsx \
  src/goldenPath/scrubFace.test.ts \
  src/goldenPath/followUpClaimDisplay.test.tsx \
  src/goldenPath/claimSection.test.tsx \
  server/src/lib/publicCopy.test.ts \
  server/src/lib/atomSearchQuery.test.ts \
  server/src/lib/atomSearch.test.ts
```

改过的面若还有同目录测，一并跑绿。

## Evidence

- 本契约
- 命令输出
- `docs/NOTES.md` 头部：用户现在完成态会看到什么不同
