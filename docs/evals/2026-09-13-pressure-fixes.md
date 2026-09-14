# 2026-09-13 · 高压走查必改（D 追问 / B 长文 / C 贴链接）

依据：`docs/reports/2026-09-13-pressure-walkthrough/notes.md` 与同目录截图。只改走查实锤的三条，不重做思考区假三步，不放水评分考试。

## Change

### D 追问必须答这句追问（优先）

1. 追问结论第一句必须直接答用户这句追问（例如流行病学/临床实验数据），不得用拆出来的旁支（如 IARC 专项评估）顶替。
2. 跨案知识库命中：命题必须是这句追问的同一件可核查事。微波炉案不得注入「吃剩饭剩菜会致癌」这类旧记忆，不得因此带跑结论和推荐追问。
3. 同一案快路径（已有）继续；访客走完整管道时同样适用 1 和 2。禁止用无关旧记忆顶替本轮问题。

### B 长文抽可核查断言

课文/百科长文抽有争议的流传说法与少数可核对事实，不要按句切片。条数有硬上限（长文 ≤ 4）。「写进教科书」这类元叙述不单独成条、不单独判「站不住」，除非用户真在问这个。完成态空尾巴继续折进「尚缺」，不刷空壳。

### C 只贴链接且抓取失败

只贴链接且抓取失败时，调查全过程必须看见「链接打不开（可能需要登录），已按你输入的文字继续」这类提示（P0 做过，走查没挂上：12 秒 toast 在调查中消失）。0 命题时结论第一句必须说明链接没打开、没法从链接里读到要查的说法，不能假装查完后写「公开材料还撑不住判断」。

## Not this

- 不重做思考区假三步。
- 不放水评分考试，不改 `packages/eval/`。
- 不擅自 commit / 部署。
- 不为动效再拉长等待。
- 不绕过登录墙。
- 不把同一案快路径拆掉。

## Evaluator

| # | 判据 | 怎么验 | 类型 |
|---|------|--------|------|
| D1 | 微波炉流行病学追问 vs 知识库「吃剩饭剩菜会致癌」→ 不命中、不注入 | `knowledgeMatch` / knowledge 测 | 命令 |
| D2 | 隔夜菜改写变体仍可命中（记忆只加速，不误杀同题） | 同上 | 命令 |
| D3 | 追问（含「同一条核查的追问」标记）结论第一句含这句追问的可核对点（流行病学/临床），不含用 IARC 专项评估顶替 | followUp / 结论测 | 命令 |
| B1 | 长城课文（含走查那种转述 9 条）产出 ≤ 4；含太空可见；不含单独的「写进教科书」 | `textbookAtoms.test.ts` | 命令 |
| B2 | 短谣少条不收、不误伤 | 同上 | 命令 |
| C1 | 只贴打不开的链接：调查态/完成态 DOM 仍有「链接打不开（可能需要登录）」；claim 无空信封 | InputStage / App / Canvas 测 | 命令 |
| C2 | 0 命题 + 只贴链接：结论第一句不是「公开材料还撑不住判断」，而是说链接打不开 | 完成态 Canvas / 结论测 | 命令 |
| G | 相关 vitest 全绿 | 见 Gate | 命令 |

人评：本机 `:5211` 若可开，抽查追问/长文/贴链接各一眼。内置浏览器接不上不要死磕。

## Gate

```bash
cd apps && npx vitest run \
  src/lib/linkScraper.test.ts \
  src/goldenPath/inputStageLinkScrape.test.tsx \
  src/goldenPath/followUpSection.test.tsx \
  src/goldenPath/investigationCanvasFollowUp.test.tsx \
  src/goldenPath/claimSection.test.tsx \
  server/src/lib/knowledgeMatch.test.ts \
  server/src/lib/knowledgeStore.test.ts \
  server/src/lib/claimAtom/textbookAtoms.test.ts \
  server/src/lib/followUpReuse.test.ts \
  server/src/lib/atomSearch.knowledge.test.ts \
  server/src/lib/agentConfigs.test.ts
```

改过的面若还有同目录测，一并跑绿。

## Evidence

- 本契约
- 命令输出
- `docs/NOTES.md` 头部：用户现在追问/长文/贴链接会看到什么不同；没修的单列
