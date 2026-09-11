# 验收：仓库清理（第一批）

日期 2026-09-11。范围：只清理「对产品没有任何用处、且可再生成或已被别处覆盖」的东西；不动产品行为。

## 一句话任务

把仓库里误入库的过程产物、工具缓存和零引用死代码清出去，让 `git clone` 拿到的是产品而不是运行残渣，同时一行产品行为都不改。

## 背景数据（实测于 2026-09-11）

| 事实 | 数值 | 来源 |
|---|---|---|
| 工作区总体积 | 1.8G | `du -sh .` |
| tracked 文件数 | 1782 | `git ls-files | wc -l` |
| tracked 体积 | 304M（源码只占约 20M） | `git ls-files -z | xargs -0 du -ck` |
| `out/` tracked | 208 文件 / 105M | `git ls-files out | wc -l` |
| `docs/qa` tracked | 289 文件 / 95M | 同上 |
| `docs/design` tracked | 377 文件 / 80M | 同上 |
| `.git` 体积 | 228M | `du -sh .git` |

`out/`、`.omo/`、`.statamcp/` 是在 2026-09-10 合并 `d3ac59f` 时一次误入库的（`git ls-tree d3ac59f^1 out` 为 0，`git ls-tree d3ac59f out` 为 208）。`docs/NOTES.md:27` 自己写着「现存 .omo/.statamcp/out 未清理」。

## Change

### C1 过程产物停止跟踪（保留工作区文件）

- `out/`、`.omo/`、`.statamcp/` 三个路径 `git rm -r --cached`，文件留在磁盘上不删。
- `.gitignore` 增加 `out/`、`.omo/`、`.statamcp/`。
- 理由：这些是 QA 脚本按次生成的输出（`scripts/qa/*.py` 的 `--out`），内容与 `docs/qa/artifacts/` 已归档的收据重复；`out/shannon-80-final/replay/*/trace.zip` 与 `docs/qa/artifacts/shannon-80-candidate-f3b9901/replay/*/trace.zip` 是同一批文件的两份。

### C2 工具缓存与 OS 垃圾删除

**范围修正（2026-09-11 执行时）**：原列 `.sc/`、`.teable/`、`.video_agent/`、`.codegraph` 改为**保留**。理由是核验后发现它们不是本仓垃圾，而是本地工具状态：`.codegraph` 是指向 `~/.omo/codegraph/...` 的符号链接且目标仍然存在（活集成），`.sc`/`.teable`/`.video_agent` 各含 1 个本地工具配置文件。删除收益接近零，但要重配，不属「对产品一点用处都没有」。

删除（均为未跟踪且可再生）：

- `.DS_Store` 全部 10 处
- `.playwright-mcp/`（7.5M，Playwright MCP 缓存）
- `tmp/`（4 张预览截图，且未被 .gitignore 覆盖，`git status` 里长期显示 `?? tmp/`）
- `.sc/`、`.teable/`、`.video_agent/`、`.codegraph`（本地工具状态与指针/符号链接）
- `.claude/skills/` 与 `.grok/skills/` 下的 broken symlink（各 12 条，目标 `.agents/skills/` 已在上一轮清理中删除）

同时把 `tmp/` 写进 `.gitignore`。四条新规则均锚定仓库根（`/out/`、`/.omo/`、`/.statamcp/`、`/tmp/`）——初版写的是不带前导斜杠的 `out/` / `tmp/`，会匹配任意层级同名目录，以后出现 `mvp/out` 之类会被静默忽略；独立验收官指出后已锚定，并反查确认仓库内名为 `out`/`tmp`/`.omo`/`.statamcp` 的目录只有根级四个。

### C3 零引用死代码删除

**追加（2026-09-11，独立验收官指出后补做）**：`mvp/src/styles.css` 的 `.privacy-policy-page` 段落（L15396–15506，111 行）随 `PrivacyPolicy.tsx` 删除后变成孤儿样式（`rg 'privacy-policy-page' mvp/src --glob '!styles.css'` 零命中），一并删除。styles.css 17667 → 17556 行。

已逐条手工核验（见「Evaluator E3 的证据」）：

- `mvp/src/lib/sourceCredibility.ts`（259 行）——搬迁到 `packages/core/src/rules/sourceCredibility.ts` 后遗留的旧副本，全仓无 import
- `mvp/src/components/v3/settings/PrivacyPolicy.tsx`（185 行）——无路由、无 import
- `mvp/server/src/lib/piBridge/index.ts`（6 行）——纯 barrel，消费者全部直连 `piSession.js` / `piModels.js`
- `mvp/src/data/reasoningCanvas.ts` 的 `L64–305`（242 行零引用导出）
- `mvp/src/store/reasoningStore.tsx` 的 `L723–812`（90 行零引用 selector）

## Not this

- **本批未提交**。`git clone` 只取 commit，所以「让 clone 拿到产品」这个目标在提交前不算兑现；E1/E7 只证明到 index 状态。未提交的原因：`docs/NOTES.md` 里有并发会话的段落（RSIH harness 安装），`-A` 提交会把它的在制品一起带进去。是否提交留人裁。

- 不动 `ops.sh`（T20 红线）。
- 不删 `mvp/`（T20 红线）。
- 不删 `packages/`：`packages/core/src/investigation` 是 mvp 前端的真实构建依赖（11 个文件 import `@rhg/core/investigation`），删了 mvp 前端构建与 Vercel 部署一起断。
- 不改任何产品行为、不改判词/检索/评分逻辑、不改 UI、不动 schema。
- 不重写 git 历史（`.git` 228M 不会因为本次改动变小；历史瘦身是另一件事，需重新 clone 才见效）。
- 不删 `docs/qa/`、`docs/design/`（那是人评要看的取证，本批只报告体积，不处置）。
- 不删 `Chinese_Rumor_Dataset/`、`tmp-apodex-study/`、`vendor/`（未跟踪，不影响 clone；删除属人裁，本批只报告）。
- 不删 `exports/`、`outputs/`（含路演用 pitch deck，属人裁）。
- 不处理文档矛盾、不重构 `NOTES.md`（属第二批，需先裁决）。

## Evaluator

机器项（全部必须通过）：

- **E1 过程产物已停止跟踪**：`git ls-files out .omo .statamcp | wc -l` 输出 `0`；且 `test -d out && test -d .omo && test -d .statamcp` 仍成立（文件没被删）。
- **E2 忽略规则到位**：`git check-ignore -v out .omo .statamcp tmp/` 四行都命中 `.gitignore`。
  - 判定命令勘误（2026-09-11 实测）：`tmp` 必须写成 `tmp/`。`.gitignore` 里的 `tmp/` 是目录型规则，只匹配目录；`tmp/` 目录本身已被本批删除，不存在时 git 无法判定它是目录，`git check-ignore tmp`（无尾斜杠）返回未命中。带尾斜杠、或目录下存在任一文件（`tmp/probe`）时规则正常命中 `.gitignore:104`。这是判定命令写法问题，不是清理未生效；按「改判定不改口」原则改命令并在此记录。
- **E3 死代码已删**：`for f in mvp/src/lib/sourceCredibility.ts mvp/src/components/v3/settings/PrivacyPolicy.tsx mvp/server/src/lib/piBridge/index.ts; do test ! -e "$f" || echo "STILL EXISTS $f"; done` 无输出；`rg -c 'maxRevealStage|canvasNodes|canvasEdges|reasoningSteps' mvp/src/data/reasoningCanvas.ts` 无输出。
  - **删除前的核验证据**（本契约要求先核验后删，核验命令与结果记录在案）：
    - `rg -l --hidden -g '!node_modules' -g '!.git' 'sourceCredibility' .` → 命中仅：`mvp/src/lib/sourceCredibility.ts`（自身）、`packages/core/src/rules/sourceCredibility.ts`（搬去后的正本，被 `rules/index.ts` 引用）、`mvp/DEVELOPMENT_LOG.md`（历史日志）、`docs/tasks/casefile-spine.md:146`（搬迁任务书，写明「搬到 packages/core/src/rules/」）。零 import。
    - `rg -n 'PrivacyPolicy' mvp/src` → 仅自身文件与 `v4-ui-e2e.test.ts:81` 里一段 `git diff` 命令字符串；`rg 'privacy|Privacy' mvp/src/App.tsx mvp/src/goldenPath/*.tsx` 无输出，确认无路由。
    - `rg -n 'piBridge' mvp` → 消费者是 `piBridge/piSession.js` 与 `piBridge/piModels.js`，没有人 import `piBridge/index.js`。
      - **口径补正（独立验收官 2026-09-11 指出）**：`piBridge/index.ts` 除 `piSession.js` / `piModels.js` 外还 re-export 了 `./piEvents.js`（`normalizePiEvent` / `PiEventCollector` / `PiStreamItem`）。删除仍安全（`piEvents` 只被 `piSession.ts:18` 直连，无消费者走 barrel），但原文「消费者全部直连 piSession.js / piModels.js」不完整。
- **E4 垃圾已清**：`find . -name .DS_Store -not -path './node_modules/*' | wc -l` 输出 `0`；`test ! -d .playwright-mcp`；`test ! -d tmp`。
  - **不包含 `.sc`、`.teable`、`.video_agent`、`.codegraph`**：C2 执行时已改判保留（见 C2 范围修正），初版 E4 仍要求它们不存在，属契约自相矛盾。2026-09-11 按 C2 修正 E4：与 C2 保持一致，只要求 `.DS_Store`、`.playwright-mcp`、`tmp` 三项消失。
- **E5 门禁全绿**：`npm test`（根，四个 workspace）0 失败；`cd mvp && npm test` 0 失败；`npm run build` exit 0；`cd mvp && npm run build` exit 0。
- **E6 没删到活代码**：`git status --porcelain` 中不存在 `D ` 开头的已跟踪源码文件删除（`out/`、`.omo/`、`.statamcp/` 的 `D` 是 C1 预期，须逐条核对只来自这三个路径）。
- **E7 体积兑现**：`git ls-files -z | xargs -0 du -ck | tail -1` 相比清理前的 304M（`311460` KB）下降；tracked 文件数算式：`1782 − 210（out 208 + .omo 1 + .statamcp 1）− 3（死文件）= 1569`，再加本批新增的两个文件（本契约与 `docs/tasks/2026-09-11-repo-cleanup/lessons.md`）= **1571**。
  - 算式勘误（2026-09-11）：初版只写到 1569「允许 ±2」，漏算了本批新增文件；独立验收官指出后，这里改成把新增文件显式列出，不再用区间含混。实测 index 入完后的 `git ls-files | wc -l` = **1571**，与上面算式完全一致。

人评项（机器无传感器，交付时单独列出）：

- **H1** 工作区是否变清爽（`ls -a` 顶层一眼看去是否还有明显的临时目录）。
- **H2** 是否认可把 `docs/qa/`（95M）与 `docs/design/`（80M）留在仓库里，还是要另立一批把 trace.zip / webm 归档出去。

## 裁决记录（2026-09-11）

- **`docs/design` 下的录屏 `.webm`（7 个 / 27.2M）：用户裁决保留（A）**。理由是它们是真实运行录屏、重录要花模型钱与时间，且其中两个大文件（`final/real/real-sse-desktop.webm` 11.8M 与 `final/real-after-74/…` 10.1M）承载「同一段真实 SSE 修 #74 前后对照」的价值，截图给不了动效与节奏。本批只停止跟踪 `trace.zip`，png 与 webm 保持跟踪。
- 结论：`docs/**/*.zip` 一条忽略规则即本批全部媒体处置，不再扩大。
