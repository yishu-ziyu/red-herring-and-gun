/**
 * caseHandlers.ts — Plan Item 2 · 报告 URL 路由 HTTP handler
 *
 * POST /api/case      → 保存 case（带 claimReview JSON-LD）→ 返回 caseId
 * GET  /api/case/:id  → 取出 case JSON
 * GET  /r/:id         → HTML 页面（带 case JSON 注入），让浏览器 + 爬虫都能消费
 *
 * 隔离：纯逻辑与 HTTP 框架解耦（接收 Express req/res）。
 */

import type { Request, Response } from "express";
import { getCase, listCases, putCase } from "./caseStore.js";
import type { FinalReport } from "./schemas.js";
import { buildClaimReviewJsonLd } from "./claimReview.js";

interface PostCaseBody {
  claim?: string;
  report?: FinalReport;
  credibilityScore?: number;
}

/**
 * POST /api/case — 保存 case
 */
export async function postCaseHandler(req: Request, res: Response): Promise<void> {
  const body = (req.body ?? {}) as PostCaseBody;
  const claim = (body.claim ?? "").trim();
  if (!claim) {
    res.status(400).json({ error: "claim is required" });
    return;
  }
  if (!body.report) {
    res.status(400).json({ error: "report is required" });
    return;
  }

  const caseId = (req.body?.caseId as string | undefined) ?? undefined;
  const claimReview = buildClaimReviewJsonLd(body.report, { url: undefined });
  const entry = putCase({
    caseId,
    claim,
    report: body.report,
    claimReview,
    credibilityScore: typeof body.credibilityScore === "number" ? body.credibilityScore : 50,
  });
  res.json({ caseId: entry.caseId, createdAt: entry.createdAt });
}

/**
 * GET /api/case/:caseId — 取出 case JSON
 */
export function getCaseHandler(req: Request, res: Response): void {
  const caseId = (req.params.caseId ?? "").trim();
  if (!caseId) {
    res.status(400).json({ error: "caseId is required" });
    return;
  }
  const entry = getCase(caseId);
  if (!entry) {
    res.status(404).json({ error: "case not found", caseId });
    return;
  }
  res.json(entry);
}

/**
 * GET /r/:caseId — 返回 HTML 页面（带 case JSON 嵌入）
 * 让浏览器/爬虫/分享预览都能消费。
 */
export function renderCaseHtmlHandler(req: Request, res: Response): void {
  const caseId = (req.params.caseId ?? "").trim();
  const entry = caseId ? getCase(caseId) : null;
  const html = buildSharePageHtml(caseId, entry);
  res.set("Content-Type", "text/html; charset=utf-8");
  res.set("Cache-Control", "no-cache");
  res.status(entry ? 200 : 404).send(html);
}

/**
 * GET /api/cases — 列出最近 case（管理员/debug 用）
 */
export function listCasesHandler(_req: Request, res: Response): void {
  res.json({ cases: listCases(50) });
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

  // 把 case JSON 嵌入 <script type="application/ld+json">（schema.org/ClaimReview）
  // 让 Google 爬虫和分享预览都能读到 ClaimReview 元数据
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}