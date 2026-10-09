/**
 * knowledgeMatch — 同一案追问复用（followUpReuse.ts）用到的确定性小工具：
 * 命题规范化、可复用判词、已核日期格式、「人物/日期/链接变了」冲突闸门。
 *
 * 文件名沿用证据库时期的叫法；跨案证据库已在 2026-10-09 删除，这里只剩追问复用在用的部分。
 * 宪法边界：人物/日期/链接变了的命题必须匹配不上——没覆盖就照常联网。
 */

/**
 * 可注入的判词：true / false / mixed_misleading（契约注入白名单）。
 * 原子级判词只有 true/false/partial/exaggerated/unverified，
 * 其中 partial / exaggerated 语义就是整句口径的 mixed_misleading（有真有假）。
 */
export const KNOWLEDGE_INJECTABLE_VERDICTS: readonly string[] = ["true", "false", "mixed_misleading"];

export function isKnowledgeVerdictInjectable(verdict: unknown): boolean {
  return KNOWLEDGE_INJECTABLE_VERDICTS.includes(String(verdict ?? "").trim().toLowerCase());
}

/**
 * 规范化：trim → NFKC（全角转半角、兼容字符统一）→ 小写 → 压缩空白 → 去句末标点。
 * 只做形状规范化，不做同义替换——同义与转述由相似度负责。
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

/**
 * 「人物/日期/链接变化 → 匹配不上」的确定性闸门：
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
