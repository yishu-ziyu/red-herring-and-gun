import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  callJob,
  createFakeLlm,
  defaultSearchProviders,
  searchAll,
  webFetch,
  type FetchedPage,
  type LlmEnv,
  type RunTurnDeps,
  type SearchProviderFn,
} from "@rhg/core";

export function loadLocalEnv(): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../../..");
  const candidates = [
    join(process.cwd(), ".env.local"),
    join(process.cwd(), "mvp/.env.local"),
    join(repoRoot, ".env.local"),
    join(repoRoot, "mvp/.env.local"),
  ];
  const seen = new Set<string>();
  for (const path of candidates) {
    const abs = resolve(path);
    if (seen.has(abs) || !existsSync(abs)) continue;
    seen.add(abs);
    const text = readFileSync(abs, "utf8");
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  }
}

export function readProcessEnv(): LlmEnv {
  return process.env;
}

export function hasLlmKey(env: LlmEnv): boolean {
  return Boolean(
    env.STEPFUN_API_KEY || env.DEEPSEEK_API_KEY || env.MINIMAX_API_KEY || env.MIMO_API_KEY || env.ANTHROPIC_API_KEY,
  );
}

export function fakeDeps(claim: string): RunTurnDeps {
  const empty: SearchProviderFn = async () => [];
  Object.defineProperty(empty, "name", { value: "fake" });
  return {
    llm: createFakeLlm({
      decompose: { claims: [{ text: claim, type: "fact", checkable: true }] },
      "self-proof": { results: [] },
      assess: { stances: [] },
      investigate: { action: { kind: "stop", target: "", why: "fake" } },
      compose: {
        conclusion: "公开材料还撑不住判断。",
        claimItems: [{ claimId: "c1", line: "公开材料还撑不住判断。" }],
      },
      cites: { citesEvidenceIds: [], primaryLinks: [] },
    }),
    searchProviders: [empty],
    tools: {
      search: async () => [],
      fetch: async (url: string): Promise<FetchedPage> => ({
        finalUrl: url,
        status: 0,
        contentType: "",
        text: "",
        links: [],
        images: [],
        reachable: false,
        charset: "",
        error: "fake",
      }),
    },
  };
}

export function liveDeps(env: LlmEnv): RunTurnDeps {
  const providers = defaultSearchProviders(env);
  return {
    llm: (params) => callJob({ ...params, env }),
    searchProviders: providers,
    tools: {
      search: (query) => searchAll(env, query, { providers }),
      fetch: (url) => webFetch(url),
    },
  };
}
