# Golden 场景（表征测试，2026-09-29，基线 `f96a37f`）

重写前后逐项比对用的场景清单。工具与用法见 `apps/golden/README.md`；录音与运行结果在 `outputs/golden/`（git 忽略）。

## 1. 三层表征

```text
服务端 golden   同一份录音 → 真实服务进程（HTTP + SSE + SQLite + 落盘）→ 归一化 → 逐项比对      20 个场景
界面 golden     服务端录下的 SSE 帧 → 真实 <App/>（jsdom，假时钟）→ 每帧 DOM + localStorage + 请求   8 个场景 + 4 条交互流程
现有测试        apps/ 152 个测试文件 1,476 条（单元 + 组件），按模块守行为细节                          照跑
```

比对内容（服务端）：每一步 HTTP 的状态码、关键响应头、响应体；客户端会消费的 SSE 帧按顺序逐帧相等；客户端忽略的过程帧按多重集合相等；SQLite 六张表；数据目录里的 JSON / JSONL；外部请求清单（命中、未命中、扣住，按指纹）。

比对内容（界面）：首页 DOM；每收到一帧客户端会消费的帧后的整页 DOM（标签、全部属性、文字）；结束时的 localStorage；前端发出的全部请求（含请求体）。

## 2. 确定性证据

| 检查 | 结果 |
|---|---|
| 服务端：基线代码对同一录音回放两次（虚拟时钟开） | 20/20 逐项相同 |
| 服务端：虚拟时钟关（外部回复瞬间到达），回放两次 | 20/20 逐项相同 |
| 界面：同一串帧驱动三次 | 8/8 逐项相同 |
| 界面交互流程：同一串帧与操作驱动三次（2026-09-29 补） | 4/4 逐项相同 |

两种服务端变体都保留：虚拟时钟开的变体更接近真实运行走过的路径（按剩余时间做的取舍与真实运行一致）；关的变体对「请求发出时序」不敏感。重写后两种都要通过；只有一种不过时，先查是不是时间预算的临界取舍被新代码的调用时序推过了线。

## 3. 场景

分类对应用户要求的八类：正常、边界、错误、中断、重启、数据兼容、并发、状态恢复。

| 场景 | 类 | 录音 | 走的路径 | 对应行为 |
|---|---|---|---|---|
| g01-mixed | 正常 | 真实 | 真假缝在一起 + 末尾元问句；两条命题；时间紧时跳过报告写作走确定性收束 | 4.x 5.x 12.1 |
| g02-debunk | 正常 | 真实 | 有官方辟谣的流传说法；证据追索 | 5.x |
| g03-causal | 边界 | 真实 | 「因为…」因果跳跃；三条命题；因果增强 | 5.x D |
| g04-stance | 边界 | 真实 | 立场句 → 不适用真假判断；整句审计规划 | 5.x D |
| g05-unverified | 边界 | 真实 | 没有公开材料；三条命题都查不清 | 5.9 5.10 |
| g06-link-failed | 边界 | 真实 | 文字 + 抓取失败的链接；判 false 带出处 | 3.5 |
| g07-image | 错误 | 真实 | 截图材料；图片解析 404 → 整次调查失败（R10） | 10.3 |
| g08-followup-guest | 状态恢复 | 真实（首轮复用 g01） | 访客追问两轮：已核命题覆盖、新问题 | 6.2 6.4 |
| g09-account | 正常 | 真实（首轮复用 g02） | 登录 → 调查 → 存档 → 列表 → 私有页 → 分享预览/创建/读取/撤销/再撤 → 带 caseId 追问 → 存档 → 登出后读不到 | 7.x 8.x 6.3 |
| g10-cancel | 中断 | 回放 + 扣住核查 | 核查阶段点停止；再点一次；迟到的核查回复不改结局 | 9.5 4.9 |
| g11-detach-resume | 状态恢复 | 回放 + 扣住核查 | 核查阶段客户端断开；调查继续跑完；按 lastSeq 接回、再从头接回 | 9.1 9.2 9.4 |
| g12-duplicate | 并发 | 回放 + 扣住核查 | 同一 clientRequestId 重复提交只订阅原调查；换了材料 409 | 9.6 3.8 |
| g13-all-down | 错误 | 无录音 | 模型、检索、探活全部失败：各阶段 fail-open，确定性收束 | 第 5 节失败 |
| g14-restart | 重启 | 回放 + 扣住核查 | 核查阶段进程被 SIGKILL；重启后 run 为中断态、快照保留；再取消返回 accepted:false | 9.7 |
| g15-search-down | 错误 | g01 录音去掉检索 | 检索全挂、模型正常 | 第 5 节失败 |
| g16-byo-fail | 错误 | 无录音 + 本机假端点 | 自带密钥 401 → fail-closed、byo_key_failed、不回退 env；畸形配置 400 | 10.9 |
| g17-legacy-data | 数据兼容 | 无录音 + 种子 cases.json | 旧 JSON 首次导入并备份；旧报告无快照时确定性重建；中断报告；坏报告；无时间记录；他人与无主记录 404；重启后（R9 会话丢失） | 7.9 R9 |
| g18-quota | 并发/额度 | 无录音，生产模式 | 访客 2 次；探针不计；第 3 次 429；test-llm 生产 404 | 10.1–10.4 |
| g19-mcp | 错误 | 无录音 | MCP 信息、握手、列表；调用恒返回 HTTP 404（R1） | R1 R2 |
| g20-bad-requests | 错误 | 无录音 | 缺 claim、modelChoice 非法、追问 caseId 不存在、未知 run、匿名写案件、分享不存在、反馈 | 6.3 |

界面 golden 覆盖 g01–g06、g13、g15（纯文字首轮）。Slice D 要动前端产品壳，动手前补了 4 条交互流程（基线 `ui-flows-base`）：

| 流程 | 用到的服务端帧 | 走的路径 |
|---|---|---|
| flow-g08-followup | g08 三轮 | 访客首轮 → 追问两次 → 回看首轮 → 返回当前轮 → 新调查（输入框预填原句） |
| flow-g11-resume | g11 接回流 | 本机留着进行中 run 的座标 → 打开页面自动接回 → 收到终态 |
| flow-local-history | g01 完成帧 | 本机知识库有一条旧调查 → 打开历史 → 打开条目（零调查请求）→ 新调查 |
| flow-g09-account | g09 首轮与追问 | 已登录 → 调查 → 服务端存档拿到 caseId → 带 caseId 追问 → 再存档 → 打开账号菜单 → 退出 |

g07（截图上传）仍由组件测试守（`inputMedia` 等）。界面 golden 读的是服务端原始帧（服务端分配的 caseId 每次回放都不同），所以前端切片一律用 `GOLDEN_FRAMES=base` 比对，不用新服务端的回放。

## 4. 回放与真实运行的差距（如实记录）

回放不是真实运行的复刻，是真实运行的**录音驱动的确定性再演**：

- 虚拟时钟开时，g01 仍有 5 条请求对不上（录音里没有），g05 有 10 条，g11/g12 各 11 条（扣住请求改变了时序）。原因是个别取舍落在时间阈值附近，回放推算出的剩余时间与真实运行差了一点。对不上的请求按供应商 503 处理，走的是失败兜底路径。这不影响新旧对照（两边吃同一份录音、同一套规则），但意味着这几个场景并不完全等于录音当时用户看到的结果。
- g07 录到的是「图片解析 404」这条失败路径，截图解析成功的路径目前没有录音（本机配置下走不通，见 R10）。

## 5. 不能自动化的验收场景（人评）

| 场景 | 为什么不能自动化 | 怎么验 |
|---|---|---|
| 视觉与动效质量（字阶、留白、节奏、reduced-motion 观感） | 界面 golden 比的是 DOM，不是像素与动效观感 | 重写涉及前端的切片完成后，Ego 截图对照 + 用户看图裁决 |
| 真人式浏览器走查（滚动、按截图坐标点击） | 脚本点击会漏掉真人操作才会触发的问题（AGENTS.md 已有先例） | Claude for Chrome 走查一遍关键路径 |
| 真实供应商下的判断质量 | 模型输出每次不同；不作为等价证据 | 新旧代码各跑少量真实说法，只作参考 |
| 邮件真实送达、AI Ping OAuth、以图搜图（需公网 PUBLIC_BASE_URL） | 需要第三方账号与公网回调 | 发布前按 `PRODUCT_RELEASE_GATE.md` 走 |
| 线上部署（ops.sh、Nginx、Docker） | 本次重写不发布 | 不在本次范围 |

## 6. 怎么跑（重写后的每一片）

```bash
cd apps
TSX=server/node_modules/.bin/tsx
$TSX golden/golden.ts replay after            && $TSX golden/golden.ts compare base after
RHG_NET_VCLOCK=0 $TSX golden/golden.ts replay after-nv && $TSX golden/golden.ts compare base-nv after-nv
GOLDEN_UI=compare GOLDEN_FRAMES=base GOLDEN_UI_LABEL=ui-after GOLDEN_UI_BASE=ui-base npx vitest run golden/ui.golden.test.tsx -t "^界面 golden（"
GOLDEN_UI=compare GOLDEN_FRAMES=base GOLDEN_UI_LABEL=ui-flows-after GOLDEN_UI_BASE=ui-flows-base npx vitest run golden/ui.golden.test.tsx -t "flow-"
npm test && npm run build && (cd server && npx tsc --noEmit)
```

基线标签：服务端 `base`、`base-nv`，界面 `ui-base`、`ui-flows-base`。基线只在基线代码上生成；重写中不重录、不改基线。
