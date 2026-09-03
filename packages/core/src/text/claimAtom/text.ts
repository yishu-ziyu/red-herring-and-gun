/** Shared string compaction for claim-atom domain. */

/** 展示/分类可见条数。检索预算仍是 atomSearch.MAX_ATOM_SEARCHES（6）。 */
export const MAX_CLAIM_ATOMS = 12;

export function compactStrings(value: unknown, limit = 5, maxLength = 260): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .slice(0, limit)
        .map((item) => (item.length > maxLength ? `${item.slice(0, maxLength)}…` : item))
    : [];
}

export function compactText(value: unknown, maxLength = 420): string {
  if (typeof value !== "string") return "";
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

/**
 * 统一原子键：全角空格规范化 + 截断到 maxLength（超长加省略号）。
 * 自证闸门改写后，split/merge/claimItems 都复用同一键。
 */
export function claimAtomKey(value: string, maxLength = 180): string {
  const norm = value.replace(/\u3000/g, " ");
  return norm.length > maxLength ? `${norm.slice(0, maxLength)}…` : norm;
}
