/**
 * caseStore.ts — caseId 的生成。
 *
 * 服务端不再保存用户的调查结果：原来只有登录用户的结果会写进 SQLite 的 cases 表，
 * 登录和账号在 #142 part a 删除后，这张表不再读写。表本身保留，旧数据库照常能打开。
 * 用户的历史只在他自己的浏览器里。
 */
const CASE_ID_LENGTH = 8;

/**
 * 生成稳定 caseId：基于 claim + timestamp + 随机数。
 * 8 字符 base36。
 */
export function generateCaseId(seed: string, now: number = Date.now()): string {
  const input = `${seed}|${now}|${Math.random().toString(36).slice(2)}`;
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) | 0;
  }
  const positive = (h >>> 0).toString(36).padStart(CASE_ID_LENGTH, "0").slice(0, CASE_ID_LENGTH);
  return positive;
}
