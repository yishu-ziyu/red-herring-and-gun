# 教训记录 · 仓库清理

## 第 1 轮：删「死代码块」删掉了一个活的局部函数

- **检查项**：`cd mvp && npm run build`（tsc 阶段）。
- **失败值**：`src/store/reasoningStore.tsx(389,47): error TS2304: Cannot find name 'clampInteger'`（393 行同）。
- **根因**：调研只按「是否 `export` + 是否有外部 import」判定死代码。`clampInteger` 是**非导出**的模块级局部函数，没有 `export`，因此不在死导出统计里；但它被同一文件的 reducer 在 389/393 行调用。删除 `L718–811` 时把它的定义一起删了。
- **修正**：把 `clampInteger` 原样加回文件末尾（`git show HEAD:mvp/src/store/reasoningStore.tsx | sed -n '793,796p'` 取回原文）。重跑 mvp build exit 0、mvp test 1160 过。
- **下次怎么做**：删代码块前，除了查 `export` 与外部 import，还要把该块内**全部标识符**（含非导出函数、常量）逐个在全文件内反查引用，不能只按导出名判断。

## 第 2 轮：独立验收官抓出的四件事（都不是误删，是口径与收口问题）

1. **契约自相矛盾**：执行时改判「保留 `.sc/.teable/.video_agent/.codegraph`」并写进 C2 范围修正，却忘了同步 E4。E4 字面要求这三个目录不存在，机器项因此永远过不了。根因是改 C2 时只改了 Change 段没改 Evaluator 段。已按 C2 修 E4。
2. **判定命令不严**：E2 写 `git check-ignore -v out .omo .statamcp tmp`，`tmp` 无尾斜杠。`.gitignore` 里 `tmp/` 是目录型规则，只匹配目录；目录已被删掉时 git 无法判定它是目录，返回未命中。带尾斜杠或存在探针文件即正常命中。已改判定命令并在契约记录勘误。
3. **`.gitignore` 规则未锚定根**：`out/`、`tmp/` 不带前导斜杠会匹配任意层级同名目录，以后出现 `mvp/out` 之类会被静默忽略。已改成 `/out/`、`/.omo/`、`/.statamcp/`、`/tmp/`，并反查确认仓库内只有根级这四个。
4. **孤儿 CSS 漏清**：删掉 `PrivacyPolicy.tsx` 后，`mvp/src/styles.css` 的 `.privacy-policy-page` 段（111 行）零引用仍在。删组件要连它独占的样式一起查，`rg '<组件类名>' --glob '!styles.css'` 就是判定命令。已删，styles.css 17667 → 17556 行。

口径补正：删掉的 `piBridge/index.ts` 除了 re-export `piSession.js` / `piModels.js`，还 re-export 了 `piEvents.js`。删除仍安全（`piEvents` 只被 `piSession.ts:18` 直连），但原表述不完整，已改。

**未收口的一条**：全部改动未提交。`git clone` 只取 commit，所以「让 clone 拿到产品」这个目标在提交前不算兑现 —— E1/E7 只证明了 index 状态。提交与否留给用户裁决，因为 NOTES.md 里有并发会话的段落。
