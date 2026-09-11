# 红鲱鱼与枪：展示层重构与全栈接线方案

版本：2026-09-11 / 提议稿，不是已获用户批准的最终设计。
仓库：https://github.com/yishu-ziyu/red-herring-and-gun
审阅基线：632746e25c551918f2ea72192b1e7de1bb5a9490。实施必须从当前工作树开始，先比较差异，不得回退用户的新提交。

## 0. 交付边界

本包提供：可点击的离线页面原型、页面与组件设计、后端改动方案、任务拆分、验收矩阵和 Codex 启动指令。未修改远程仓库、未创建 GitHub Issue、未部署，也未实测线上模型或搜索。原型使用明确标注的虚构公园案例；不连接模型，不上传任何输入，不是实际核查服务。

上一张概念拼图只作美术方向参考，不作为事实数据或精确视觉验收图。它的医疗/政策例子、来源标题、阅读量、估计耗时都不得直接上线。拼图把“不准确”放进绿色成功框、将“分析中”与“等待汇总”混排等问题也不应照抄。本包的 HTML 是修正这些问题后的页面提议，仍待用户审美确认，不宣称已经批准。

## 1. 这次真正改什么

把“输入一句话，然后等待一份报告”，改成“交来一份材料，看见问题怎样被拆清楚、哪些线索带来发现，最后能亲手查验判断”。

保留：核查与搜索能力、原句与命题的绑定、证据关联、引用检查、不确定性、现有账号与额度保护。
重构：首页、调查过程、结果页、材料查看、争议对照、历史与分享的阅读体验；补齐可恢复的任务身份、事实驱动的进展和真正的取消。
不做：换成 Next.js、重写所有提示词、增加一套通用 Agent 平台、引入微服务或消息队列、为头像额外调用模型、靠多 Agent 票数评判事实。

人物代表工作职责，不代表真人、专家资质或独立证据。默认四个：拆问题、找出处、核语境、作判断。后端可以并行执行，界面不画成必然严格串行的四步百分比。

## 2. 代码落点：必须改生产入口

已读代码表明，生产主入口在 `mvp/src/App.tsx` 的 ProductApp，默认走 goldenPath；`/?legacy=1` 是旧壳。根目录 `packages/web` 有另一套应用，不能只改那里就声称完成生产重构。

| 当前路径 | 动作 | 目的 |
| --- | --- | --- |
| mvp/src/App.tsx | 收窄为路由与组合；拆出账号、案例、任务 hooks | 避免一个组件同时管登录、存储、运行、历史、页面 |
| mvp/src/goldenPath/InputStage.tsx | 重构为 IntakePage / IntakeComposer | 清楚的入口，保留材料，首页展示可体验案例 |
| mvp/src/goldenPath/ProductShell.tsx | 重构 Shell / HistoryDrawer / AccountMenu | 简单统一的导航，正确焦点管理 |
| mvp/src/goldenPath/InvestigationCanvas.tsx | 拆成 InvestigationPage + ResultDocument 共用部件 | 调查状态变化不丢原句、滚动和来源上下文 |
| mvp/src/goldenPath/ClaimSection.tsx | 提炼 ClaimRail / ClaimEvidence / ConflictComparison | 关联原句，独立打开双方来源 |
| mvp/src/goldenPath/EvidenceBoard.tsx、EvidenceItem.tsx | 保留稳定证据 ID 与关联，改层级与排版 | 证据先回答“证明什么”，再列来源 |
| mvp/src/goldenPath/ConclusionHero.tsx | 拆 VerdictLead / AnnotatedClaim / KeyEvidence | 结果不是大字数报告，也不是一个分数 |
| mvp/src/goldenPath/SourceDrawer.tsx | 复用逻辑，扩展 SourceInspector | 区分原文、检索摘要和模型解释 |
| mvp/src/goldenPath/useInvestigationRun.ts | 生命周期与展示状态分离 | 不再仅靠组件内 runId 忽略过期结果 |
| mvp/src/lib/agentExpansion.ts | 流传输变成可显式取消与重连的客户端 | 信号传递、错误标准化、帧解析 |
| mvp/src/lib/caseIntake.ts、linkScraper.ts | 原始材料与抓取内容分开存 | 不把抓取正文追加成“用户原话” |
| mvp/server/src/handlers.ts | 接入产品事件投影与 RunService | HTTP 不再持有整个任务生命周期 |
| mvp/server/src/lib/casePipeline/runCasePipeline.ts | 复用 hooks，补缺失的结构化事实，不重写核查 | 提供真实工作进展 |
| mvp/server/src/lib/caseHandlers.ts、caseStore.ts | 所有权、显式分享、兼容迁移 | 私有存档不等于默认公开 |
| mvp/server/src/index.ts | 新路由、鉴权与额度中间件 | 不绕过旧保护措施 |

新文件名允许按仓库习惯调整；职责边界和行为不可悄悄省略。第一阶段保留 goldenPath 目录并逐步替换，避免再造一个永远不接生产的 v4 展示项目。

## 3. 页面全景

页面可复用，但不能遗漏下面这些产品状态。

| 页面/路由（拟定） | 第一眼看到什么 | 主要动作 | 必须覆盖的异常 |
| --- | --- | --- | --- |
| `/` 首页 | “这句话，站得住吗？”、输入区、紧凑人物组、一个可回放案例 | 输入、加图、贴链接、看案例 | 空输入、服务不可用、额度不足、抓取失败 |
| `/examples` | 精选调查的具体问题与关键发现 | 看已核对案例，不发新调查 | 案例未发布、材料被撤回 |
| `/examples/:slug` | “案例回放”、原调查日期、原材料、播放/下一步 | 回放、看结果 | 时间过期声明，禁止伪装实时 |
| `/cases/:caseId` 调查中 | 原始材料、当前问题、工作人员状态、最新发现 | 看材料、停止、离开后回来 | 首个快照前断开、长时间无进展、用户取消 |
| `/cases/:caseId` 完成态 | 直接回答、原句分段判断、决定性材料 | 查来源、看分歧、重新调查、分享 | 证据不足、保存失败、来源失效 |
| SourceInspector | 这份材料针对哪句话、原文/摘要、为何有关、日期 | 切换关联、打开原网页 | 无摘录、无法定位全文、链接不可达 |
| ConflictComparison | 同一个问题的两份材料、差异与解释边界 | 分别打开左右来源 | 单边缺失、时间不明、不是独立证据 |
| 历史抽屉 / `/history` | 说法、结果摘要、时间、任务状态、保存状态 | 搜索、打开、重新调查、删除 | 读取失败、迁移旧记录、未登录 |
| 登录/账号 | 明确登录收益，不打断当前材料 | 邮箱验证、退出、导出、删除 | 发送失败、过期验证码、退出失败 |
| `/settings/api-key` | 平台服务与自带密钥的清楚边界 | 添加、验证、移除 | 无效密钥、供应商不可达、服务端不支持 |
| `/s/:shareId` 分享页 | 同一份结果文稿、原调查时间、材料与边界 | 看来源、开始自己的调查 | 私有、已撤销、不存在、过期 |
| 空/404/系统失败 | 发生什么、哪些内容还在、接下来怎么做 | 返回、重试、保留材料 | 不暴露栈、密钥和提供方原始错误 |

### 3.1 首页

第一屏只保留一个主要动作。导航：品牌、案例、历史、账号。主标题为“这句话，站得住吗？”，副文案为“放进一句话、一张截图或一个链接。一起查它的出处。”输入区初始高度 152–176px；底部左侧附件，右侧“开始调查”。

桌面主内容宽 1080–1120px，输入区最大 760px，标题 56–64px；手机标题 34–38px，横向边距 20px，按钮触控区至少 44px。人物每位展示 64–88px 的头像或半身，不用四张等宽营销大卡。头像下是工作内容，不写“世界级”“专家团”。

输入可接收文字、图片、链接；附件必须有缩略图、文件名、移除动作。空输入按钮禁用并提供可见原因。文字输入不能因为历史 API 还在加载而静默失效；同句提醒只在历史已有可靠结果时出现，不抢先截断提交。

首页下方先放一个经过核对的真实案例，而非一排编造的新闻和阅读数。展示“原说法—决定性发现—查看调查”。生产案例无登录、无额度消耗；没有审核好的案例就显示明确的教学示例，不冒充真实调查。

### 3.2 调查中

进入时立即显示用户原材料，即使零个服务端快照。文字不改写成模型术语；图片不消失；抓取内容是附属材料，不合并进原话。

页面由三个层次组成：原材料与调查问题；紧凑工作人员带；最新发现与关联证据。默认不铺满四个执行面板。当前问题不超过 3–5 条可扫描行，较多时折叠其余。发现流只保留有信息增量的项，工具心跳不刷屏。

工作状态使用“未开始 / 正在查 / 已带回材料 / 暂未查到 / 已停止”。对任务阶段变化做 180–260ms 过渡；头像不持续摇晃、旋转、放大。相邻发现按真实顺序出现，用户主动滚动查看旧项时禁止强制拉回底部，改为“有 2 条新发现”按钮。

服务器说“搜索已开始”只能显示动作，不能显示“已找到原文”。搜索摘要可显示“发现一条线索”，没有确认来源层级时不叫“原始出处”。长期没有新的发现时显示“尚无新材料”，连接健康和业务进度分别表达，不假造 93% 进度或 1–2 分钟承诺。

停止会保留材料与已获得的证据。只有后端停止逻辑接通以后才显示“已停止”；请求中的状态叫“正在停止”。离开页面是否继续查必须与 RunService 的实际能力一致：实施新任务服务前不许写“你可以随意切走，我们继续查”。

### 3.3 结果

顺序：直接回答 → 原句上关键部分的判断 → 2–3 条决定性证据 → 展开完整分析 → 尚缺/争议 → 分享与复查。

不以“结论：部分真实”代替回答。一个示意回答是“只涉及两座试点公园，不是全市，也不是全天。”不是为了断言实际政策，而是说明文案粒度。

原句用文字标签和下划线表达“有依据 / 不成立 / 尚不确定”，颜色辅助，不靠红绿区分。事实为假不能放绿色成功框；操作完成与内容真伪是两套状态。结果存在真实的证据不足时可以完成调查但 outcome=unresolved；系统报错则 run=interrupted，不混为一谈。

证据行：它证明/限制什么 → 短摘录（有则显示）→ 来源、发表时间、关系 → 查看。决定性证据优先，其余可展开，不按模型票数或来源总数排序。

结果不因保存失败消失。保存状态独立显示“已保存在此设备 / 同步中 / 已同步 / 同步失败，重试”；不得把失败藏在 console。复制摘要必须保留调查日期、不确定性和来源，不剪掉边界来增强传播效果。

### 3.4 来源与争议

SourceInspector 桌面约 440px，宽屏可作为不遮住主文稿的侧面板；小屏用全宽底部面板或独立详情页。键盘焦点进入、Escape 关闭、关闭后还给触发证据行。

来源内容显式分型：`verbatim_quote`（已获得原文、可定位）、`search_snippet`（检索摘要）、`model_summary`（模型整理）。缺字段不补造原文。文档时间、抓取时间、适用时间分别存，来源 URL 不可达不自动推断内容为假。

争议是同一个 claim 下可独立点击的两份证据。双方名称不能被合成一个只打开左边的按钮。并排说明对象、时间、范围、定义与证据限制；只有材料层确实冲突才叫“证据冲突”。两个模型意见不同而来源相同，只能叫“解释存在分歧”。同源转载明确折叠，不伪装多源佐证。

### 3.5 历史、账号、设置与分享

历史默认是自己的记录。完成/中断/取消可筛选；打开旧结果零模型、零搜索、零扣额。重新调查生成新的 run，保留旧时间和结果，不能静默覆盖。只有读取成功才显示“没有历史”；网络失败是错误状态，不是空态。

登录作为弹窗，不清空输入和附件。设置保留现有 React 组件与账号接线，统一视觉即可，不造新登录体系。密钥页默认遮挡，不在日志、活动事件、回放、分享、错误页面中出现。非必要不新增浏览器长期存密钥；已有存储行为先审计，提供仅本次会话使用选项。

分享必须是用户明确创建的只读投影；默认排除邮箱、原始上传文件、密钥、内存召回、调试轨迹。创建前预览公开字段；复制成功要等服务器写入完成；可以撤销。链接随机且不可用 caseId 猜出。撤销不能承诺抹除别人已下载的副本。

基线代码中 `/api/case/:id` 有 owner 校验，但 `/r/:caseId` 的 HTML handler 直接按 caseId 取记录；未在该 handler 中看到 owner 或显式分享许可检查。实施时先做安全回归测试，不新增同类公开入口。旧 `/r/:id` 不能继续作为绕过私有权限的入口；无已确认分享许可的旧记录按私有处理，不因“兼容旧链接”保持泄露。

## 4. 视觉系统

| 项目 | 初始设计值 |
| --- | --- |
| 页面底色 | #F6F4EF，浅暖灰，不用米黄纸纹和假旧报纸 |
| 功能表面 | #FFFFFF |
| 主要文字 | #252723 |
| 次要文字 | #62665E |
| 分隔线 | #DEDCD4 |
| 品牌强调 | #A13734，暗红；CTA、焦点与品牌，不把所有负面语义混为品牌 |
| 有依据 | #28705A + 文字“有依据” |
| 不成立 | #A13734 + 文字“不成立” |
| 尚不确定 | #8A651E + 文字“尚不确定” |
| 阅读正文 | 16px / 1.75，手机不降到 12px |
| 主标题 | 桌面 56–64px；手机 34–38px；宋体风格可用系统 serif |
| 结果 lead | 桌面 34–40px；手机 26–30px |
| 元信息 | 12–13px / 1.5，保证对比度 |
| 圆角 | 输入 16px，菜单/证据控件 10–12px；文稿层不嵌套套卡 |
| 空间 | 4 / 8 / 12 / 16 / 24 / 32 / 48 / 72 |
| 动效 | hover 140ms；panel 220ms；新发现 220ms；尊重 reduced-motion |

沿用 `framer-motion`、现有 React/Vite 与 Ant Design 的交互原语，统一表面样式。优先复用项目已有能力，不为视觉升级再装三套组件库。全局 CSS 不污染登录页或旧壳。移动端不能只是把桌面缩小。

头像首先检查 `mvp/public/agents/*.png`。本包四个临时头像裁自本对话生成的概念图，仅供提议原型；不是从仓库取出的原头像。生产必须优先验证旧素材能否复用，必要时统一重绘，保留职责识别。头像是独立静态素材，UI 文字必须原生 HTML，不把整张设计图铺在页面上。

## 5. 全栈最小重构

### 5.1 两种信息，不能混在一起

`InvestigationSnapshot`：当前有哪些命题、来源、证据关系、边界和结论，继续作为结果内容的主数据。

`PublicActivity`：调查刚刚做了什么、带回了什么。是确定性投影，不是另一个模型写的直播稿，也不是原始工具日志。

```ts
// 拟议的产品事件；具体运行时 schema 按项目已有校验工具实现。
type WorkRole = 'question' | 'source' | 'context' | 'judgment';
type ActivityKind =
  | 'claim_decomposed' | 'search_started' | 'source_found'
  | 'source_checked' | 'evidence_assessed' | 'conflict_detected'
  | 'gap_identified' | 'judgment_revised' | 'run_completed';
interface PublicActivity {
  version: 1;
  runId: string;
  seq: number;                 // 服务端该 run 内单调递增，重放仍用原 seq
  id: string;                  // 不依赖 Date.now 生成 UI key
  occurredAt: string;
  kind: ActivityKind;
  role: WorkRole;
  claimIds: string[];
  sourceIds: string[];
  evidenceIds: string[];
  snapshotRevision: number;    // 先落相关快照，后允许引用
  payload: Record<string, unknown>; // 实现时改为 kind 对应的判别联合，不长期保留 unknown 大包
}
```

活动文案采用模板 + 已校验字段。每项发现都能追到 claim/source/evidence；没有引用对象的事件只能描述动作。标准展示字段白名单，不透传 provider 原始错误、agent_thought、systemPrompt 或 apiKey。来源判断改变用 revision 更新旧项并显示修订，不让矛盾的两条快讯永久并列。

使用 `runCasePipeline` 的 `onAtomSearchStart` / `onAtomSearchResult` / `onEvidenceLoopRoundResult` / `onInvestigationSnapshot` 等 hooks；只在确实缺少结构化结果时增加 hook。服务端可以按快照差分生成证据发现，但不得从自由文本猜出引用关联。活动层坏了不影响结果；快照坏了不伪造结果。

### 5.2 任务、连接与保存分开

```text
runStatus: accepted | extracting | investigating | judging | completed | interrupted | cancelling | cancelled
streamStatus: connecting | live | reconnecting | closed
saveStatus: local | syncing | synced | failed
outcome: supported | refuted | mixed | unresolved | not-applicable
```

不要创建四个完全独立、互相覆盖的真相源。run 状态与快照的 phase 有确定映射；终态不能被晚到活动倒退。连接断开不是任务完成或失败；前端不能自行把后端仍在执行的 run 判成 cancelled。

新建任务后服务端分配稳定 caseId 与 runId。clientRequestId 以身份为作用域幂等，重放相同请求返回同一 run，payload 不同返回冲突；前端双击锁只是补充。原始材料不可变；抓取、图片文字提取、模型改写各自有来源类型，不再追加进原始 text。

### 5.3 路由（新增方案，不是假装仓库已有）

| 路由 | 意义 |
| --- | --- |
| POST `/api/investigations` | 验证身份/材料/额度与 clientRequestId，持久化后返回 202 与 caseId/runId |
| GET `/api/investigations/:runId` | owner/guest capability 校验，返回状态、快照、lastSeq、保存信息 |
| GET `/api/investigations/:runId/events?after=N` | 同源带凭据、校验所有权，重放 N 后事件，再接实时 SSE |
| POST `/api/investigations/:runId/cancel` | 幂等取消，传递 AbortSignal；终态调用无副作用 |
| POST `/api/cases/:caseId/shares` | 明确授权后建立不可猜测只读分享投影 |
| DELETE `/api/cases/:caseId/shares/:shareId` | 验证所有者，撤销未来访问 |
| GET `/s/:shareId` | 仅查询有效分享投影，不直读完整私有 case |

旧 POST stream 入口先作为兼容适配器保留，必须与新 RunService 共用核查执行与额度逻辑，不能双跑两条管线。EventSource / fetch 流使用现有适配器均可，但要求事件重放与连接生命周期清楚。

SSE 实现要支持 event id、heartbeat、合法分帧、断流、尾帧与错误。JSON 解析失败不能简单当正常完成。缺口重连拉最新快照，不能重发一次新调查代替续接。重连不扣一次新额度，不触发第二条流水线。

### 5.4 生命周期与存储

实施选择：单机部署保持单进程 RunService，不增加 Redis/消息队列。对于运行记录、公开活动、分享令牌及案例索引，使用一个本地 SQLite 存储适配层，实现创建幂等记录、快照版本与事件序号的事务写入。账号体系先保留，禁止顺带迁移认证数据库。

先核实部署 Node/平台再选 SQLite 驱动，不盲装 latest；把驱动藏在 repository 接口后。这一步安排在视觉原型确认之后，不作为“必须先重构数据库才能画页面”的借口。

建议表：cases（保留旧 ID、owner、原材料引用）、runs（runId、caseId、clientRequestId、inputHash、status、revision、snapshot、deadline）、activities（runId,seq 唯一）、shares（shareId 随机令牌哈希、caseId、公开字段投影、revokedAt）。敏感附件单独受权限保护，不往每个事件里重复存 base64。

已有 `caseStore` 是 Map + JSON 落盘，不是完全无持久化。本轮替换其案例存储适配时先备份 `cases.json`，幂等导入，记录迁移版本，逐项比较数量/ID/owner/结论/时间。禁止静默删掉 1000 条以外的用户记录；以后需要保留期限时单独产品决策。旧缺失的字段保持未知，不能用当前时间伪造原调查时间。

浏览器 IndexedDB 继续作匿名历史和草稿缓存；清楚标注“此设备”。服务端同步以稳定 caseId/runId 为准，不能登录一次复制成两条；账户切换不能把上一个人的本地记录自动上传到新账号。

服务端保存最终快照在发送 completed 之前完成；失败要返回可恢复保存错误，不假称已同步。浏览器刷新只重新订阅。服务进程重启后把未完成 run 标成 interrupted（保留中间快照），第一轮不承诺自动恢复模型上下文。用户明确重试才开新 run。

### 5.5 取消、费用与权限

RunService 持有 AbortController，把 signal 传到搜索与模型请求。超时预算取消在途请求，并阻止新轮次启动；不能只 `Promise.race` 丢弃结果。供应商无法硬取消时记录事实，停止后续调用，不承诺已经发送的请求完全不计费。

额度在创建任务时按身份与 clientRequestId 做一次原子预留/计费登记，复用现有额度策略；重复请求、读历史、SSE 重连、案例回放、健康探针均不应作为新核查扣额。退款/失败返额沿用现有业务规则，不擅自新增收费规则。

匿名 run 使用 HttpOnly、SameSite、Secure 的签名会话或高熵访问能力，不把 IP 当唯一所有权。写入端点检查 CSRF/origin 与当前 CORS 策略。新的来源抓取、外链探活、BYOK baseUrl 全部复用现有 URL 安全处理；需要补测回环、内网、重定向与 DNS 变更后的目标校验，不能凭 http/https 就视为安全。

## 6. 公共案例与离线演示

演示模型有两个独立概念：

1. 教学 fixture：虚构内容，明确“交互示例，不是真实核查”，完全离线、不消耗额度。用于开发、测试和审美确认。
2. 已核对的公共案例：来自真实完成记录，人工确认有权公开、来源仍可查、结论日期清楚、敏感信息已处理，之后才发布。

本包只带第 1 种。Codex 不得把它移到生产后改标签为“真实案例”。真实案例选择避免一开始就用医疗/金融等高风险题材。回放保留原时间；播放器时钟是回放位置，不伪装真实调查耗时。缺时间戳的旧记录只能分步演示，不合成历史过程。

## 7. 分阶段交付

### PR-A：基线与立即安全修复
记录当前分支/提交、工作树、生产入口和部署入口；截图首页、运行、完成、来源、手机。给私有 HTML 分享通道补先失败测试并修权限。修正历史加载对提交的静默阻断。不要为了视觉改动碰模型逻辑。

### PR-B：统一视觉与真实组件 fixture
用原型的设计系统改生产组件，先以明确的 dev fixture 驱动：首页、调查中、结果、来源、争议、历史、设置、手机和错误态。不把新设计放到一个无人访问的独立项目。提供同尺寸截图和可点预览；未获用户视觉确认前不强行替换线上。

### PR-C：产品活动与证据对照
落地 PublicActivity 投影、事件顺序/去重、活动到证据导航、来源片段分型、冲突左右独立来源，接现有管线。保留原始事实校验和旧报告可读性。

### PR-D：任务可靠性
RunService、SQLite 适配/迁移、幂等创建、带身份读写、重连、取消、刷新恢复与保存反馈。现有 stream 兼容接入，不复制算法。页面离开提示必须和能力同时上线。

### PR-E：历史、分享与设置闭环
旧记录读取、匿名/账户隔离、显式分享/撤销、无障碍模态框、设置错误、公开案例发布机制。内部/公开结果尽量共用 ResultDocument，公开数据先经服务端投影。

### PR-F：移除重复展示与全链路验收
确定只有一个生产视觉入口后，清理已替代的旧展示逻辑；不删唯一仍被使用的组件、逻辑或历史适配器。不得通过删测试或降低断言掩盖回归；不再适用的纯视觉旧断言逐项映射到新行为。最后提交截图、测试记录、迁移/回滚说明，等用户批准再合并部署。

并行边界：视觉 A 可做首页/调查；视觉 B 可做来源/结果；后端 C 可做活动与 RunService。先由一个负责人定义公共事件与 ID，不能各自发明类型。多个 Agent 不同时编辑 App.tsx / 公共 CSS / schema。

## 8. 不应该出现的“完成”

不能只有概念图；不能只有建模文档；不能只新增漂亮 demo；不能有可点但没有解释的假按钮；不能把搜索摘要写成原文；不能把模拟调查当真实能力；不能说全部测试通过却没跑；不能未授权部署。

最终提交必须附：改了哪些生产路径、真实与模拟验证分别做了什么、前后截图、未通过项、来源与权限验证、旧数据迁移结果、回滚路径。视觉是否满意由用户判断，不能用测试通过证明审美已达标。

## 9. 代码与参考来源

代码均按基线提交读取；实施时重新核对。
- App：https://github.com/yishu-ziyu/red-herring-and-gun/blob/632746e25c551918f2ea72192b1e7de1bb5a9490/mvp/src/App.tsx
- stream hook：https://github.com/yishu-ziyu/red-herring-and-gun/blob/632746e25c551918f2ea72192b1e7de1bb5a9490/mvp/src/goldenPath/useInvestigationRun.ts
- transport：https://github.com/yishu-ziyu/red-herring-and-gun/blob/632746e25c551918f2ea72192b1e7de1bb5a9490/mvp/src/lib/agentExpansion.ts
- pipeline hooks：https://github.com/yishu-ziyu/red-herring-and-gun/blob/632746e25c551918f2ea72192b1e7de1bb5a9490/mvp/server/src/lib/casePipeline/runCasePipeline.ts
- share handlers：https://github.com/yishu-ziyu/red-herring-and-gun/blob/632746e25c551918f2ea72192b1e7de1bb5a9490/mvp/server/src/lib/caseHandlers.ts
- store：https://github.com/yishu-ziyu/red-herring-and-gun/blob/632746e25c551918f2ea72192b1e7de1bb5a9490/mvp/server/src/lib/caseStore.ts
