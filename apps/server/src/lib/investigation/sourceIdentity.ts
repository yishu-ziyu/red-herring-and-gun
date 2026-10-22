/**
 * InvestigationSource.id 的稳定派生（Issue #76）。
 *
 * id 是规范化 URL 的纯函数，不依赖 phase、role、evidence 排序或注册顺序。
 * 同一 URL 在一次 investigation 的任意 Snapshot 中必须得到同一 id。
 * 同 URL 的 support / contradict 仍是两条 EvidenceLink，不在这里合成 stance。
 */
export function normalizeInvestigationSourceUrl(url: string): string {
  return url.trim();
}

function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(input);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, "0");
}

/** CSS-safe、跨 Snapshot 稳定：只由规范化 URL 决定。 */
export function investigationSourceId(url: string): string {
  return `src-${fnv1a64Hex(normalizeInvestigationSourceUrl(url))}`;
}

