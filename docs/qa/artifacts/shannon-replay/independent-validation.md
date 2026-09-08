# 独立回放复验

验证者：独立 replay_validator 会话；账号、目录共享，隔离级别 logical-only。验证日期：2026-09-08。本记录基于独立读取 observation、Playwright trace、执行收据，并实际查看截图；不是转述 Recorder 的 PASS。

| 运行 | 冻结函数复算 | 独立协议结论 |
| --- | --- | --- |
| out/shannon-replay-first | 27/27 PASS | 不合格：移动端 returned 截图停在来源区，未重现合同要求的直接答案；desktop drawer 截图在动画中途，右侧裁切；sourceFinalUrl 为空。机械全绿不能替代协议完成。 |
| out/shannon-replay-negative | 21 PASS、6 FAIL | 阴性校准成立：三个 profile 的 citation_binding、source_navigation 均发现错误。网络 trace 记录向 example.invalid/wrong-source 的真实导航失败，不是仅修改报告状态。 |
| out/shannon-replay-corrected | 27/27 PASS | 本次记录范围内的确定性 UI 路径合格：关闭来源与抽屉后实际返回直接答案，抽屉截图稳定且完整，来源新页有真实内容和完整 URL。最终干净候选绑定仍待重跑。 |

纠正后独立证据：

- 实际查看 desktop/drawer.png：来源标题、关闭按钮、对应 Claim、摘录与打开原文入口均位于视口内，不再出现首跑的动画中途截断。
- 实际查看 mobile390/returned.png：390 px 截图顶部出现完整直接答案，下方保留边界和原句，满足关闭后重新阅读判断的合同。
- 实际查看 desktop/external-source.png：显示新华网“维生素C能防治感冒……是真是假？”原文页面，而非空白新页。
- 三个 profile 的 sourceFinalUrl 均为 http://www.news.cn/local/20241231/528e6d4d13de43c0b57b151ea3a2283f/c.html，sourceResponseStatus 均为 200。此事实证明到达引用目标，不替代来源文义评价。
- keyboardReduced trace 包含真实 Tab/Enter/Escape 按键；未用 locator.click 或程序 focus 代替键盘选择。焦点返回与 Reduced Motion 观测通过。
- 纠正后的 trial.json 引用 23 个 result_artifacts，本验证者逐一重新计算 SHA256，全部匹配。

纠正运行收据：campaign=shannon-recorder-corrected；candidate_sha=0e499ee403249238f23df12dccb542d9726441cf；dirty=true；diff_sha256=52663bca9ad7a499335fde7d2937fd1463f68597762534a7d76f054f59e06ae8；开始 2026-09-08T03:38:31.681858+00:00，结束 2026-09-08T03:38:41.860338+00:00；exit_code=0。该收据只能绑定这次 dirty 候选，不能冒称最终提交已验收。

测试器修正发生在观测采集端：保留冻结 check_profiles 和原始 Snapshot，不将 expected 值改成首跑恰好产生的结果。旧失败目录保留。

边界：该路径使用正式生产 UI 的已有 replay 入口与未经修改的历史 Snapshot，driver=deterministic_runner，execution_mode=RECORDED_REPLAY。历史医疗记录的第二 Claim 没有证据却被整体结论写为不成立的问题仍保留。该 UI 回放不证明 #79 新管线医疗语义正确、LIVE 模型表现、实时延迟、独立模拟理解或真人理解通过。simulated_comprehension_score=null；HUMAN_VALIDATION_PENDING。未执行 LIVE；未批准合并。
