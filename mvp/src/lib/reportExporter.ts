import type { DemoCase, FinalReport, RebuttalCard } from "./schemas";
import type { ReasoningState } from "../store/reasoningStore";

export type VerificationResult = "true" | "false" | "partial" | "unknown";

export interface CredibilityBreakdown {
  score: number;
  label: string;
  factors: { factor: string; impact: number }[];
}

export function calculateCredibilityScore(
  caseData: DemoCase,
  report: FinalReport
): CredibilityBreakdown {
  const factors: { factor: string; impact: number }[] = [];
  let score = 50; // 起始中性分

  // 1. 谣言特征扣分
  const indicatorCount = caseData.diagnosis.rumorIndicators?.length ?? 0;
  const indicatorPenalty = indicatorCount * 8;
  score -= indicatorPenalty;
  factors.push({
    factor: `检测到 ${indicatorCount} 个谣言特征`,
    impact: -indicatorPenalty,
  });

  // 2. 子命题覆盖加分
  const exploredCount = report.subclaimStatuses.length;
  const totalCount = caseData.subclaims.length;
  const coverageBonus = Math.round((exploredCount / Math.max(totalCount, 1)) * 15);
  score += coverageBonus;
  factors.push({
    factor: `子命题核查覆盖率 ${Math.round((exploredCount / Math.max(totalCount, 1)) * 100)}%`,
    impact: coverageBonus,
  });

  // 3. 证据链完整度
  const hasMainEvidence = report.evidenceChain.some((e) => e.includes("主证据"));
  const hasCounterEvidence = report.evidenceChain.some((e) => e.includes("反证"));
  const evidenceBonus = (hasMainEvidence ? 8 : 0) + (hasCounterEvidence ? 7 : 0);
  score += evidenceBonus;
  factors.push({
    factor: hasMainEvidence && hasCounterEvidence
      ? "证据链包含主证据与反证"
      : hasMainEvidence
        ? "证据链包含主证据"
        : "证据链待补充",
    impact: evidenceBonus,
  });

  // 4. 可信度评级
  const clamped = Math.max(0, Math.min(100, score));
  let label = "无法核实";
  if (clamped <= 20) label = "疑似谣言";
  else if (clamped <= 40) label = "高度可疑";
  else if (clamped <= 60) label = "部分可信";
  else if (clamped <= 80) label = "基本可信";
  else label = "可信";

  return { score: clamped, label, factors };
}

export function getVerificationLabel(result: VerificationResult): string {
  switch (result) {
    case "true":
      return "真";
    case "false":
      return "假";
    case "partial":
      return "部分真";
    case "unknown":
    default:
      return "无法核实";
  }
}

export function getVerificationColor(result: VerificationResult): string {
  switch (result) {
    case "true":
      return "#16a766";
    case "false":
      return "#fb4c2f";
    case "partial":
      return "#ffad47";
    case "unknown":
    default:
      return "#999999";
  }
}

export function exportToMarkdown(
  report: FinalReport,
  caseData: DemoCase,
  verificationResult?: VerificationResult
): string {
  const now = new Date().toLocaleString("zh-CN");
  const credibility = calculateCredibilityScore(caseData, report);

  const sections = [
    "# 红鲱鱼与枪 — 核查报告",
    `\n生成时间：${now}`,
    `\n---\n`,

    "## 一、待核查信息",
    `\n**原始信息**：${report.originalClaim}`,
    `**传播场景**：${caseData.useContext}`,
    `**谣言类型**：${caseData.rumorType ?? "未分类"}`,

    `\n---\n`,

    "## 二、谣言特征检测",
    ...(caseData.diagnosis.rumorIndicators?.length
      ? [
          `\n检测到 **${caseData.diagnosis.rumorIndicators.length}** 个谣言特征：`,
          ...caseData.diagnosis.rumorIndicators.map((ri) => `- ${ri}`),
        ]
      : ["\n未检测到明显的谣言特征。"]),
    `\n**风险描述**：${caseData.diagnosis.risk}`,

    `\n---\n`,

    "## 三、核查维度与结论",
    `\n**总体评估**：${credibility.label}（可信度 ${credibility.score}%）`,
    ...(verificationResult
      ? [`**人工判定**：${getVerificationLabel(verificationResult)}`]
      : []),
    `\n### 子命题核查状态`,
    ...report.subclaimStatuses.map((s) => {
      const evidenceList = s.usableEvidence.length
        ? `\n   - 可用证据：${s.usableEvidence.join("；")}`
        : "";
      const blockedList = s.cannotInfer.length
        ? `\n   - 不可推断：${s.cannotInfer.join("；")}`
        : "";
      return `- **${s.subclaimId}** ${s.subclaim}\n   - 状态：${s.status}${evidenceList}${blockedList}`;
    }),

    `\n---\n`,

    "## 四、证据链",
    ...report.evidenceChain.map((e) => `- ${e}`),

    `\n---\n`,

    "## 五、不可做出的推断",
    ...report.doNotInfer.map((d) => `- ${d}`),

    `\n---\n`,

    "## 六、建议改写",
    `\n**谨慎版**：${report.rewrittenClaim.cautious}`,
    `**面向公众版**：${report.rewrittenClaim.publicFacing}`,
    `**研究备忘录版**：${report.rewrittenClaim.researchMemo}`,

    `\n---\n`,

    "## 七、下一步需补充的证据",
    ...report.nextEvidenceNeeded.map((n) => `- ${n}`),

    `\n---\n`,

    "*本报告由 红鲱鱼与枪 自动生成，仅供参考。关键结论请以权威信源为准。*",
  ];

  return sections.join("\n");
}

export interface ClosureReportPayload {
  claim: string;
  conclusion: string;
  credibilityScore: number;
  credibilityLabel: string;
  summaryForPublic: string;
  sources: string[];
}

export interface DoubtfulArchiveEntry extends ClosureReportPayload {
  id: string;
  archivedAt: number;
  note: string;
}

export interface ShareLogEntry {
  id: string;
  claim: string;
  sharedAt: number;
  channel: "native-share" | "clipboard";
}

const QUESTIONABLE_ARCHIVE_KEY = "reasoning-v3-questionable-archives";
const SHARE_LOG_KEY = "reasoning-v3-share-log";

function readLocalList<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

function writeLocalList<T>(key: string, value: T[]) {
  localStorage.setItem(key, JSON.stringify(value));
}

export function buildRebuttalCard(payload: ClosureReportPayload): RebuttalCard {
  const color =
    payload.credibilityScore >= 60
      ? "#16a766"
      : payload.credibilityScore >= 40
        ? "#d97706"
        : "#fb4c2f";
  return {
    title: `核查：${payload.claim.slice(0, 36)}`,
    verdict: payload.credibilityLabel,
    color,
    keyPoints: [
      payload.conclusion,
      payload.summaryForPublic,
      payload.sources[0] ? `可复核来源：${payload.sources[0]}` : "仍需补充权威来源。",
    ].filter(Boolean).slice(0, 3),
    sourceRef: `红鲱鱼与枪核查 · ${new Date().toLocaleString("zh-CN")}`,
  };
}

export function buildRebuttalCardMarkdown(payload: ClosureReportPayload): string {
  const card = buildRebuttalCard(payload);
  return [
    "# 红鲱鱼与枪 — 辟谣卡片",
    "",
    `## ${card.title}`,
    "",
    `**结论**：${card.verdict}（可信度 ${payload.credibilityScore}%）`,
    "",
    "### 核心要点",
    ...card.keyPoints.map((point) => `- ${point}`),
    "",
    "### 可复核来源",
    ...(payload.sources.length > 0 ? payload.sources.map((source) => `- ${source}`) : ["- 暂无可复核来源，建议继续补证。"]),
    "",
    `> ${card.sourceRef}`,
  ].join("\n");
}

export function archiveDoubtful(payload: ClosureReportPayload): DoubtfulArchiveEntry {
  const entry: DoubtfulArchiveEntry = {
    ...payload,
    id: `questionable-${Date.now()}`,
    archivedAt: Date.now(),
    note: "questionable",
  };
  const existing = readLocalList<DoubtfulArchiveEntry>(QUESTIONABLE_ARCHIVE_KEY);
  const deduped = existing.filter((item) => item.claim !== payload.claim);
  writeLocalList(QUESTIONABLE_ARCHIVE_KEY, [entry, ...deduped].slice(0, 80));
  return entry;
}

export function getDoubtfulArchiveCount(): number {
  return readLocalList<DoubtfulArchiveEntry>(QUESTIONABLE_ARCHIVE_KEY).length;
}

export async function shareVerification(payload: ClosureReportPayload): Promise<ShareLogEntry> {
  const shareText = [
    `红鲱鱼与枪核查：${payload.claim}`,
    `结论：${payload.credibilityLabel}（${payload.credibilityScore}%）`,
    payload.summaryForPublic,
  ].join("\n");
  let channel: ShareLogEntry["channel"] = "clipboard";

  if (navigator.share) {
    try {
      await navigator.share({
        title: "红鲱鱼与枪核查结果",
        text: shareText,
      });
      channel = "native-share";
    } catch {
      await copyToClipboard(shareText);
    }
  } else {
    await copyToClipboard(shareText);
  }

  const entry: ShareLogEntry = {
    id: `share-${Date.now()}`,
    claim: payload.claim,
    sharedAt: Date.now(),
    channel,
  };
  const existing = readLocalList<ShareLogEntry>(SHARE_LOG_KEY);
  writeLocalList(SHARE_LOG_KEY, [entry, ...existing].slice(0, 80));
  return entry;
}

export function exportToJSON(state: ReasoningState): string {
  const exportData = {
    originalClaim: state.originalClaim,
    diagnosis: state.diagnosis,
    report: state.report,
    exploredSubclaimCount: state.exploredSubclaimCount,
    totalSubclaimCount: state.totalSubclaimCount,
    agentRuns: state.agentRuns.map((r) => ({
      id: r.id,
      nodeTitle: r.nodeTitle,
      mode: r.mode,
      agents: r.agents,
      sources: r.sources,
      model: r.model,
    })),
    timestamp: new Date().toISOString(),
  };
  return JSON.stringify(exportData, null, 2);
}

export function copyToClipboard(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
