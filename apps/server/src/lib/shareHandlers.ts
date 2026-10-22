/**
 * shareHandlers — 不登录也能分享一轮调查（#142 part b）。
 *
 * 规矩：
 *   1. 分享只含一轮调查，内容只取服务端为这一轮（run）存下的快照，不收浏览器发来的任何正文。
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
import type { RunRecord } from "./runStore.js";
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
  /** 整句标签与一句理由（#140）。改版前存下的分享没有这两个字段。 */
  label?: LabelKey;
  reason?: string;
  rationale?: string;
  boundaries: string[];
  checkedAt?: string;
  createdAt: number;
  claims: Array<{ text: string; judgment: string | null; label?: LabelKey; reason?: string; evidence: Array<{ role: string; sourceId: string; sentence?: string; note?: string; finding?: string; excerptKind?: string; passage?: string }> }>;
  deferredClaims: string[];
  sources: Array<{ id: string; title: string; url: string; publishedAt?: string; retrievedAt?: string; excerptKind?: string; fetchStatus?: string; fetchNote?: string }>;
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
        ...(isLabelKey(claim.label) ? { label: claim.label } : {}),
        ...(isLabelKey(claim.label) && str(claim.reason) ? { reason: scrubFaceText(str(claim.reason)) } : {}),
        evidence: arr(claim.evidence)
          .map(rec)
          .filter((link) => ["support", "contradict", "context-only"].includes(str(link.role)))
          .map((link) => ({
            role: str(link.role),
            sourceId: str(link.sourceId),
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

type ShareRow = { shareId: string; runId: string | null; projection: string; createdAt: number; revokedAt: number | null };

type ShareStore = ReturnType<typeof createShareStore>;

function createShareStore(db: DatabaseSync | null) {
  const memory = new Map<string, ShareRow>();
  const find = (shareId: string): ShareRow | undefined =>
    db ? (db.prepare("SELECT shareId, runId, projection, createdAt, revokedAt FROM shares WHERE shareId = ?").get(shareId) as ShareRow | undefined) : memory.get(shareId);

  return {
    /** 建分享：返回**明文令牌**，库里只落哈希。 */
    create(run: RunRecord, projection: PublicShareProjection, now = Date.now()): { token: string } {
      const token = randomBytes(TOKEN_BYTES).toString("base64url");
      const shareId = hashShareToken(token);
      const row: ShareRow = { shareId, runId: run.runId, projection: JSON.stringify(projection), createdAt: now, revokedAt: null };
      if (!db) memory.set(shareId, row);
      else
        db.prepare("INSERT INTO shares (shareId, caseId, runId, projection, createdAt, revokedAt) VALUES (?, ?, ?, ?, ?, NULL)").run(
          shareId,
          run.caseId,
          run.runId,
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
      if (!db) memory.set(shareId, { ...row, revokedAt: now });
      else db.prepare("UPDATE shares SET revokedAt = ? WHERE shareId = ?").run(now, shareId);
      return true;
    },
  };
}

let cachedStore: ShareStore | null = null;

function shareStore(): ShareStore {
  if (!cachedStore) cachedStore = createShareStore(openDatabase());
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

export function createShareHandlers(deps: { getRun: (runId: string) => RunRecord | null }) {
  /** POST /api/investigations/:runId/shares — 请求体一律不读。 */
  async function createShareHandler(req: any, res: any): Promise<void> {
    const runId = String(req.params?.runId ?? "").trim();
    const run = runId ? deps.getRun(runId) : null;
    if (!run) return sendJson(res, 404, { message: "没有这次调查" });
    const guestId = ownsRun(req, run);
    if (!guestId) return sendJson(res, 403, { message: "只有发起这次调查的浏览器能分享它" });
    const snapshot = run.snapshot;
    if (run.status !== "completed" || !snapshot || snapshot.phase !== "complete" || !snapshot.conclusion) {
      return sendJson(res, 409, { message: "这次调查还没有查完，查完才能分享" });
    }
    const day = shanghaiDayKey();
    const ipKey = clientIpKey(req);
    if (usedToday(sharesByGuest, guestId, day) >= GUEST_DAILY_SHARES || usedToday(sharesByIp, ipKey, day) >= IP_DAILY_SHARES) {
      return sendJson(res, 429, { message: "今天建的分享链接太多了，明天再试" });
    }
    const { token } = shareStore().create(run, projectionFromSnapshot(snapshot, run.createdAt));
    countShare(sharesByGuest, guestId, day);
    countShare(sharesByIp, ipKey, day);
    return sendJson(res, 201, { shareId: token, url: `/s/${token}` });
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

// 和产品结果页同一套样式（apps/src/goldenPath/result.css）：暖纸底、判断和摘句用衬线、标签颜色只做辅助。
// 分享多半在手机微信里打开，先按手机排；不加载网络字体。
const SHARE_PAGE_STYLE = `
  :root {
    color-scheme: light;
    --canvas: #faf9f5; --ink: #1c1917; --ink-2: #57534e; --ink-3: #8c867f;
    --hairline: #e7e5df; --hairline-subtle: #f0ede6; --inset: #f5f4ef;
    --accent: #8f2d2a; --accent-deep: #732220;
    --positive: #20604c; --positive-bg: rgba(32, 96, 76, 0.08);
    --negative: #8f2d2a; --negative-bg: rgba(143, 45, 42, 0.08);
    --mixed: #855f1a; --mixed-bg: rgba(133, 95, 26, 0.1);
    --muted: #57534e; --muted-bg: rgba(87, 83, 78, 0.08);
    --serif: "Noto Serif SC", "Songti SC", "STSong", serif;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--canvas); color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif; font-size: 15px; line-height: 1.7; -webkit-font-smoothing: antialiased; }
  main { max-width: 720px; margin: 0 auto; padding: 0 16px 32px; overflow-wrap: anywhere; }
  a { color: var(--ink-2); text-decoration-color: var(--hairline); text-underline-offset: 3px; }
  a:hover { text-decoration-color: currentColor; }
  .top { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 0 12px; margin-bottom: 20px; border-bottom: 1px solid var(--hairline-subtle); }
  .brand { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--ink); text-decoration: none; }
  .brand img { width: 26px; height: 26px; border-radius: 6px; }
  .top small { font-size: 12px; color: var(--ink-3); }
  .eyebrow { margin: 0 0 4px; font-size: 12.5px; letter-spacing: .04em; color: var(--ink-3); }
  .claim { margin: 0 0 18px; font-family: var(--serif); font-size: 20px; font-weight: 400; line-height: 1.7; }
  .verdict { display: block; word-break: keep-all; font-family: var(--serif); font-size: 44px; font-weight: 600; line-height: 1.15; letter-spacing: .06em; }
  .headline { margin: 12px 0 0; font-family: var(--serif); font-size: 18px; line-height: 1.8; }
  .tone-positive { color: var(--positive); } .tone-negative { color: var(--negative); } .tone-mixed { color: var(--mixed); } .tone-muted { color: var(--ink); }
  .rationale { margin: 10px 0 0; font-size: 14.5px; line-height: 1.75; color: var(--ink-2); }
  .meta { margin: 12px 0 0; font-size: 13px; color: var(--ink-3); }
  .scope { margin: 6px 0 0; font-size: 13px; color: var(--ink-3); }
  .boundary { margin: 12px 0 4px; padding: 2px 0 2px 12px; border-left: 2px solid var(--hairline); font-size: 14.5px; line-height: 1.75; color: var(--ink-2); }
  .boundary b { display: block; font-size: 12.5px; font-weight: 600; letter-spacing: .04em; color: var(--ink-3); }
  .part { padding: 20px 0 16px; border-top: 1px solid var(--hairline-subtle); }
  .part:first-of-type { margin-top: 22px; }
  .part-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 10px; }
  .part-no { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; margin-right: 10px; border-radius: 50%; background: var(--inset); color: var(--ink-2); font-size: 12px; font-weight: 600; vertical-align: 3px; }
  .part-text { font-family: var(--serif); font-size: 19px; font-weight: 600; line-height: 1.5; }
  .label { display: inline-block; font-size: 13px; font-weight: 600; line-height: 1.6; padding: 1px 10px; border-radius: 999px; white-space: nowrap; }
  .label-positive { color: var(--positive); background: var(--positive-bg); } .label-negative { color: var(--negative); background: var(--negative-bg); }
  .label-mixed { color: var(--mixed); background: var(--mixed-bg); } .label-muted { color: var(--muted); background: var(--muted-bg); }
  .reason { margin: 6px 0 0; font-family: var(--serif); font-size: 16px; line-height: 1.85; color: var(--ink-2); }
  .empty { margin: 10px 0 0; font-size: 14px; color: var(--ink-3); }
  ul.evidence { list-style: none; margin: 12px 0 0; padding: 0; }
  .ev { padding: 8px 0; }
  .ev q { display: block; font-family: var(--serif); font-size: 15.5px; line-height: 1.8; quotes: "「" "」"; }
  .ev-note { display: block; font-size: 14.5px; color: var(--ink-2); }
  .ev-note i { font-style: normal; font-size: 12px; margin-right: 6px; padding: 0 6px; border: 1px solid var(--hairline); border-radius: 6px; color: var(--ink-3); }
  .ev-finding { font-size: 14px; color: var(--ink-2); }
  .ev-src { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px; margin-top: 2px; font-size: 12.5px; color: var(--ink-3); }
  .role { font-weight: 600; } .role-support { color: var(--positive); } .role-contradict { color: var(--negative); }
  .ev-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-top: 6px; font-size: 12.5px; }
  .read { display: inline-flex; align-items: center; gap: 5px; padding: 0 8px; border: 1px solid var(--hairline); border-radius: 6px; line-height: 1.8; color: var(--ink-2); }
  .read::before { content: ""; width: 6px; height: 6px; border-radius: 50%; border: 1.5px solid currentColor; flex: none; }
  .read-read::before { background: currentColor; } .read-partial::before { background: linear-gradient(90deg, currentColor 50%, transparent 50%); }
  .ev-foot details[open] { flex-basis: 100%; }
  details { margin-top: 8px; font-size: 13px; }
  .ev-foot details { margin: 0; font-size: 12.5px; }
  summary { list-style: none; display: inline-flex; align-items: center; gap: 4px; cursor: pointer; color: var(--ink-2); }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: ""; width: 6px; height: 6px; margin-left: 4px; border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor; transform: rotate(-45deg); transition: transform 160ms ease; }
  details[open] > summary::after { transform: rotate(45deg) translate(-2px, -2px); }
  .context { margin: 8px 0 2px; padding-left: 12px; border-left: 2px solid var(--hairline); font-size: 13.5px; color: var(--ink-2); }
  .context blockquote, .context p { margin: 0 0 6px; white-space: pre-wrap; }
  .context small { display: block; font-size: 12.5px; color: var(--ink-3); }
  details ul.evidence { margin-top: 4px; padding-left: 12px; border-left: 2px solid var(--hairline-subtle); }
  .sources { margin: 6px 0 0; padding-left: 18px; font-size: 13.5px; color: var(--ink-2); }
  .sources li { margin: 4px 0; }
  .sources small { color: var(--ink-3); }
  .all { padding-top: 14px; border-top: 1px solid var(--hairline-subtle); }
  .cta { display: block; margin: 26px 0 12px; padding: 12px; border-radius: 12px; background: var(--accent); color: #fff; text-align: center; font-size: 15px; font-weight: 600; text-decoration: none; }
  .cta:hover { background: var(--accent-deep); }
  footer p { margin: 0; font-size: 12px; line-height: 1.7; color: var(--ink-3); text-align: center; }
  h1.notice { margin: 8px 0 8px; font-family: var(--serif); font-size: 22px; }
  @media (min-width: 640px) {
    main { padding: 0 24px 48px; }
    .verdict { font-size: 56px; }
    .headline { font-size: 20px; }
    .part-text { font-size: 21px; }
  }
  @media (prefers-reduced-motion: reduce) { summary::after { transition: none; } }
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
<header class="top"><a class="brand" href="/"><img src="/logo.png?v=20260615" alt="">红鲱鱼与枪</a><small>别人分享给你的调查</small></header>
${body}
</main></body></html>`;
}

/** 只用公开内容渲染分享页。 */
function buildSharedPageHtml(lookup: ShareLookup): string {
  if (lookup.state === "revoked") {
    return shell(
      "分享链接已撤销 · 红鲱鱼与枪",
      `<section data-share-revoked><h1 class="notice">这个分享链接已被撤销</h1>
<p>创建者撤销了这个链接，这里不再显示调查内容。</p>
<a class="cta" href="/">去查你听到的说法</a></section>`,
      false
    );
  }
  if (lookup.state === "missing") {
    return shell(
      "分享链接不可用 · 红鲱鱼与枪",
      `<section data-share-missing><h1 class="notice">分享链接不可用</h1>
<p>这个链接不存在，或已经过期。</p>
<a class="cta" href="/">去查你听到的说法</a></section>`,
      false
    );
  }

  const p = lookup.record.projection;
  // 发布日期：老分享里存的是原样日期，显示时按同一规则读；读不出就照实说没取到。
  const publishedTag = (raw: string | undefined) => {
    const day = normalizePublishedDate(raw);
    return `<span data-share-published="${day ?? ""}">${day ?? "发布日期未取到"}</span>`;
  };
  const sourceById = new Map(p.sources.map((source) => [source.id, source]));
  const evidenceRow = (link: PublicShareProjection["claims"][number]["evidence"][number]): string => {
    const source = sourceById.get(link.sourceId);
    const quote = link.sentence ? `<q data-share-quote>${escapeHtml(link.sentence)}</q>` : "";
    const note = !quote && link.note ? `<span class="ev-note" data-share-note><i>我们的概括</i>${escapeHtml(link.note)}</span>` : "";
    const finding = link.finding ? `<div class="ev-finding">${escapeHtml(link.finding)}</div>` : "";
    if (!quote && !note && !finding && !link.passage) return "";
    const href = source ? quoteLinkUrl(source.url, link.excerptKind === "page-excerpt" ? link.sentence : "") : "";
    const title = escapeHtml(source?.title || "原网页");
    const src = `<span class="ev-src"><span class="role role-${escapeHtml(link.role)}">${ROLE_LABEL[link.role] ?? ""}</span>${
      href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${title} ↗</a>` : `<span>${title}</span>`
    }${source ? publishedTag(source.publishedAt) : ""}</span>`;
    const read = materialReadTag(link, source ?? {});
    const passageNote = [
      materialPassageLabel(link.excerptKind),
      source?.fetchNote ? `正文读取情况：${escapeHtml(source.fetchNote)}` : "",
      materialRetrievedLabel(source?.retrievedAt),
    ].filter(Boolean).join(" · ");
    const material = `<details><summary>看原文上下文</summary><div class="context">${
      link.passage ? `<blockquote>${escapeHtml(link.passage)}</blockquote>` : "<p>这条依据没有保存可检查的上下文。</p>"
    }<small>${passageNote}</small></div></details>`;
    return `<li class="ev" data-share-material-kind="${escapeHtml(link.excerptKind ?? "unknown")}" data-share-source-id="${escapeHtml(link.sourceId)}" data-share-role="${escapeHtml(link.role)}">${quote}${note}${finding}${src}<div class="ev-foot"><span class="read read-${read.level}" data-share-material-status>${read.text}</span>${material}</div></li>`;
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
  <div class="part-head"><span><span class="part-no" aria-hidden="true">${index + 1}</span><span class="part-text">${escapeHtml(claim.text)}</span></span>${chip}</div>
  ${reason}
  ${decisive.length ? `<ul class="evidence">${decisive.join("")}</ul>` : `<p class="empty">没有找到直接支持或反驳这一截的依据。</p>`}
  ${background.length ? `<details><summary>另有 ${background.length} 条背景材料，没有用来判断</summary><ul class="evidence">${background.join("")}</ul></details>` : ""}
</article>`;
    })
    .join("");
  const when = readableTime(p.checkedAt) || readableTime(p.createdAt);
  const metaParts = [p.claims.length ? `查了 ${p.claims.length} 截` : "", when ? `核查于 ${when}` : ""].filter(Boolean);
  const body = `<p class="eyebrow">调查的说法</p>
  <h1 class="claim">「${escapeHtml(p.claim)}」</h1>
  <p class="eyebrow">结论</p>
  <div data-share-conclusion>${
    p.label ? `<span class="verdict tone-${LABEL_TONE[p.label]}" data-share-label="${p.label}">${escapeHtml(LABEL_TEXT[p.label])}</span>` : ""
  }<p class="headline">${escapeHtml(p.answer)}</p></div>
  ${p.rationale ? `<p class="rationale">${escapeHtml(p.rationale)}</p>` : ""}
  ${metaParts.length ? `<p class="meta">${metaParts.join(" · ")}</p>` : ""}
  <p class="scope">结论只针对下面列出的几截，不代表整段话都已证实。</p>
  ${p.boundaries.length ? `<p class="boundary"><b>必要边界</b>${p.boundaries.map(escapeHtml).join("；")}</p>` : ""}
  ${p.deferredClaims.length ? `<p class="scope">这次没有查：${p.deferredClaims.map(escapeHtml).join("；")}</p>` : ""}
  ${claimItems}
  ${
    p.sources.length
      ? `<details class="all"><summary>这次一共用到 ${p.sources.length} 份材料</summary><ul class="sources">${p.sources
          .map(
            (source) =>
              `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer nofollow">${escapeHtml(source.title)}</a> <small>${publishedTag(source.publishedAt)}</small></li>`
          )
          .join("")}</ul></details>`
      : ""
  }
  <a class="cta" href="/">去查你听到的说法</a>
  <footer><p>这是分享人当时的调查快照，之后不会再变；分享人撤销后，这个链接就打不开了。</p></footer>`;
  return shell(`${p.claim.slice(0, 40)} · 红鲱鱼与枪`, body, true);
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
