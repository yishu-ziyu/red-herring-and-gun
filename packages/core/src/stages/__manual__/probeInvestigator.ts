import { mkdir, writeFile } from "node:fs/promises";
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

function envRecord(env: NodeJS.ProcessEnv): { [key: string]: string | undefined } {
  const out: { [key: string]: string | undefined } = {};
  for (const [key, value] of Object.entries(env)) out[key] = value;
  return out;
}

function hasAny(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]));
}

export async function probeInvestigator(env: NodeJS.ProcessEnv = process.env): Promise<string | undefined> {
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
      deadline: Date.now() + 90_000,
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
    if (result) {
      console.log(`probeInvestigator: stop=${result.stopReason} steps=${result.steps} log=${logPath}`);
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
