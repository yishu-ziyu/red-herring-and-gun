/**
 * Flatten a process row into spoken text + instrument cards.
 *
 * Speech is what we tell the user. Instruments are tools / thinking.
 * They must not share one chrome.
 */

import type { ShellNodeStatus } from "./types";
import type { ProcessActivity, VisibleProcessRow } from "./visibleProcessRows";

export type InstrumentVariant = "search" | "memory" | "think" | "work";

export interface SpeechBlock {
  kind: "speech";
  key: string;
  rowKey: string;
  text: string;
  more?: string;
  status: ShellNodeStatus;
  isCurrent: boolean;
}

export interface InstrumentBlock {
  kind: "instrument";
  key: string;
  rowKey: string;
  title: string;
  detail?: string;
  status: ShellNodeStatus;
  isCurrent: boolean;
  variant: InstrumentVariant;
  toolKey?: string;
  reasoning?: string[];
  reasoningElapsedMs?: number;
  hostsReasoning: boolean;
}

export type SpeechInstrumentBlock = SpeechBlock | InstrumentBlock;

export function instrumentVariantFromTitle(title: string, toolKey?: string): InstrumentVariant {
  const s = `${title} ${toolKey ?? ""}`.toLowerCase();
  if (/思考/.test(title) && !/检索|查阅|对照/.test(title)) return "think";
  if (/历史|memory|查阅/.test(s)) return "memory";
  if (/追索/.test(title)) return "work";
  if (/检索|search|360|公开材料/.test(s)) return "search";
  return "work";
}

function shouldHostReasoning(row: VisibleProcessRow): boolean {
  return Boolean(row.reasoning?.length) || (row.status === "loading" && Boolean(row.actor));
}

function hostActivityIndex(acts: ProcessActivity[]): number {
  let lastLoading = -1;
  for (let i = 0; i < acts.length; i += 1) {
    if (acts[i].status === "loading") lastLoading = i;
  }
  return lastLoading >= 0 ? lastLoading : acts.length - 1;
}

export function flattenRowToBlocks(row: VisibleProcessRow): SpeechInstrumentBlock[] {
  const blocks: SpeechInstrumentBlock[] = [
    {
      kind: "speech",
      key: `${row.key}:speech`,
      rowKey: row.key,
      text: row.title,
      more: row.summary,
      status: row.status,
      isCurrent: row.isCurrent,
    },
  ];

  const acts = row.activities;
  const hasReasoning = shouldHostReasoning(row);

  if (acts.length === 0) {
    if (hasReasoning) {
      blocks.push({
        kind: "instrument",
        key: `${row.key}:think`,
        rowKey: row.key,
        title: "思考",
        status: row.status === "pending" ? "loading" : row.status,
        isCurrent: row.isCurrent,
        variant: "think",
        reasoning: row.reasoning,
        reasoningElapsedMs: row.reasoningElapsedMs,
        hostsReasoning: true,
      });
    }
    return blocks;
  }

  const hostIdx = hasReasoning ? hostActivityIndex(acts) : -1;
  acts.forEach((act, i) => {
    const hosts = i === hostIdx;
    blocks.push({
      kind: "instrument",
      key: act.key,
      rowKey: row.key,
      title: act.title,
      detail: act.detail,
      status: act.status,
      isCurrent: row.isCurrent,
      variant: instrumentVariantFromTitle(act.title, act.toolKey),
      toolKey: act.toolKey,
      reasoning: hosts ? row.reasoning : undefined,
      reasoningElapsedMs: hosts ? row.reasoningElapsedMs : undefined,
      hostsReasoning: hosts,
    });
  });

  return blocks;
}

export function flattenRowsToBlocks(rows: VisibleProcessRow[]): SpeechInstrumentBlock[] {
  return rows.flatMap(flattenRowToBlocks);
}
