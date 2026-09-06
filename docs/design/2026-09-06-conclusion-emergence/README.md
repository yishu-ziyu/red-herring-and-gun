# Conclusion Emergence 取证（Issue #64）

生产 Golden Path 组件 + DEV fixture（`/?fixture=investigating|complete`）。**不是**真实 SSE investigating → complete；那一项留给 #66。

由 `scripts/capture_conclusion_emergence.py` 在端口 **5184** 生成。

| 文件 | 视口 | 说明 |
|---|---|---|
| `conclusion-investigating.png` | Desktop 1440 | 结论区已在 DOM，不占明显空间，无预渲染答案 |
| `conclusion-complete.png` | Desktop 1440 | 同一区域显现 `directAnswer` lede |
| `conclusion-mobile-complete.png` | Mobile 390 | 完成态长文阅读 |
| `conclusion-emergence.gif` / `.webm` / `.mp4` | Desktop 1440 | investigating → complete 形成过程 |
| `frames/` | Desktop 1440 | 连续帧 |
| `conclusion-reduced-motion-complete.png` | Desktop 1440 | `prefers-reduced-motion: reduce` 对照 |
| `conclusion-reduced-motion.gif` / `.webm` | Desktop 1440 | 减弱动效下答案立即可读 |
| `frames-reduced-motion/` | Desktop 1440 | 减弱动效连续帧 |
