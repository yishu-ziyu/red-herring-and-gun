import type { Case } from '@rhg/core/casefile';
import { faceWord } from '@rhg/core/publicCopy';

export const APP_TITLE = "红鲱鱼与枪";
export const TURN_BUSY = "这一案还在查，等这轮结束再问。";
export const SUBMIT_HOME = "开始核对";
export const SUBMIT_TURN = "再问一句";
export const ABORT = "中止";
export const OPEN_PANEL = "打开面板";
export const CLOSE_PANEL = "关闭面板";
export const OPEN_NAV = "打开案件列表";
export const CLOSE_NAV = "关闭案件列表";
export const COLLAPSE_NAV = "收起案件列表";
export const EXPAND_NAV = "展开案件列表";
export const CLOSE_OVERLAY = "关闭";

export const STATUS = {
  decomposing: "正在拆题",
  retrieving: "正在找证据",
  assessing: "正在核对",
  investigating: "正在追索",
  examining: "正在复核",
  composing: "正在写结论",
  done: "已完成",
  aborted: "已中止",
} as const;

const STAGE_STATUS: Record<string, string> = {
  intake: STATUS.decomposing,
  decompose: STATUS.decomposing,
  retrieve: STATUS.retrieving,
  assess: STATUS.assessing,
  judge: STATUS.assessing,
  investigate: STATUS.investigating,
  crossExam: STATUS.examining,
  compose: STATUS.composing,
  finalize: STATUS.composing,
};

export function statusWord(current: Case, running: boolean): string {
  const lastTurn = current.turns.at(-1);
  if (lastTurn?.reason === "aborted") return STATUS.aborted;
  if (!running && lastTurn?.finishedAt) return STATUS.done;
  const open = [...current.stages].reverse().find((row) => row.finishedAt === undefined);
  const name = open?.stage ?? current.stages.at(-1)?.stage;
  if (name && STAGE_STATUS[name]) return STAGE_STATUS[name];
  return running ? STATUS.decomposing : STATUS.done;
}

export function claimFace(verdict: string | undefined): string {
  return faceWord(verdict);
}

export function faceTone(verdict: string | undefined): "true" | "false" | "unclear" {
  if (verdict === "true") return "true";
  if (verdict === "false") return "false";
  return "unclear";
}
