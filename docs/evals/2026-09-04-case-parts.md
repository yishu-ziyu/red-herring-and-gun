# 2026-09-04 · 案件页搬开源零件

一句话：案件页过程可折、句中 `[n]` 能悬停看出处、检索时有安静仪器和等待圈。结论和问题点仍是主秀。

## Change

用户打开案件（fixture 或真查）：

1. 查证中（`/cases/fx-retrieving`）：状态行带安静 ring；过程区展开，能看到检索仪器（源 → 材料），beam 在跑。不发明 0 条统计。
2. 查完（`/cases/fx-done`）：结论第一句仍直接回答原句；`[n]` 悬停出标题、host、引文；脚注是来源芯片；过程默认收起，点开才看到步骤竖线。
3. 来源链接新标签打开原文。

## Not this

- 聊天壳、Agent 指挥台、①–⑤ 流水线
- 「多路检索雷达」当第一屏英雄
- 假进度条、0 占位统计、彩虹 beam
- 引入 framer-motion / Tailwind / 整份 mvp `styles.css`
- 改首页、改 `ops.sh`、删 `mvp/`

## Evaluator

```bash
npm test -w @rhg/web
```

浏览器 1280：

- `/cases/fx-retrieving`：看得到 ring 或检索仪器，没有「整句判决」抢主秀于过程之上也可以，但过程必须可见。
- `/cases/fx-done`：结论里 `[1]` hover 出 popover；有来源芯片；过程折叠按钮默认 `aria-expanded=false`（有步骤时）。

## Goal / Hard bar / Improve

- Goal: 板上勾过的零件出现在案件页，染成纸墨
- Hard bar: 测试绿；真打开 5173 两条 fixture 路径
- Improve: none
