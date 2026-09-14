# @rhg/core

领域包。按一次调查的工作切，不按前后端切。

| 目录 | 这一层干什么 |
|------|----------------|
| `investigation/` | 白盒快照。生产 Express 有字节镜像 |
| `text/` | 用户看见的字：公开文案、引用、命题 |
| `rules/` | 判决纪律、公式分 |
| `search/` | 检索、过滤、证据追索 |
| `llm/` | 模型调用（实现层） |
| `stages/` | 脊柱阶段机；生产编排仍是 mvp 的 casePipeline |
| `fetch/` | 抓网页、图源 |
| `runner/` | 脊柱回合 |

改这里之后，若文件在 `apps/server/src/lib` 有镜像，两边一起改，跑 `mirror.test.ts`。地图：`docs/REPO.md`。
