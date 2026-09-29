/**
 * Golden CLI（在 apps/ 下运行）：
 *
 *   npx tsx golden/golden.ts list
 *   npx tsx golden/golden.ts record <场景…> [--jobs 3]     真实联网，录音写 outputs/golden/tapes/<world>
 *   npx tsx golden/golden.ts replay <标签> [场景…] [--jobs 4]  回放，结果写 outputs/golden/runs/<标签>/<场景>
 *   npx tsx golden/golden.ts compare <标签A> <标签B> [场景…]  逐场景比对 normalized.json，有差异退出码 1
 *
 * 比对规则：客户端消费的帧、HTTP 回复、落库、落盘文件、外部请求清单逐项相等才算通过；
 * 客户端忽略的过程帧只比多重集合，它们的到达顺序变化记为提示，不算失败；外部请求的发出顺序同样记为提示。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { OUT, digest, runScenario } from "./harness";
import { scenarios } from "./scenarios";

type Diff = { path: string; a: unknown; b: unknown };

function diffValues(a: unknown, b: unknown, path: string, out: Diff[], limit: number): void {
  if (out.length >= limit) return;
  if (Object.is(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push({ path: `${path}.length`, a: a.length, b: b.length });
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) diffValues(a[i], b[i], `${path}[${i}]`, out, limit);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const key of [...keys].sort()) {
      diffValues((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${path}.${key}`, out, limit);
    }
    return;
  }
  out.push({ path, a, b });
}

function clip(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text === undefined ? "undefined" : text.length > 240 ? `${text.slice(0, 240)}…` : text;
}

function compareScenario(labelA: string, labelB: string, name: string): { failures: Diff[]; warnings: string[] } {
  const read = (label: string) => JSON.parse(readFileSync(join(OUT, "runs", label, name, "normalized.json"), "utf8")) as Record<string, unknown>;
  const a = read(labelA);
  const b = read(labelB);
  const warnings: string[] = [];
  const strip = (value: Record<string, unknown>) => {
    const steps = (value.steps as Array<Record<string, unknown>>).map((step) => {
      const frames = step.frames as Record<string, unknown> | undefined;
      if (!frames) return step;
      const { sequence: _sequence, ...rest } = frames;
      void _sequence;
      return { ...step, frames: rest };
    });
    return { ...value, steps };
  };
  const stepsA = a.steps as Array<Record<string, unknown>>;
  const stepsB = b.steps as Array<Record<string, unknown>>;
  for (let i = 0; i < Math.min(stepsA.length, stepsB.length); i += 1) {
    const seqA = (stepsA[i]!.frames as { sequence?: string[] } | undefined)?.sequence;
    const seqB = (stepsB[i]!.frames as { sequence?: string[] } | undefined)?.sequence;
    if (seqA && seqB && JSON.stringify(seqA) !== JSON.stringify(seqB)) {
      warnings.push(`steps[${i}] ${String(stepsA[i]!.label)}：帧到达顺序不同（过程帧顺序不是契约）`);
    }
  }
  // 外部请求清单按指纹比多重集合（上面）；发出顺序另作提示：同一份代码两次回放的顺序是稳定的，
  // 重排阶段时顺序一变就说明调用时序动了，要先查清再往下走。
  const netOrder = (label: string) => {
    const file = join(OUT, "runs", label, name, "net.jsonl");
    if (!existsSync(file)) return null;
    return readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const entry = JSON.parse(line) as { mode?: string; key?: string; n?: number };
        return `${entry.mode} ${entry.key} ${entry.n ?? ""}`;
      });
  };
  const orderA = netOrder(labelA);
  const orderB = netOrder(labelB);
  if (orderA && orderB && JSON.stringify(orderA) !== JSON.stringify(orderB)) {
    const at = orderA.findIndex((line, i) => line !== orderB[i]);
    warnings.push(`外部请求发出顺序不同（第 ${at < 0 ? Math.min(orderA.length, orderB.length) : at + 1} 条起）`);
  }
  const failures: Diff[] = [];
  diffValues(strip(a), strip(b), "", failures, 40);
  return { failures, warnings };
}

async function runPool<T>(items: T[], jobs: number, work: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(jobs, queue.length)) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

function flag(args: string[], name: string, fallback: number): number {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  args.splice(index, 2);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  if (command === "list") {
    for (const [name, scenario] of Object.entries(scenarios)) {
      console.log(`${name.padEnd(28)} world=${scenario.world.padEnd(16)} ${scenario.recordable ? "可录" : "仅回放"}  ${scenario.description}`);
    }
    return;
  }
  if (command === "record") {
    const jobs = flag(args, "--jobs", 3);
    const names = args.length ? args : Object.keys(scenarios).filter((name) => scenarios[name]!.recordable);
    const label = `record-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;
    await runPool(names, jobs, async (name) => {
      const scenario = scenarios[name];
      if (!scenario) throw new Error(`没有场景 ${name}`);
      const started = Date.now();
      const { runDir } = await runScenario(name, scenario, "record", label);
      console.log(`recorded ${name} in ${Math.round((Date.now() - started) / 1000)}s → ${runDir}`);
    });
    return;
  }
  if (command === "replay") {
    const jobs = flag(args, "--jobs", 4);
    const label = args.shift();
    if (!label) throw new Error("replay 需要一个标签");
    const names = args.length ? args : Object.keys(scenarios);
    await runPool(names, jobs, async (name) => {
      const scenario = scenarios[name];
      if (!scenario) throw new Error(`没有场景 ${name}`);
      if (scenario.world !== "empty" && !existsSync(join(OUT, "tapes", scenario.world))) {
        console.log(`skip ${name}：没有录音 ${scenario.world}`);
        return;
      }
      const started = Date.now();
      const { runDir } = await runScenario(name, scenario, "replay", label);
      const normalized = JSON.parse(readFileSync(join(runDir, "normalized.json"), "utf8")) as { network: string[] };
      const misses = normalized.network.filter((line) => line.startsWith("miss ")).length;
      console.log(`replayed ${name} in ${((Date.now() - started) / 1000).toFixed(1)}s misses=${misses} digest=${digest(normalized)}`);
    });
    return;
  }
  if (command === "compare") {
    const [labelA, labelB, ...only] = args;
    if (!labelA || !labelB) throw new Error("compare 需要两个标签");
    const inA = new Set(readdirSync(join(OUT, "runs", labelA)));
    const inB = new Set(readdirSync(join(OUT, "runs", labelB)));
    const names = (only.length ? only : [...inA]).filter((name) => inA.has(name) && inB.has(name)).sort();
    let failed = 0;
    for (const name of names) {
      const { failures, warnings } = compareScenario(labelA, labelB, name);
      if (failures.length === 0) {
        console.log(`PASS ${name}${warnings.length ? `（${warnings.length} 条提示）` : ""}`);
      } else {
        failed += 1;
        console.log(`FAIL ${name}`);
        for (const diff of failures.slice(0, 12)) console.log(`  ${diff.path}\n    A: ${clip(diff.a)}\n    B: ${clip(diff.b)}`);
      }
      for (const warning of warnings) console.log(`  提示：${warning}`);
    }
    const missing = [...inA].filter((name) => !inB.has(name));
    if (missing.length) console.log(`只在 ${labelA} 里有：${missing.join(" ")}`);
    console.log(`${names.length - failed}/${names.length} 通过`);
    if (failed > 0) process.exitCode = 1;
    return;
  }
  console.log("用法：list | record <场景…> | replay <标签> [场景…] | compare <标签A> <标签B> [场景…]");
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
