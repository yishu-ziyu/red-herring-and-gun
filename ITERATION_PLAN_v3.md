# UI 改造计划 v3 — 证据呈现重做

## 用户反馈
证据展示非常糟糕——内部错误和 LLM 失败信息暴露给最终用户;另外,某些 demo 跑题到完全不同的命题。

## 根因(从代码中查到)
1. **内部错误外泄** —— NodeInspectorV3.tsx 把 LLM 抛出的 `cannotSay[]` 数组原文渲染给用户(如"Exa Search 调用失败: ... credits limit")。
2. **跑题** —— `runDemoPipeline()` 默认 `caseId = 'ai-content-jobs'`,如果用户在 demo 选择器里选了别的 case 但 URL/状态没同步,就会拿到错的数据。或者 model provider 失败时 fallback path 选了一个错的 demo。
3. **评分卡片里塞错误 trace** —— 截图"评分"模块第一项是「来源可靠性 42/70 low」下面是 `Exa Search 真实调用失败: credits limit` —— 这条来自 agent_step.tool_error,不该出现在 UI 的「评分」里。

## 改造目标
1. 内部错误:用一份「上游服务降级」+ 「基础设施警告」分类,错误不混入「评分」「证据」板块,而是单独一个 collapsible "运行状态" 模块。
2. 跑题:确保 demo case id 与用户当前 claim 强绑定。
3. 评分:只看聚合分数,不看 raw 工具错误。

## 实施切片(强推、并行友好)

### 切片 1: 数据净化 — sanitizeCanSayCannotSay (lib)
新文件 `mvp/src/lib/sanitizeReport.ts`,过滤掉以下模式:
- 包含 "exceed"、"quota"、"credits"、"调用失败"、"调用异常"、"超时"、"API error"、"rate limit" 等错误文本
- 包含 emoji 或非用户友好字符
- 包含代码片段或 URL 路径

### 切片 2: UI 净化 — 评分卡片隐藏错误 trace
`NodeInspectorV3.tsx` 的"评分"模块:把包含 tool-error / quota / 错误的条目移到独立的 `infrastructureWarnings` 区块。

### 切片 3: 跑题拦截 — 锁定 demo case
`pipeline.ts` 增加:跑 demo 路径必须把 user claim 与 case.subclaim text 做 similarity check,<0.4 抛错并清空结果。

### 切片 4: BYO key 设置页 (新功能,B 阶段)
新文件 `mvp/src/components/v3/settings/ApiKeySettings.tsx`:
- 文本框:baseUrl、apiKey、modelName(可选)
- 保存到 localStorage
- "测试连接" 按钮:前端 fetch 一个简单的 `/api/agent/test-llm` (新后端 endpoint)

### 切片 5: 后端 — 接受并使用 BYO key
新文件 `mvp/server/src/handlers.ts` 新 endpoint `POST /api/agent/test-llm`:
- 接受 baseUrl + apiKey + model
- 一次最小调用验证
- 返回 {ok, latencyMs, error?}

### 切片 6: 邮件登录 + 免费额度 (C 阶段)
新文件 `mvp/server/src/handlers.ts` 新 endpoints:
- `POST /api/auth/email/request` (发送验证码)
- `POST /api/auth/email/verify` (验证 + 创建 session)
- `GET /api/account/quota` (返回剩余免费次数)
- `POST /api/account/verify/run` (扣减一次额度)

存储:用 `/tmp/gun-accounts/` JSON 文件 + `/tmp/gun-codes/` 验证码(简易 MVP)。
或更简单:cookie-绑定 localStorage hash + 在 server 维护 in-memory store (重启会丢数据)。

### 切片 7: 隐私 / 合规基础
新文件 `mvp/src/components/v3/settings/PrivacyPolicy.tsx`:
- 服务条款
- 隐私政策
- Cookie 政策
- 数据导出 / 删除按钮

新文件 `mvp/server/src/handlers.ts`:
- `GET /api/account/export` (返回用户所有数据)
- `DELETE /api/account` (删除用户 + 数据)

## 文件改动

**新增 (8 个):**
- mvp/src/lib/sanitizeReport.ts
- mvp/src/lib/sanitizeReport.test.ts
- mvp/src/components/v3/settings/ApiKeySettings.tsx
- mvp/src/components/v3/settings/PrivacyPolicy.tsx
- mvp/src/components/v3/settings/SettingsViewV3.tsx
- mvp/server/src/lib/accountStore.ts (内存账户存储)
- mvp/server/src/lib/accountStore.test.ts
- mvp/server/src/lib/sanitizeReportShared.ts (前后端共用 sanitize 规则)

**修改 (5 个):**
- mvp/src/components/v3/NodeInspectorV3.tsx (评分净化)
- mvp/src/lib/pipeline.ts (跑题拦截)
- mvp/src/lib/pipeline.test.ts (新增跑题测试)
- mvp/server/src/handlers.ts (新增 5 个 endpoints)
- mvp/src/components/v3/Dashboard.tsx (挂载设置页入口)

## 验收

- `npx tsc --noEmit` 通过
- `npm test` ≥ 80% 覆盖
- 截图:证据页面无内部错误字样
- 部署到 gun.yishuziyu.cn 后,在国内打开能看到 BYO key 设置 + 邮件登录入口
- 隐私页可访问,导出 / 删除按钮可用

## 不在范围
- 真实邮件发送(用 console.log 模拟验证码,生产环境需 SMTP)
- 微信登录(用户明确说先做邮箱)
- 计费支付(P2 之后)
- 数据加密(传输用 HTTPS 即可)

## 强推执行

按切片并行:
- Wave 1 (并行): 切片 1、2、3(数据 + UI 净化)— 同一 PR 多次提交
- Wave 2: 切片 4、5(BYO key 前端 + 后端 endpoint)
- Wave 3 (并行): 切片 6、7(账户 + 隐私)
- Wave 4: 部署 + 验证