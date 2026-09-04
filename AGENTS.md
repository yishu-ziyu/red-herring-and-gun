# 红鲱鱼与枪

人定价值函数，机器搜索。方法：`docs/METHODOLOGY.md`。产品：`docs/PRODUCT_SPEC.md`。运行：`docs/ARCHITECTURE.md`。

## 默认

1. 动手前把「什么现象算成功」写成 `docs/evals/YYYY-MM-DD-slug.md`：Change / Not this / Evaluator。没有 evaluator 的句子不算标准。能拆成命令的拆成命令；拆不动的标「人评」。
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
