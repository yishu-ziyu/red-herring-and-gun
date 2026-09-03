export type { Pivot, Tier } from "../casefile/schema.js";

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
  charset: string;
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
  guard?: (url: string) => Promise<string | undefined>;
};
