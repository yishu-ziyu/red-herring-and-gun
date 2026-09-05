# 红鲱鱼与枪

人定价值函数，机器搜索。方法：`docs/METHODOLOGY.md`。产品：`docs/PRODUCT_SPEC.md`。运行：`docs/ARCHITECTURE.md`。

## 默认

1. 动手前写下验收标准，存 `docs/evals/YYYY-MM-DD-slug.md`：Change / Not this / Evaluator。这是独立于实现的完成尺度，用来判断做没做完、做到哪。没有 evaluator 的句子不算标准。能拆成命令的拆成命令；拆不动的标「人评」。
2. 用户说「太慢」「不好用」时不准直接改。先追问成数值、行为、截图、复现路径，再翻译成测试。
3. 压缩后先读 `docs/NOTES.md`。每个子任务刚做完就改 NOTES 头部「当前状态」。等压缩再写等于没写。
4. 方向改变写 `docs/devlog/`，不是 commit 复述。
5. 日常不读 wiki。不在用户未裁决时改本文件或 skill。
6. 机器项全绿才交付。测试绿但用户路径没通，改 evaluator，不改口说完成。人评项单独列出等人裁。

## 能合并

```bash
npm test
npm run build
```

行为变更再跑 `npm run eval:gate`。生产壳仍是 `mvp/` 时另跑 `cd mvp && npm test`。

可见路径：对原句的直接回答 → 问题点 → 出处。测试绿不算验收。

T20 之前不改 `ops.sh`、不删 `mvp/`。

## 怎么说

跟用户说话、写文档、写验收，意思都要写全。不要为了短而删掉会改变含义的字。不要自造产品叫法。一个说法如果还能听成别的意思，就换成不会听错的完整句子。例如转载过程中后人加料，写「添油加醋」，不要写成「加油」。
