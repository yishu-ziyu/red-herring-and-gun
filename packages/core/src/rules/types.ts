/**
 * Minimal mvp/src/lib/schemas types needed by sourceCredibility.ts.
 * Sourced verbatim from mvp/src/lib/schemas.ts; T09 will decide canonical home.
 */

export type EvidenceRole = "支持" | "反驳" | "限定" | "背景" | "线索" | "不可用";

export type SearchSourceType = "官方" | "学术" | "媒体" | "自媒体" | "论坛" | "聚合搜索" | "未知";

type ScoreLevel = "高" | "中" | "低";

export interface Search360Source {
  id?: string;
  title: string;
  url: string;
  snippet: string;
  credibility?: ScoreLevel;
  sourceType?: SearchSourceType;
  credibilityScore?: number;
  sourceTier?: number;
  freshnessScore?: number;
  domain?: string;
  evidenceRole?: EvidenceRole;
  publishedAt?: string;
  publishedTimestamp?: number;
}
