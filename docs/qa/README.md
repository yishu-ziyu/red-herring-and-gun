# 本地 QA

生产 UI 仍是 `mvp/`。这些工具不启动付费调查，不修改部署。

首次安装：

```bash
python3 -m venv .venv-qa
.venv-qa/bin/pip install -r scripts/qa/requirements.txt
.venv-qa/bin/python -m playwright install chromium
source .venv-qa/bin/activate
```

Node 依赖沿用仓库安装方法。`npm run qa:gate` 明确执行 Python 报告器自检和 Vitest contracts；根 `npm test` 本身不包括 Python。

```bash
npm run qa:replay -- --campaign CAMPAIGN --out out/UNIQUE-REPLAY
npm run qa:replay -- --campaign CALIBRATION --out out/UNIQUE-NEGATIVE --synthetic-wrong-source
```

第一条通过既有 `?fixture=replay` 适配器驱动生产组件树。输入为原始 `real-after-76/snapshots/complete.json`；SHA 在独立 evaluator 冻结。自动起停独立 Vite 与只读本地代理，代理拒绝 API，使用独立 Chromium context。正向 scope 只证明桌面、390px、键盘 Reduced Motion 的阅读/来源路径，不能证明历史医学结论、实时模型或 LIVE 延迟。第二条明确为 synthetic 校准，预期退出 1，不能和自然运行合算通过率。两次目录必须不同，拒绝覆盖。

执行收据：

```bash
npm run qa:suite -- --campaign CAMPAIGN --inventory docs/qa/artifacts/shannon-report/scope.yaml --behavior report-contract --out out/UNIQUE-SUITE -- python3 -m unittest scripts.qa.qa_report_test scripts.qa.qa_report_shannon_test -v
```

`qa:report` 必须显式给候选 SHA、campaign、dirty、diff hash，不能从任意收据自动猜期望候选。将所需 `trial.json` / `receipt.json` 复制进独立 trials 目录（不混入其它 JSON）：

```bash
npm run qa:report -- --inventory docs/qa/replay-scope.yaml --trials-dir out/TRIALS --expected-candidate FULL_SHA --expected-campaign CAMPAIGN --expected-dirty false --expected-diff DIFF_SHA256 --out out/REPORT
```

clean diff SHA256 为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。工作树 diff 包括未跟踪源码，生成的 out/、QA artifacts、已有 .omo/.statamcp scratch 不进入源码 diff。当前仪器/结果文件改变会使旧收据失效。收据的绝对本机 artifact 路径需在迁移证据包时显式重定位，不可只改 hash 后冒称新运行。

全产品范围继续用 `docs/qa/behavior-inventory.yaml`；冻结的 replay scope 或 report scope 通过不能覆盖其未测项。没有收据为 NOT_RUN，真人未参加为 HUMAN_PENDING；任何当前适用失败都保留。原历史 failure specimen 不覆盖。

LIVE 申请与前置门见 `live-budget-request.md`。本轮 `qa:live` 尚未实现。最多 2 次根因修复 / 3 轮测量；到限保留失败等裁决。
