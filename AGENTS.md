# 红鲱鱼与枪

人定价值函数，机器搜索。方法：`docs/METHODOLOGY.md`。产品：`docs/PRODUCT_SPEC.md`。运行：`docs/ARCHITECTURE.md`。

## 默认

1. 动手前写下验收标准，存 `docs/evals/YYYY-MM-DD-slug.md`：Change / Not this / Evaluator。这是独立于实现的完成尺度，用来判断做没做完、做到哪。没有 evaluator 的句子不算标准。能拆成命令的拆成命令；拆不动的标「人评」。
2. 用户说「太慢」「不好用」时不准直接改。先追问成数值、行为、截图、复现路径，再翻译成测试。
3. 压缩后先读 `docs/NOTES.md`。每个子任务刚做完就改 NOTES 头部「当前状态」。等压缩再写等于没写。
4. 方向改变写 `docs/devlog/`，不是 commit 复述。
5. 日常不读 wiki。不在用户未裁决时改本文件或 skill。
6. 机器项全绿才交付。测试绿但用户路径没通，改 evaluator，不改口说完成。人评项单独列出等人裁。
7. 新工作先开 Issue 并挂到 Project「红鲱鱼与枪」；关 Issue 前在「结果」字段写数字或人评结论，验收标准文档末尾补「结果」并链接该 Issue。

## 能合并

```bash
npm test
npm run build
```

行为变更再跑 `npm run eval:gate`。生产壳是 `apps/`，另跑 `cd apps && npm test`。

可见路径：对原句的直接回答 → 问题点 → 出处。测试绿不算验收。

浏览器验收分两层：Ego（`ego-browser`）当主力，写成可重复运行的脚本，用数值断言（如 `scrollY`、元素位置）；Claude for Chrome 再做一遍真人式走查，先滚动、按截图坐标点击。脚本点击干净，会漏掉真人操作才会触发的问题：2026-09-28 首页滚到案例区后点开、结论被挤出视口的 bug，就是 Chrome 撞出、Ego 定量复现的。

T20（生产切到 `packages/` 脊柱）2026-09-28 起暂停，见 `docs/devlog/2026-09-28-pause-t20.md`。`apps/` 是生产唯一真相（由 `mvp/` 改名），修改只落 `apps/`；`investigation/` 字节镜像照旧两边一起改。发布走 `./ops.sh`。

## 怎么说

跟用户说话、写文档、写验收，意思都要写全。不要为了短而删掉会改变含义的字。不要自造产品叫法。一个说法如果还能听成别的意思，就换成不会听错的完整句子。例如转载过程中后人加料，写「添油加醋」，不要写成「加油」。
