/**
 * InvestigationSnapshotV1 → 用户可见语义的纯映射（Issue #52 第四节固定映射表）。
 * 不读 raw Agent/tool 事件；不含实现层词汇。
 */
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";
import { judgmentToLabel, normalizePublishedDate, type LabelKey } from "../lib/investigation";

export const ROLE_LABEL: Record<InvestigationEvidenceLink["role"], string> = {
  support: "支持",
  contradict: "反驳",
  unassessed: "尚未核对",
  "context-only": "相关材料",
};

export const PUBLISHED_UNKNOWN = "发布日期未取到";

/** 来源发布日期 YYYY-MM-DD；老快照里的原样日期也按同一规则读，读不出就是 null。不拿取得时间顶替。 */
export function publishedDay(source: Pick<InvestigationSource, "publishedAt"> | undefined): string | null {
  return normalizePublishedDate(source?.publishedAt) ?? null;
}

/** 这一截显示的标签：快照带了就用；改版前的快照只有 judgment，按它推出（此时没有理由）。 */
export function claimLabel(claim: Pick<InvestigationClaim, "label" | "judgment">): LabelKey | null {
  if (claim.label) return claim.label;
  return claim.judgment ? judgmentToLabel(claim.judgment) : null;
}

export const CHECKABILITY_HINT: Record<InvestigationClaim["checkability"], string> = {
  checkable: "",
  "not-applicable": "立场或价值表达，不适用真假判断",
  "trace-only": "只能追查说法从哪来",
};

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
