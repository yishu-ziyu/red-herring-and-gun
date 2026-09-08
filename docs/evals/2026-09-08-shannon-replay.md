# 冻结的首条 qa:replay 验收合同

Change：将未经修改的历史 complete.json 输入当前生产 fixture=replay 入口，实际完成原句、直接答案、展开对应 Claim、打开来源抽屉、关闭返回。三个 profile 分别为 desktop、mobile390、keyboardReduced。

Not this：不判断该历史医疗答案正确，不证明实时模型或延迟，不把 deterministic_runner 叫作 browser_agent 或真人。该历史记录的第二 Claim 为 not-applicable，而整句声称两条均不成立；保留此历史语义失败，UI 忠实回放通过不消除此问题。独立性仅 logical-only。

Evaluator：scripts/qa/replay_checks.py 的 check_profiles(record, snapshot) 冻结在 recorder 实现之前。每项返回 PASS/FAIL；任一缺字段不通过。源文件 SHA256 必须为 8cfd748d60a39ffd4eb81fcac00e49e51cf06517d834db4da12df8711b81e4dd，来源 manifest 为该原始 JSON 的 sources 数组；source ID 与 URL 均留证。

选择规则：结论 sourceIds 的第一项，找首个引用该项的 Claim。预期为 claim-1 / src-a6b628e01561c1d7 / http://www.news.cn/local/20241231/528e6d4d13de43c0b57b151ea3a2283f/c.html。必须点击此 Claim 下的实际来源控件，读取 drawer 的 href；不得从 Snapshot 填充观测值。

观测 schema：record.profiles 是数组。每项有 name、viewport.width、originalClaimVisible、originalClaimText、directAnswerVisible、directAnswerText、claimTextsVisible（可见文本数组）、openedClaimId、selectedSourceId、drawerVisible、drawerHref、drawerTitle、closedReturned（关闭后抽屉消失且判断再次可见）、overflowPx（整个过程最大水平溢出）、artifacts（screenshot 和 trace 实际文件路径）。keyboardReduced 另有 focusReturned（Escape 后回到打开抽屉的控件）、reducedMotion（matchMedia 实测为 true）。视觉文本比对只折叠空白，不删除标点或引用。

三个 profile 的相同标准：原句、完整直接答案和全部 Claim 可见，目标 Claim/Source 身份与原始 manifest 一致，drawer 标题及 href 一致，关闭返回成功，水平溢出不超过 1 px，截图和轨迹文件存在且非空。mobile390 必须为 390 px；keyboardReduced 必须还证明 Reduced Motion 和焦点返回。

阴性对照：synthetic/sandbox 页面将抽屉 href 改成 https://example.invalid/wrong-source；同一测量函数必须返回 citation_binding=FAIL。隐藏 directAnswer 的函数输入对照必须返回 direct_answer=FAIL。不得修改历史 Snapshot。合成输入自检只校准测量函数，不能替代浏览器实测。

独立 Simulator 尚未执行；五个理解问题及真人体验均 HUMAN_VALIDATION_PENDING。不可由本合同的 UI 保真度通过推导理解通过。

导航补充（浏览器执行之前冻结）：必须真实点击打开来源链接；sourceNavigationAttempted=true、openedSourceUrl 为实际发出的导航 URL 且等于 manifest、sourcePageClosedReturned=true。Recorder 另记 sourceFinalUrl、sourceResponseStatus（不可达或 unknown 单列），不得据此声称来源内容已验证。关闭来源页后再关闭抽屉。该项只验正确导航，不把来源服务器不可达归为本地 UI 失败。
