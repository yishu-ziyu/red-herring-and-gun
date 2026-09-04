import type { SearchProviderId } from "./searchProviders.js";

export type SearchBilling = "included" | "byo";

export type SearchProviderMeta = {
  id: SearchProviderId;
  label: string;
  billing: SearchBilling;
  envKey?: string;
  urlEnv?: string;
  signupUrl?: string;
  rechargeUrl?: string;
  hint: string;
};

/** 单源真相：预置源不用用户填；收费源只走已知厂商，密钥由用户自己贴。 */
export const SEARCH_CATALOG: readonly SearchProviderMeta[] = [
  {
    id: "any_search",
    label: "AnySearch",
    billing: "included",
    hint: "已预置。没有密钥也能搜，有密钥额度更高。",
  },
  {
    id: "searxng_search",
    label: "SearXNG",
    billing: "included",
    urlEnv: "SEARXNG_URL",
    hint: "开源聚合搜索。运维配好地址即用，用户不用填密钥。",
  },
  {
    id: "360_search",
    label: "360 智搜",
    billing: "byo",
    envKey: "QIHOO_360_API_KEY",
    signupUrl: "https://ai.360.com/",
    rechargeUrl: "https://ai.360.com/",
    hint: "额度用完后到 360 开放平台充值，把密钥贴进来。",
  },
  {
    id: "metaso_search",
    label: "秘塔",
    billing: "byo",
    envKey: "METASO_API_KEY",
    signupUrl: "https://metaso.cn/",
    rechargeUrl: "https://metaso.cn/",
    hint: "额度用完后到秘塔充值，把密钥贴进来。",
  },
  {
    id: "tavily_search",
    label: "Tavily",
    billing: "byo",
    envKey: "TAVILY_API_KEY",
    signupUrl: "https://app.tavily.com/",
    rechargeUrl: "https://app.tavily.com/",
    hint: "额度用完后到 Tavily 控制台充值，把密钥贴进来。",
  },
  {
    id: "exa_search",
    label: "Exa",
    billing: "byo",
    envKey: "EXA_API_KEY",
    signupUrl: "https://dashboard.exa.ai/",
    rechargeUrl: "https://dashboard.exa.ai/",
    hint: "额度用完后到 Exa 控制台充值，把密钥贴进来。",
  },
  {
    id: "bocha_search",
    label: "博查",
    billing: "byo",
    envKey: "BOCHA_API_KEY",
    signupUrl: "https://open.bochaai.com/",
    rechargeUrl: "https://open.bochaai.com/",
    hint: "国内搜索 API。到博查开放平台开通或充值，把密钥贴进来。",
  },
  {
    id: "brave_search",
    label: "Brave",
    billing: "byo",
    envKey: "BRAVE_SEARCH_API_KEY",
    signupUrl: "https://api.search.brave.com/",
    rechargeUrl: "https://api.search.brave.com/",
    hint: "到 Brave Search API 开通或充值，把密钥贴进来。",
  },
  {
    id: "jina_search",
    label: "Jina",
    billing: "byo",
    envKey: "JINA_API_KEY",
    signupUrl: "https://jina.ai/",
    rechargeUrl: "https://jina.ai/",
    hint: "到 Jina 开通或充值，把密钥贴进来。",
  },
];

export function envHas(env: Readonly<{ [key: string]: string | undefined }>, key: string): boolean {
  const value = env[key];
  return typeof value === "string" && value.trim().length > 0;
}

export function isSearchSourceConfigured(
  env: Readonly<{ [key: string]: string | undefined }>,
  meta: SearchProviderMeta
): boolean {
  if (meta.id === "any_search") return true;
  if (meta.urlEnv) return envHas(env, meta.urlEnv);
  if (meta.envKey) return envHas(env, meta.envKey);
  return false;
}

export type SearchProviderPublic = {
  id: SearchProviderId;
  label: string;
  billing: SearchBilling;
  configured: boolean;
  hint: string;
  signupUrl?: string;
  rechargeUrl?: string;
};

export function listSearchProviders(
  env: Readonly<{ [key: string]: string | undefined }>
): SearchProviderPublic[] {
  return SEARCH_CATALOG.map((meta) => {
    const row: SearchProviderPublic = {
      id: meta.id,
      label: meta.label,
      billing: meta.billing,
      configured: isSearchSourceConfigured(env, meta),
      hint: meta.hint,
    };
    if (meta.signupUrl) row.signupUrl = meta.signupUrl;
    if (meta.rechargeUrl) row.rechargeUrl = meta.rechargeUrl;
    return row;
  });
}

const BYO_ENV_BY_ID = new Map(
  SEARCH_CATALOG.filter((m) => m.billing === "byo" && m.envKey).map((m) => [m.id, m.envKey as string])
);

/** 只接受目录里的收费源密钥，拒绝任意环境变量。 */
export function parseUserSearchKeys(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const rec = raw as Record<string, unknown>;
  const out: Record<string, string> = {};
  for (const [id, envKey] of BYO_ENV_BY_ID) {
    const value = rec[id];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    out[envKey] = trimmed;
  }
  return out;
}
