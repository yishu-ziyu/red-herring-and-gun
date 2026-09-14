/**
 * 知识库复用的读侧：证据条目的两个可选字段（`provenance` / `originDate`）与命中知识库那行的
 * 已核日期。两个字段都可选，老快照没有它们时一律按普通证据渲染、不出标记。
 */
import type { InvestigationEvidenceLink, PublicActivity } from "../lib/investigation";

/** ISO 时间戳或日期串截到 YYYY-MM-DD；取不到日返回空串。 */
function originDay(value: string | undefined): string {
  const match = (value ?? "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

/**
 * 证据条目的知识库日期：不是知识库来源返回 null（老快照没有这两个字段）。
 * 是知识库来源但缺 originDate 时返回空串——标记照出，只是不写日期。
 */
export function knowledgeOriginDay(link: InvestigationEvidenceLink): string | null {
  if (link.provenance !== "knowledge") return null;
  return originDay(link.originDate);
}

/** 同一案上一轮复用的证据条目。不是 prior-round 返回 false（老快照没有这个字面量）。 */
export function isPriorRoundLink(link: InvestigationEvidenceLink): boolean {
  return link.provenance === "prior-round";
}

/**
 * 命中知识库那行的已核日期。这行活动没有可归属对象（引用数组留空），日期只在 payload 里；
 * originDate 与 verifiedAt 都是该 kind 的 payload 白名单键。
 */
export function knowledgeHitDay(activity: PublicActivity): string {
  return originDay(activity.payload.originDate ?? activity.payload.verifiedAt);
}
