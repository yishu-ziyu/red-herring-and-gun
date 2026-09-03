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
export const CHECKING = "核对中";
export const STANCE_TYPE = "立场型 · 不适用真/假判断";
export const CONTESTED_LINE = "来源之间相互矛盾";
export const FRONTIER_TITLE = "还可以往哪查";
export const IMAGE_ORIGIN = "这张图的来源";
export const PURSUING = "正在查";
export const CITE_MORE = "展开全部";
export const MATERIALS = "已找到";
export const MATERIALS_UNIT = "条材料";
export const VERDICT_SECTION = "整句判决";
export const CLAIM_SECTION = "命题";
export const EVIDENCE_SECTION = "材料";
export const GRAPH_SECTION = "出处图";
export const MORE_SAME_ORIGIN = "还有";
export const SAME_ORIGIN_UNIT = "条同源";
export const OPEN_ORIGINAL = "打开原文";
export const ASK_AGAIN = "可以再试，或换个说法。";
export const MEMO_USER = "原句";
export const MEMO_FOLLOW = "追问";
export const COMPOSER_LABEL = "追问";
export const ATTACH_ALT = "附图";
export const CLUSTER_SOLO = "单独来源";

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

export const STOP_REASONS = {
  budget: "预算用完",
  "no-gain": "没有新收获",
  resolved: "已经查清",
  time: "时间到",
  "tool-failed": "工具故障",
} as const;

export const ROLES = {
  main: "主查",
  prosecutor: "控方",
  defender: "辩方",
} as const;

export const ACTIONS = {
  search: "检索",
  fetch: "打开页面",
  reverse_image: "查图",
  recall: "对照旧案",
  stop: "停下",
} as const;

export const STANCE_WORDS = {
  supports: "支持 ＋",
  refutes: "反驳 －",
  partial: "部分 ±",
  contextual: "背景",
} as const;

export function claimFace(verdict: string | undefined): string {
  return faceWord(verdict);
}

export function faceTone(verdict: string | undefined): "true" | "false" | "unclear" {
  if (verdict === "true") return "true";
  if (verdict === "false") return "false";
  return "unclear";
}

export function stopReasonWord(reason: string): string {
  return STOP_REASONS[reason as keyof typeof STOP_REASONS] ?? STOP_REASONS.resolved;
}

export function roleWord(role: string): string {
  return ROLES[role as keyof typeof ROLES] ?? ROLES.main;
}

export function actionWord(kind: string): string {
  return ACTIONS[kind as keyof typeof ACTIONS] ?? kind;
}

export function stanceWord(stance: string): string {
  return STANCE_WORDS[stance as keyof typeof STANCE_WORDS] ?? stance;
}

export function errorLine(detail: string): string {
  const head = detail.trim() || "这一步没做成";
  return `${head}。${ASK_AGAIN}`;
}

export function expandCitations(total: number): string {
  return `${CITE_MORE} ${total} 条`;
}

export function materialsLine(n: number): string {
  return `${MATERIALS} ${n} ${MATERIALS_UNIT}`;
}

export function moreInCluster(n: number): string {
  return `${MORE_SAME_ORIGIN} ${n} ${SAME_ORIGIN_UNIT}`;
}

export function chaseLine(n: number, reason?: string): string {
  const base = `追索了 ${n} 步`;
  return reason ? `${base} · ${reason}` : base;
}

export function timelineTitle(chase: number, exam: number): string {
  return `追索 ${chase} 步 · 复核 ${exam} 步`;
}

export function gainLine(gain: number): string {
  return `+${gain} 条证据 / 判决变化`;
}

export function pursueText(label: string): string {
  return `追查 · ${label}`;
}
