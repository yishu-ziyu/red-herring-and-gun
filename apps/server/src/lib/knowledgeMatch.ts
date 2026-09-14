/**
 * knowledgeMatch — 知识库条目的确定性语义匹配（证据库第一版）。
 *
 * 匹配算法不在这里重新发明：同义词组桥接 + 汉字 Dice + bigram Jaccard 直接调
 * `semanticRecall.ts`（SSOT 在 `packages/core/src/text/semanticRecall.ts`，
 * server 侧同内容镜像）。本模块只加三件确定性的事：
 *   1. 规范化（trim / 压缩空白 / 全半角与大小写统一 / 去句末标点）；
 *   2. 相似度阈值；
 *   3. 30 天新鲜度窗口与判词可注入性。
 *
 * 宪法边界（写死在这里，任何调用方都不得绕过）：
 * - **不静默继承**：字面不同、换了人物/日期/链接的命题必须匹配不上——没命中就照常联网。
 *   相似度算法本身分不出「隔夜菜」和「隔夜水/隔夜茶」（实测 25 / 66，满分 100），
 *   所以这里加了一道保守闸门：两边都出现数字/拉丁词，而各自都有对方没有的词时判不匹配
 *   （2 月 5 日 vs 2 月 6 日、第 8 号 vs 第 9 号、两条不同链接都落在这一条上）；
 *   人名级替换（某甲 vs 某乙）确定性层拦不住，由「注入证据必须被本轮 fact_checker
 *   用真实 URL 重新绑定，绑不上即降级联网」兜底。
 * - **记忆只加速、不代替核查**：本模块只回答「像不像同一条命题」，不回答真假；
 *   命中的是「上次核过这条命题时绑过的证据」，判词永远由本轮重新判。
 */
import { RUMOR_SYNONYM_GROUPS, semanticClaimSimilarity } from "./semanticRecall.js";

/**
 * 语义相似度阈值（0–100，与 `semanticClaimSimilarity` 同标度）。
 *
 * 取值依据（2026-09-13 实测；脚本与全部数字见本批服务端分身回报）：
 * - 真实改写变体（同一条命题换个说法）落在 21–42：例如
 *   「隔夜菜放一晚亚硝酸盐会升高」(34)、「吃隔夜菜会使人中毒」(40)、
 *   「隔夜菜亚硝酸盐超标，食用后可能中毒」(27)；
 * - 真实谣言库随机两两配对（400 条 × 79,800 对）在 ≥20 时约 1.0–1.4% 会上线，
 *   且集中在共享模板/链接/话题标签的原始微博文本（"发表了一篇转载博文…"、"#同一话题#"），
 *   不是命题级误判；阈值抬到 30 降到约 1.1%，却会丢掉上面一半以上的真改写。
 * 所以取 20：宁可多注入一次（错了由 fact_checker 绑定失败降级联网兜底），
 * 不让「记忆只加速」这层在第一版就形同虚设。
 */
export const KNOWLEDGE_MATCH_THRESHOLD = 20;

/** 条目新鲜度窗口（天）：超龄条目只记 stale，不注入——陈旧证据不算证据。 */
export const KNOWLEDGE_MAX_AGE_DAYS = 30;

const DAY_MS = 86_400_000;

/**
 * 可注入的判词：true / false / mixed_misleading（契约注入白名单）。
 * 原子级判词只有 true/false/partial/exaggerated/unverified，
 * 其中 partial / exaggerated 语义就是整句口径的 mixed_misleading（有真有假），
 * 表里统一按 mixed_misleading 存（见 knowledgeStore.knowledgeVerdictOf）。
 */
export const KNOWLEDGE_INJECTABLE_VERDICTS: readonly string[] = ["true", "false", "mixed_misleading"];

export function isKnowledgeVerdictInjectable(verdict: unknown): boolean {
  return KNOWLEDGE_INJECTABLE_VERDICTS.includes(String(verdict ?? "").trim().toLowerCase());
}

/**
 * 规范化：trim → NFKC（全角转半角、兼容字符统一）→ 小写 → 压缩空白 → 去句末标点。
 * 这是知识库条目的唯一键（`knowledge_entries.atomNorm`），也是观测记录里的 atomNorm。
 * 只做形状规范化，不做同义替换——同义与转述由相似度负责，键保持可读、可核对。
 */
export function normalizeKnowledgeAtom(text: string): string {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[。．.！!？?；;，,、：:…~～"'“”‘’）)】\]》>]+$/u, "")
    .trim();
}

/** epoch ms → YYYY-MM-DD（UTC，无时区歧义）。取不到返回空串，不编日期。 */
export function originDateOf(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** 距今整天数（向下取整，最小 0；非法时间视为极旧 → 负数由调用方按 stale 处理）。 */
export function ageDaysOf(lastVerifiedAt: number, now: number): number {
  if (!Number.isFinite(lastVerifiedAt) || lastVerifiedAt <= 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now - lastVerifiedAt) / DAY_MS));
}

/** 匹配用的条目最小形状（与 knowledgeStore.KnowledgeEntry 结构兼容）。 */
export type KnowledgeMatchEntry = {
  id: string;
  atomNorm: string;
  verdict: string;
  /** 只关心有没有可注入的真实 URL；具体字段由 store 校验。 */
  evidence: ReadonlyArray<{ url?: unknown }>;
  lastVerifiedAt: number;
};

/** 分类结果：泛型保留调用方传进来的条目类型（store 需要完整字段）。 */
export type KnowledgeMatchClassification<T extends KnowledgeMatchEntry = KnowledgeMatchEntry> =
  | { kind: "injectable"; entry: T; score: number; ageDays: number }
  /** 命题命中了，但已核日期超龄：正常联网，只记 stale。 */
  | { kind: "stale"; entry: T; score: number; ageDays: number }
  /** 命题命中了，但判词不可注入 / 条目没有可注入的真实 URL：按未命中处理。 */
  | { kind: "unusable"; entry: T; score: number; ageDays: number }
  | { kind: "none" };

/** http(s) 且非空的证据 URL：注入材料必须能点开（没证据不出结论）。 */
function hasUsableEvidence(entry: KnowledgeMatchEntry): boolean {
  return entry.evidence.some((item) => /^https?:\/\//i.test(String(item?.url ?? "").trim()));
}

/**
 * 「人物/日期/链接变化 → 匹配不上」的确定性闸门（见文件头注释）：
 * 两边都出现数字/拉丁词或链接、且**各自都有对方没有的**数字/拉丁词时判冲突
 * （2 月 5 日 vs 2 月 6 日、第 8 号 vs 第 9 号、0.5mg vs 0.3mg、两条不同链接）。
 * 只有一侧带数字/链接不算冲突——正常改写常常补一个时间或出处。
 */
export function hasTokenConflict(atomA: string, atomB: string): boolean {
  const a = normalizeKnowledgeAtom(atomA);
  const b = normalizeKnowledgeAtom(atomB);
  if (!a || !b) return false;

  const digitsA = new Set(a.match(/[a-z0-9]+/g) ?? []);
  const digitsB = new Set(b.match(/[a-z0-9]+/g) ?? []);
  if (digitsA.size > 0 && digitsB.size > 0) {
    const onlyA = [...digitsA].some((token) => !digitsB.has(token));
    const onlyB = [...digitsB].some((token) => !digitsA.has(token));
    if (onlyA && onlyB) return true;
  }

  const linksA = new Set(a.match(/https?:\/\/\S+/g) ?? []);
  const linksB = new Set(b.match(/https?:\/\/\S+/g) ?? []);
  if (linksA.size > 0 && linksB.size > 0) {
    const shared = [...linksA].some((link) => linksB.has(link));
    if (!shared) return true;
  }

  return false;
}

/**
 * 主语族：同一族是同一件事的改写，跨族不得注入。
 * 走查实锤：微波炉追问命中「吃剩饭剩菜会致癌」只因共享「致癌」。
 * 「致癌」在同义词组里，不算主语。
 */
const SUBJECT_FAMILIES: readonly (readonly string[])[] = [
  ["微波", "微波炉"],
  ["隔夜", "剩饭", "剩菜", "亚硝酸盐", "亚硝"],
];

const PREDICATE_DROP = [...RUMOR_SYNONYM_GROUPS.flat(), "是否", "可靠", "实验", "数据", "支持", "研究"].sort(
  (a, b) => b.length - a.length
);

function distinctiveSubjectTokens(text: string): Set<string> {
  let stripped = normalizeKnowledgeAtom(text);
  const tokens = new Set<string>();
  for (const family of SUBJECT_FAMILIES) {
    if (family.some((term) => stripped.includes(term))) {
      tokens.add(`topic:${family[0]}`);
      for (const term of family) stripped = stripped.split(term).join(" ");
    }
  }
  for (const term of PREDICATE_DROP) {
    if (!term) continue;
    stripped = stripped.split(term).join(" ");
  }
  for (const latin of stripped.match(/[a-z]{2,}/g) ?? []) tokens.add(latin);
  const compact = stripped.replace(/\s+/g, "");
  for (let i = 0; i < compact.length - 1; i += 1) {
    const pair = compact.slice(i, i + 2);
    if (/^[\p{Script=Han}]{2}$/u.test(pair)) tokens.add(pair);
  }
  return tokens;
}

/**
 * 两边都有可识别主语、却完全对不上 → 不是同一件可核查事。
 * 一侧剥完谓语后没有主语（纯「会致癌」）不拦，避免误杀短改写。
 */
export function hasSubjectMismatch(atomA: string, atomB: string): boolean {
  const a = distinctiveSubjectTokens(atomA);
  const b = distinctiveSubjectTokens(atomB);
  if (a.size === 0 || b.size === 0) return false;
  for (const token of a) {
    if (b.has(token)) return false;
  }
  return true;
}

/**
 * 在候选条目里找语义最近的一条并分类。确定性：同输入同输出；
 * 分数并列时取 lastVerifiedAt 更新（更近）的那条，再并列取 id 字典序，保证不随表序漂移。
 */
export function classifyKnowledgeMatch<T extends KnowledgeMatchEntry>(input: {
  atom: string;
  entries: readonly T[];
  now: number;
  threshold?: number;
  maxAgeDays?: number;
}): KnowledgeMatchClassification<T> {
  const threshold = input.threshold ?? KNOWLEDGE_MATCH_THRESHOLD;
  const maxAgeDays = input.maxAgeDays ?? KNOWLEDGE_MAX_AGE_DAYS;
  const atomNorm = normalizeKnowledgeAtom(input.atom);
  if (!atomNorm) return { kind: "none" };

  let best: { entry: T; score: number } | null = null;
  for (const entry of input.entries) {
    if (!entry || typeof entry.atomNorm !== "string" || !entry.atomNorm) continue;
    if (hasTokenConflict(atomNorm, entry.atomNorm)) continue;
    if (hasSubjectMismatch(atomNorm, entry.atomNorm)) continue;
    const score = semanticClaimSimilarity(atomNorm, entry.atomNorm);
    if (score < threshold) continue;
    if (
      !best ||
      score > best.score ||
      (score === best.score && entry.lastVerifiedAt > best.entry.lastVerifiedAt) ||
      (score === best.score &&
        entry.lastVerifiedAt === best.entry.lastVerifiedAt &&
        entry.id < best.entry.id)
    ) {
      best = { entry, score };
    }
  }

  if (!best) return { kind: "none" };
  const ageDays = ageDaysOf(best.entry.lastVerifiedAt, input.now);
  if (ageDays > maxAgeDays) {
    return { kind: "stale", entry: best.entry, score: best.score, ageDays };
  }
  if (!isKnowledgeVerdictInjectable(best.entry.verdict) || !hasUsableEvidence(best.entry)) {
    return { kind: "unusable", entry: best.entry, score: best.score, ageDays };
  }
  return { kind: "injectable", entry: best.entry, score: best.score, ageDays };
}
