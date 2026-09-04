# Runtime

新会话先读本页。短索引，不承载完整历史。完整工作集在对应任务文件。

| Task ID | 状态文件 | 状态 | 更新 | 下一步 |
| --- | --- | --- | --- | --- |
| 20260903-casefile-spine | tasks/20260903-casefile-spine.md | active | 2026-09-04 | T01–T19、T21–T24 已合入 spine，local main/dev 已快进到同一提交；只剩 T20（门槛 = eval 门禁，卡在搜索配额）。生产仍走 mvp/。配额恢复后：全量 eval 复跑写 baseline → T18/T19 真后端复扫 → 用户亲手试 → T20 |
| 20260902-search-progress-ui | tasks/20260902-search-progress-ui.md | complete | 2026-09-02 | 无 |

无活动任务时表体为空。不要把本表的任务行提交进产品 PR。
