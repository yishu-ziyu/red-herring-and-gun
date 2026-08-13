import catalogJson from "./modelsDevCatalog.json";

export interface ByoModelOption {
  id: string;
  label: string;
}

export interface ByoProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  /** 历史或文档里常见的等价地址，用来从已保存配置认回这家。 */
  aliases?: string[];
  models: ByoModelOption[];
  defaultModel: string;
}

export interface ModelsDevModel {
  id: string;
  name: string;
  status?: string;
}

export interface ModelsDevProvider {
  id: string;
  name: string;
  api: string | null;
  models: ModelsDevModel[];
}

export type ModelsDevCatalog = Record<string, ModelsDevProvider>;

export interface ByoOverlayModel {
  id: string;
  /** Chip label. If omitted, derived from the models.dev name. */
  label?: string;
}

export interface ByoProviderOverlay {
  id: string;
  name: string;
  /** models.dev provider id. Omit for vendors they do not list (360). */
  modelsDevId?: string;
  baseUrl: string;
  aliases?: string[];
  /** Strip these prefixes from models.dev names when label is omitted. */
  labelStrip?: string[];
  /**
   * Featured first, and the source of chip labels when set.
   * Remaining mainstream chat models from models.dev are appended.
   * Vendors missing from models.dev (360) use this as the full list.
   */
  models?: ByoOverlayModel[];
  defaultModel: string;
}

export const CUSTOM_PRESET_ID = "custom";

const MODELS_DEV_CATALOG = catalogJson as ModelsDevCatalog;

const NON_CHAT_MODEL =
  /tts|asr|whisper|embedding|realtime|dall-e|gpt-image|chatgpt-image/i;

/**
 * Which vendors we expose, and the OpenAI-compatible URLs our test-llm
 * path actually speaks. Chat model lists come from models.dev.
 */
export const BYO_PROVIDER_OVERLAY: ByoProviderOverlay[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    modelsDevId: "deepseek",
    baseUrl: "https://api.deepseek.com/v1",
    aliases: ["https://api.deepseek.com"],
    labelStrip: ["DeepSeek"],
    models: [{ id: "deepseek-v4-flash" }, { id: "deepseek-v4-pro" }],
    defaultModel: "deepseek-v4-flash",
  },
  {
    id: "minimax",
    name: "MiniMax",
    modelsDevId: "minimax-cn",
    // models.dev lists Anthropic `.../anthropic/v1`; we talk OpenAI /chat/completions.
    baseUrl: "https://api.minimaxi.com/v1",
    aliases: ["https://api.minimaxi.com/anthropic", "https://api.minimaxi.com/anthropic/v1"],
    labelStrip: ["MiniMax"],
    models: [{ id: "MiniMax-M3" }, { id: "MiniMax-M2.7-highspeed" }],
    defaultModel: "MiniMax-M3",
  },
  {
    id: "360",
    name: "360GPT",
    baseUrl: "https://api.360.cn/v1",
    models: [
      { id: "360gpt2-pro", label: "2 Pro" },
      { id: "360gpt-pro", label: "Pro" },
      { id: "360gpt-turbo", label: "Turbo" },
    ],
    defaultModel: "360gpt-pro",
  },
  {
    id: "stepfun",
    name: "阶跃",
    modelsDevId: "stepfun",
    baseUrl: "https://api.stepfun.com/v1",
    labelStrip: ["StepFun", "Step"],
    models: [{ id: "step-3.7-flash" }],
    defaultModel: "step-3.7-flash",
  },
  {
    id: "kimi",
    name: "Kimi",
    modelsDevId: "moonshotai-cn",
    baseUrl: "https://api.moonshot.cn/v1",
    labelStrip: ["Kimi"],
    models: [{ id: "kimi-k3" }, { id: "kimi-k2.6" }, { id: "kimi-k2.7-code-highspeed" }],
    defaultModel: "kimi-k3",
  },
  {
    id: "openai",
    name: "OpenAI",
    modelsDevId: "openai",
    // models.dev often has no `api` field for OpenAI.
    baseUrl: "https://api.openai.com/v1",
    models: [
      { id: "gpt-5.6" },
      { id: "gpt-5.5" },
      { id: "gpt-5.4" },
      { id: "gpt-5.4-mini" },
    ],
    defaultModel: "gpt-5.4-mini",
  },
];

export function chipLabelFromCatalog(name: string, strips: string[] = []): string {
  let label = name.trim();
  for (const strip of strips) {
    const escaped = strip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    label = label.replace(new RegExp(`^${escaped}[\\s-]*`, "i"), "");
  }
  label = label.replace(/[-\s]*highspeed$/i, " 高速");
  return label.trim() || name;
}

export function isMainstreamChatModel(model: ModelsDevModel): boolean {
  if (model.status === "deprecated") return false;
  if (NON_CHAT_MODEL.test(`${model.id} ${model.name}`)) return false;
  if (/-\d{4}-\d{2}-\d{2}$/.test(model.id)) return false;
  if (/^step-[12]-/.test(model.id)) return false;
  if (/^kimi-k2-.*preview$/.test(model.id)) return false;
  return true;
}

export function mergeByoPresets(
  overlay: ByoProviderOverlay[],
  catalog: ModelsDevCatalog
): ByoProviderPreset[] {
  return overlay.map((entry) => {
    const provider = entry.modelsDevId ? catalog[entry.modelsDevId] : undefined;
    const catalogModels = (provider?.models ?? []).filter(isMainstreamChatModel);
    const byId = new Map(catalogModels.map((model) => [model.id, model]));
    const catalogApi = provider?.api?.trim() || "";
    const aliases = uniqueUrls([
      ...(entry.aliases ?? []),
      ...(catalogApi && !urlsMatch(catalogApi, entry.baseUrl) ? [catalogApi] : []),
    ]);

    return {
      id: entry.id,
      name: entry.name,
      baseUrl: entry.baseUrl,
      ...(aliases.length > 0 ? { aliases } : {}),
      models: mergeModelChips(entry, byId, catalogModels),
      defaultModel: entry.defaultModel,
    };
  });
}

function mergeModelChips(
  entry: ByoProviderOverlay,
  byId: Map<string, ModelsDevModel>,
  catalogModels: ModelsDevModel[]
): ByoModelOption[] {
  const seen = new Set<string>();
  const chips: ByoModelOption[] = [];

  const push = (id: string, label?: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    const fromCatalog = byId.get(id);
    chips.push({
      id,
      label:
        label ??
        chipLabelFromCatalog(fromCatalog?.name ?? id, entry.labelStrip),
    });
  };

  for (const spec of entry.models ?? []) {
    push(spec.id, spec.label);
  }
  for (const model of catalogModels) {
    push(model.id);
  }
  return chips;
}

export const BYO_PROVIDER_PRESETS: ByoProviderPreset[] = mergeByoPresets(
  BYO_PROVIDER_OVERLAY,
  MODELS_DEV_CATALOG
);

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/$/, "");
}

export function urlsMatch(left: string, right: string): boolean {
  const a = normalizeUrl(left);
  const b = normalizeUrl(right);
  if (a === b) return true;
  if (a === `${b}/v1` || b === `${a}/v1`) return true;
  return false;
}

function uniqueUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const url of urls) {
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(url);
  }
  return result;
}

export function matchByoPreset(baseUrl: string): ByoProviderPreset | null {
  const url = normalizeUrl(baseUrl);
  if (!url) return null;
  return (
    BYO_PROVIDER_PRESETS.find(
      (preset) =>
        urlsMatch(preset.baseUrl, url) ||
        (preset.aliases ?? []).some((alias) => urlsMatch(alias, url))
    ) ?? null
  );
}
