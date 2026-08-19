# 21 份施工规范

独立审查员（critic）多数没有写盘工具。规范由主会话按审查正文落盘。
第 2 章审查员卡在「没有写入工具」循环，已杀掉，规范按 INDEX + ch-02 补写。

| 章 | status | 执行 |
|----|--------|------|
| 01 链 | verify-only | 跑已有测试 |
| 02 路由 | implement | claimAtom 强制可核查闸 |
| 03 并行 | verify-only | 跑已有测试 |
| 04 反思 | verify-only | 跑已有测试 |
| 05 工具 | verify-only | 跑已有测试 |
| 06 规划 | implement | atomSearchQuery 三类问法 |
| 07 多Agent | verify-only | 跑已有测试 |
| 08 记忆 | verify-only | 跑已有测试 |
| 09 学习 | implement | queryReuse |
| 10 MCP | verify-only | 跑已有测试 |
| 11 目标 | verify-only | 跑已有测试 |
| 12 异常 | implement | fallback 不得写 false |
| 13 人机 | implement | 结果页确认按钮 |
| 14 RAG | implement | bind 无 URL → unverified |
| 15 A2A | verify-only | 跑已有测试 |
| 16 资源 | implement | MiniMax 超时一次即 skip |
| 17 推理 | verify-only | 跑已有测试 |
| 18 安全 | implement | merge/derive/reviewer |
| 19 评估 | implement | eval 三类错 |
| 20 优先级 | implement | 选 6 条 + 未检索仍展示 |
| 21 探索 | verify-only | 跑已有测试 |

14 / 18 / 20 改同一批文件，已按序做完（先 14+18，后 20）。验收见 `done/`。
