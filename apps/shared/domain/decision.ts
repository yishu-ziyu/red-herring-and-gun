/**
 * 整句判定写进报告的那份记录：规则表的结论、整句标签与理由、每一截显示出来的标签与理由。
 * 服务端判定后写入（attachVerdictRecord），快照构建读取（readVerdictRecord）；两边只通过这份记录说话。
 */
import { claimAtomKey } from "../claimAtomText.js";
import { isLabelKey, type LabelKey } from "./labels.js";
import type { PartRole, PartStanding, SentenceVerdict, VerdictRule } from "./verdict.js";

const RECORD_FIELD = "_verdictDecision";

export type DecidedPart = {
  text: string;
  role: PartRole;
  standing: PartStanding;
  /** 这一截显示的标签（已按证据撑不撑得住调整过）与一句理由。 */
  label?: LabelKey;
  reason?: string;
  issuerMisattributed?: boolean;
};

export type VerdictRecord = {
  verdict: SentenceVerdict;
  rule: VerdictRule;
  label: LabelKey;
  reason: string;
  parts: DecidedPart[];
};

export function attachVerdictRecord(report: Record<string, unknown>, record: VerdictRecord): void {
  report[RECORD_FIELD] = record;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const ROLES: readonly string[] = ["main", "premise", "background"];
const STANDINGS: readonly string[] = ["supported", "refuted", "partial", "unresolved", "conflicting"];

/** 读报告里的判定记录。更早版本写的记录可能没有标签，所以标签和理由都是可缺的。 */
export function readVerdictRecord(report: Record<string, unknown> | null) {
  const record = asRecord(report?.[RECORD_FIELD]);
  if (!record) return null;
  const parts = (Array.isArray(record.parts) ? record.parts : [])
    .map(asRecord)
    .filter((p): p is Record<string, unknown> => p !== null && asString(p.text).trim() !== "")
    .map((p) => {
      const text = asString(p.text).trim();
      const reason = asString(p.reason).trim();
      return {
        key: claimAtomKey(text),
        text,
        role: (ROLES.includes(asString(p.role)) ? asString(p.role) : "premise") as PartRole,
        standing: (STANDINGS.includes(asString(p.standing)) ? asString(p.standing) : "unresolved") as PartStanding,
        ...(isLabelKey(p.label) ? { label: p.label } : {}),
        ...(reason ? { reason } : {}),
        ...(p.issuerMisattributed === true ? { issuerMisattributed: true } : {}),
      };
    });
  return {
    label: isLabelKey(record.label) ? record.label : undefined,
    reason: asString(record.reason).trim(),
    parts,
  };
}
