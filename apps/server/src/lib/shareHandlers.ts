/**
 * shareHandlers — 不登录也能分享一轮调查。
 *
 * 规矩：
 *   1. 分享只含一轮调查，内容只取服务端为这一轮（run）发布的固定最终结果，不收浏览器发来的任何正文。
 *      所以没人能借分享发布自己写的任意文字。只有跑完（completed）的一轮能分享。
 *   2. 只有建这轮调查的浏览器（同一个访客 cookie）能建、能撤这一轮的分享。
 *   3. 链接令牌随机、猜不出；库里只存令牌的哈希。撤销之后链接只显示「已撤销」，不显示正文；
 *      但不承诺抹掉别人已经存下的副本。
 *
 * 公开内容按白名单逐字段构造：快照里将来多了字段，默认不出去。
 */
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { openDatabase } from "./sqliteStore.js";
import { followUpQuestionOf } from "./followUpReuse.js";
import { clientIpKey, guestIdFromRequest, guestOwnerHash } from "./checkQuota.js";
import type { RunRecord, PublishedRunResult } from "./runStore.js";
import { GUEST_DAILY_SHARES, IP_DAILY_SHARES, shanghaiDayKey } from "../../../shared/quota.js";
import { scrubFaceText } from "../../../shared/scrubFace.js";
import { conclusionMissesFollowUp, followUpQuestionLead } from "../../../shared/followUp.js";
import { LABEL_TEXT, LABEL_TONE, isLabelKey, judgmentToLabel, type LabelKey } from "../../../shared/domain/labels.js";
import { normalizePublishedDate } from "../../../shared/investigation/sourceDate.js";
import { quoteLinkUrl } from "../../../shared/investigation/quote.js";
import { materialPassageLabel, materialReadTag, materialRetrievedLabel } from "../../../shared/investigation/material.js";

const TOKEN_BYTES = 24;
const SHARE_TTL_DAYS = 30;
/** 只交图片时发给服务端的请求句开头（见 src/lib/caseIntake.ts）。它是内部提示词，公开页里不能出现。 */
const IMAGE_REQUEST_PREFIX = "请核查用户上传的";

/** 公开页显示的全部内容。白名单就是这份类型。 */
type PublicShareProjection = {
  version: 2;
  claim: string;
  /** 结论句：和结果页大字显示的那句一致。 */
  answer: string;
  /** 整句标签与一句理由。改版前存下的分享没有这两个字段。 */
  label?: LabelKey;
  reason?: string;
  rationale?: string;
  boundaries: string[];
  checkedAt?: string;
  createdAt: number;
  claims: Array<{ text: string; judgment: string | null; label?: LabelKey; reason?: string; boundary?: string; evidence: Array<{ role: string; sourceId: string; sentence?: string; note?: string; finding?: string; excerptKind?: string; passage?: string; provenance?: string; originDate?: string }> }>;
  deferredClaims: string[];
  sources: Array<{ id: string; title: string; url: string; publishedAt?: string; retrievedAt?: string; excerptKind?: string; fetchStatus?: string; fetchNote?: string; provenance?: string; originDate?: string }>;
};

type ShareRecord = { shareId: string; runId: string | null; projection: PublicShareProjection; createdAt: number; revokedAt: number | null };

type ShareLookup =
  | { state: "ok"; record: ShareRecord }
  | { state: "revoked" }
  | { state: "missing" };

const str = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const rec = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** 公开页上的说法：追问轮只留用户写的那句；内部请求句换成中性的名字。 */
function publicClaim(originalClaim: string): string {
  const claim = followUpQuestionOf(originalClaim);
  return claim.startsWith(IMAGE_REQUEST_PREFIX) ? "上传的图片" : claim;
}

/** 结论句的取法与结果页一致（InvestigationCanvas + ConclusionHero）。 */
function publicAnswer(snapshot: Record<string, unknown>, conclusion: Record<string, unknown>): string {
  const originalClaim = str(snapshot.originalClaim);
  const verdictLead = str(conclusion.verdictLead);
  const directAnswer = str(conclusion.directAnswer);
  const judgment = str(conclusion.judgment) as Parameters<typeof followUpQuestionLead>[1];
  const rewrite = conclusionMissesFollowUp(verdictLead || directAnswer, originalClaim)
    ? followUpQuestionLead(followUpQuestionOf(originalClaim), judgment)
    : "";
  const raw = rewrite || verdictLead || directAnswer;
  return scrubFaceText(raw) || raw;
}

const JUDGMENTS = ["supported", "refuted", "mixed", "disputed", "unresolved", "not-applicable"] as const;

/** 快照带了标签就用；改版前的快照只有 judgment，按它推出。 */
function labelOf(label: unknown, judgment: unknown): LabelKey | undefined {
  if (isLabelKey(label)) return label;
  const j = str(judgment);
  return (JUDGMENTS as readonly string[]).includes(j) ? judgmentToLabel(j as (typeof JUDGMENTS)[number]) : undefined;
}

/** 从一轮调查的快照造公开内容。只读快照，不读任何浏览器发来的东西。 */
function projectionFromSnapshot(snapshotValue: unknown, createdAt: number): PublicShareProjection {
  const snapshot = rec(snapshotValue);
  const conclusion = rec(snapshot.conclusion);
  const claims = arr(snapshot.claims).map(rec);
  const scope = rec(snapshot.scope);
  const deferredIds = new Set(arr(scope.deferredClaimIds).map(str));
  const rationale = str(conclusion.verdictLead) ? scrubFaceText(str(conclusion.rationale)) : "";
  const checkedAt = str(snapshot.checkedAt);
  const answer = publicAnswer(snapshot, conclusion);
  const label = labelOf(conclusion.label, conclusion.judgment);
  // 追问改写换掉了首句时，结论的理由不再是显示出来的那句，不单独给。
  const reason = str(conclusion.reason) && answer === (scrubFaceText(str(conclusion.reason)) || str(conclusion.reason)) ? answer : "";
  return {
    version: 2,
    claim: publicClaim(str(snapshot.originalClaim)),
    answer,
    ...(label ? { label } : {}),
    ...(reason ? { reason } : {}),
    ...(rationale ? { rationale } : {}),
    boundaries: arr(conclusion.boundaries).map(str).filter(Boolean),
    ...(checkedAt ? { checkedAt } : {}),
    createdAt,
    claims: claims
      .filter((claim) => !deferredIds.has(str(claim.id)) && str(claim.text))
      .map((claim) => ({
        text: str(claim.text),
        judgment: str(claim.judgment) || null,
        ...(str(claim.boundary) ? { boundary: str(claim.boundary) } : {}),
        ...(isLabelKey(claim.label) ? { label: claim.label } : {}),
        ...(isLabelKey(claim.label) && str(claim.reason) ? { reason: scrubFaceText(str(claim.reason)) } : {}),
        evidence: arr(claim.evidence)
          .map(rec)
          .filter((link) => ["support", "contradict", "context-only"].includes(str(link.role)))
          .map((link) => ({
            role: str(link.role),
            sourceId: str(link.sourceId),
            ...(["prior-round", "knowledge"].includes(str(link.provenance)) ? { provenance: str(link.provenance), originDate: str(link.originDate) } : {}),
            ...(["search-snippet", "page-excerpt"].includes(str(link.excerptKind)) ? { excerptKind: str(link.excerptKind) } : {}),
            ...(str(link.passage) ? { passage: str(link.passage) } : {}),
            // 与结果页同一规则：引号里只放已核对的那一句；没有就给我们的概括。
            // 老分享存的 quote 是整段 passage，显示时不再读。
            ...(str(link.quote) ? { sentence: str(link.quote) } : str(link.relationReason) ? { note: scrubFaceText(str(link.relationReason)) } : {}),
            ...(str(link.finding) ? { finding: scrubFaceText(str(link.finding)) } : {}),
          })),
      })),
    deferredClaims: claims.filter((claim) => deferredIds.has(str(claim.id))).map((claim) => str(claim.text)).filter(Boolean),
    sources: arr(snapshot.sources)
      .map(rec)
      .filter((source) => /^https?:\/\//.test(str(source.url)))
      .map((source) => ({
        id: str(source.id),
        title: str(source.title) || str(source.url),
        url: str(source.url),
        ...(["prior-round", "knowledge"].includes(str(source.provenance)) ? { provenance: str(source.provenance), originDate: str(source.originDate) } : {}),
        ...(str(source.publishedAt) ? { publishedAt: str(source.publishedAt) } : {}),
        ...(str(source.retrievedAt) ? { retrievedAt: str(source.retrievedAt) } : {}),
        ...(["search-snippet", "page-excerpt"].includes(str(source.excerptKind)) ? { excerptKind: str(source.excerptKind) } : {}),
        ...(["snippet-only", "fetched", "truncated", "restricted", "failed"].includes(str(source.fetchStatus)) ? { fetchStatus: str(source.fetchStatus) } : {}),
        ...(str(source.fetchNote) ? { fetchNote: str(source.fetchNote) } : {}),
      })),
  };
}

/** 登录时代存下的老分享（{claim, report, createdAt}）按同一套白名单重新取一遍再显示。 */
function readStoredProjection(raw: string): PublicShareProjection | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = rec(JSON.parse(raw));
  } catch {
    return null;
  }
  if (parsed.version === 2) return parsed as unknown as PublicShareProjection;
  const report = rec(parsed.report);
  const createdAt = typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now();
  const projection = projectionFromSnapshot({ ...rec(report.investigation), originalClaim: str(parsed.claim) }, createdAt);
  if (!projection.answer) projection.answer = scrubFaceText(str(report.conclusion));
  return projection;
}

function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type ShareRow = { shareId: string; runId: string | null; resultId: string | null; projection: string; createdAt: number; revokedAt: number | null };

type ShareStore = ReturnType<typeof createShareStore>;

function createShareStore(db: DatabaseSync) {
  const find = (shareId: string): ShareRow | undefined =>
    (db.prepare("SELECT shareId, runId, resultId, projection, createdAt, revokedAt FROM shares WHERE shareId = ?").get(shareId) as ShareRow | undefined);

  return {
    /** 建分享：返回**明文令牌**，库里只落哈希。 */
    create(run: RunRecord, resultId: string, projection: PublicShareProjection, now = Date.now()): { token: string } {
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const shareId = hashShareToken(token);
      const row: ShareRow = { shareId, runId: run.runId, resultId, projection: JSON.stringify(projection), createdAt: now, revokedAt: null };
      db.prepare("INSERT INTO shares (shareId, caseId, runId, resultId, projection, createdAt, revokedAt) VALUES (?, ?, ?, ?, ?, ?, NULL)").run(
          shareId,
          run.caseId,
          run.runId,
          resultId,
          row.projection,
          now
        );
      return { token };
    },

    /** 按令牌找分享。撤销单独报出来；过期和找不到对外是同一种「不可用」。 */
    read(token: string, now = Date.now()): ShareLookup {
      const row = find(hashShareToken(token));
      if (!row) return { state: "missing" };
      if (row.revokedAt) return { state: "revoked" };
      if (now - row.createdAt > SHARE_TTL_DAYS * 86_400_000) return { state: "missing" };
      const projection = readStoredProjection(row.projection);
      if (!projection) return { state: "missing" };
      return { state: "ok", record: { shareId: row.shareId, runId: row.runId, projection, createdAt: row.createdAt, revokedAt: null } };
    },

    /** 撤销：只标记，不删行。只撤属于这一轮的分享；幂等。 */
    revoke(token: string, runId: string, now = Date.now()): boolean {
      const shareId = hashShareToken(token);
      const row = find(shareId);
      if (!row || row.runId !== runId) return false;
      if (row.revokedAt) return true;
      db.prepare("UPDATE shares SET revokedAt = ? WHERE shareId = ?").run(now, shareId);
      return true;
    },
  };
}

let cachedStore: ShareStore | null = null;

function shareStore(): ShareStore {
  if (!cachedStore) {
    const db = openDatabase();
    if (!db) throw new Error("Share storage unavailable");
    cachedStore = createShareStore(db);
  }
  return cachedStore;
}

// ── 建分享限额：按访客、按来源 IP，每天各算各的。只在进程内计数，重启清零。──
const sharesByGuest = new Map<string, { day: string; used: number }>();
const sharesByIp = new Map<string, { day: string; used: number }>();

function usedToday(map: Map<string, { day: string; used: number }>, key: string, day: string): number {
  const bucket = map.get(key);
  return bucket && bucket.day === day ? bucket.used : 0;
}

function countShare(map: Map<string, { day: string; used: number }>, key: string, day: string): void {
  map.set(key, { day, used: usedToday(map, key, day) + 1 });
}

function sendJson(res: any, status: number, body: unknown): void {
  res.status(status).json(body);
}

/** 这一轮调查是不是这个浏览器建的。老 run 的 ownerHash 是 null，谁都不认。 */
function ownsRun(req: any, run: RunRecord): string | null {
  const guestId = guestIdFromRequest(req);
  if (!guestId || !run.ownerHash || guestOwnerHash(guestId) !== run.ownerHash) return null;
  return guestId;
}

export function createShareHandlers(deps: {
  getRun: (runId: string) => RunRecord | null;
  getResult: (runId: string) => PublishedRunResult | null;
}) {
  /** POST /api/investigations/:runId/shares — 请求体一律不读。 */
  async function createShareHandler(req: any, res: any): Promise<void> {
    const runId = String(req.params?.runId ?? "").trim();
    const run = runId ? deps.getRun(runId) : null;
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    const guestId = ownsRun(req, run);
    if (!guestId) return sendJson(res, 403, { message: "只有发起这次调查的浏览器能分享它" });
    const published = deps.getResult(runId);
    const snapshot = published?.snapshot;
    if (run.status !== "completed" || published?.kind !== "final" || !snapshot || snapshot.phase !== "complete" || !snapshot.conclusion) {
      return sendJson(res, 409, { message: "这次调查还没有查完，查完才能分享" });
    }
    const day = shanghaiDayKey();
    const ipKey = clientIpKey(req);
    if (usedToday(sharesByGuest, guestId, day) >= GUEST_DAILY_SHARES || usedToday(sharesByIp, ipKey, day) >= IP_DAILY_SHARES) {
      return sendJson(res, 429, { message: "今天建的分享链接太多了，明天再试" });
    }
    const { token } = shareStore().create(run, published.resultId, projectionFromSnapshot(snapshot, published.createdAt));
    countShare(sharesByGuest, guestId, day);
    countShare(sharesByIp, ipKey, day);
    return sendJson(res, 201, { shareId: token, resultId: published.resultId, revision: published.revision, url: `/s/${token}` });
  }

  /** DELETE /api/investigations/:runId/shares/:shareId */
  async function revokeShareHandler(req: any, res: any): Promise<void> {
    const runId = String(req.params?.runId ?? "").trim();
    const token = String(req.params?.shareId ?? "").trim();
    const run = runId ? deps.getRun(runId) : null;
    if (!run || !token) return sendJson(res, 404, { message: "没有这个分享" });
    if (!ownsRun(req, run)) return sendJson(res, 403, { message: "只有发起这次调查的浏览器能撤销分享" });
    if (!shareStore().revoke(token, run.runId)) return sendJson(res, 404, { message: "没有这个分享" });
    return sendJson(res, 200, { revoked: true });
  }

  return { createShareHandler, revokeShareHandler };
}

// 和产品结果页同一套样式（apps/src/goldenPath/result.css）：颜色取自 Radix Colors（sand / red / green / amber），
// 字号只有 36 / 20 / 16 / 13，线一律 0.5px。分享多半在手机微信里打开，先按手机排；不加载网络字体。
const SHARE_PAGE_STYLE = `
  :root {
    color-scheme: light;
    --sand-1: #fdfdfc; --sand-2: #f9f9f8; --sand-3: #f1f0ef; --sand-4: #e9e8e6; --sand-6: #dad9d6;
    --sand-8: #bcbbb5; --sand-11: #63635e; --sand-12: #21201c;
    --green-3: #e6f6eb; --green-11: #218358;
    --amber-3: #fff7c2; --amber-11: #ab6400;
    --red-3: #feebec; --red-11: #ce2c31;
    --line: 0.5px solid var(--sand-6);
    --serif: "Noto Serif SC", "Songti SC", "STSong", serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--sand-1); color: var(--sand-12); font-family: "SF Pro Text", -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 16px; line-height: 1.6; -webkit-font-smoothing: antialiased; }
  main { max-width: 720px; margin: 0 auto; padding: 0 16px 48px; overflow-wrap: anywhere; }
  a { color: var(--sand-12); text-decoration-thickness: 0.5px; text-decoration-color: var(--sand-8); text-underline-offset: 3px; }
  a:hover { text-decoration-color: currentColor; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; height: 56px; margin-bottom: 32px; border-bottom: var(--line); }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; text-decoration: none; }
  .brand img { width: 28px; height: 28px; }
  .top small, .meta, .scope, .empty, .ev-src, .ev-foot, .context small { font-size: 13px; color: var(--sand-11); }
  .claim { position: relative; margin: 0; padding-bottom: 24px; border-bottom: var(--line); font-family: var(--serif); font-size: 20px; font-weight: 400; line-height: 1.7; }
  .claim .open { position: absolute; right: 100%; }
  .verdict-block { padding: 32px 0; }
  .verdict { display: block; word-break: keep-all; font-family: var(--serif); font-size: 36px; font-weight: 700; line-height: 1.3; }
  .headline { margin: 12px 0 0; font-family: var(--serif); font-size: 20px; line-height: 1.7; }
  .tone-positive { color: var(--green-11); } .tone-negative { color: var(--red-11); } .tone-mixed { color: var(--amber-11); } .tone-muted { color: var(--sand-12); }
  .rationale { margin: 12px 0 0; color: var(--sand-11); }
  .meta { margin: 16px 0 0; }
  .scope { margin: 8px 0 0; }
  .boundary { margin: 12px 0 0; line-height: 1.8; color: var(--sand-11); }
  .boundary b { display: block; font-size: 13px; font-weight: 600; }
  .part { display: grid; grid-template-columns: 20px minmax(0, 1fr); column-gap: 12px; align-items: baseline; padding: 24px 0; border-top: var(--line); }
  .part-no { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; background: var(--sand-3); color: var(--sand-11); font-size: 13px; font-weight: 500; }
  .part-body { min-width: 0; }
  .part-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; }
  .part-text { font-family: var(--serif); font-size: 20px; font-weight: 600; line-height: 1.5; }
  .label { display: inline-block; padding: 0 6px; border-radius: 4px; font-size: 13px; font-weight: 500; line-height: 22px; white-space: nowrap; }
  .label-positive { color: var(--green-11); background: var(--green-3); } .label-negative { color: var(--red-11); background: var(--red-3); }
  .label-mixed { color: var(--amber-11); background: var(--amber-3); } .label-muted { color: var(--sand-11); background: var(--sand-3); }
  .reason { margin: 8px 0 0; font-family: var(--serif); line-height: 1.8; }
  .empty { margin: 12px 0 0; }
  ul.evidence { list-style: none; margin: 16px 0 0; padding: 0; display: flex; flex-direction: column; gap: 16px; }
  .ev q { display: block; text-indent: -0.5em; font-family: var(--serif); line-height: 1.8; color: var(--sand-11); quotes: "「" "」"; }
  .ev-note { display: block; color: var(--sand-11); }
  .ev-note i { font-style: normal; font-size: 13px; font-weight: 600; margin-right: 8px; }
  .ev-finding { color: var(--sand-11); }
  .ev-src, .ev-foot { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-top: 4px; }
  .role { font-weight: 600; } .role-support { color: var(--green-11); } .role-contradict { color: var(--red-11); }
  .ev-foot details[open] { flex-basis: 100%; }
  details { margin-top: 16px; font-size: 13px; }
  .ev-foot details { margin: 0; }
  summary { list-style: none; display: inline-flex; align-items: center; gap: 6px; cursor: pointer; color: var(--sand-11); }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: ""; width: 5px; height: 5px; border-right: 1px solid currentColor; border-bottom: 1px solid currentColor; transform: rotate(-45deg); }
  details[open] > summary::after { transform: translateY(-2px) rotate(45deg); }
  summary:hover { color: var(--sand-12); }
  .context { margin-top: 8px; padding: 12px; border-radius: 8px; background: var(--sand-2); }
  .context blockquote, .context p { margin: 0 0 8px; white-space: pre-wrap; }
  details ul.evidence { font-size: 16px; }
  .sources { list-style: none; margin: 12px 0 0; padding: 0; }
  .sources li { margin: 4px 0; }
  .all { margin-top: 0; padding-top: 24px; border-top: var(--line); }
  .cta { display: flex; align-items: center; justify-content: center; height: 40px; margin: 32px 0 0; border-radius: 8px; background: var(--sand-12); color: var(--sand-1); font-size: 13px; font-weight: 500; text-decoration: none; }
  .cta:hover { opacity: 0.88; }
  h1.notice { margin: 0 0 8px; font-size: 20px; }
  section > p { color: var(--sand-11); }
  @media (min-width: 640px) {
    main { padding: 0 24px 64px; }
  }
`;

const ROLE_LABEL: Record<string, string> = { support: "支持", contradict: "反驳", "context-only": "背景" };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 「2026 年 10 月 22 日 13:05」，按北京时间；读不出就不显示。 */
function readableTime(value: string | number | undefined): string {
  if (value === undefined || value === "") return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Shanghai", year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(date)
      .map((part) => [part.type, part.value])
  );
  return `${parts.year} 年 ${parts.month} 月 ${parts.day} 日 ${parts.hour}:${parts.minute}`;
}

function shell(title: string, body: string, indexable: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${indexable ? "index,follow" : "noindex"}">
<title>${escapeHtml(title)}</title>
<link rel="icon" type="image/png" href="/logo.png?v=20260615">
<style>${SHARE_PAGE_STYLE}</style>
</head><body><main>
<header class="top"><a class="brand" href="/"><img src="/mark.png" alt="">红鲱鱼与枪</a><small>分享的调查</small></header>
${body}
</main></body></html>`;
}

/** 只用公开内容渲染分享页。 */
function buildSharedPageHtml(lookup: ShareLookup): string {
  if (lookup.state === "revoked") {
    return shell(
      "分享链接已撤销｜红鲱鱼与枪",
      `<section data-share-revoked><h1 class="notice">这个分享链接已被撤销</h1>
<p>分享人已撤销这个链接，不再显示调查内容。</p>
<a class="cta" href="/">核查你听到的说法</a></section>`,
      false
    );
  }
  if (lookup.state === "missing") {
    return shell(
      "分享链接不可用｜红鲱鱼与枪",
      `<section data-share-missing><h1 class="notice">分享链接不可用</h1>
<p>链接不存在或已过期。</p>
<a class="cta" href="/">核查你听到的说法</a></section>`,
      false
    );
  }

  const p = lookup.record.projection;
  // 发布日期：老分享里存的是原样日期，显示时按同一规则读；读不出就照实说没取到。
  const publishedTag = (raw: string | undefined) => {
    const day = normalizePublishedDate(raw);
    return `<span data-share-published="${day ?? ""}">${day ?? "发布日期不详"}</span>`;
  };
  const sourceById = new Map(p.sources.map((source) => [source.id, source]));
  const evidenceRow = (link: PublicShareProjection["claims"][number]["evidence"][number]): string => {
    const source = sourceById.get(link.sourceId);
    // 摘自搜索摘要的句子可能被搜索引擎改写过，不能加引号当作网页原话。
    const quote = !link.sentence ? ""
      : link.excerptKind === "page-excerpt" ? `<q data-share-quote>${escapeHtml(link.sentence)}</q>`
      : `<span class="ev-note" data-share-snippet><i>搜索摘要</i>${escapeHtml(link.sentence)}</span>`;
    const note = !quote && link.note ? `<span class="ev-note" data-share-note><i>概括</i>${escapeHtml(link.note)}</span>` : "";
    const finding = link.finding ? `<div class="ev-finding">${escapeHtml(link.finding)}</div>` : "";
    if (!quote && !note && !finding && !link.passage) return "";
    const href = source ? quoteLinkUrl(source.url, link.excerptKind === "page-excerpt" ? link.sentence : "") : "";
    const title = escapeHtml(source?.title || "原网页");
    const src = `<span class="ev-src"><span class="role role-${escapeHtml(link.role)}">${ROLE_LABEL[link.role] ?? ""}</span>${
      href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${title} ↗</a>` : `<span>${title}</span>`
    }${source ? publishedTag(source.publishedAt) : ""}</span>`;
    const provenance = link.provenance ?? source?.provenance;
    const originDate = link.originDate || source?.originDate;
    const origin = provenance ? `<span>${provenance === "prior-round" ? "来自上一轮" : "来自历史材料"}${originDate ? ` · ${escapeHtml(originDate)}` : ""}</span>` : "";
    const read = materialReadTag(link, source ?? {});
    const passageNote = [
      materialPassageLabel(link.excerptKind),
      source?.fetchNote ? `正文读取情况：${escapeHtml(source.fetchNote)}` : "",
      materialRetrievedLabel(source?.retrievedAt),
    ].filter(Boolean).join("；");
    const material = `<details><summary>查看上下文</summary><div class="context">${
      link.passage ? `<blockquote>${escapeHtml(link.passage)}</blockquote>` : "<p>这条依据没有保存可检查的上下文。</p>"
    }<small>${passageNote}</small></div></details>`;
    return `<li class="ev" data-share-material-kind="${escapeHtml(link.excerptKind ?? "unknown")}" data-share-source-id="${escapeHtml(link.sourceId)}" data-share-role="${escapeHtml(link.role)}">${quote}${note}${finding}${src}${origin}<div class="ev-foot"><span class="read read-${read.level}" data-share-material-status>${read.text}</span>${material}</div></li>`;
  };
  const claimItems = p.claims
    .map((claim, index) => {
      const decisive = claim.evidence.filter((link) => link.role === "support" || link.role === "contradict").map(evidenceRow).filter(Boolean);
      const background = claim.evidence.filter((link) => link.role !== "support" && link.role !== "contradict").map(evidenceRow).filter(Boolean);
      const label = labelOf(claim.label, claim.judgment);
      const chip = label
        ? `<span class="label label-${LABEL_TONE[label]}" data-share-claim-label="${label}">${escapeHtml(LABEL_TEXT[label])}</span>`
        : "";
      const reason = claim.label && claim.reason ? `<p class="reason" data-share-claim-reason>${escapeHtml(claim.reason)}</p>` : "";
      return `<article class="part" data-share-claim>
  <span class="part-no" aria-hidden="true">${index + 1}</span>
  <div class="part-body">
  <div class="part-head"><span class="part-text">${escapeHtml(claim.text)}</span>${chip}</div>
  ${reason}
  ${claim.boundary ? `<p class="reason"><strong>不能推出：</strong>${escapeHtml(claim.boundary.replace(/^不能推出[：:]?/, ""))}</p>` : ""}
  ${decisive.length ? `<ul class="evidence">${decisive.join("")}</ul>` : `<p class="empty">没有找到直接支持或反驳这一点的依据。</p>`}
  ${background.length ? `<details><summary>另有 ${background.length} 条相关材料，未用于判断</summary><ul class="evidence">${background.join("")}</ul></details>` : ""}
  </div>
</article>`;
    })
    .join("");
  const when = readableTime(p.checkedAt) || readableTime(p.createdAt);
  const body = `<h1 class="claim"><span class="open" aria-hidden="true">“</span>${escapeHtml(p.claim)}<span aria-hidden="true">”</span></h1>
  <div class="verdict-block">
  <div data-share-conclusion>${
    p.label ? `<span class="verdict tone-${LABEL_TONE[p.label]}" data-share-label="${p.label}">${escapeHtml(LABEL_TEXT[p.label])}</span>` : ""
  }<p class="headline">${escapeHtml(p.answer)}</p></div>
  ${p.rationale ? `<p class="rationale">${escapeHtml(p.rationale)}</p>` : ""}
  ${p.boundaries.length ? `<p class="boundary"><b>必要边界</b>${p.boundaries.map(escapeHtml).join("；")}</p>` : ""}
  ${p.deferredClaims.length ? `<p class="scope">本次未核查：${p.deferredClaims.map(escapeHtml).join("；")}</p>` : ""}
  ${when ? `<p class="meta">核查于 ${when}</p>` : ""}
  </div>
  ${claimItems}
  ${
    p.sources.length
      ? `<details class="all"><summary>本次共用到 ${p.sources.length} 份材料</summary><ul class="sources">${p.sources
          .map(
            (source) =>
              `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(source.title)}</a> <small>${publishedTag(source.publishedAt)}</small></li>`
          )
          .join("")}</ul></details>`
      : ""
  }
  <a class="cta" href="/">核查你听到的说法</a>`;
  return shell(`${p.claim.slice(0, 40)}｜红鲱鱼与枪`, body, true);
}

/** GET /s/:shareId — 只查分享里存的公开内容，不读 run。 */
export async function renderShareHtmlHandler(req: any, res: any): Promise<void> {
  const token = String(req.params?.shareId ?? "").trim();
  const lookup: ShareLookup = token ? shareStore().read(token) : { state: "missing" };
  const status = lookup.state === "ok" ? 200 : lookup.state === "revoked" ? 410 : 404;
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-cache");
  res.set("X-Robots-Tag", lookup.state === "ok" ? "all" : "noindex");
  res.status(status).send(buildSharedPageHtml(lookup));
}
