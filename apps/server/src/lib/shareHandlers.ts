/**
 * shareHandlers — 显式分享（IMPLEMENTATION_PLAN §3.5、§5.3）。
 *
 * 三条规矩：
 *   1. 分享是用户明确创建的一次只读投影，不是把私有记录默认公开。
 *   2. 链接令牌随机、不可由 caseId 猜出；库里只存令牌的哈希，不存令牌本身。
 *   3. 撤销之后链接读不到任何正文；但不承诺抹掉别人已经下载的副本。
 *
 * 投影用白名单构造，不用黑名单过滤：将来 report 里多了字段，默认不出去。
 */
import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getCase, type CaseEntry } from "./caseStore.js";
import { openDatabase } from "./sqliteStore.js";
import { readEmailAccountOptional } from "./emailSession.js";

const TOKEN_BYTES = 24;
const SHARE_TTL_DAYS = 30;

export type ShareRecord = {
  shareId: string;
  caseId: string;
  projection: PublicShareProjection;
  createdAt: number;
  revokedAt: number | null;
};

/** 公开页只读到的字段。白名单就是这份类型。 */
export type PublicShareProjection = {
  caseId: string;
  claim: string;
  report: Record<string, unknown>;
  claimReview: Record<string, unknown>;
  credibilityScore: number;
  createdAt: number;
  checkedAt?: string;
};

/** 递归丢掉任何名字像秘密的键：投影里宁可少一个字段，也不多一个。 */
const SECRET_KEY_RE = /(apikey|api_key|secret|token|password|byokey|authorization|cookie|email|ownerhash|upload|memoryrecall|thought|trace|debug|systemprompt)/i;

function redact(value: unknown, depth = 0): unknown {
  if (depth > 12) return undefined;
  if (Array.isArray(value)) {
    const out = value.map((item) => redact(item, depth + 1)).filter((item) => item !== undefined);
    return out;
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_RE.test(key)) continue;
      const cleaned = redact(item, depth + 1);
      if (cleaned !== undefined) out[key] = cleaned;
    }
    return out;
  }
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "undefined") return undefined;
  return value;
}

/** 从 case 造公开投影。ownerHash、feedback 一律不进。 */
export function buildPublicProjection(entry: CaseEntry): PublicShareProjection {
  return {
    caseId: entry.caseId,
    claim: entry.claim,
    report: (redact(entry.report) as Record<string, unknown>) ?? {},
    claimReview: (redact(entry.claimReview) as Record<string, unknown>) ?? {},
    credibilityScore: entry.credibilityScore,
    createdAt: entry.createdAt,
    ...(typeof (entry.report as { checkedAt?: unknown })?.checkedAt === "string"
      ? { checkedAt: (entry.report as { checkedAt: string }).checkedAt }
      : {}),
  };
}

export function hashShareToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newShareToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

type ShareRow = {
  shareId: string;
  caseId: string;
  projection: string;
  createdAt: number;
  revokedAt: number | null;
};

export type ShareStore = ReturnType<typeof createShareStore>;

export function createShareStore(db: DatabaseSync | null) {
  const memory = new Map<string, ShareRecord>();

  return {
    /** 建分享：返回**明文令牌**，库里只落哈希。 */
    create(
      entry: CaseEntry,
      options: { now?: number; ttlDays?: number } = {}
    ): { shareId: string; createdAt: number; expiresAt: number; projection: PublicShareProjection } {
      const token = newShareToken();
      const shareId = hashShareToken(token);
      const now = options.now ?? Date.now();
      const ttlDays = options.ttlDays ?? SHARE_TTL_DAYS;
      const projection = buildPublicProjection(entry);
      if (!db) {
        memory.set(shareId, { shareId, caseId: entry.caseId, projection, createdAt: now, revokedAt: null });
        return { shareId: token, createdAt: now, expiresAt: now + ttlDays * 86_400_000, projection };
      }
      db.prepare("INSERT INTO shares (shareId, caseId, projection, createdAt, revokedAt) VALUES (?, ?, ?, ?, NULL)").run(
        shareId,
        entry.caseId,
        JSON.stringify(projection),
        now
      );
      return { shareId: token, createdAt: now, expiresAt: now + ttlDays * 86_400_000, projection };
    },

    /** 按令牌找分享。过期、撤销、找不到都返回 null——对外只有「不可读」一种说法。 */
    read(token: string, now = Date.now()): ShareRecord | null {
      const shareId = hashShareToken(token);
      let record: ShareRecord | null = null;
      if (!db) {
        record = memory.get(shareId) ?? null;
      } else {
        const row = db.prepare("SELECT * FROM shares WHERE shareId = ?").get(shareId) as ShareRow | undefined;
        if (row) {
          let projection: PublicShareProjection | null = null;
          try {
            projection = JSON.parse(row.projection) as PublicShareProjection;
          } catch {
            projection = null;
          }
          record = projection
            ? { shareId: row.shareId, caseId: row.caseId, projection, createdAt: row.createdAt, revokedAt: row.revokedAt ?? null }
            : null;
        }
      }
      if (!record) return null;
      if (record.revokedAt) return null;
      if (now - record.createdAt > SHARE_TTL_DAYS * 86_400_000) return null;
      return record;
    },

    /** 撤销：只标记，不删行（审计要看得出曾经分享过）。幂等。 */
    revoke(token: string, now = Date.now()): { ok: boolean; alreadyRevoked: boolean } {
      const shareId = hashShareToken(token);
      if (!db) {
        const record = memory.get(shareId);
        if (!record) return { ok: false, alreadyRevoked: false };
        const already = Boolean(record.revokedAt);
        memory.set(shareId, { ...record, revokedAt: record.revokedAt ?? now });
        return { ok: true, alreadyRevoked: already };
      }
      const row = db.prepare("SELECT revokedAt FROM shares WHERE shareId = ?").get(shareId) as
        | { revokedAt: number | null }
        | undefined;
      if (!row) return { ok: false, alreadyRevoked: false };
      if (row.revokedAt) return { ok: true, alreadyRevoked: true };
      db.prepare("UPDATE shares SET revokedAt = ? WHERE shareId = ?").run(now, shareId);
      return { ok: true, alreadyRevoked: false };
    },

    /** 主人视角：这条 case 现在有几个还没撤销的分享。 */
    listActive(caseId: string): Array<{ shareId: string; createdAt: number }> {
      if (!db) {
        return [...memory.values()]
          .filter((record) => record.caseId === caseId && !record.revokedAt)
          .map((record) => ({ shareId: record.shareId, createdAt: record.createdAt }));
      }
      const rows = db
        .prepare("SELECT shareId, createdAt FROM shares WHERE caseId = ? AND revokedAt IS NULL ORDER BY createdAt DESC")
        .all(caseId) as Array<{ shareId: string; createdAt: number }>;
      return rows;
    },
  };
}

let cachedStore: ShareStore | null = null;

export function shareStore(): ShareStore {
  if (!cachedStore) cachedStore = createShareStore(openDatabase());
  return cachedStore;
}

/** 测试用：换一份存储。 */
export function __setShareStoreForTests(store: ShareStore | null): void {
  cachedStore = store;
}

const SHARE_PAGE_STYLE = `
  :root { color-scheme: light; }
  body { font-family: -apple-system, "PingFang SC", sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.75; color: #252723; background: #f6f4ef; }
  h1 { font-size: 1.35rem; line-height: 1.5; margin: 0 0 .5rem; }
  h2 { font-size: 1rem; margin: 1.6rem 0 .5rem; }
  .meta { color: #62665e; font-size: .85rem; margin: .25rem 0 1.5rem; }
  .lead { font-size: 1.08rem; }
  article { background: #fff; border: 1px solid #dedcd4; border-radius: 12px; padding: 1.1rem 1.25rem; }
  ul { padding-left: 1.1rem; }
  li { margin: .3rem 0; }
  a { color: #a13734; }
  footer { margin-top: 2rem; font-size: .85rem; color: #62665e; }
`;

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 只用投影渲染公开页；读不到就一种 404，不区分「不存在 / 已撤销 / 已过期」。 */
export function buildSharedPageHtml(token: string, projection: PublicShareProjection | null): string {
  const shell = (title: string, body: string) =>
    `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="robots" content="${projection ? "index,follow" : "noindex"}">
<title>${escapeHtml(title)}</title>
<style>${SHARE_PAGE_STYLE}</style>
</head><body>${body}</body></html>`;

  if (!projection) {
    return shell(
      "分享链接不可用 · 红鲱鱼与枪",
      `<main><h1>分享链接不可用</h1>
<p>这个链接不存在、已被撤销，或已经过期。分享由创建者控制，撤销之后就读不到了。</p>
<p><a href="/">回到红鲱鱼与枪</a></p></main>`
    );
  }

  const report = projection.report as Record<string, unknown>;
  const conclusion = typeof report.conclusion === "string" ? report.conclusion : "";
  const verdictLead = typeof report.causalBoundary === "string" ? report.causalBoundary : "";
  const investigation = report.investigation as { claims?: Array<{ text?: string }>; sources?: Array<{ title?: string; url?: string }> } | undefined;
  const claims = Array.isArray(investigation?.claims) ? investigation!.claims! : [];
  const sources = Array.isArray(investigation?.sources) ? investigation!.sources! : [];
  const checkedAt = projection.checkedAt ?? "";

  const body = `<main>
  <h1>${escapeHtml(projection.claim)}</h1>
  <p class="meta">原调查时间：${escapeHtml(new Date(projection.createdAt).toLocaleString("zh-CN", { hour12: false }))}${
    checkedAt ? ` · 核查完成：${escapeHtml(checkedAt)}` : ""
  }</p>
  <article>
    ${conclusion ? `<p class="lead"><strong>${escapeHtml(conclusion)}</strong></p>` : ""}
    ${verdictLead ? `<p>${escapeHtml(verdictLead)}</p>` : ""}
    ${claims.length ? `<h2>拆出的问题</h2><ul>${claims.map((claim) => `<li>${escapeHtml(claim.text ?? "")}</li>`).join("")}</ul>` : ""}
    ${
      sources.length
        ? `<h2>用到的材料</h2><ul>${sources
            .map((source) =>
              source.url
                ? `<li><a href="${escapeHtml(source.url)}" rel="noreferrer nofollow">${escapeHtml(source.title ?? source.url)}</a></li>`
                : `<li>${escapeHtml(source.title ?? "")}</li>`
            )
            .join("")}</ul>`
        : ""
    }
  </article>
  <footer>
    <p>这份页面是创建者当时公开的只读快照，不会随后续修改变化。撤销之后本页即不可读。</p>
    <p><a href="/">用红鲱鱼与枪查自己的说法</a></p>
  </footer>
</main>`;

  return shell(`${projection.claim.slice(0, 40)} · 红鲱鱼与枪`, body);
}

/**
 * GET /api/cases/:caseId/share-preview — 创建之前先看到会公开哪些字段。
 * 只看不写：这个端点不产生链接。
 */
export async function previewShareHandler(req: any, res: any): Promise<void> {
  const caseId = String(req.params?.caseId ?? "").trim();
  const entry = caseId ? getCase(caseId) : null;
  if (!entry || !entry.ownerHash) {
    res.status(404).json({ error: "case not found" });
    return;
  }
  const account = await readEmailAccountOptional(req);
  if (!account || account.hash !== entry.ownerHash) {
    res.status(404).json({ error: "case not found" });
    return;
  }
  res.status(200).json({ preview: buildPublicProjection(entry) });
}

/** POST /api/cases/:caseId/shares — 只有主人能建；返回明文令牌一次。 */
export async function createShareHandler(req: any, res: any): Promise<void> {
  const caseId = String(req.params?.caseId ?? "").trim();
  const entry = caseId ? getCase(caseId) : null;
  if (!entry || !entry.ownerHash) {
    res.status(404).json({ error: "case not found" });
    return;
  }
  const account = await readEmailAccountOptional(req);
  if (!account || account.hash !== entry.ownerHash) {
    res.status(404).json({ error: "case not found" });
    return;
  }
  const created = shareStore().create(entry);
  res.status(201).json({
    shareId: created.shareId,
    url: `/s/${created.shareId}`,
    createdAt: created.createdAt,
    expiresAt: created.expiresAt,
    // 创建前就能看到的公开字段：就是这份投影本身。
    preview: created.projection,
  });
}

/** DELETE /api/cases/:caseId/shares/:shareId — 只有主人能撤销。 */
export async function revokeShareHandler(req: any, res: any): Promise<void> {
  const caseId = String(req.params?.caseId ?? "").trim();
  const token = String(req.params?.shareId ?? "").trim();
  const entry = caseId ? getCase(caseId) : null;
  if (!entry || !entry.ownerHash) {
    res.status(404).json({ error: "case not found" });
    return;
  }
  const account = await readEmailAccountOptional(req);
  if (!account || account.hash !== entry.ownerHash) {
    res.status(404).json({ error: "case not found" });
    return;
  }
  const result = shareStore().revoke(token);
  if (!result.ok) {
    res.status(404).json({ error: "share not found" });
    return;
  }
  res.status(200).json({ revoked: true, alreadyRevoked: result.alreadyRevoked });
}

/** GET /s/:shareId — 只查分享投影，不读私有 case。 */
export async function renderShareHtmlHandler(req: any, res: any): Promise<void> {
  const token = String(req.params?.shareId ?? "").trim();
  const record = token ? shareStore().read(token) : null;
  const html = buildSharedPageHtml(token, record?.projection ?? null);
  if (typeof res.set === "function") {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-cache");
    res.set("X-Robots-Tag", record ? "all" : "noindex");
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
  }
  res.statusCode = record ? 200 : 404;
  if (typeof res.status === "function") res.status(record ? 200 : 404);
  if (typeof res.send === "function") {
    res.send(html);
    return;
  }
  res.end(html);
}
