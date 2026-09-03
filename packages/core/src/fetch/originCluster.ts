import type { ClusterInput } from "./types.js";

function ngrams(text: string): Set<string> {
  const s = text.replace(/\s+/g, "");
  const grams = new Set<string>();
  for (let i = 0; i <= s.length - 5; i++) grams.add(s.slice(i, i + 5));
  return grams;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const gram of a) if (b.has(gram)) inter += 1;
  return inter / (a.size + b.size - inter);
}

function pickRoot(group: ClusterInput[]): ClusterInput {
  return [...group].sort((a, b) => {
    const aD = a.publishedAt;
    const bD = b.publishedAt;
    if (aD && bD) {
      const cmp = aD.localeCompare(bD);
      if (cmp !== 0) return cmp;
      return a.id.localeCompare(b.id);
    }
    if (aD && !bD) return -1;
    if (!aD && bD) return 1;
    return a.id.localeCompare(b.id);
  })[0];
}

export function originCluster(items: ClusterInput[]): Map<string, string> {
  const n = items.length;
  const parent = items.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (items[i].host === items[j].host) union(i, j);
    }
  }

  // ponytail: O(n²) pairwise 5-gram Jaccard; ceiling n ≤ 200. Upgrade: LSH / MinHash if retrieve set grows.
  const grams = items.map((item) => ngrams(item.text ?? ""));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue;
      if (jaccard(grams[i], grams[j]) >= 0.6) union(i, j);
    }
  }

  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const list = members.get(root) ?? [];
    list.push(i);
    members.set(root, list);
  }

  const result = new Map<string, string>();
  for (const idxs of members.values()) {
    const group = idxs.map((i) => items[i]);
    const clusterId = pickRoot(group).id;
    for (const item of group) result.set(item.id, clusterId);
  }
  return result;
}
