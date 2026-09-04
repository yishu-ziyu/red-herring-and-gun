const STORAGE_KEY = "rhg.search-keys";

export function loadSearchKeys(): Record<string, string> {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "string" && value.trim()) out[key] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSearchKeys(keys: Record<string, string>): void {
  const cleaned: Record<string, string> = {};
  for (const [key, value] of Object.entries(keys)) {
    if (value.trim()) cleaned[key] = value.trim();
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cleaned));
}

export function searchKeysPayload(): Record<string, string> | undefined {
  const keys = loadSearchKeys();
  return Object.keys(keys).length > 0 ? keys : undefined;
}
