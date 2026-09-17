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

export const JUDGMENT_LABEL: Record<NonNullable<InvestigationJudgment>, string> = {
  supported: "证据支持",
  refuted: "证据反驳",
  mixed: "有对有错",
  unresolved: "证据不足",
  "not-applicable": "立场表达",
};

export const JUDGMENT_TONE: Record<NonNullable<InvestigationJudgment>, "positive" | "negative" | "mixed" | "muted"> = {
  supported: "positive",
  refuted: "negative",
  mixed: "mixed",
  unresolved: "muted",
  "not-applicable": "muted",
};

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
    if (claim.judgment === "mixed") {
      const other = claim.evidence.find(
        (link) => isDecisiveRole(link.role) && link !== preferred,
      );
      if (other) add(claim, other);
    }
  }

  return items;
}

/** 完成态下是否有任何可下钻的来源。 */
export function hasDrilldownSource(snapshot: InvestigationSnapshotV1): boolean {
  return snapshot.sources.some((s) => Boolean(s.url));
}

/** imageOrigin（finalReport 临时 side-channel）的只读视图。 */
export type ImageOriginView =
  | { status: "found"; url: string; title: string; label: string }
  | { status: "not_found"; label: string };

export function readImageOrigin(report: Record<string, unknown> | null | undefined): ImageOriginView | undefined {
  if (!report || typeof report !== "object") return undefined;
  const raw = (report as Record<string, unknown>).imageOrigin;
  if (!raw || typeof raw !== "object") return undefined;
  const rec = raw as Record<string, unknown>;
  const label = typeof rec.label === "string" ? rec.label : "";
  const url = typeof rec.url === "string" && rec.url.trim() ? rec.url.trim() : "";
  if (rec.status === "found" && url) {
    return {
      status: "found",
      url,
      title: typeof rec.title === "string" && rec.title.trim() ? rec.title.trim() : url,
      label: label || "原图出处",
    };
  }
  return { status: "not_found", label: label || "原图出处未查到" };
}
