# Evidence Settling 取证（Issue #63）

生产 Golden Path 组件 + 确定性 DEV fixture `/?fixture=settling`。

**这些图不是真实 SSE 跑出来的。** 真实 investigating → complete 的 SSE 取证留给 #66。

| 文件 | 说明 |
|---|---|
| `evidence-before-settling.png` | Desktop 1440，三条材料都在待核对 |
| `evidence-after-settling.png` | 同一批节点归到支持 / 反驳 / 相关材料 |
| `evidence-settling.gif` / `evidence-settling.webm` | 运动：一条支持、一条反驳、一条相关材料 |
| `frames/motion-*.png` | 连续帧 |
| `evidence-settling-reduced.gif` / `evidence-settling-reduced.webm` | `prefers-reduced-motion: reduce` 对照 |
| `frames-reduced/motion-*.png` | reduced-motion 连续帧 |

脚本：`python3 scripts/capture_evidence_settling.py`（端口 **5182**）。
