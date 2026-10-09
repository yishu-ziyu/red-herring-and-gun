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
import { GUEST_DAILY_SHARES, IP_DAILY_SHARES, shanghaiDayKey } from "../../../src/lib/checkQuota.js";
import { scrubFaceText } from "../../../src/lib/scrubFace.js";
import { conclusionMissesFollowUp, followUpQuestionLead } from "../../../src/lib/composeFollowUpClaim.js";
import { LABEL_TEXT, LABEL_TONE, isLabelKey, judgmentToLabel, type LabelKey } from "../domain/labels.js";

const TOKEN_BYTES = 24;
const SHARE_TTL_DAYS = 30;
/** 只交图片时发给服务端的请求句开头（见 src/lib/caseIntake.ts）。它是内部提示词，公开页里不能出现。 */
const IMAGE_REQUEST_PREFIX = "请核查用户上传的";

/** 公开页显示的全部内容。白名单就是这份类型。 */
export type PublicShareProjection = {
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
  claims: Array<{ text: string; judgment: string | null; label?: LabelKey; reason?: string; evidence: Array<{ role: string; sourceId: string; quote?: string; finding?: string }> }>;
  deferredClaims: string[];
  sources: Array<{ id: string; title: string; url: string; publishedAt?: string }>;
};

type ShareRecord = { shareId: string; runId: string | null; projection: PublicShareProjection; createdAt: number; revokedAt: number | null };

export type ShareLookup =
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
export function projectionFromSnapshot(snapshotValue: unknown, createdAt: number): PublicShareProjection {
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
            ...(str(link.passage) ? { quote: str(link.passage) } : {}),
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

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

type ShareRow = { shareId: string; runId: string | null; projection: string; createdAt: number; revokedAt: number | null };

export type ShareStore = ReturnType<typeof createShareStore>;

export function createShareStore(db: DatabaseSync | null) {
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

const SHARE_PAGE_STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.75; color: #252723; background: #f6f4ef; }
  h1 { font-size: 1.35rem; line-height: 1.5; margin: 0 0 .5rem; }
  h2 { font-size: 1rem; margin: 1.6rem 0 .5rem; }
  .meta { color: #62665e; font-size: .85rem; margin: .25rem 0 1.5rem; }
  .lead { font-size: 1.08rem; }
  .label { display: inline-block; border: 1px solid currentColor; border-radius: 4px; padding: 0 .4rem; font-size: .8rem; font-weight: 500; margin-right: .4rem; }
  .reason { display: block; color: #3d403a; font-size: .9rem; }
  blockquote { margin: .3rem 0 .3rem .2rem; padding-left: .7rem; border-left: 3px solid #dedcd4; color: #3d403a; font-size: .92rem; }
  article { background: #fff; border: 1px solid #dedcd4; border-radius: 12px; padding: 1.1rem 1.25rem; }
  ul { padding-left: 1.1rem; }
  li { margin: .3rem 0; }
  a { color: #a13734; }
  footer { margin-top: 2rem; font-size: .85rem; color: #62665e; }
`;

const LABEL_COLOR: Record<string, string> = { positive: "#15803d", mixed: "#92400e", negative: "#b91c1c", muted: "#62665e" };

/** 标签小块：文字一直显示，颜色只做辅助。 */
function labelChip(label: LabelKey | undefined, attr: string): string {
  if (!label) return "";
  return `<span class="label" ${attr}="${label}" style="color:${LABEL_COLOR[LABEL_TONE[label]]}">${escapeHtml(LABEL_TEXT[label])}</span>`;
}
const ROLE_LABEL: Record<string, string> = { support: "支持", contradict: "反驳", "context-only": "背景" };

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function shell(title: string, body: string, indexable: boolean): string {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="${indexable ? "index,follow" : "noindex"}">
<title>${escapeHtml(title)}</title>
<style>${SHARE_PAGE_STYLE}</style>
</head><body>${body}</body></html>`;
}

/** 只用公开内容渲染分享页。 */
export function buildSharedPageHtml(lookup: ShareLookup): string {
  if (lookup.state === "revoked") {
    return shell(
      "分享链接已撤销 · 红鲱鱼与枪",
      `<main data-share-revoked><h1>这个分享链接已被撤销</h1>
<p>创建者撤销了这个链接，这里不再显示调查内容。</p>
<p><a href="/">回到红鲱鱼与枪</a></p></main>`,
      false
    );
  }
  if (lookup.state === "missing") {
    return shell(
      "分享链接不可用 · 红鲱鱼与枪",
      `<main data-share-missing><h1>分享链接不可用</h1>
<p>这个链接不存在，或已经过期。</p>
<p><a href="/">回到红鲱鱼与枪</a></p></main>`,
      false
    );
  }

  const p = lookup.record.projection;
  const sourceById = new Map(p.sources.map((source) => [source.id, source]));
  const claimItems = p.claims
    .map((claim) => {
      const evidence = claim.evidence
        .map((link) => {
          const source = sourceById.get(link.sourceId);
          const label = `${ROLE_LABEL[link.role] ?? ""}${source ? ` · ${escapeHtml(source.title)}` : ""}`;
          const quote = link.quote ? `<blockquote>${escapeHtml(link.quote)}</blockquote>` : "";
          const finding = link.finding ? `<div>${escapeHtml(link.finding)}</div>` : "";
          return quote || finding ? `<li><small>${label}</small>${quote}${finding}</li>` : "";
        })
        .filter(Boolean)
        .join("");
      const label = labelOf(claim.label, claim.judgment);
      const reason = claim.label && claim.reason ? `<span class="reason" data-share-claim-reason>${escapeHtml(claim.reason)}</span>` : "";
      return `<li data-share-claim>${labelChip(label, "data-share-claim-label")}${escapeHtml(claim.text)}${reason}${evidence ? `<ul>${evidence}</ul>` : ""}</li>`;
    })
    .join("");
  const body = `<main>
  <h1>${escapeHtml(p.claim)}</h1>
  <p class="meta">原调查时间：${escapeHtml(new Date(p.createdAt).toLocaleString("zh-CN", { hour12: false, timeZone: "Asia/Shanghai" }))}${
    p.checkedAt ? ` · 核查完成：${escapeHtml(p.checkedAt)}` : ""
  }</p>
  <article>
    <p class="lead" data-share-conclusion>${labelChip(p.label, "data-share-label")} <strong>${escapeHtml(p.answer)}</strong></p>
    ${p.rationale ? `<p>${escapeHtml(p.rationale)}</p>` : ""}
    ${p.boundaries.length ? `<p>必要边界：${p.boundaries.map(escapeHtml).join("；")}</p>` : ""}
    <p>回答仅针对本轮列出的核查问题，不代表整份材料已获证实。</p>
    ${p.deferredClaims.length ? `<p>本轮未覆盖：${p.deferredClaims.map(escapeHtml).join("；")}</p>` : ""}
    ${claimItems ? `<h2>拆出的问题</h2><ul>${claimItems}</ul>` : ""}
    ${
      p.sources.length
        ? `<h2>用到的材料</h2><ul>${p.sources
            .map(
              (source) =>
                `<li><a href="${escapeHtml(source.url)}" rel="noreferrer nofollow">${escapeHtml(source.title)}</a>${
                  source.publishedAt ? ` <small>${escapeHtml(source.publishedAt)}</small>` : ""
                }</li>`
            )
            .join("")}</ul>`
        : ""
    }
  </article>
  <footer>
    <p>这份页面是创建者当时公开的一轮调查的只读快照，不会随后续修改变化。创建者撤销之后本页即不可读。</p>
    <p><a href="/">用红鲱鱼与枪查自己的说法</a></p>
  </footer>
</main>`;
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
