/**
 * caseHandlers.ts — 报告 URL 路由 HTTP handler
 *
 * POST /api/case      → 保存 case（带 claimReview JSON-LD）→ 返回 caseId
 * GET  /api/case/:id  → 取出 case JSON（有归属则只给主人）
 * GET  /r/:id         → HTML 页面（带 case JSON 注入），分享仍公开
 * GET  /api/cases     → 当前登录账号的最近核查；未登录返回 []
 */

import { getCase, listCases, putCase } from "./caseStore.js";
import type { FinalReport } from "./schemas.js";
import { buildClaimReviewJsonLd } from "./claimReview.js";
import { readEmailAccountOptional } from "./emailSession.js";

interface PostCaseBody {
  claim?: string;
  report?: FinalReport;
  credibilityScore?: number;
  caseId?: string;
}

function sendJson(res: any, status: number, body: unknown) {
  if (typeof res.status === "function" && typeof res.json === "function") {
    res.status(status).json(body);
    return;
  }
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function caseStatus(report: FinalReport): "done" | "interrupted" {
  const source = (report as { _source?: unknown })._source;
  return source === "error-boundary" ? "interrupted" : "done";
}

function toListItem(entry: ReturnType<typeof getCase>) {
  if (!entry) return null;
  return {
    caseId: entry.caseId,
    claim: entry.claim,
    createdAt: entry.createdAt,
    credibilityScore: entry.credibilityScore,
    status: caseStatus(entry.report),
  };
}

function toPublicCase(entry: NonNullable<ReturnType<typeof getCase>>) {
  const { ownerHash: _ownerHash, ...rest } = entry;
  void _ownerHash;
  return rest;
}

/**
 * POST /api/case — 保存 case。有邮箱会话则写入归属。
 */
export async function postCaseHandler(req: any, res: any): Promise<void> {
  const body = (req.body ?? {}) as PostCaseBody;
  const claim = (body.claim ?? "").trim();
  if (!claim) {
    sendJson(res, 400, { error: "claim is required" });
    return;
  }
  if (!body.report) {
    sendJson(res, 400, { error: "report is required" });
    return;
  }

  const account = await readEmailAccountOptional(req);
  const caseId = typeof body.caseId === "string" ? body.caseId : undefined;
  const claimReview = buildClaimReviewJsonLd(body.report, { url: undefined });
  const entry = putCase({
    caseId,
    claim,
    report: body.report,
    claimReview,
    credibilityScore: typeof body.credibilityScore === "number" ? body.credibilityScore : 50,
    ownerHash: account?.hash,
  });
  sendJson(res, 200, { caseId: entry.caseId, createdAt: entry.createdAt });
}

/**
 * GET /api/case/:caseId — 取出 case JSON
 */
export async function getCaseHandler(req: any, res: any): Promise<void> {
  const caseId = String(req.params?.caseId ?? "").trim();
  if (!caseId) {
    sendJson(res, 400, { error: "caseId is required" });
    return;
  }
  const entry = getCase(caseId);
  if (!entry) {
    sendJson(res, 404, { error: "case not found", caseId });
    return;
  }
  if (entry.ownerHash) {
    const account = await readEmailAccountOptional(req);
    if (!account || account.hash !== entry.ownerHash) {
      sendJson(res, 404, { error: "case not found", caseId });
      return;
    }
  }
  sendJson(res, 200, toPublicCase(entry));
}

/**
 * GET /r/:caseId — 返回 HTML 页面（带 case JSON 嵌入）
 * 让浏览器/爬虫/分享预览都能消费。
 */
export function renderCaseHtmlHandler(req: any, res: any): void {
  const caseId = String(req.params?.caseId ?? "").trim();
  const entry = caseId ? getCase(caseId) : null;
  const html = buildSharePageHtml(caseId, entry);
  if (typeof res.set === "function") {
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-cache");
  } else {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
  }
  res.statusCode = entry ? 200 : 404;
  if (typeof res.status === "function") res.status(entry ? 200 : 404);
  if (typeof res.send === "function") {
    res.send(html);
    return;
  }
  res.end(html);
}

/**
 * GET /api/cases — 当前登录账号的最近核查。未登录不泄漏全库。
 */
export async function listCasesHandler(req: any, res: any): Promise<void> {
  const account = await readEmailAccountOptional(req);
  if (!account) {
    sendJson(res, 200, { cases: [] });
    return;
  }
  sendJson(res, 200, {
    cases: listCases(50, account.hash).map((entry) => toListItem(entry)),
  });
}

function buildSharePageHtml(caseId: string, entry: ReturnType<typeof getCase>): string {
  if (!entry) {
    return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>报告未找到 · 红鲱鱼与枪</title></head>
<body><main><h1>报告未找到</h1>
<p>caseId: <code>${escapeHtml(caseId)}</code> 不存在或已过期。</p>
<p>本系统是进程内存储，重启服务进程会清空历史 case。请生成新报告后立即复制 URL 分享。</p>
<p><a href="/">返回首页</a></p></main></body></html>`;
  }

  const jsonLdScript = JSON.stringify(entry.claimReview)
    .replace(/<\/script/gi, "<\\/script");

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(entry.claim.slice(0, 40))} · 红鲱鱼与枪核查报告</title>
  <meta name="description" content="红鲱鱼与枪核查报告 · 可信度 ${entry.credibilityScore}分">
  <meta property="og:title" content="红鲱鱼与枪核查：${escapeHtml(entry.claim.slice(0, 60))}">
  <meta property="og:description" content="可信度 ${entry.credibilityScore}分 · schema.org/ClaimReview">
  <meta property="og:type" content="article">
  <script type="application/ld+json">${jsonLdScript}</script>
  <style>
    body { font-family: -apple-system, sans-serif; max-width: 720px; margin: 2rem auto; padding: 0 1rem; line-height: 1.6; color: #222; }
    h1 { font-size: 1.4rem; border-bottom: 2px solid #2ecc71; padding-bottom: 0.4rem; }
    .meta { color: #666; font-size: 0.9rem; margin: 0.5rem 0 1.5rem; }
    .score { display: inline-block; padding: 4px 12px; background: #2ecc71; color: #fff; border-radius: 4px; font-weight: 600; }
    .score-low { background: #e74c3c; }
    .report-block { background: #f8f9fa; padding: 1rem 1.2rem; border-left: 4px solid #2ecc71; margin: 1rem 0; }
    a { color: #2ecc71; }
  </style>
</head>
<body>
  <main>
    <h1>${escapeHtml(entry.claim)}</h1>
    <p class="meta">
      <span class="score ${entry.credibilityScore < 40 ? "score-low" : ""}">可信度 ${entry.credibilityScore}分</span>
      · 报告 ID <code>${escapeHtml(entry.caseId)}</code>
      · ${new Date(entry.createdAt).toLocaleString("zh-CN")}
    </p>
    <div class="report-block">
      <h2>核查结论</h2>
      <p>${escapeHtml(entry.report.rewrittenClaim.cautious)}</p>
      <h3>对公众的简化版</h3>
      <p>${escapeHtml(entry.report.rewrittenClaim.publicFacing)}</p>
    </div>
    <p><a href="https://gun.yishuziyu.cn/r/${escapeHtml(entry.caseId)}">分享此报告</a> · <a href="/">回到红鲱鱼与枪</a></p>
  </main>
</body>
</html>`;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
