import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { callJob } from "../../llm/callJob.js";
import { createCase } from "../../casefile/reduce.js";
import { webFetch } from "../../fetch/webFetch.js";
import { searchAll } from "../../search/searchAll.js";
import { createStageContext, type LlmJob } from "../context.js";
import { runInvestigator, type InvestigatorTools } from "../investigate.js";

const CLAIM = "人社部发文说生育津贴直接打到个人卡里了";

const LLM_KEYS = [
  "MINIMAX_API_KEY",
  "DEEPSEEK_API_KEY",
  "STEPFUN_API_KEY",
  "MIMO_API_KEY",
  "QIHOO_360_API_KEY",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "CODEX_BIN",
];

const SEARCH_KEYS = ["QIHOO_360_API_KEY", "TAVILY_API_KEY", "METASO_API_KEY", "EXA_API_KEY", "ANYSEARCH_API_KEY"];

function loadEnvFile(path: string, env: NodeJS.ProcessEnv): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq);
    let value = line.slice(eq + 1);
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
}

function hydrateEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const worktreeRoot = fileURLToPath(new URL("../../../../../", import.meta.url));
  const candidates = [
    join(worktreeRoot, "mvp/.env.local"),
    join(worktreeRoot, ".env.local"),
    join(worktreeRoot, "../../mvp/.env.local"),
  ];
  for (const file of candidates) loadEnvFile(file, env);
  return env;
}

function envRecord(env: NodeJS.ProcessEnv): { [key: string]: string | undefined } {
  const out: { [key: string]: string | undefined } = {};
  for (const [key, value] of Object.entries(env)) out[key] = value;
  return out;
}

function hasAny(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]));
}

function reportLlmFailures(events: readonly { type: string; ok?: boolean; job?: string; error?: string }[]): void {
  const calls = events.filter((event) => event.type === "llm.called");
  const failed = calls.filter((event) => event.ok === false);
  if (calls.length === 0) {
    console.log("probeInvestigator: 没有 llm.called");
    return;
  }
  if (failed.length === calls.length) {
    console.log(`probeInvestigator: 模型调用全部失败 ${failed.length}/${calls.length}`);
    for (const event of failed) {
      console.log(`  ${event.job}: ${event.error ?? "(no error field)"}`);
    }
    return;
  }
  console.log(`probeInvestigator: llm ok=${calls.length - failed.length} fail=${failed.length}`);
}

export async function probeInvestigator(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
  hydrateEnv(env);
  if (!hasAny(env, LLM_KEYS) || !hasAny(env, SEARCH_KEYS)) {
    console.log("probeInvestigator: missing LLM or search key; script only, not run");
    return undefined;
  }

  const bound = envRecord(env);
  const llm: LlmJob = (params) => callJob({ ...params, env: bound });
  const { case: c } = createCase({ id: "probe-t10", text: CLAIM });
  const ctx = createStageContext({ case: c, llm });
  ctx.emit({
    type: "claims.added",
    claims: [{ id: "c1", text: CLAIM, type: "fact", checkable: true, order: 0 }],
  });

  const tools: InvestigatorTools = {
    search: (query) => searchAll(bound, query, { signal: ctx.signal }),
    fetch: (url) => webFetch(url, { signal: ctx.signal }),
  };

  let result: { stopReason: string; steps: number } | undefined;
  let logPath: string | undefined;
  try {
    result = await runInvestigator(ctx, {
      role: "main",
      budget: 6,
      deadline: Date.now() + 120_000,
      tools,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.emit({ type: "error", message, stage: "investigate" });
    console.error(error);
  } finally {
    const dir = new URL("../../../output/probe/", import.meta.url);
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const file = new URL(`investigator-${stamp}.jsonl`, dir);
    const body = ctx.emitted.map((event) => JSON.stringify(event)).join("\n") + "\n";
    await writeFile(file, body, "utf8");
    logPath = fileURLToPath(file);
    const steps = ctx.current.investigatorSteps.map((step) => ({
      n: step.n,
      action: step.action,
      gain: step.gain,
    }));
    const stances = ctx.current.stances.length;
    const verdicts = ctx.current.verdicts.map((item) => `${item.claimId}:${item.verdict}/${item.rule}`).join(",") || "无";
    const assessOk = ctx.emitted.filter(
      (event) => event.type === "stage.finished" && event.stage === "assess" && event.outcome === "ok",
    ).length;
    const assessFail = ctx.emitted.filter(
      (event) => event.type === "stage.finished" && event.stage === "assess" && event.outcome === "failed-open",
    ).length;
    console.log(
      `probeInvestigator: stances=${stances} verdicts=${verdicts} assessOk=${assessOk} assessFail=${assessFail} stop=${result?.stopReason ?? "failed"} steps=${result?.steps ?? 0}`,
    );
    reportLlmFailures(ctx.emitted);
    for (const event of ctx.emitted) {
      if (event.type === "error") console.log(`probeInvestigator error: ${event.message}`);
    }
    if (result) {
      console.log(`probeInvestigator: actions=${JSON.stringify(steps)} log=${logPath}`);
    } else {
      console.log(`probeInvestigator: failed; log=${logPath}`);
    }
  }
  return logPath;
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  probeInvestigator().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
