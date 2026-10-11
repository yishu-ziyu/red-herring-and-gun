/**
 * 资料（来源）在界面上怎么叫、怎么排、和要点是什么关系。进度页的药丸、结果页的引用、引用卡、全部资料抽屉都从这里取，
 * 所以同一份资料在四个地方的名字、立场词、排序和关系句一定一致。
 *
 * - 一条「关系」（SourceRelation）= 一份资料 × 一个要点 × 一个立场。引用和引用卡吃的就是它。
 * - 同一份资料可能和几个要点有关系，抽屉要全部列出，所以抽屉用 snapshotSourceEntries 按资料聚合。
 * - 要点编号（claimNo）从 1 开始，按调用方传进来的要点数组算：结果页会滤掉空壳要点，编号必须和页面上显示的一致。
 */
import type { InvestigationClaim, InvestigationEvidenceLink, InvestigationSource } from "../lib/investigation";
import { quoteLinkUrl } from "../lib/investigation";
import { ROLE_LABEL, ROLE_ORDER, ROLE_TONE, type EvidenceRole } from "./snapshotUi";

export { ROLE_LABEL, ROLE_ORDER, ROLE_TONE, type EvidenceRole };

export type SourceRelation = {
  source: InvestigationSource;
  role: EvidenceRole;
  claimNo: number;
  /** 这条关系背后的依据；有它才有逐字摘句和带定位的外链。 */
  link?: InvestigationEvidenceLink;
};

export type SourceEntry = {
  source: InvestigationSource;
  /** 这份资料和每个要点的关系，按要点编号排。找到了但没挂到任何要点上的资料，这里是空数组。 */
  relations: Array<{ claimNo: number; role: EvidenceRole; link: InvestigationEvidenceLink }>;
  /** 最能决定判断的那个立场（按 ROLE_ORDER）；没有任何关系时为 null，调用方不要硬给它一个立场词。 */
  primaryRole: EvidenceRole | null;
};

export const roleRank = (role: EvidenceRole): number => ROLE_ORDER.indexOf(role);

/** 网站的主机名，给图标接口用。不是 http(s) 链接或解析不了时返回空字符串，调用方显示兜底图标。 */
export function hostOf(url: string | undefined): string {
  if (!url || !/^https?:\/\//i.test(url)) return "";
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** 给人看的网站名：去掉 www.。 */
export function siteOf(url: string | undefined): string {
  return hostOf(url).replace(/^www\./, "");
}

/**
 * 资料的短名（药丸、引用上那几个字）。中文资料标题常写成「机构：标题」，冒号前是机构名，比域名好认；
 * 冒号前太长就多半不是机构名，退回检索方给的发布者，再退回网站名。
 */
export function publisherOf(source: Pick<InvestigationSource, "title" | "url" | "publisher" | "id">): string {
  const title = source.title?.trim() ?? "";
  const cut = title.indexOf("：");
  const prefix = cut > 0 ? title.slice(0, cut).trim() : "";
  if (prefix && [...prefix].length <= 10) return prefix;
  return source.publisher?.trim() || siteOf(source.url) || title || source.id;
}

/** 引用卡上的立场标记。和立场标签用同一组词，不加「材料」（文案准则 v2 只用「资料」）。 */
export const ROLE_BADGE: Record<EvidenceRole, string> = {
  contradict: "反驳",
  support: "支持",
  "context-only": "背景",
  unassessed: "没读完",
};

/** 这份资料和第几个要点是什么关系：引用卡底部和全部资料里都用这一句。 */
export function relationText(role: EvidenceRole, claimNo: number): string {
  switch (role) {
    case "unassessed":
      return `还没读完，没有算进第 ${claimNo} 个要点的判断`;
    case "context-only":
      return `为第 ${claimNo} 个要点提供背景`;
    default:
      return `${ROLE_LABEL[role]}第 ${claimNo} 个要点`;
  }
}

/** 引用卡里引的那段话：先用逐字核对过的摘句，没有就用依据的上下文，再没有才用资料自带的摘录。 */
export function relationPassage(relation: Pick<SourceRelation, "source" | "link">): string {
  return relation.link?.quote?.trim() || relation.link?.passage?.trim() || relation.source.excerpt?.trim() || "";
}

/** 打开原网页。只有正文里的摘句才带定位跳到那一句；搜索摘要只打开网页，不承诺能找到同一句。 */
export function relationHref(relation: Pick<SourceRelation, "source" | "link">): string {
  const url = relation.source.url;
  if (!hostOf(url)) return "";
  const quote = relation.link?.excerptKind === "page-excerpt" ? relation.link.quote?.trim() ?? "" : "";
  return quoteLinkUrl(url, quote);
}

/**
 * 一个要点用到的资料，一份资料只出现一次（同一份资料对同一要点既有支持又有反驳时，取更能决定判断的那个立场），
 * 按 ROLE_ORDER 排，同一立场内保持依据原来的顺序。找不到资料条目的依据跳过。
 */
export function claimSourceRelations(
  claim: Pick<InvestigationClaim, "evidence">,
  claimNo: number,
  sources: InvestigationSource[],
): SourceRelation[] {
  const byId = new Map(sources.map((source) => [source.id, source]));
  const best = new Map<string, SourceRelation>();
  for (const link of claim.evidence) {
    const source = byId.get(link.sourceId);
    if (!source) continue;
    const seen = best.get(source.id);
    if (!seen || roleRank(link.role) < roleRank(seen.role)) best.set(source.id, { source, role: link.role, claimNo, link });
  }
  return [...best.values()].sort((a, b) => roleRank(a.role) - roleRank(b.role));
}

/**
 * 全部资料（抽屉）：每份资料一条，带上它和每个要点的关系。
 * 排序同结果页：最能决定判断的立场在前，同立场按资料被找到的顺序；没挂到任何要点上的资料放最后。
 */
export function snapshotSourceEntries(sources: InvestigationSource[], claims: InvestigationClaim[]): SourceEntry[] {
  const relations = new Map<string, SourceEntry["relations"]>();
  claims.forEach((claim, index) => {
    const seen = new Set<string>();
    for (const link of claim.evidence) {
      const key = `${link.sourceId}\0${link.role}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = relations.get(link.sourceId) ?? [];
      list.push({ claimNo: index + 1, role: link.role, link });
      relations.set(link.sourceId, list);
    }
  });
  const rank = (entry: SourceEntry) => (entry.primaryRole ? roleRank(entry.primaryRole) : ROLE_ORDER.length);
  return sources
    .map((source): SourceEntry => {
      const list = (relations.get(source.id) ?? []).sort((a, b) => a.claimNo - b.claimNo || roleRank(a.role) - roleRank(b.role));
      const primaryRole = list.reduce<EvidenceRole | null>(
        (top, r) => (top === null || roleRank(r.role) < roleRank(top) ? r.role : top),
        null,
      );
      return { source, relations: list, primaryRole };
    })
    .sort((a, b) => rank(a) - rank(b));
}

/** 抽屉里每一行的 DOM id：从引用卡「在全部资料里看」跳过去时用它找到那一行。 */
export const sourceEntryDomId = (sourceId: string): string => `gp-source-entry-${encodeURIComponent(sourceId)}`;
