/**
 * Append one line of answer-benchmark summary numbers to docs/metrics/answer-bench.jsonl
 * and regenerate docs/metrics/index.html (self-contained, inline SVG).
 *
 *   npx tsx eval/answerBenchMetrics.ts --label current-v1 [--date 2026-09-29] [--commit abc1234]
 *   npx tsx eval/answerBenchMetrics.ts --render-only        # rebuild the page from the jsonl
 *
 * Only aggregate numbers are stored. Per-host call tables and case content never reach the row.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type BenchSummaryInput = {
  label?: string;
  cases?: number;
  scored?: number;
  correct?: number;
  accuracy?: number;
  byLabel?: Record<string, { n?: number; correct?: number }>;
  trueToFalse?: number;
  shouldJudgeButDidnt?: number;
  wrongSupport?: number;
  fallbackUsed?: number;
  secondsMedian?: number;
  secondsMax?: number;
  modelCallsMean?: number;
  searchCallsMean?: number;
};

export type MetricsRow = {
  label: string;
  date: string;
  commit: string;
  cases: number;
  accuracy: { overall: number; byLabel: Record<string, number> };
  trueToFalse: number;
  shouldJudgeButDidnt: number;
  wrongSupport: number;
  fallbackRate: number;
  secondsMedian: number;
  secondsMax: number;
  modelCallsMean: number;
  searchCallsMean: number;
};

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const ratio = (a: number, b: number): number => (b > 0 ? a / b : 0);

export function toMetricsRow(summary: BenchSummaryInput, meta: { date: string; commit: string }): MetricsRow {
  if (!summary.label) throw new Error("summary.json has no label");
  const byLabel: Record<string, number> = {};
  for (const [k, v] of Object.entries(summary.byLabel ?? {})) byLabel[k] = ratio(num(v?.correct), num(v?.n));
  const cases = num(summary.cases);
  return {
    label: summary.label,
    date: meta.date,
    commit: meta.commit,
    cases,
    accuracy: { overall: ratio(num(summary.correct), num(summary.scored)), byLabel },
    trueToFalse: num(summary.trueToFalse),
    shouldJudgeButDidnt: num(summary.shouldJudgeButDidnt),
    wrongSupport: num(summary.wrongSupport),
    fallbackRate: ratio(num(summary.fallbackUsed), cases),
    secondsMedian: num(summary.secondsMedian),
    secondsMax: num(summary.secondsMax),
    modelCallsMean: num(summary.modelCallsMean),
    searchCallsMean: num(summary.searchCallsMean),
  };
}

export function parseJsonl(text: string): { rows: MetricsRow[]; bad: number } {
  const rows: MetricsRow[] = [];
  let bad = 0;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as MetricsRow;
      if (!r || typeof r.label !== "string" || !r.accuracy) throw new Error("shape");
      rows.push(r);
    } catch {
      bad++;
    }
  }
  return { rows, bad };
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;
const fix1 = (v: number): string => v.toFixed(1);
const int = (v: number): string => String(Math.round(v));

type Series = { name: string; color: string; values: number[] };
const PALETTE = ["#9a3412", "#1e40af", "#166534", "#6b21a8"];

function chart(title: string, note: string, xs: string[], series: Series[], fmt: (v: number) => string, scale: "pct" | "count" | "auto" = "auto"): string {
  const W = 520, H = 220, L = 52, R = 16, T = 16, B = 44;
  const all = series.flatMap((s) => s.values);
  const max = Math.max(1e-9, ...all);
  const top = scale === "pct" ? 1 : scale === "count" ? Math.max(4, Math.ceil(max / 4) * 4) : max * 1.15;
  const px = (i: number) => (xs.length <= 1 ? L + (W - L - R) / 2 : L + ((W - L - R) * i) / (xs.length - 1));
  const py = (v: number) => T + (H - T - B) * (1 - v / top);
  let g = "";
  for (let k = 0; k <= 4; k++) {
    const v = (top * k) / 4, y = py(v);
    g += `<line x1="${L}" x2="${W - R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e7e5df"/>` +
      `<text x="${L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-size="11" fill="#78716c">${esc(fmt(v))}</text>`;
  }
  xs.forEach((x, i) => {
    g += `<text x="${px(i).toFixed(1)}" y="${H - 22}" text-anchor="middle" font-size="11" fill="#78716c">${esc(x)}</text>`;
  });
  for (const s of series) {
    const pts = s.values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`);
    if (pts.length > 1) g += `<polyline points="${pts.join(" ")}" fill="none" stroke="${s.color}" stroke-width="2"/>`;
    s.values.forEach((v, i) => {
      g += `<circle cx="${px(i).toFixed(1)}" cy="${py(v).toFixed(1)}" r="4" fill="${s.color}"/>` +
        `<text x="${px(i).toFixed(1)}" y="${(py(v) - 8).toFixed(1)}" text-anchor="middle" font-size="11" fill="${s.color}">${esc(fmt(v))}</text>`;
    });
  }
  const legend = series.length > 1
    ? `<div class="lg">${series.map((s) => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join("")}</div>`
    : "";
  return `<figure><figcaption>${esc(title)}<small>${esc(note)}</small></figcaption>${legend}` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}">${g}</svg></figure>`;
}

export function renderMetricsHtml(rows: MetricsRow[]): string {
  const xs = rows.map((r) => r.label);
  const S = (name: string, i: number, f: (r: MetricsRow) => number): Series => ({ name, color: PALETTE[i % PALETTE.length]!, values: rows.map(f) });
  const labels = [...new Set(rows.flatMap((r) => Object.keys(r.accuracy.byLabel)))];
  const charts = rows.length === 0 ? "" : [
    chart("判定正确率", "整体，分母是已评分条数", xs, [S("整体", 0, (r) => r.accuracy.overall)], pct, "pct"),
    chart("分类别正确率", "按标准答案的类别", xs, labels.map((l, i) => S(l, i, (r) => r.accuracy.byLabel[l] ?? 0)), pct, "pct"),
    chart("把真话判假", "标准「能信」被判「不能信」，条数", xs, [S("条数", 0, (r) => r.trueToFalse)], int, "count"),
    chart("该判不判", "标准有结论却判「证据不足」，条数", xs, [S("条数", 0, (r) => r.shouldJudgeButDidnt)], int, "count"),
    chart("错标支持", "反驳或无关来源被标为「支持」，条数", xs, [S("条数", 0, (r) => r.wrongSupport)], int, "count"),
    chart("兜底报告率", "最终报告走兜底的占比，分母是全部条数", xs, [S("兜底率", 0, (r) => r.fallbackRate)], pct, "pct"),
    chart("用时", "秒", xs, [S("中位数", 0, (r) => r.secondsMedian), S("最长", 1, (r) => r.secondsMax)], int),
    chart("每条调用次数", "平均", xs, [S("模型", 0, (r) => r.modelCallsMean), S("搜索", 1, (r) => r.searchCallsMean)], fix1),
  ].join("\n");
  const head = ["运行", "日期", "提交", "条数", "判定正确", "把真话判假", "该判不判", "错标支持", "兜底率", "用时中位", "用时最长", "模型调用", "搜索调用"];
  const body = rows.map((r) => "<tr>" + [
    r.label, r.date, r.commit, int(r.cases), pct(r.accuracy.overall), int(r.trueToFalse), int(r.shouldJudgeButDidnt),
    int(r.wrongSupport), pct(r.fallbackRate), int(r.secondsMedian) + " 秒", int(r.secondsMax) + " 秒", fix1(r.modelCallsMean), fix1(r.searchCallsMean),
  ].map((c) => `<td>${esc(c)}</td>`).join("") + "</tr>").join("\n");
  const table = rows.length === 0
    ? `<p class="muted">还没有记录。跑完回答基准后执行 <code>npx tsx eval/answerBenchMetrics.ts --label &lt;运行名&gt;</code>。</p>`
    : `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>\n${body}\n</tbody></table>`;
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>红鲱鱼与枪 · 回答基准数字</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --ink:#1c1917; --mute:#78716c; --line:#e7e5df; --paper:#faf9f6; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--paper); color:var(--ink); font:16px/1.7 "Songti SC","Noto Serif SC",serif; }
  main { max-width:1120px; margin:0 auto; padding:40px 28px 80px; }
  h1 { font-size:28px; margin:0 0 4px; }
  h2 { font-size:20px; margin:36px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line); }
  .muted { color:var(--mute); font-size:14px; }
  .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(480px,1fr)); gap:20px; }
  figure { margin:0; background:#fff; border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
  figcaption { font-weight:600; } figcaption small { display:block; font-weight:400; color:var(--mute); font-size:13px; }
  .lg { font-size:13px; color:var(--mute); margin:4px 0; } .lg span { margin-right:14px; } .lg i { display:inline-block; width:10px; height:10px; border-radius:50%; margin-right:5px; }
  svg { width:100%; height:auto; font-family:inherit; }
  table { width:100%; border-collapse:collapse; font-size:14px; background:#fff; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid var(--line); white-space:nowrap; font-variant-numeric:tabular-nums; }
  th { color:var(--mute); font-weight:600; font-size:13px; }
  .scroll { overflow-x:auto; }
</style>
</head>
<body>
<main>
  <h1>回答基准数字</h1>
  <p class="muted">每跑完一次回答基准追加一行汇总数字（只存汇总，不存第三方内容）。数据源：docs/metrics/answer-bench.jsonl，共 ${rows.length} 次运行。</p>
  <h2>曲线</h2>
  <div class="grid">
${charts}
  </div>
  <h2>明细</h2>
  <div class="scroll">${table}</div>
</main>
</body>
</html>
`;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export function main(argv: string[]): void {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const REPO = join(HERE, "..", "..", "..");
  const dir = join(REPO, "docs", "metrics");
  const jsonl = join(dir, "answer-bench.jsonl");
  mkdirSync(dir, { recursive: true });
  if (!argv.includes("--render-only")) {
    const label = arg(argv, "--label");
    if (!label) throw new Error("usage: answerBenchMetrics.ts --label <run> [--date YYYY-MM-DD] [--commit sha] | --render-only");
    const summary = JSON.parse(readFileSync(join(REPO, "outputs", "answer-bench", label, "summary.json"), "utf8")) as BenchSummaryInput;
    const commit = arg(argv, "--commit") ?? execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
    const date = arg(argv, "--date") ?? new Date().toISOString().slice(0, 10);
    const row = toMetricsRow({ ...summary, label }, { date, commit });
    appendFileSync(jsonl, JSON.stringify(row) + "\n");
    console.log(`appended ${label} -> ${jsonl}`);
  }
  const { rows, bad } = parseJsonl(existsSync(jsonl) ? readFileSync(jsonl, "utf8") : "");
  if (bad) console.warn(`skipped ${bad} unreadable line(s) in ${jsonl}`);
  writeFileSync(join(dir, "index.html"), renderMetricsHtml(rows));
  console.log(`wrote docs/metrics/index.html (${rows.length} run(s))`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main(process.argv.slice(2));
