import type { BiasAuditFinding, GradedEvidence, Subclaim } from "./schemas";

function finding(
  id: string,
  label: string,
  severity: BiasAuditFinding["severity"],
  explanation: string,
  mitigation: string,
  affectedSubclaimId?: string
): BiasAuditFinding {
  return { id, label, severity, explanation, mitigation, affectedSubclaimId };
}

export function auditGradeBiases(grade: GradedEvidence, subclaim: Subclaim): BiasAuditFinding[] {
  const findings: BiasAuditFinding[] = [];

  if (subclaim.type === "因果" && grade.usageLevel !== "主证据") {
    findings.push(
      finding(
        `correlation-${subclaim.id}-${grade.candidateId}`,
        "相关不等于因果",
        "high",
        "该子命题包含因果表述，但当前材料最多支持相关或背景解释。",
        "结论必须降级为“可能相关/证据不足”，并补充时间顺序、替代解释和反事实材料。",
        subclaim.id
      )
    );
  }

  if (grade.scores.independence === "低") {
    findings.push(
      finding(
        `confirmation-${subclaim.id}-${grade.candidateId}`,
        "确认偏误风险",
        "medium",
        "证据独立性低，可能只是同一叙事的重复传播。",
        "继续寻找不同机构、不同数据口径或反向结论来源。",
        subclaim.id
      )
    );
  }

  if (grade.evidenceRole === "支持" && grade.sourceQuality && grade.sourceQuality.tier >= 5) {
    findings.push(
      finding(
        `source-tier-${subclaim.id}-${grade.candidateId}`,
        "弱来源放大风险",
        "medium",
        "低等级来源正在支持关键判断，容易把社交传播当作事实证据。",
        "只作为线索使用，不能进入最终主结论。",
        subclaim.id
      )
    );
  }

  return findings;
}

export function summarizeBiasFindings(grades: GradedEvidence[]): BiasAuditFinding[] {
  const allFindings = grades.flatMap((grade) => grade.biasFindings ?? []);
  const seen = new Set<string>();
  return allFindings.filter((item) => {
    const key = `${item.label}-${item.affectedSubclaimId ?? ""}-${item.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function toText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (isRecord(value)) {
    return (
      toText(value.label) ||
      toText(value.risk) ||
      toText(value.warning) ||
      toText(value.issue) ||
      toText(value.text) ||
      toText(value.reason) ||
      toText(value.explanation)
    );
  }
  return "";
}

function normalizeSeverity(value: unknown, fallback: BiasAuditFinding["severity"]): BiasAuditFinding["severity"] {
  if (value === "high" || value === "medium" || value === "low") return value;
  if (value === "高" || value === "严重") return "high";
  if (value === "中" || value === "中等") return "medium";
  if (value === "低" || value === "轻微") return "low";
  return fallback;
}

function normalizeFinding(
  value: unknown,
  index: number,
  sourceKey: string,
  fallbackLabel: string,
  fallbackSeverity: BiasAuditFinding["severity"],
  agentId?: string
): BiasAuditFinding | null {
  const record = isRecord(value) ? value : null;
  const label = (record ? toText(record.label) : "") || fallbackLabel;
  const explanation = record
    ? toText(record.explanation) ||
      toText(record.risk) ||
      toText(record.warning) ||
      toText(record.issue) ||
      toText(record.text) ||
      toText(record.reason) ||
      label
    : toText(value);
  if (!explanation) return null;

  return {
    id: `agent-${agentId ?? "unknown"}-${sourceKey}-${index}`,
    label,
    severity: normalizeSeverity(record?.severity, fallbackSeverity),
    explanation,
    mitigation:
      (record ? toText(record.mitigation) : "") ||
      (sourceKey === "cannotInfer" || sourceKey === "doNotInfer"
        ? "在结论中显式禁止该推断，并补充更直接的证据。"
        : "降低结论强度，并补充独立来源、反向证据或原始材料。"),
    affectedSubclaimId: record ? toText(record.affectedSubclaimId) || undefined : undefined,
  };
}

export function normalizeAgentBiasFindings(
  output: unknown,
  context: { agentId?: string } = {}
): BiasAuditFinding[] {
  if (!isRecord(output)) return [];

  const sources: Array<{
    key: string;
    label: string;
    severity: BiasAuditFinding["severity"];
  }> = [
    { key: "logicRiskItems", label: "逻辑风险", severity: "medium" },
    { key: "logicRisks", label: "逻辑风险", severity: "medium" },
    { key: "biasWarnings", label: "偏差警告", severity: "medium" },
    { key: "cannotInfer", label: "禁止推断", severity: "high" },
    { key: "doNotInfer", label: "禁止推断", severity: "high" },
  ];

  const findings = sources.flatMap((source) =>
    toArray(output[source.key])
      .map((item, index) =>
        normalizeFinding(item, index, source.key, source.label, source.severity, context.agentId)
      )
      .filter((item): item is BiasAuditFinding => item !== null)
  );

  const seen = new Set<string>();
  return findings.filter((item) => {
    const key = `${item.label}-${item.explanation}-${item.severity}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
