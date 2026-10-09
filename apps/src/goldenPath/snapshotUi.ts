/**
 * InvestigationSnapshotV1 → 用户可见语义的纯映射（Issue #52 第四节固定映射表）。
 * 不读 raw Agent/tool 事件；不含实现层词汇。文案跟随产品宪法五词 + 证据语义。
 */
import type {
  InvestigationClaim,
  InvestigationEvidenceLink,
  InvestigationJudgment,
  InvestigationPhase,
  InvestigationProgress,
  InvestigationSnapshotV1,
  InvestigationSource,
} from "../lib/investigation";
import { LABEL_TEXT, LABEL_TONE, judgmentToLabel, normalizePublishedDate, type LabelKey } from "../lib/investigation";

export type EvidenceRole = InvestigationEvidenceLink["role"];

export const ROLE_ORDER: EvidenceRole[] = ["contradict", "support", "unassessed", "context-only"];

export const ROLE_LABEL: Record<EvidenceRole, string> = {
  support: "支持",
  contradict: "反驳",
  unassessed: "待核对",
  "context-only": "相关材料",
};

/** 证据行左侧固定栏：比分组标题更短，相关不写「相关材料」。 */
export const ROLE_ROW_LABEL: Record<EvidenceRole, string> = {
  support: "支持",
  contradict: "反驳",
  unassessed: "待核对",
  "context-only": "相关",
};

export const PUBLISHED_UNKNOWN = "发布日期未取到";

/** 来源发布日期 YYYY-MM-DD；老快照里的原样日期也按同一规则读，读不出就是 null。不拿取得时间顶替。 */
export function publishedDay(source: Pick<InvestigationSource, "publishedAt"> | undefined): string | null {
  return normalizePublishedDate(source?.publishedAt) ?? null;
}

// 文本片段匹配要求两端落在词边界：只取两侧都是原文标点的整段，不在中间截断。
const CLAUSE_SPLIT = /[。｡！？!?；;，,、：:“”「」『』（）()《》\n]|\.(?=\s|$)/;
// 这些字符多半是我们或检索方加进去的（省略号、markdown、链接、引用角标），原网页里找不到。
const INSERTED_MARKS = /…|\.\.\.|[#*[\]<>|_`\\]|https?:|　|\s{2,}/;
// 中文里的空格、句首的序号，多半是抽取正文时把几个网页元素拼在一起留下的。
const JOINED_ELEMENTS = /[一-鿿].*\s|\s.*[一-鿿]|^\d/;

/**
 * 原文链接 + 文本片段（#:~:text=），浏览器打开后跳到摘录里的那一句。
 * 片段取摘录里一段两侧都是原文标点的完整短句（8–30 字）；找不到安全的就返回原链接。
 */
export function quoteFragmentUrl(url: string, quote: string | undefined): string {
  if (!/^https?:\/\//i.test(url) || url.includes(":~:")) return url;
  const text = (quote ?? "").replace(/\r/g, "");
  const parts = text.split(CLAUSE_SPLIT);
  // 第一段和最后一段可能被摘录截断（两侧不是原文标点），不用。
  const candidates = parts
    .slice(1, -1)
    .map((p) => p.trim())
    .filter((p) => p.length >= 8 && p.length <= 30 && !INSERTED_MARKS.test(p) && !JOINED_ELEMENTS.test(p) && text.includes(p));
  const pick = candidates.sort((a, b) => b.length - a.length)[0];
  if (!pick) return url;
  const encoded = encodeURIComponent(pick).replace(/-/g, "%2D");
  return url.includes("#") ? `${url}:~:text=${encoded}` : `${url}#:~:text=${encoded}`;
}

/** 只回传来源已有摘录，不编造。 */
export function sourceExcerpt(source: InvestigationSource | undefined): string {
  const text = source?.excerpt?.trim();
  return text || "";
}

/** role 的 neutral/positive/negative 语气；unassessed 绝不能被染成证据位。 */
export const ROLE_TONE: Record<EvidenceRole, "positive" | "negative" | "neutral" | "muted"> = {
  support: "positive",
  contradict: "negative",
  unassessed: "muted",
  "context-only": "neutral",
};

/** judgment 对应的标签词（9 个标签之一，见 domain/labels）。活动流等只有 judgment 的地方用它。 */
export const JUDGMENT_LABEL: Record<NonNullable<InvestigationJudgment>, string> = {
  supported: LABEL_TEXT[judgmentToLabel("supported")],
  refuted: LABEL_TEXT[judgmentToLabel("refuted")],
  mixed: LABEL_TEXT[judgmentToLabel("mixed")],
  disputed: LABEL_TEXT[judgmentToLabel("disputed")],
  unresolved: LABEL_TEXT[judgmentToLabel("unresolved")],
  "not-applicable": LABEL_TEXT[judgmentToLabel("not-applicable")],
};

export { LABEL_TEXT, LABEL_TONE, type LabelKey };

/** 这一截显示的标签：快照带了就用；改版前的快照只有 judgment，按它推出（此时没有理由）。 */
export function claimLabel(claim: Pick<InvestigationClaim, "label" | "judgment">): LabelKey | null {
  if (claim.label) return claim.label;
  return claim.judgment ? judgmentToLabel(claim.judgment) : null;
}

export const PROGRESS_LABEL: Record<InvestigationProgress, string> = {
  pending: "待查",
  searching: "正在追查",
  complete: "已核对",
  interrupted: "没查完",
};

export const CHECKABILITY_HINT: Record<InvestigationClaim["checkability"], string> = {
  checkable: "",
  "not-applicable": "立场或价值表达，不适用真假判断",
  "trace-only": "只能追查说法从哪来",
};

/** 调查态的一句话状态：不出现任何实现层词汇。 */
export function phaseHeadline(snapshot: InvestigationSnapshotV1): string {
  switch (snapshot.phase) {
    case "received":
      return "已收到这个说法，准备开始。";
    case "decomposed":
      return "这句话被拆成了下面几个命题。";
    case "investigating":
      return "正在逐条追查出处。";
    case "judging":
      return "正在对照证据形成判断。";
    case "complete":
      return "调查完成。";
    case "interrupted":
      return "还没有写成总判断。";
  }
}

/**
 * 列表和结论卡上的出处标题。辟谣合集里命中某一节时，先写这一节，合集标题作为出处；
 * 只写合集标题会让人以为拿错了材料（2026-09-28 错误分析 NEW-003）。
 */
export function evidenceTitle(
  link: { sectionTitle?: string },
  source: { id: string; url?: string; title?: string } | undefined
): string {
  const page = source?.title?.trim() || source?.url || source?.id || "";
  const section = link.sectionTitle?.trim();
  if (!section || section === source?.title?.trim()) return page;
  return source?.title?.trim() ? `${section}（出自《${source.title.trim()}》）` : section;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export type EvidenceGroup = {
  role: EvidenceRole;
  label: string;
  tone: "positive" | "negative" | "neutral" | "muted";
  links: InvestigationEvidenceLink[];
};

/** 把一条 claim 的证据按角色分组，固定顺序（反驳、支持、待核对、相关材料）。 */
export function groupEvidence(links: InvestigationEvidenceLink[]): EvidenceGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    label: ROLE_LABEL[role],
    tone: ROLE_TONE[role],
    links: links.filter((l) => l.role === role),
  })).filter((group) => group.links.length > 0);
}

/**
 * 证据行身份（view layer，不扩 Snapshot contract）。
 *
 * InvestigationEvidenceLink 没有 link id。builder 可对同一 sourceId 分别 push
 * supporting / contradicting，所以重复出现是多条独立 relation，不能合成一行。
 *
 * 能确认同一对象才给稳定 key；确认不了就 fail-safe，不用出现序号假装 continuity。
 *
 * - stable：该 sourceId 本帧只出现一次。key = `${claimId}:${sourceId}`，可跨 role 保持节点。
 * - relation：同源重复，但 role（不够再用 finding/limitation）能唯一区分。
 *   key 与 stable 键族不相交，故 1×↔2× 会 remount；同一 relation 只改顺序则保持节点。
 * - ephemeral：现有字段仍撞车。只保证本帧 React key 唯一，不声称 object continuity。
 */
export type EvidenceIdentityKind = "stable" | "relation" | "ephemeral";

export type IdentifiedEvidenceLink = {
  link: InvestigationEvidenceLink;
  key: string;
  identity: EvidenceIdentityKind;
};

function contentToken(link: InvestigationEvidenceLink): string {
  return `${encodeURIComponent(link.finding ?? "")}:${encodeURIComponent(link.limitation ?? "")}`;
}

export function identifyEvidenceLinks(
  claimId: string,
  links: InvestigationEvidenceLink[],
): IdentifiedEvidenceLink[] {
  const sourceCounts = new Map<string, number>();
  const roleCounts = new Map<string, number>();
  const contentCounts = new Map<string, number>();

  for (const link of links) {
    sourceCounts.set(link.sourceId, (sourceCounts.get(link.sourceId) ?? 0) + 1);
    const roleKey = `${link.sourceId}\0${link.role}`;
    roleCounts.set(roleKey, (roleCounts.get(roleKey) ?? 0) + 1);
    const contentKey = `${roleKey}\0${contentToken(link)}`;
    contentCounts.set(contentKey, (contentCounts.get(contentKey) ?? 0) + 1);
  }

  const contentSeen = new Map<string, number>();

  return links.map((link) => {
    const sourceId = link.sourceId;
    if ((sourceCounts.get(sourceId) ?? 0) <= 1) {
      return { link, key: `${claimId}:${sourceId}`, identity: "stable" as const };
    }

    const roleKey = `${sourceId}\0${link.role}`;
    if ((roleCounts.get(roleKey) ?? 0) <= 1) {
      return { link, key: `${claimId}:${sourceId}::${link.role}`, identity: "relation" as const };
    }

    const token = contentToken(link);
    const contentKey = `${roleKey}\0${token}`;
    if ((contentCounts.get(contentKey) ?? 0) <= 1) {
      return {
        link,
        key: `${claimId}:${sourceId}::${link.role}:${token}`,
        identity: "relation" as const,
      };
    }

    const seen = (contentSeen.get(contentKey) ?? 0) + 1;
    contentSeen.set(contentKey, seen);
    return {
      link,
      key: `${claimId}:${sourceId}::${link.role}:${token}::~${seen}`,
      identity: "ephemeral" as const,
    };
  });
}

export function evidenceLinkKey(claimId: string, links: InvestigationEvidenceLink[], index: number): string {
  return identifyEvidenceLinks(claimId, links)[index]?.key ?? `${claimId}:`;
}

export const ROLE_LAYOUT_ORDER: Record<EvidenceRole, number> = {
  contradict: 10,
  support: 20,
  unassessed: 30,
  "context-only": 40,
};

export function roleGlyph(role: EvidenceRole): string {
  switch (role) {
    case "support":
    case "contradict":
      return "●";
    case "context-only":
      return "○";
    case "unassessed":
      return "◌";
    default:
      return "●";
  }
}

export function sourceById(snapshot: InvestigationSnapshotV1, id: string): InvestigationSource | undefined {
  return snapshot.sources.find((s) => s.id === id);
}

/** 某条来源真正挂在哪些命题上：保留原始 EvidenceLink，不按 sourceId 首次遇见或 claims[0] 重建。 */
export function attachmentsForSource(
  sourceId: string,
  claims: InvestigationClaim[],
): Array<{ claim: InvestigationClaim; link: InvestigationEvidenceLink }> {
  const rows: Array<{ claim: InvestigationClaim; link: InvestigationEvidenceLink }> = [];
  for (const claim of claims) {
    for (const link of claim.evidence ?? []) {
      if (link.sourceId === sourceId) rows.push({ claim, link });
    }
  }
  return rows;
}

export type DecisiveEvidenceItem = {
  claimId: string;
  claimText: string;
  link: InvestigationEvidenceLink;
  source: InvestigationSource;
};

function isDecisiveRole(role: EvidenceRole): role is "support" | "contradict" {
  return role === "support" || role === "contradict";
}

/** 1–3 条决定性依据。只取支持/反驳，不拿相关材料凑数。 */
export function pickDecisiveEvidence(
  claims: InvestigationClaim[],
  sources: InvestigationSource[],
): DecisiveEvidenceItem[] {
  const items: DecisiveEvidenceItem[] = [];
  const seen = new Set<string>();

  const add = (claim: InvestigationClaim, link: InvestigationEvidenceLink) => {
    if (items.length >= 3 || !isDecisiveRole(link.role)) return;
    const source = sources.find((item) => item.id === link.sourceId);
    if (!source) return;
    const key = `${claim.id}\0${link.sourceId}\0${link.role}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ claimId: claim.id, claimText: claim.text, link, source });
  };

  for (const claim of claims) {
    const preferredRole =
      claim.judgment === "refuted" ? "contradict" : claim.judgment === "supported" ? "support" : null;
    const preferred = preferredRole
      ? claim.evidence.find((link) => link.role === preferredRole)
      : claim.evidence.find((link) => isDecisiveRole(link.role));
    if (preferred) add(claim, preferred);
    if (claim.judgment === "mixed" || claim.judgment === "disputed") {
      const other = claim.evidence.find(
        (link) => isDecisiveRole(link.role) && link !== preferred,
      );
      if (other) add(claim, other);
    }
  }

  return items;
}

/** 所有来源共用的本地图标：不向第三方图标服务透露用户在看哪些网站。 */
export const SOURCE_ICON_URL = "/source-icon.svg";

/** 完成态下是否有任何可下钻的来源。 */
export function hasDrilldownSource(snapshot: InvestigationSnapshotV1): boolean {
  return snapshot.sources.some((s) => Boolean(s.url));
}
