export type Tier = "A" | "B" | "C" | "unknown";
export type Provenance =
  | { kind: "search"; query: string; provider?: string }
  | { kind: "pivot"; fromEvidenceId: string; pivotId: string }
  | { kind: "user" }
  | { kind: "memory"; recallId?: string }
  | { kind: "reverse-image"; imageUrl: string };
export interface Evidence {
  id: string;             // "e1", "e2", …
  url: string;            // 原始 URL
  canonicalUrl: string;   // 规范化后，用于去重
  host: string;
  title?: string;
  excerpt: string;        // ≤ 320 字
  text?: string;          // 抓取后的正文
  publishedAt?: string;   // ISO 8601
  retrievedAt: string;    // ISO 8601
  tier: Tier;
  clusterId?: string;
  reachable?: boolean;    // 抓取失败置 false
  provenance: Provenance;
}
