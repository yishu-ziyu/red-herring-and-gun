# 报告执行证据合同

Change：coverage、execution、acceptance 分开。当前 candidate/campaign 完整收据才能 PASS；任何适用 FAIL 保留并阻塞。纯 contract 无须后端，replay 绑定当前前端和历史来源，LIVE 双绑定。

Not this：测试文件存在不等于运行；不修改原始失败；不把自动化通过当真人验收。

Evaluator：`python3 -m unittest scripts.qa.qa_report_test -v`。同一测量程序对 before.py 与修改后执行：五条 Review 负例必须旧红新绿；成功收据、人评 pending、经合同允许且裁决的 N/A 保持合法；伪候选、坏 hash、缺文件、缺时间、缺 backend、自动化 NEEDS_HUMAN 均不得 PASS。runner 实际执行该命令，输出日志、退出码和绑定收据。人评体验不在此 suite 内，保持 pending。

旧测试中“repo-suite 无收据 PASS”和“不存在 artifact 的 LIVE PASS”违反本合同，改为 NOT_RUN；旧/新实现均使用纠正后的同一测试。

## 执行结果

独立会话固定五条 Review 反例；旧版同测量器 5 项失败，新版 5 项通过。独立性为 logical-only，同账户权限未隔离。

报告器完整自检共 22 项通过，包括真实合同收据、human pending、合法 N/A 正向；当前候选绑定、artifact hash、required_checks、明确 approved_commands、partial 不得升级为全覆盖等负例。`suite-working-final/receipt.json` 由真实子进程执行生成，日志与 hash 可核对；`working-final-report.json` 仅 report-contract 冻结范围通过，不证明全产品通过。早期 working 收据保留；其 instrument/inventory hash 随修复失效，不能用于后续当前候选 PASS。合并前需在最终候选重新执行。

approved_commands 为清单明确的 argv 数组；runner 的任意命令执行能力不等于该命令能证明某项行为。每项必须声明 required_checks；缺少必需测量或 partial 覆盖均保持 NOT_RUN。最终独立阴性浏览器校准和真实用户路径由 qa:replay 单独提供证据。
