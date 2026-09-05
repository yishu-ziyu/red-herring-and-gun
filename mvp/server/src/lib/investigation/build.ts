/**
 * 生产数据 → InvestigationSnapshotV1 的确定性映射（不调用任何 LLM）。
 *
 * 输入是生产结构的鸭子类型（claimAtoms / claimAtomTypes / AtomSearchBundle /
 * subclaimVerdicts / crossExam / pursuitHops / finalReport），全部可选——
 * 同一个 builder 服务调查进行中、完成、interrupted 和旧历史重建。
 *
 * 判词纪律不在本文件发明：true/false 无已绑定 http(s) 来源时按生产 demote 规则
 * 收敛为 unresolved（与 mergeSubclaimVerdicts / bindAtomEvidenceToVerdicts 同向，
 * 只在读取时兜底，不回写生产数据）。
 */
import type {
  InvestigationCheckability,
  InvestigationClaim,
  InvestigationConflict,
  InvestigationEvidenceLink,
  InvestigationGap,
  InvestigationJudgment,
  InvestigationPhase,
  InvestigationProgress,
  InvestigationSnapshotV1,
  InvestigationSource,
} from "./schema.js";
import { validateInvestigationSnapshot } from "./schema.js";

export type InvestigationBuildInput = {
  originalClaim: string;
  phase: InvestigationPhase;
  /** self-proof 后保留的原子（原句序）。dropped 原子不进 claims——它们不是用户主张。 */
  claimAtoms?: unknown;
  /** [{ text, verifiable, type }]，拆题类型闸工单。 */
  claimAtomTypes?: unknown;
  /** AtomSearchBundle 形：{ atomsSearched?, byAtomKey? }。 */
  atomSearchBundle?: unknown;
  /** SubclaimVerdict 形数组（合并绑定后或模型原始）。 */
  subclaimVerdicts?: unknown;
  /** [{ text, type }] 立场/不适用原子（legacy 补 types 用）。 */
  nonVerifiableAtoms?: unknown;
  /** { ran?, atoms?: [...] } 质询记录；只用于冲突 reason，不决定冲突是否存在。 */
  crossExam?: unknown;
  /** PursuitHop[] 证据追索跳；只用于 gap consequence。 */
  pursuitHops?: unknown;
  /** finalReport 形：{ conclusion?, verdictType?, causalBoundary?, citationSources?, checkedAt? }。 */
  report?: unknown;
  /** 引用探活死链（pruneDeadCitations.deadUrls）：死链来源标 reachable=false。 */
  reachability?: { deadUrls?: readonly string[] };
  checkedAt?: string;
};

export type InvestigationBuildOptions = {
  /**
   * 生产传 mvp `claimAtomKey`，保证与 merge/claimItems 同键；
   * 缺省用内置同规则规范化（全角空格 → 空格，超长 180 截断）。
   */
  claimAtomKeyFn?: (value: string) => string;
};

const DEFAULT_KEY_MAX = 180;

function defaultClaimAtomKey(value: string): string {
  const norm = value.replace(/\u3000/g, " ");
  return norm.length > DEFAULT_KEY_MAX ? `${norm.slice(0, DEFAULT_KEY_MAX)}…` : norm;
}

const HTTP_RE = /^https?:\/\//i;

function isHttpUrl(url: string): boolean {
  return HTTP_RE.test(url);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

type VerdictSourceLike = { url?: unknown; title?: unknown; snippet?: unknown };

type VerdictLike = {
  claimAtom: string;
  verdict: string;
  evidence: string;
  boundary: string;
  supportingSources: VerdictSourceLike[];
  contradictingSources: VerdictSourceLike[];
  evidenceGaps: string[];
  sourcesRelatedOnly: boolean;
};

function readVerdicts(raw: unknown, keyFn: (s: string) => string): Map<string, VerdictLike> {
  const out = new Map<string, VerdictLike>();
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const atom = asString(rec.claimAtom).trim();
    if (!atom) continue;
    const key = keyFn(atom);
    if (!key || out.has(key)) continue;
    const supporting = asArray(rec.supportingSources)
      .map(asRecord)
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({ url: s.url, title: s.title, snippet: s.snippet }));
    const contradicting = asArray(rec.contradictingSources)
      .map(asRecord)
      .filter((s): s is Record<string, unknown> => s !== null)
      .map((s) => ({ url: s.url, title: s.title, snippet: s.snippet }));
    out.set(key, {
      claimAtom: key,
      verdict: asString(rec.verdict).trim().toLowerCase(),
      evidence: clip(asString(rec.evidence), 240),
      boundary: clip(asString(rec.boundary), 200),
      supportingSources: supporting,
      contradictingSources: contradicting,
      evidenceGaps: asArray(rec.evidenceGaps)
        .map((g) => clip(asString(g), 120))
        .filter((g) => g.length > 0)
        .slice(0, 3),
      sourcesRelatedOnly: rec.sourcesRelatedOnly === true,
    });
  }
  return out;
}

function readAtomTypes(
  claimAtomTypes: unknown,
  nonVerifiableAtoms: unknown,
  keyFn: (s: string) => string
): Map<string, { verifiable: boolean; type: string }> {
  const map = new Map<string, { verifiable: boolean; type: string }>();
  for (const item of asArray(claimAtomTypes)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = asString(rec.text).trim();
    if (!text) continue;
    map.set(keyFn(text), {
      verifiable: rec.verifiable !== false,
      type: clip(asString(rec.type), 40),
    });
  }
  for (const item of asArray(nonVerifiableAtoms)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = asString(rec.text).trim();
    if (!text) continue;
    const key = keyFn(text);
    if (!map.has(key)) {
      map.set(key, { verifiable: false, type: clip(asString(rec.type), 40) });
    }
  }
  return map;
}

function readBundle(
  raw: unknown,
  keyFn: (s: string) => string
): {
  searchedKeys: Set<string>;
  /** byAtomKey 里出现过的键（含空列表）：空列表 = 检索过但零命中，仍要拦幻觉 URL。 */
  allowKeys: Set<string>;
  perAtom: Map<string, Array<{ url: string; title: string; snippet: string }>>;
} {
  const rec = asRecord(raw);
  const searchedKeys = new Set<string>();
  const allowKeys = new Set<string>();
  const perAtom = new Map<string, Array<{ url: string; title: string; snippet: string }>>();
  if (!rec) return { searchedKeys, allowKeys, perAtom };
  for (const atom of asArray(rec.atomsSearched)) {
    if (typeof atom === "string" && atom.trim()) searchedKeys.add(keyFn(atom));
  }
  const byAtomKey = asRecord(rec.byAtomKey);
  if (byAtomKey) {
    for (const [key, list] of Object.entries(byAtomKey)) {
      allowKeys.add(key);
      const sources = asArray(list)
        .map(asRecord)
        .filter((s): s is Record<string, unknown> => s !== null)
        .map((s) => ({
          url: asString(s.url).trim(),
          title: clip(asString(s.title), 200),
          snippet: clip(asString(s.snippet), 320),
        }))
        .filter((s) => isHttpUrl(s.url));
      if (sources.length > 0) perAtom.set(key, sources);
    }
  }
  return { searchedKeys, allowKeys, perAtom };
}

function readCrossExam(
  raw: unknown,
  keyFn: (s: string) => string
): Map<string, { response: string; status: string }> {
  const rec = asRecord(raw);
  const out = new Map<string, { response: string; status: string }>();
  if (!rec) return out;
  for (const item of asArray(rec.atoms)) {
    const atomRec = asRecord(item);
    if (!atomRec) continue;
    const atom = asString(atomRec.atom).trim();
    if (!atom) continue;
    out.set(keyFn(atom), {
      response: clip(asString(atomRec.response), 300),
      status: asString(atomRec.status),
    });
  }
  return out;
}

function readPursuitHops(
  raw: unknown,
  keyFn: (s: string) => string
): Map<string, { goal: string; missingAfter: string[] }> {
  const out = new Map<string, { goal: string; missingAfter: string[] }>();
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const atom = asString(rec.atom).trim();
    if (!atom) continue;
    const missingAfter = asArray(rec.missingAfter)
      .map((m) => clip(asString(m), 40))
      .filter((m) => m.length > 0);
    if (missingAfter.length === 0) continue;
    out.set(keyFn(atom), {
      goal: clip(asString(rec.goal), 80),
      missingAfter,
    });
  }
  return out;
}

function verdictToJudgment(verdict: string): InvestigationJudgment | null {
  switch (verdict) {
    case "true":
      return "supported";
    case "false":
      return "refuted";
    case "partial":
    case "exaggerated":
      return "mixed";
    case "unverified":
      return "unresolved";
    default:
      return null;
  }
}

function progressFor(
  phase: InvestigationPhase,
  searched: boolean,
  judged: boolean
): InvestigationProgress {
  if (phase === "complete") return "complete";
  if (phase === "interrupted") return judged ? "complete" : "interrupted";
  if (phase === "received" || phase === "decomposed") return "pending";
  return searched ? "searching" : "pending";
}

/**
 * 构建 InvestigationSnapshotV1。纯函数、确定性；输出先过 schema 校验再返回。
 */
export function buildInvestigationSnapshot(
  input: InvestigationBuildInput,
  options: InvestigationBuildOptions = {}
): InvestigationSnapshotV1 {
  const keyFn = options.claimAtomKeyFn ?? defaultClaimAtomKey;
  const phase = input.phase;
  const originalClaim = input.originalClaim;

  const atoms: string[] = [];
  const seenAtom = new Set<string>();
  for (const item of asArray(input.claimAtoms)) {
    if (typeof item !== "string") continue;
    const key = keyFn(item.trim());
    if (!key || seenAtom.has(key)) continue;
    seenAtom.add(key);
    atoms.push(key);
  }

  const types = readAtomTypes(input.claimAtomTypes, input.nonVerifiableAtoms, keyFn);
  const verdicts = readVerdicts(input.subclaimVerdicts, keyFn);
  const bundle = readBundle(input.atomSearchBundle, keyFn);
  const crossExamAtoms = readCrossExam(input.crossExam, keyFn);
  const pursuitByAtom = readPursuitHops(input.pursuitHops, keyFn);
  const report = asRecord(input.report);
  const deadUrls = new Set(asArray(input.reachability?.deadUrls).map((u) => asString(u)));

  // 判词纪律兜底（与生产 demoteUnsourcedTrueFalse 同向）：true/false 无已绑定来源 → unresolved。
  // 先算链接再定判词，所以分两步：先收集每条 claim 的原始来源引用，再统一装配。
  type ClaimAssembly = {
    key: string;
    text: string;
    order: number;
    checkability: InvestigationCheckability;
    support: Array<{ url: string; title: string; snippet: string }>;
    contradict: Array<{ url: string; title: string; snippet: string }>;
    relatedOnly: boolean;
    verdict: VerdictLike | undefined;
  };

  const assemblies: ClaimAssembly[] = atoms.map((key, index) => {
    const verdict = verdicts.get(key);
    const info = types.get(key);
    const checkability: InvestigationCheckability =
      info && info.verifiable === false ? "not-applicable" : "checkable";
    const allowed = bundle.perAtom.get(key) ?? (bundle.allowKeys.has(key) ? [] : undefined);
    const inBundle = (list: VerdictSourceLike[]): Array<{ url: string; title: string; snippet: string }> => {
      const out: Array<{ url: string; title: string; snippet: string }> = [];
      const seen = new Set<string>();
      for (const s of list) {
        const url = asString(s.url).trim();
        if (!isHttpUrl(url) || seen.has(url)) continue;
        if (allowed && !allowed.some((a) => a.url === url)) continue; // 幻觉 URL 拦截
        seen.add(url);
        out.push({ url, title: clip(asString(s.title), 200), snippet: clip(asString(s.snippet), 320) });
      }
      return out;
    };
    const support = verdict ? inBundle(verdict.supportingSources) : [];
    const contradict = verdict ? inBundle(verdict.contradictingSources) : [];
    return {
      key,
      text: key,
      order: index,
      checkability,
      support,
      contradict,
      relatedOnly: verdict?.sourcesRelatedOnly === true,
      verdict,
    };
  });

  // 来源登记：证据位来源先注册（按 claim 序），检索垫其余来源随后。
  const sources: InvestigationSource[] = [];
  const sourceIdByUrl = new Map<string, string>();
  const registerSource = (s: { url: string; title: string; snippet: string }): string => {
    const existing = sourceIdByUrl.get(s.url);
    if (existing) return existing;
    const id = `src-${sources.length + 1}`;
    sourceIdByUrl.set(s.url, id);
    sources.push({
      id,
      url: s.url,
      title: s.title,
      ...(s.snippet ? { excerpt: s.snippet } : {}),
      ...(deadUrls.has(s.url) ? { reachable: false } : {}),
    });
    return id;
  };

  for (const a of assemblies) {
    for (const s of a.support) registerSource(s);
    for (const s of a.contradict) registerSource(s);
  }
  for (const a of assemblies) {
    for (const s of bundle.perAtom.get(a.key) ?? []) registerSource(s);
  }

  const claims: InvestigationClaim[] = assemblies.map((a) => {
    const verdict = a.verdict;
    const evidence: InvestigationEvidenceLink[] = [];
    if (verdict) {
      // 支持位：related-only 的检索填充绝不映射为 support。
      for (const s of a.support) {
        const role = a.relatedOnly ? "context-only" : "support";
        evidence.push({
          sourceId: sourceIdByUrl.get(s.url)!,
          role,
          ...(role === "support" && verdict.evidence ? { finding: verdict.evidence } : {}),
        });
      }
      if (a.relatedOnly && a.support.length > 0 && verdict.evidence) {
        // 相关检索的说明文字挂在第一个 context-only link 上，不重复每条。
        const first = evidence.find((l) => l.role === "context-only");
        if (first) first.finding = verdict.evidence;
      }
      for (const s of a.contradict) {
        evidence.push({ sourceId: sourceIdByUrl.get(s.url)!, role: "contradict" });
      }
      // 已核查命题：检索垫其余来源只是背景材料，不得残留 unassessed。
      for (const s of bundle.perAtom.get(a.key) ?? []) {
        if (sourceIdByUrl.get(s.url) && evidence.some((l) => l.sourceId === sourceIdByUrl.get(s.url))) continue;
        evidence.push({ sourceId: sourceIdByUrl.get(s.url)!, role: "context-only" });
      }
    } else if (bundle.searchedKeys.has(a.key)) {
      // 检索已返回、核查未开始：只能是 unassessed 暂态。
      for (const s of bundle.perAtom.get(a.key) ?? []) {
        evidence.push({ sourceId: sourceIdByUrl.get(s.url)!, role: "unassessed" });
      }
    }

    // 判断：not-applicable 即刻成立；判词映射；true/false 无绑定来源按生产规则收敛 unresolved。
    let judgment: InvestigationJudgment | null;
    if (a.checkability === "not-applicable") {
      judgment = "not-applicable";
    } else if (verdict) {
      const mapped = verdictToJudgment(verdict.verdict);
      if (mapped === "supported" && a.support.length === 0) judgment = "unresolved";
      else if (mapped === "refuted" && a.contradict.length === 0) judgment = "unresolved";
      else judgment = mapped;
    } else {
      judgment = null;
    }

    const gaps: InvestigationGap[] = [];
    const pursuit = pursuitByAtom.get(a.key);
    let consequence: string | undefined;
    if (pursuit) {
      const goalPart = pursuit.goal ? `证据追索以「${pursuit.goal}」为目标补查` : "证据追索已补查";
      consequence = clip(`${goalPart}，仍缺 ${pursuit.missingAfter.join("、")}`, 160);
    }
    const seenGap = new Set<string>();
    for (const g of verdict?.evidenceGaps ?? []) {
      if (seenGap.has(g)) continue;
      seenGap.add(g);
      gaps.push({
        id: `gap-${a.order + 1}-${gaps.length + 1}`,
        claimId: `claim-${a.order + 1}`,
        description: g,
        status: "open",
        ...(consequence && gaps.length === 0 ? { consequence } : {}),
      });
    }
    // 判词没列缺口但证据追索记录了真实 missingAfter：这是一等缺口，如实立对象。
    if (gaps.length === 0 && pursuit) {
      gaps.push({
        id: `gap-${a.order + 1}-${gaps.length + 1}`,
        claimId: `claim-${a.order + 1}`,
        description: clip(`补查后仍缺：${pursuit.missingAfter.join("、")}`, 160),
        status: "open",
        ...(consequence ? { consequence } : {}),
      });
    }
    for (const link of evidence) {
      const src = sources.find((s) => s.id === link.sourceId);
      if (src?.reachable === false) {
        const description = clip(`来源无法打开：${src.title || src.url}`, 160);
        if (seenGap.has(description)) continue;
        seenGap.add(description);
        gaps.push({
          id: `gap-${a.order + 1}-${gaps.length + 1}`,
          claimId: `claim-${a.order + 1}`,
          description,
          status: "open",
        });
      }
    }

    const span = originalClaim.indexOf(a.text);
    return {
      id: `claim-${a.order + 1}`,
      text: a.text,
      order: a.order,
      ...(span >= 0 ? { originalSpan: { start: span, end: span + a.text.length } } : {}),
      checkability: a.checkability,
      progress: progressFor(phase, bundle.searchedKeys.has(a.key), judgment !== null),
      judgment,
      ...(verdict?.boundary ? { boundary: verdict.boundary } : {}),
      evidence,
      gaps,
    };
  });

  // 冲突：只来自真实证据层（同命题支持与反驳来源并存）；crossExam 只补原因线索。
  const conflicts: InvestigationConflict[] = [];
  for (const claim of claims) {
    const supportIds = claim.evidence.filter((l) => l.role === "support").map((l) => l.sourceId);
    const contradictIds = claim.evidence.filter((l) => l.role === "contradict").map((l) => l.sourceId);
    if (supportIds.length === 0 || contradictIds.length === 0) continue;
    const verdict = verdicts.get(claim.text);
    const cross = verdict ? crossExamAtoms.get(verdict.claimAtom) : undefined;
    const knownReason = cross && cross.status === "answered" && cross.response ? cross.response : "";
    conflicts.push({
      id: `conflict-${claim.order + 1}`,
      claimId: claim.id,
      summary: `同一命题同时存在支持与反驳证据：支持 ${supportIds.length} 条、反驳 ${contradictIds.length} 条`,
      sides: [
        { position: "support", sourceIds: supportIds },
        { position: "contradict", sourceIds: contradictIds },
      ],
      ...(knownReason ? { reason: knownReason } : {}),
      reasonStatus: knownReason ? "known" : "unknown",
      unresolved: true,
    });
  }

  let conclusion: InvestigationSnapshotV1["conclusion"];
  if (phase === "complete" && report) {
    const directAnswer = clip(asString(report.conclusion), 400);
    if (directAnswer) {
      const hasCheckable = claims.some((c) => c.checkability !== "not-applicable");
      const overall = asString(report.verdictType).trim().toLowerCase();
      const overallJudgment: InvestigationJudgment = !hasCheckable
        ? "not-applicable"
        : overall === "true"
          ? "supported"
          : overall === "false"
            ? "refuted"
            : overall === "mixed_misleading" || overall === "partial"
              ? "mixed"
              : "unresolved";
      const citedUrls = new Set(
        asArray(report.citationSources)
          .map((s) => asRecord(s))
          .filter((s): s is Record<string, unknown> => s !== null)
          .map((s) => asString(s.url).trim())
      );
      const boundaries: string[] = [];
      const seenBoundary = new Set<string>();
      for (const claim of claims) {
        const b = claim.boundary;
        if (!b || seenBoundary.has(b)) continue;
        seenBoundary.add(b);
        boundaries.push(b);
      }
      const causal = clip(asString(report.causalBoundary), 200);
      if (causal && !seenBoundary.has(causal)) boundaries.push(causal);
      conclusion = {
        directAnswer,
        judgment: overallJudgment,
        boundaries,
        claimIds: claims.map((c) => c.id),
        sourceIds: sources.filter((s) => citedUrls.has(s.url)).map((s) => s.id),
      };
    }
  }

  const checkedAt =
    input.checkedAt ?? (report && typeof report.checkedAt === "string" ? report.checkedAt : undefined);

  return validateInvestigationSnapshot({
    schemaVersion: 1,
    originalClaim,
    phase,
    claims,
    sources,
    conflicts,
    ...(conclusion ? { conclusion } : {}),
    ...(checkedAt ? { checkedAt } : {}),
  });
}

/**
 * 旧历史报告 → Snapshot 的确定性重建。缺字段表达 unresolved/unknown，
 * 不启动模型或搜索、不伪造新事实；`_source === 'error-boundary'` 重建为 interrupted。
 */
export function rebuildInvestigationFromReport(input: {
  report: unknown;
  claim: string;
  options?: InvestigationBuildOptions;
}): InvestigationSnapshotV1 {
  const report = asRecord(input.report) ?? {};
  const interrupted = report._source === "error-boundary";

  // 命题顺序取 claimItems（含立场条交错）；没有 claimItems 的旧数据回退 subclaimVerdicts + nonVerifiableAtoms。
  let atoms: string[] = [];
  let types: Array<{ text: string; verifiable: boolean; type: string }> = [];
  const claimItems = asArray(report.claimItems);
  if (claimItems.length > 0) {
    for (const item of claimItems) {
      const rec = asRecord(item);
      if (!rec) continue;
      const text = asString(rec.text).trim();
      if (!text) continue;
      atoms.push(text);
      types.push({ text, verifiable: rec.verifiable !== false, type: clip(asString(rec.type), 40) });
    }
  }
  if (atoms.length === 0) {
    for (const v of asArray(report.subclaimVerdicts)) {
      const rec = asRecord(v);
      if (!rec) continue;
      const text = asString(rec.claimAtom).trim();
      if (!text) continue;
      atoms.push(text);
      types.push({ text, verifiable: true, type: "" });
    }
    for (const n of asArray(report.nonVerifiableAtoms)) {
      const rec = asRecord(n);
      if (!rec) continue;
      const text = asString(rec.text).trim();
      if (!text) continue;
      atoms.push(text);
      types.push({ text, verifiable: false, type: clip(asString(rec.type), 40) });
    }
  }

  const pursuitHops = asRecord(report.evidencePursuit)?.hops;

  return buildInvestigationSnapshot(
    {
      originalClaim: input.claim,
      phase: interrupted ? "interrupted" : "complete",
      claimAtoms: atoms,
      claimAtomTypes: types,
      subclaimVerdicts: report.subclaimVerdicts,
      crossExam: report.crossExam,
      pursuitHops,
      report,
    },
    input.options
  );
}
