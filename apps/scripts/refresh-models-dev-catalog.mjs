#!/usr/bin/env node
/**
 * Refresh the slim models.dev snapshot used by BYO presets.
 * Overlay in byoProviderPresets.ts still owns OpenAI-compatible URLs
 * (MiniMax /v1, OpenAI, 360) and which chips we show.
 *
 * Usage: node scripts/refresh-models-dev-catalog.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDER_IDS = ["deepseek", "minimax-cn", "stepfun", "moonshotai-cn", "openai"];
const dest = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src/lib/modelsDevCatalog.json");

const response = await fetch("https://models.dev/api.json", {
  headers: { "User-Agent": "red-herring-and-gun/0.1" },
});
if (!response.ok) {
  throw new Error(`models.dev api.json ${response.status}`);
}

const data = await response.json();
const catalog = {};
for (const id of PROVIDER_IDS) {
  const provider = data[id];
  if (!provider) throw new Error(`models.dev is missing ${id}`);
  catalog[id] = {
    id: provider.id,
    name: provider.name,
    api: provider.api ?? null,
    models: Object.values(provider.models || {}).map((model) => ({
      id: model.id,
      name: model.name,
      status: model.status || "active",
    })),
  };
}

fs.writeFileSync(dest, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`wrote ${dest}`);
