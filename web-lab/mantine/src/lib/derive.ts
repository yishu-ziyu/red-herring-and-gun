/**
 * 结果页要用、但共享层没直接给出的两样：
 * 1. 整句结论怎么从各点推出来——按 domain/verdict.ts 的规则（报告里记了 rule 就用它，老记录按同一张表现算），写成一句大白话；
 * 2. 各点依据正文里的 [n]：编号是这一点自己的来源顺序（先支持、后反驳，见 server citationBinding），在这里对回来源。
 */
import { decideSentenceVerdict, standingForJudgment, type PartRole, type PartStanding, type VerdictRule } from "@shared/domain/verdict.ts";
import { LABEL_TEXT, LABEL_TONE, type LabelKey } from "@shared/domain/labels.ts";
import { claimAtomKey } from "@shared/claimAtomText.ts";
import type { InvestigationSnapshotV1, InvestigationSource } from "@shared/investigation/schema.ts";
import { claimLabel, domainOf, publishedDay } from "@shared/investigation/presentation.ts";
import type { Report } from "./data.ts";
import { plainPart } from "./scrub.ts";

export const TONE_COLOR: Record<"positive" | "mixed" | "negative" | "muted", string> = {
  positive: "teal",
  mixed: "orange",
  negative: "red",
  muted: "gray",
};

export function labelColor(label: LabelKey | null | undefined): string {
  return label ? TONE_COLOR[LABEL_TONE[label]] : "gray";
}

// ── 整句结论怎么推出来 ──

type Part = { text: string; role: PartRole; standing: PartStanding; label: LabelKey | null };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

const RULES: readonly string[] = [
  "main-refuted", "parallel-true-and-false", "main-unresolved", "main-conflicting", "main-partial", "premise-refuted",
  "premise-refuted-nothing-true", "premise-unresolved", "premise-partial", "background-refuted", "all-supported", "no-checkable-claim",
];

/** 报告里的判定记录（rule + 各点角色）；没有就用快照的各点判断按「每一点都是主要说法」现算。 */
export function verdictBasis(snapshot: InvestigationSnapshotV1, report: Report | null): { rule: VerdictRule; parts: Part[]; recorded: boolean } {
  const record = asRecord(report?._verdictDecision);
  const recordParts = Array.isArray(record?.parts) ? (record!.parts as unknown[]).map(asRecord).filter(Boolean) as Record<string, unknown>[] : [];
  if (record && typeof record.rule === "string" && RULES.includes(record.rule) && recordParts.length) {
    return {
      rule: record.rule as VerdictRule,
      recorded: true,
      parts: recordParts.map((p) => ({
        text: plainPart(String(p.text ?? "")),
        role: (["main", "premise", "background"].includes(String(p.role)) ? p.role : "main") as PartRole,
        standing: (["supported", "refuted", "partial", "unresolved", "conflicting"].includes(String(p.standing)) ? p.standing : "unresolved") as PartStanding,
        label: (typeof p.label === "string" ? p.label : null) as LabelKey | null,
      })),
    };
  }
  const checkable = snapshot.claims.filter((c) => c.checkability === "checkable" && c.judgment);
  const parts: Part[] = checkable.map((c) => ({
    text: plainPart(c.text),
    role: "main",
    standing: standingForJudgment(c.judgment),
    label: claimLabel(c),
  }));
  return { rule: decideSentenceVerdict(parts).rule, parts, recorded: false };
}

const q = (text: string) => `「${text}」`;
const joinParts = (parts: Part[]) => parts.map((p) => q(p.text)).join("、");

/** 一句朴素的话：整句结论是怎么从各点推出来的。 */
export function derivationSentence(snapshot: InvestigationSnapshotV1, report: Report | null, wholeLabel: LabelKey): string {
  const { rule, parts } = verdictBasis(snapshot, report);
  const verdict = LABEL_TEXT[wholeLabel];
  const mains = parts.filter((p) => p.role === "main");
  const mainList = mains.length ? mains : parts;
  const premises = parts.filter((p) => p.role === "premise");
  const by = (list: Part[], standing: PartStanding) => list.filter((p) => p.standing === standing);
  const n = parts.length;
  switch (rule) {
    case "all-supported":
      return n > 1 ? `拆出的 ${n} 点都有材料支持，所以整句算${verdict}。` : `这句话的意思有材料支持，所以算${verdict}。`;
    case "background-refuted":
      return `最想让人信的部分有材料支持，只有顺带提到的${joinParts(by(parts.filter((p) => p.role === "background"), "refuted"))}不对，所以整句算${verdict}。`;
    case "main-partial":
      return `最想让人信的${joinParts(by(mainList, "partial"))}只对了一部分，所以整句算${verdict}。`;
    case "premise-partial":
      return `主要说法有材料支持，但它要成立先得有${joinParts(by(premises, "partial"))}，而这一点只对了一部分，所以整句算${verdict}。`;
    case "parallel-true-and-false":
      return `这句话里并列说了几件事：${joinParts(by(mainList, "supported"))}有材料支持，${joinParts(by(mainList, "refuted"))}被材料反驳，有对有错，所以整句算${verdict}。`;
    case "premise-refuted":
      return `这句话要成立，先得有${joinParts(by(premises, "refuted"))}，材料说这一点不对；另有${joinParts(by(parts, "supported"))}是对的，所以整句算${verdict}。`;
    case "main-refuted": {
      const refuted = by(mainList, "refuted");
      return refuted.length > 1
        ? `这句话最想让人信的 ${refuted.length} 点（${joinParts(refuted)}）都被材料反驳了，所以整句算${verdict}。`
        : `这句话最想让人信的${joinParts(refuted)}被材料反驳了，所以整句算${verdict}。`;
    }
    case "premise-refuted-nothing-true":
      return `这句话要成立，先得有${joinParts(by(premises, "refuted"))}，材料说这一点不对，其他点也没有一点被证实，所以整句算${verdict}。`;
    case "main-unresolved":
      return `最想让人信的${joinParts(by(mainList, "unresolved"))}，这次没找到能直接说明对错的材料，所以整句只能算${verdict}。`;
    case "premise-unresolved":
      return `主要说法有材料支持，但它要成立先得有${joinParts(premises.filter((p) => p.standing === "unresolved" || p.standing === "conflicting"))}，这一点还说不清，所以整句只能算${verdict}。`;
    case "main-conflicting":
      return `关于${joinParts(by(mainList, "conflicting"))}，可靠来源之间说法相反，所以整句算${verdict}。`;
    case "no-checkable-claim":
      return `这句话里没有能拿事实核对的点，所以算${verdict}。`;
  }
}

// ── 各点依据正文里的 [n] ──

export type CiteSource = {
  n: number;
  url: string;
  title: string;
  quote: string;
  role: "support" | "contradict";
  domain: string;
  published: string | null;
  source: InvestigationSource | undefined;
};

export type ClaimCitations = { text: string; sources: CiteSource[] };

function sourceList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? (value.map(asRecord).filter(Boolean) as Record<string, unknown>[]) : [];
}

/** 报告 claimItems 里这一点的依据正文和它的来源列表（[1..S] 支持，[S+1..] 反驳）。 */
export function claimCitations(report: Report | null, claimText: string, sources: readonly InvestigationSource[]): ClaimCitations | null {
  const items = sourceList(report?.claimItems);
  const key = claimAtomKey(claimText);
  const item = items.find((it) => claimAtomKey(String(it.text ?? "")) === key);
  const verdict = asRecord(item?.verdict);
  if (!verdict) return null;
  const text = typeof verdict.evidence === "string" ? verdict.evidence.trim() : "";
  if (!text) return null;
  const build = (list: Record<string, unknown>[], role: CiteSource["role"], offset: number): CiteSource[] =>
    list.map((s, i) => {
      const url = String(s.url ?? "");
      const source = sources.find((src) => src.url === url);
      return {
        n: offset + i + 1,
        url,
        title: String(s.title ?? source?.title ?? url),
        quote: typeof s.quote === "string" && s.quote.trim() ? s.quote.trim() : "",
        role,
        domain: domainOf(url),
        published: publishedDay(source),
        source,
      };
    });
  const support = build(sourceList(verdict.supportingSources), "support", 0);
  const contradict = build(sourceList(verdict.contradictingSources), "contradict", support.length);
  return { text: plainPart(text), sources: [...support, ...contradict] };
}

/** 整句结论的解释层里，哪些句子来自哪一点的依据正文：用来把那里的 [n] 也对回来源。 */
export function splitRationale(rationale: string, claims: { citations: ClaimCitations | null }[]): { text: string; citations: ClaimCitations | null }[] {
  const pieces: { text: string; citations: ClaimCitations | null }[] = [{ text: rationale, citations: null }];
  for (const claim of claims) {
    const c = claim.citations;
    if (!c) continue;
    for (let i = 0; i < pieces.length; i += 1) {
      const piece = pieces[i];
      if (piece.citations) continue;
      const at = piece.text.indexOf(c.text);
      if (at < 0) continue;
      const before = piece.text.slice(0, at);
      const after = piece.text.slice(at + c.text.length);
      pieces.splice(i, 1, ...[{ text: before, citations: null }, { text: c.text, citations: c }, { text: after, citations: null }].filter((p) => p.text));
      break;
    }
  }
  return pieces;
}

export function faviconUrl(domain: string): string {
  return `https://icons.duckduckgo.com/ip3/${domain}.ico`;
}

export function shortDate(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
