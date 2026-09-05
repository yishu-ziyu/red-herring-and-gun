# 2026-09-06 · 搜索策略迭代（一期）：双路查询 + 硬超时 + 反垃圾排序

## Change

用户可见：同一句话的调查，出处更准、合集页更少、慢页不再拖死整次。术语只用说法、出处、判断、追问、历史。

- 每条原子查询走双路：短关键词一路 + 语义改写一路（确定性生成，不新增模型调用），两路结果做 RRF 融合。口语改写（电瓶车→电动自行车这类）不写死名单也能召回。
- 单页抓取（已有	searchAll/provider	之外的新增全文抓取，若本期做）设单页硬超时 2-3 秒，超时丢弃并记 degraded，不阻断整次。
- 排序加三件套：语义相关优先于关键词命中、时间敏感加新度、同站只留 1-2 条且支撑/反证各至少留一条。`site:piyao.org.cn` 这类官方直查独立于通用配额先走。
- 过程可回看每一跳：实际发出的改写查询、粗排→精排数量变化（before/afterFilter/afterDedupe/afterTopK）、每页命中段（audition chunk 出处到段）。

## Not this

- 不做按用户历史的个性化改写，不做 VIP 站白名单加权，不把触发搜不搜改成概率 token（`verifiable` 仍是确定性闸）。
- 本期不做购物通道、不做以图搜图、不改 `ops.sh`、不删 `mvp/`。
- 本期不引入新的付费搜索厂商、不引入在线 embedding 服务（语义分走确定性本地算法，沿用 `semanticRecall.ts` 路线）。

## Evaluator

机器（ behavior 变更后全跑）：

```bash
npm test
npm run build
cd mvp && npm test
```

另跑（如有行为变更）：`npm run eval:gate`（配额不足时只跑单例，不烧全量）。

- `packages/core/src/search/atomSearchQuery.test.ts`：每条原子至少产出短关键词 + 语义两路；口语改写零词面交集仍可召回（沿用 电瓶车→电动车 用例）。
- `retrievalFilter.test.ts` / `searchAll.test.ts`：同站转载不计增益、合集页沉底、一手出处浮上；去重后无重复 canonicalUrl。
- 单页超时用例：慢页被丢弃且整次仍为 degraded、有出处返回；`traceText`/公开流不泄漏密钥与原始错误。
- 人评：结果页出处点得开且精确到段；过程只挂当前轮；手机过程能读完。
