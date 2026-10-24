/**
 * 结果页要的几样推导：用户看到的原句、图片里读出的文字、整句结论怎么从各点推出来（verdict.ts 的规则）。
 */
import type { InvestigationSnapshotV1 } from "@shared/investigation/schema";
import { decideSentenceVerdict, standingForJudgment, type PartRole, type PartStanding, type VerdictRule } from "@shared/domain/verdict";
import { labelText, type LabelKey } from "@shared/domain/labels";
import { claimAtomKey } from "@shared/claimAtomText";
import { displayFollowUpClaim } from "@shared/followUp";
import type { RunData, StreamEvent } from "./types";
import { scrubList } from "./scrub";

const IMAGE_PREFIX = "请核查用户上传的";
const MATERIAL_MARK = "【用户上传材料的真实工具预处理结果】";

export type ImageReading = { ocrTexts: string[]; summary: string };

/** 视觉预处理结果：新流程在事件流（query=图片材料解析 的 tool_result），老记录只写进了原句。 */
export function imageReading(snapshot: InvestigationSnapshotV1 | null, events: StreamEvent[]): ImageReading | null {
  const fromEvent = events.find((event) => event.type === "tool_result" && event.query === "图片材料解析")?.result;
  const raw = fromEvent ?? parseEmbeddedReading(snapshot?.originalClaim ?? "");
  if (!raw) return null;
  const ocrTexts = scrubList(raw.ocrTexts);
  const summary = typeof raw.visualSummary === "string" ? raw.visualSummary.trim() : "";
  if (ocrTexts.length === 0 && !summary) return null;
  return { ocrTexts, summary };
}

function parseEmbeddedReading(originalClaim: string): Record<string, unknown> | null {
  const at = originalClaim.indexOf(MATERIAL_MARK);
  if (at < 0) return null;
  const rest = originalClaim.slice(at);
  const start = rest.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < rest.length; i += 1) {
    if (rest[i] === "{") depth += 1;
    if (rest[i] === "}") depth -= 1;
    if (depth === 0) {
      try {
        return JSON.parse(rest.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** 用户提交的那句话：内部拼进去的材料说明不显示；只交了图片时显示「上传的图片」。 */
export function displayClaim(originalClaim: string): { text: string; fromImage: boolean } {
  const own = displayFollowUpClaim(originalClaim.split(MATERIAL_MARK)[0]!.trim());
  if (own.startsWith(IMAGE_PREFIX)) return { text: "上传的图片", fromImage: true };
  return { text: own, fromImage: false };
}

/** 历史列表里的一行：只交了图片时，带上图里读出的第一行字，好认。 */
export function historyClaimText(claim: string): string {
  const shown = displayClaim(claim);
  const first = shown.fromImage ? scrubList(parseEmbeddedReading(claim)?.ocrTexts)[0] : "";
  return first ? `${shown.text}：${first}` : shown.text;
}

type Part = { key: string; text: string; role: PartRole; standing: PartStanding; label?: LabelKey };

/** 各点的角色与证据状态：优先读后端写进报告的判定记录，没有就按快照现推（角色都当主要说法）。 */
export function verdictParts(run: Pick<RunData, "snapshot" | "verdictDecision">): { rule: VerdictRule; parts: Part[] } | null {
  const snapshot = run.snapshot;
  if (!snapshot) return null;
  const record = run.verdictDecision;
  if (record?.rule && Array.isArray(record.parts)) {
    return {
      rule: record.rule,
      parts: record.parts.map((p) => ({ key: claimAtomKey(p.text), text: p.text, role: p.role, standing: p.standing, label: p.label })),
    };
  }
  const parts: Part[] = snapshot.claims
    .filter((claim) => claim.checkability === "checkable" && claim.judgment && claim.judgment !== "not-applicable")
    .map((claim) => ({ key: claimAtomKey(claim.text), text: claim.text, role: "main", standing: standingForJudgment(claim.judgment) }));
  return { rule: decideSentenceVerdict(parts).rule, parts };
}

export function roleOf(run: Pick<RunData, "snapshot" | "verdictDecision">, claimText: string): PartRole | null {
  return verdictParts(run)?.parts.find((p) => p.key === claimAtomKey(claimText))?.role ?? null;
}

export const ROLE_TEXT: Record<PartRole, string> = { main: "主要说法", premise: "前提", background: "背景" };

const quote = (parts: Part[]) => parts.map((p) => `「${p.text}」`).join("和");

/** 一句大白话：整句结论是怎么从各点推出来的。规则见 apps/shared/domain/verdict.ts。 */
export function derivationSentence(rule: VerdictRule, parts: Part[], label: LabelKey): string {
  const mains = parts.filter((p) => p.role === "main");
  const mainList = mains.length ? mains : parts;
  const premises = parts.filter((p) => p.role === "premise");
  const pick = (list: Part[], standing: PartStanding | PartStanding[]) =>
    list.filter((p) => (Array.isArray(standing) ? standing : [standing]).includes(p.standing));
  const end = `所以整句是「${labelText(label)}」。`;
  const or = (list: Part[], fallback: string) => (list.length ? quote(list) : fallback);
  switch (rule) {
    case "all-supported":
      return `每一点都有材料支持，没有哪一点被反驳，${end}`;
    case "background-refuted":
      return `主要说法有材料支持，只有顺带提到的背景${or(pick(parts.filter((p) => p.role === "background"), "refuted"), "")}被反驳，${end}`;
    case "parallel-true-and-false":
      return `这句话并列说了几件事：${or(pick(mainList, "supported"), "其中一点")}有材料支持，${or(pick(mainList, "refuted"), "另一点")}被材料反驳，${end}`;
    case "premise-refuted":
      return `这句话要成立，得先有${or(pick(premises, "refuted"), "一个前提")}，可这个前提被材料反驳了；${or(pick(parts, "supported"), "其余部分")}虽然有材料支持，${end}`;
    case "premise-refuted-nothing-true":
      return `这句话要成立，得先有${or(pick(premises, "refuted"), "一个前提")}，可这个前提被材料反驳了，其余的点也没有一点被证实，${end}`;
    case "main-refuted":
      return `这句话最想让人相信的${or(pick(mainList, "refuted"), "那一点")}被材料反驳了，${end}`;
    case "main-partial":
      return `这句话最想让人相信的${or(pick(mainList, "partial"), "那一点")}只有一部分站得住，${end}`;
    case "premise-partial":
      return `主要说法有材料支持，但它依赖的前提${or(pick(premises, "partial"), "")}只对了一部分，${end}`;
    case "main-unresolved":
      return `这句话最想让人相信的${or(pick(mainList, "unresolved"), "那一点")}这次没找到能下定论的材料，${end}`;
    case "premise-unresolved":
      return `主要说法有材料支持，但它依赖的前提${or(pick(premises, ["unresolved", "conflicting"]), "")}还没查清，${end}`;
    case "main-conflicting":
      return `关于${or(pick(mainList, "conflicting"), "这句话的主要说法")}，权威来源之间说法互相矛盾，${end}`;
    case "no-checkable-claim":
      return `这句话里没有能拿事实核对的说法，${end}`;
  }
}
