# 迭代 Spec · 可核查原子检索（per-atom retrieval）

> 状态：最小可演示落地中  
> 日期：2026-08-06  
> 产品决策：按学界 decompose-then-verify，子命题驱动取证  
> 依赖：原句自证闸门、排除层、逐命题定罪

## 背景

此前生产路径 **只对整句 claim 搜一次**，原子只用于判定与报告呈现。  
文献主流（FActScore / DAD 等）是：拆 → **按子命题检索** → 按条验证 → 汇总。  
产品已决定对齐该标准。

## 目标（用户将看到）

1. 可核查原子各自取证（不是所有条共用「整句随便搜来的一堆」说不清为谁搜）。  
2. 报告「逐命题定罪」展开后，**该条**能看到主要为该条取到的链接/摘要。  
3. 无结果时看到「未能补证 / 定向检索无结果」，**不把无证据写成假**。

## 范围（本轮最小可演示）

- 自证 + 排除层之后，对 **可核查原子** 每条一轮 `get360SearchForClaim(atom)`（多源并行逻辑复用现有）。  
- 上限 `MAX_ATOM_SEARCHES = 6`（与 claimAtoms 压缩上限一致）。  
- 聚合来源供 FactChecker / SourceValidator 兼容；落库时 **按条绑定** 到 `subclaimVerdicts.supportingSources`。  
- 文档：`docs/PRODUCT_SPEC.md` 检索策略 + 验收句。

## 非目标（本轮不做）

- 整句兜底检索  
- query 合并 / 去重调度  
- 检索结果缓存  
- 上限 N 的动态策略  
- 去语境化（decontextualize）改写原子文案  

## 行为契约

| When | Then |
|------|------|
| 可核查原子有 2 条 | 发起 2 轮原子检索（≤6） |
| 原子 A 搜到 URL u | A 的 verdict 展开可见 u（模型未绑定时确定性回填） |
| 原子 B 检索 0 条 | B 的 evidenceGaps 含定向检索无结果类说明 |
| 立场/不可核查原子 | **不**发起原子检索 |

## 实现锚点

- `mvp/server/src/lib/atomSearch.ts` — 选原子、打包、绑证据  
- `mvp/server/src/handlers.ts` — orchestrate / stream：自证后按原子搜  
- 测试：`atomSearch.test.ts`

## 验收

- [x] PRODUCT_SPEC 写明策略与用户可见验收  
- [x] 纯函数单测：选原子 / bundle / 绑证据  
- [ ] 手工或集成：真实 key 下两条原子两次 tool 查询（可选，依赖环境）  
- [x] `cd mvp && npm test` 绿  

## 后续（阶段 4）

整句兜底、query 合并、缓存、上限 N 调优 —— 另开工单。
