export type Tier = "A" | "B" | "C" | "unknown";

export interface Pivot {
  id: string;
  kind: "link" | "doc_number" | "date" | "image" | "entity" | "query";
  value: string; // URL / 文号 / 日期 / 机构名 / 查询串
  why: string;
  expectedValue: 1 | 2 | 3;
  fromEvidenceId?: string;
  depth: number; // 距用户输入的跳数
}

export type FetchedPage = {
  finalUrl: string;
  status: number;
  contentType: string;
  html?: string;
  text: string;
  title?: string;
  publishedAt?: string;
  links: string[];
  images: string[];
  reachable: boolean;
  truncated?: boolean;
  error?: string;
};

export interface ClusterInput {
  id: string;
  host: string;
  text?: string;
  publishedAt?: string;
}

export type WebFetchOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  signal?: AbortSignal;
};
